'use strict';

const fs = require('fs');
const path = require('path');
const { COLS, ROWS, INPUTS, encode } = require('./env');

const DEFAULT_H1 = 96;
const DEFAULT_H2 = 96;

function shape(net) {
  return {
    h1: net.h1 || (net.meta && net.meta.h1) || DEFAULT_H1,
    h2: net.h2 || (net.meta && net.meta.h2) || DEFAULT_H2,
  };
}

function randW(n, fan, rng) {
  const values = new Float32Array(n);
  const scale = Math.sqrt(2 / fan);
  for (let i = 0; i < n; i++) values[i] = (rng() * 2 - 1) * scale;
  return values;
}

function createNet(options = {}) {
  const h1 = options.h1 || DEFAULT_H1;
  const h2 = options.h2 || DEFAULT_H2;
  const rng = options.rng || Math.random;
  return {
    W1: randW(h1 * INPUTS, INPUTS, rng),
    b1: new Float32Array(h1),
    W2: randW(h2 * h1, h1, rng),
    b2: new Float32Array(h2),
    Wp: randW(COLS * h2, h2, rng),
    bp: new Float32Array(COLS),
    Wv: randW(h2, h2, rng),
    bv: new Float32Array(1),
    h1,
    h2,
  };
}

function dense(W, b, x, out) {
  const outputs = out.length;
  const inputs = x.length;
  for (let i = 0; i < outputs; i++) {
    let sum = b[i];
    const base = i * inputs;
    for (let j = 0; j < inputs; j++) sum += W[base + j] * x[j];
    out[i] = sum;
  }
  return out;
}

function relu(values) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) values[i] = 0;
  }
  return values;
}

function forwardInput(net, x) {
  const { h1: H1, h2: H2 } = shape(net);
  const h1 = relu(dense(net.W1, net.b1, x, new Float32Array(H1)));
  const h2 = relu(dense(net.W2, net.b2, h1, new Float32Array(H2)));
  const pl = dense(net.Wp, net.bp, h2, new Float32Array(COLS));
  let valueSum = net.bv[0];
  for (let j = 0; j < H2; j++) valueSum += net.Wv[j] * h2[j];
  return { h1, h2, pl, value: Math.tanh(valueSum) };
}

function forward(net, board, player) {
  return forwardInput(net, encode(board, player));
}

function softmaxLegal(logits, moves) {
  let max = -Infinity;
  for (const move of moves) max = Math.max(max, logits[move]);

  let sum = 0;
  const probs = {};
  for (const move of moves) {
    probs[move] = Math.exp(logits[move] - max);
    sum += probs[move];
  }
  for (const move of moves) probs[move] /= sum || 1;
  return probs;
}

function fromWeights(weights) {
  const meta = weights.meta || {};
  return {
    W1: Float32Array.from(weights.W1),
    b1: Float32Array.from(weights.b1),
    W2: Float32Array.from(weights.W2),
    b2: Float32Array.from(weights.b2),
    Wp: Float32Array.from(weights.Wp),
    bp: Float32Array.from(weights.bp),
    Wv: Float32Array.from(weights.Wv),
    bv: Float32Array.from(weights.bv),
    h1: meta.h1 || DEFAULT_H1,
    h2: meta.h2 || DEFAULT_H2,
    meta,
  };
}

function toWeights(net, meta = {}) {
  const { h1, h2 } = shape(net);
  const out = {};
  for (const key of ['W1', 'b1', 'W2', 'b2', 'Wp', 'bp', 'Wv', 'bv']) {
    out[key] = Array.from(net[key], value => +value.toFixed(5));
  }
  out.meta = { in: INPUTS, h1, h2, cols: COLS, rows: ROWS, ...meta };
  return out;
}

function loadWeights(file) {
  return fromWeights(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function saveWeights(file, net, meta) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(toWeights(net, meta)));
}

function makeAdam(net) {
  const m = {};
  const v = {};
  for (const key of ['W1', 'b1', 'W2', 'b2', 'Wp', 'bp', 'Wv', 'bv']) {
    m[key] = new Float32Array(net[key].length);
    v[key] = new Float32Array(net[key].length);
  }
  return { m, v, t: 0 };
}

function trainBatch(net, adam, batch, lr) {
  const { h1: H1, h2: H2 } = shape(net);
  const grads = {};
  for (const key of ['W1', 'b1', 'W2', 'b2', 'Wp', 'bp', 'Wv', 'bv']) {
    grads[key] = new Float32Array(net[key].length);
  }

  let lossV = 0;
  let lossP = 0;
  for (const sample of batch) {
    const f = forwardInput(net, sample.x);
    const dv = (f.value - sample.z) * (1 - f.value * f.value);
    lossV += (f.value - sample.z) ** 2;

    let max = -Infinity;
    for (let i = 0; i < COLS; i++) max = Math.max(max, f.pl[i]);
    let sum = 0;
    const sm = new Float32Array(COLS);
    for (let i = 0; i < COLS; i++) {
      sm[i] = Math.exp(f.pl[i] - max);
      sum += sm[i];
    }
    for (let i = 0; i < COLS; i++) sm[i] /= sum || 1;

    const dpl = new Float32Array(COLS);
    for (let i = 0; i < COLS; i++) {
      dpl[i] = sm[i] - sample.pi[i];
      if (sample.pi[i] > 0) lossP -= sample.pi[i] * Math.log(sm[i] + 1e-9);
    }

    const dh2 = new Float32Array(H2);
    for (let i = 0; i < H2; i++) {
      let g = dv * net.Wv[i];
      for (let out = 0; out < COLS; out++) g += dpl[out] * net.Wp[out * H2 + i];
      dh2[i] = g * (f.h2[i] > 0 ? 1 : 0);
    }
    for (let i = 0; i < H2; i++) {
      grads.Wv[i] += dv * f.h2[i];
      for (let out = 0; out < COLS; out++) grads.Wp[out * H2 + i] += dpl[out] * f.h2[i];
    }
    grads.bv[0] += dv;
    for (let out = 0; out < COLS; out++) grads.bp[out] += dpl[out];

    const dh1 = new Float32Array(H1);
    for (let i = 0; i < H2; i++) {
      const g = dh2[i];
      const base = i * H1;
      for (let j = 0; j < H1; j++) {
        grads.W2[base + j] += g * f.h1[j];
        dh1[j] += g * net.W2[base + j];
      }
      grads.b2[i] += g;
    }
    for (let j = 0; j < H1; j++) dh1[j] *= f.h1[j] > 0 ? 1 : 0;
    for (let i = 0; i < H1; i++) {
      const g = dh1[i];
      const base = i * INPUTS;
      for (let j = 0; j < INPUTS; j++) grads.W1[base + j] += g * sample.x[j];
      grads.b1[i] += g;
    }
  }

  const n = batch.length || 1;
  adam.t++;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  const bias1 = 1 - Math.pow(beta1, adam.t);
  const bias2 = 1 - Math.pow(beta2, adam.t);
  for (const key of ['W1', 'b1', 'W2', 'b2', 'Wp', 'bp', 'Wv', 'bv']) {
    const weights = net[key];
    const grad = grads[key];
    const m = adam.m[key];
    const v = adam.v[key];
    for (let i = 0; i < weights.length; i++) {
      const g = grad[i] / n;
      m[i] = beta1 * m[i] + (1 - beta1) * g;
      v[i] = beta2 * v[i] + (1 - beta2) * g * g;
      weights[i] -= lr * (m[i] / bias1) / (Math.sqrt(v[i] / bias2) + eps);
    }
  }

  return { v: lossV / n, p: lossP / n };
}

module.exports = {
  DEFAULT_H1,
  DEFAULT_H2,
  createNet,
  forward,
  forwardInput,
  softmaxLegal,
  fromWeights,
  toWeights,
  loadWeights,
  saveWeights,
  makeAdam,
  trainBatch,
};

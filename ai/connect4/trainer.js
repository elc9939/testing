'use strict';

const path = require('path');
const { COLS, ROWS, INPUTS, newBoard, legalMoves, drop, wins, encode, otherPlayer } = require('./env');
const { createNet, makeAdam, trainBatch, saveWeights, DEFAULT_H1, DEFAULT_H2 } = require('./net');
const { mcts, visitPolicy } = require('./mcts');
const { rngFromSeed } = require('./random');

const DEFAULT_DEST = path.resolve(__dirname, '../../js/games/connect4-weights.json');

function finalize(traj, winner) {
  return traj.map(sample => ({
    x: sample.x,
    pi: sample.pi,
    z: winner === 0 ? 0 : (winner === sample.player ? 1 : -1),
  }));
}

function pickFromPolicy(moves, pi, rng) {
  let random = rng();
  let move = moves[0];
  for (const candidate of moves) {
    random -= pi[candidate];
    if (random <= 0) return candidate;
  }
  return move;
}

function selfPlay(net, sims, options = {}) {
  const rng = options.rng || Math.random;
  const board = newBoard();
  let player = 1;
  const traj = [];
  let ply = 0;

  for (;;) {
    const moves = legalMoves(board);
    if (!moves.length) return finalize(traj, 0);

    const root = mcts(net, board, player, sims, { dirichlet: 0.25, rng });
    const pi = visitPolicy(root);
    traj.push({ x: encode(board, player), pi: Float32Array.from(pi), player });

    let move;
    if (ply < 10) {
      move = pickFromPolicy(moves, pi, rng);
    } else {
      let bestVisits = -1;
      for (const candidate of moves) {
        const edge = root.children[candidate];
        if (edge.N > bestVisits) {
          bestVisits = edge.N;
          move = candidate;
        }
      }
    }

    const row = drop(board, move, player);
    if (wins(board, move, row, player)) return finalize(traj, player);
    player = otherPlayer(player);
    ply++;
  }
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
}

function trainConnect4(options = {}) {
  const iters = options.iters || 4;
  const games = options.games || 40;
  const sims = options.sims || 80;
  const epochs = options.epochs || 4;
  const batchSize = options.batchSize || 64;
  const bufferMax = options.bufferMax || 16000;
  const lr = options.lr || 0.002;
  const h1 = options.h1 || DEFAULT_H1;
  const h2 = options.h2 || DEFAULT_H2;
  const dest = options.dest || DEFAULT_DEST;
  const log = options.log || console.error;
  const rng = rngFromSeed(options.seed);

  const net = createNet({ h1, h2, rng });
  const adam = makeAdam(net);
  const buffer = [];
  const started = Date.now();

  log(`training: ${iters} iters x ${games} games x ${sims} sims`);
  for (let it = 0; it < iters; it++) {
    let samples = 0;
    for (let game = 0; game < games; game++) {
      const data = selfPlay(net, sims, { rng });
      for (const sample of data) buffer.push(sample);
      samples += data.length;
    }
    while (buffer.length > bufferMax) buffer.shift();

    let lossV = 0;
    let lossP = 0;
    let steps = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      shuffle(buffer, rng);
      for (let i = 0; i + batchSize <= buffer.length; i += batchSize) {
        const loss = trainBatch(net, adam, buffer.slice(i, i + batchSize), lr);
        lossV += loss.v;
        lossP += loss.p;
        steps++;
      }
    }

    saveWeights(dest, net, {
      in: INPUTS,
      h1,
      h2,
      cols: COLS,
      rows: ROWS,
      iters: it + 1,
      ofIters: iters,
      games,
      sims,
      samples,
      seed: options.seed === undefined ? null : String(options.seed),
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    log(`iter ${it + 1}/${iters}  buf=${buffer.length}  lossV=${(lossV / (steps || 1)).toFixed(3)}  lossP=${(lossP / (steps || 1)).toFixed(3)}  t=${elapsed}s`);
  }

  return { net, dest, samples: buffer.length };
}

module.exports = {
  DEFAULT_DEST,
  finalize,
  selfPlay,
  trainConnect4,
};

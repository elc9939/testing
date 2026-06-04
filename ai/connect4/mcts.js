'use strict';

const { COLS, cloneBoard, legalMoves, drop, winLine, otherPlayer } = require('./env');
const { forward, softmaxLegal } = require('./net');

const DEFAULT_CPUCT = 1.6;
const DEFAULT_ROLLOUT_WEIGHT = 0.5;

function rollout(board, player, options = {}) {
  const rng = options.rng || Math.random;
  const bb = cloneBoard(board);
  let current = player;
  for (;;) {
    const moves = legalMoves(bb);
    if (!moves.length) return 0;
    const col = moves[(rng() * moves.length) | 0];
    const row = drop(bb, col, current);
    if (winLine(bb, col, row, current)) return current === player ? 1 : -1;
    current = otherPlayer(current);
  }
}

function leafEval(net, board, player, moves, options = {}) {
  if (!net) {
    const priors = {};
    for (const move of moves) priors[move] = 1 / moves.length;
    return { priors, v: rollout(board, player, options) };
  }

  const f = forward(net, board, player);
  const priors = softmaxLegal(f.pl, moves);
  const rolloutWeight = options.rolloutWeight === undefined ? DEFAULT_ROLLOUT_WEIGHT : options.rolloutWeight;
  const v = (1 - rolloutWeight) * f.value + rolloutWeight * rollout(board, player, options);
  return { priors, v };
}

function expand(net, node, options) {
  const moves = legalMoves(node.board);
  const ev = leafEval(net, node.board, node.player, moves, options);
  node.children = {};
  for (const move of moves) {
    node.children[move] = { N: 0, W: 0, P: ev.priors[move], child: null, move };
  }
  return ev.v;
}

function simulate(net, node, options, isRoot) {
  if (node.terminal !== undefined) return node.terminal;

  const moves = node.children ? Object.keys(node.children).map(Number) : legalMoves(node.board);
  if (!node.children) {
    if (!moves.length) {
      node.N++;
      return 0;
    }
    const v = expand(net, node, options);
    if (isRoot && options.dirichlet) addDirichlet(node, options.dirichlet, options.rng || Math.random);
    node.N++;
    return -v;
  }

  let best = null;
  let bestU = -Infinity;
  const cpuct = options.cpuct || DEFAULT_CPUCT;
  const sqrtN = Math.sqrt(Math.max(1, node.N));
  for (const move of moves) {
    const edge = node.children[move];
    const q = edge.N ? edge.W / edge.N : 0;
    const u = q + cpuct * edge.P * sqrtN / (1 + edge.N);
    if (u > bestU) {
      bestU = u;
      best = edge;
    }
  }

  let v;
  if (!best.child) {
    const nextBoard = cloneBoard(node.board);
    const row = drop(nextBoard, best.move, node.player);
    const nextPlayer = otherPlayer(node.player);
    if (winLine(nextBoard, best.move, row, node.player)) {
      best.child = { terminal: 1, N: 0, board: nextBoard, player: nextPlayer };
      v = -1;
    } else {
      best.child = { N: 0, children: null, board: nextBoard, player: nextPlayer };
      v = simulate(net, best.child, options, false);
    }
  } else if (best.child.terminal) {
    v = -1;
  } else {
    v = simulate(net, best.child, options, false);
  }

  best.N++;
  best.W += v;
  node.N++;
  return -v;
}

function addDirichlet(node, eps, rng) {
  const moves = Object.keys(node.children).map(Number);
  const noise = moves.map(() => -Math.log(1 - rng()));
  const sum = noise.reduce((total, value) => total + value, 0) || 1;
  moves.forEach((move, i) => {
    node.children[move].P = (1 - eps) * node.children[move].P + eps * (noise[i] / sum);
  });
}

function mcts(net, rootBoard, rootPlayer, sims, options = {}) {
  const root = { N: 0, children: null, player: rootPlayer, board: cloneBoard(rootBoard) };
  for (let i = 0; i < sims; i++) simulate(net, root, options, i === 0);
  return root;
}

function visitPolicy(root) {
  const pi = new Float32Array(COLS);
  let total = 0;
  if (!root.children) return pi;
  for (const move in root.children) {
    pi[move] = root.children[move].N;
    total += root.children[move].N;
  }
  if (total) {
    for (let i = 0; i < COLS; i++) pi[i] /= total;
  }
  return pi;
}

function bestMove(root) {
  let move = -1;
  let visits = -1;
  if (!root.children) return move;
  for (const key in root.children) {
    const edge = root.children[key];
    if (edge.N > visits) {
      visits = edge.N;
      move = Number(key);
    }
  }
  return move;
}

module.exports = {
  DEFAULT_CPUCT,
  DEFAULT_ROLLOUT_WEIGHT,
  rollout,
  leafEval,
  mcts,
  visitPolicy,
  bestMove,
};

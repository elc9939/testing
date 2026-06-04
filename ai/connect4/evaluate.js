'use strict';

const path = require('path');
const { newBoard, legalMoves, drop, winLine, otherPlayer } = require('./env');
const { loadWeights } = require('./net');
const { mcts, bestMove } = require('./mcts');
const { rngFromSeed } = require('./random');

const DEFAULT_WEIGHTS = path.resolve(__dirname, '../../js/games/connect4-weights.json');

function randomMove(board, rng) {
  const moves = legalMoves(board);
  return moves[(rng() * moves.length) | 0];
}

function centerMove(board) {
  const moves = legalMoves(board);
  let best = moves[0];
  let bestScore = Infinity;
  for (const move of moves) {
    const score = Math.abs(3 - move);
    if (score < bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function netMove(net, board, player, sims, rng) {
  const root = mcts(net, board, player, sims, { rng });
  const move = bestMove(root);
  return move >= 0 ? move : randomMove(board, rng);
}

function opponentMove(kind, board, rng) {
  if (kind === 'center') return centerMove(board);
  return randomMove(board, rng);
}

function playGame(options) {
  const net = options.net;
  const sims = options.sims;
  const rng = options.rng || Math.random;
  const aiPlayer = options.aiPlayer || 1;
  const opponent = options.opponent || 'random';
  const board = newBoard();
  let player = 1;

  for (let ply = 0; ply < 42; ply++) {
    const move = player === aiPlayer
      ? netMove(net, board, player, sims, rng)
      : opponentMove(opponent, board, rng);
    const row = drop(board, move, player);
    if (winLine(board, move, row, player)) {
      return { winner: player, plies: ply + 1 };
    }
    if (!legalMoves(board).length) return { winner: 0, plies: ply + 1 };
    player = otherPlayer(player);
  }
  return { winner: 0, plies: 42 };
}

function evaluateConnect4(options = {}) {
  const games = options.games || 12;
  const sims = options.sims || 80;
  const weightsPath = options.weightsPath || DEFAULT_WEIGHTS;
  const opponent = options.opponent || 'random';
  const log = options.log || console.log;
  const rng = rngFromSeed(options.seed);
  const net = loadWeights(weightsPath);
  const result = { wins: 0, losses: 0, draws: 0, games, sims, opponent, weightsPath };

  for (let game = 0; game < games; game++) {
    const aiPlayer = game % 2 === 0 ? 1 : 2;
    const played = playGame({ net, sims, rng, aiPlayer, opponent });
    if (played.winner === 0) result.draws++;
    else if (played.winner === aiPlayer) result.wins++;
    else result.losses++;
  }

  log(`connect4 eval: ${result.wins}W ${result.losses}L ${result.draws}D vs ${opponent} (${games} games, ${sims} sims)`);
  return result;
}

module.exports = {
  DEFAULT_WEIGHTS,
  randomMove,
  centerMove,
  playGame,
  evaluateConnect4,
};

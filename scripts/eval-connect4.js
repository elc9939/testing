#!/usr/bin/env node
'use strict';

const path = require('path');
const { evaluateConnect4 } = require('../ai/connect4/evaluate');

function intArg(index, fallback) {
  const value = parseInt(process.argv[index], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const games = intArg(2, 12);
const sims = intArg(3, 80);
const opponent = process.argv[4] || 'random';

evaluateConnect4({
  games,
  sims,
  opponent,
  weightsPath: path.resolve(__dirname, '../js/games/connect4-weights.json'),
  seed: process.env.CONNECT4_SEED,
});

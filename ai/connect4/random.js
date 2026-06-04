'use strict';

function createRng(seed) {
  let state = Number(seed) >>> 0;
  if (!state) state = 0x9e3779b9;

  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFromSeed(seed) {
  return seed === undefined || seed === null || seed === '' ? Math.random : createRng(seed);
}

module.exports = {
  createRng,
  rngFromSeed,
};

'use strict';

const COLS = 7;
const ROWS = 6;
const CELLS = COLS * ROWS;
const INPUTS = CELLS * 2;

function newBoard() {
  return new Int8Array(CELLS);
}

function cloneBoard(board) {
  return Int8Array.from(board);
}

function otherPlayer(player) {
  return player === 1 ? 2 : 1;
}

function heightAt(board, col) {
  let row = 0;
  while (row < ROWS && board[row * COLS + col]) row++;
  return row;
}

function legalMoves(board) {
  const moves = [];
  for (let col = 0; col < COLS; col++) {
    if (!board[(ROWS - 1) * COLS + col]) moves.push(col);
  }
  return moves;
}

function drop(board, col, player) {
  const row = heightAt(board, col);
  if (row >= ROWS) return -1;
  board[row * COLS + col] = player;
  return row;
}

function winLine(board, col, row, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const line = [[row, col]];
    for (const sign of [1, -1]) {
      let rr = row + dr * sign;
      let cc = col + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr * COLS + cc] === player) {
        line.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

function wins(board, col, row, player) {
  return !!winLine(board, col, row, player);
}

function encode(board, player) {
  const x = new Float32Array(INPUTS);
  const opponent = otherPlayer(player);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === player) x[i] = 1;
    else if (board[i] === opponent) x[CELLS + i] = 1;
  }
  return x;
}

module.exports = {
  COLS,
  ROWS,
  CELLS,
  INPUTS,
  newBoard,
  cloneBoard,
  otherPlayer,
  heightAt,
  legalMoves,
  drop,
  winLine,
  wins,
  encode,
};

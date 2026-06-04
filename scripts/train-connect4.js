/* Offline trainer for the Connect Four arcade AI.
 *
 * A small policy+value MLP learns from MCTS self-play (an AlphaZero-style loop).
 * The MCTS leaf evaluation blends a quick random rollout with the net's value,
 * so the resulting player is strong even after light training (the rollout
 * carries it) and sharpens as the net learns (better priors + value). We export
 * the trained weights to JSON; the browser game loads them and runs the same
 * MCTS for its moves.
 *
 *   node scripts/train-connect4.js [iters] [gamesPerIter] [sims]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const COLS = 7, ROWS = 6, NC = COLS * ROWS, IN = NC * 2, H1 = 96, H2 = 96;

// ---------- game ----------
// board: Int8Array(42), 0 empty / 1 / 2. idx = row*COLS+col, row 0 = bottom.
function newBoard() { return new Int8Array(NC); }
function heights(b) { const h = new Array(COLS).fill(0); for (let c = 0; c < COLS; c++) { let r = 0; while (r < ROWS && b[r * COLS + c]) r++; h[c] = r; } return h; }
function legal(b) { const m = []; for (let c = 0; c < COLS; c++) if (!b[(ROWS - 1) * COLS + c]) m.push(c); return m; }
function drop(b, c, p) { let r = 0; while (r < ROWS && b[r * COLS + c]) r++; if (r >= ROWS) return -1; b[r * COLS + c] = p; return r; }
function wins(b, c, r, p) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let n = 1;
    for (const s of [1, -1]) { let rr = r + dr * s, cc = c + dc * s; while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) { n++; rr += dr * s; cc += dc * s; } }
    if (n >= 4) return true;
  }
  return false;
}
// canonical input from `player`'s POV: plane0 = player pieces, plane1 = opponent
function encode(b, player) { const x = new Float32Array(IN); const opp = player === 1 ? 2 : 1; for (let i = 0; i < NC; i++) { if (b[i] === player) x[i] = 1; else if (b[i] === opp) x[NC + i] = 1; } return x; }

// ---------- tiny MLP (policy + value heads on a shared trunk) ----------
function randW(n, fan) { const a = new Float32Array(n), s = Math.sqrt(2 / fan); for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * s; return a; }
function newNet() {
  return {
    W1: randW(H1 * IN, IN), b1: new Float32Array(H1),
    W2: randW(H2 * H1, H1), b2: new Float32Array(H2),
    Wp: randW(COLS * H2, H2), bp: new Float32Array(COLS),
    Wv: randW(H2, H2), bv: new Float32Array(1),
  };
}
function relu(v) { for (let i = 0; i < v.length; i++) if (v[i] < 0) v[i] = 0; return v; }
function dense(W, b, x, out) { const o = out.length, n = x.length; for (let i = 0; i < o; i++) { let s = b[i]; const base = i * n; for (let j = 0; j < n; j++) s += W[base + j] * x[j]; out[i] = s; } return out; }
function forward(net, x) {
  const h1 = relu(dense(net.W1, net.b1, x, new Float32Array(H1)));
  const h2 = relu(dense(net.W2, net.b2, h1, new Float32Array(H2)));
  const pl = dense(net.Wp, net.bp, h2, new Float32Array(COLS));
  let vs = net.bv[0]; for (let j = 0; j < H2; j++) vs += net.Wv[j] * h2[j];
  const value = Math.tanh(vs);
  return { h1, h2, pl, value };
}
function softmaxLegal(logits, moves) {
  let mx = -Infinity; for (const m of moves) mx = Math.max(mx, logits[m]);
  let sum = 0; const p = {}; for (const m of moves) { p[m] = Math.exp(logits[m] - mx); sum += p[m]; }
  for (const m of moves) p[m] /= sum; return p;
}

// ---------- MCTS (PUCT) with rollout+net blended leaf eval ----------
const CPUCT = 1.6, ROLLOUT_W = 0.5;
function rollout(b, player) {            // random playout from `player` to move; returns value for `player`
  const bb = Int8Array.from(b); let p = player;
  for (;;) {
    const m = legal(bb); if (!m.length) return 0;
    const c = m[(Math.random() * m.length) | 0], r = drop(bb, c, p);
    if (wins(bb, c, r, p)) return p === player ? 1 : -1;
    p = p === 1 ? 2 : 1;
  }
}
function leafEval(net, b, player, moves) {
  const f = forward(net, encode(b, player));
  const priors = softmaxLegal(f.pl, moves);
  const v = (1 - ROLLOUT_W) * f.value + ROLLOUT_W * rollout(b, player);
  return { priors, v };
}
function mcts(net, root, rootPlayer, sims, opts) {
  opts = opts || {};
  const R = { N: 0, children: null, player: rootPlayer, board: Int8Array.from(root) };
  for (let s = 0; s < sims; s++) simulate(net, R, opts, s === 0);
  return R;
}
function expand(net, node) {
  const moves = legal(node.board);
  const ev = leafEval(net, node.board, node.player, moves);
  node.children = {};
  for (const m of moves) node.children[m] = { N: 0, W: 0, P: ev.priors[m], child: null, move: m };
  return ev.v;
}
function simulate(net, node, opts, isRoot) {
  // terminal?
  const moves = node.children ? Object.keys(node.children).map(Number) : legal(node.board);
  if (!node.children) {
    if (!moves.length) { node.N++; return 0; }
    let v = expand(net, node);
    if (isRoot && opts.dirichlet) addDirichlet(node, opts.dirichlet);
    node.N++; return -v;                 // value is from node.player POV; parent sees negative
  }
  // select via PUCT
  let best = null, bestU = -Infinity; const sqrtN = Math.sqrt(Math.max(1, node.N));
  for (const m of moves) { const e = node.children[m]; const q = e.N ? e.W / e.N : 0; const u = q + CPUCT * e.P * sqrtN / (1 + e.N); if (u > bestU) { bestU = u; best = e; } }
  // descend
  let v;
  if (!best.child) {
    const nb = Int8Array.from(node.board); const r = drop(nb, best.move, node.player);
    if (wins(nb, best.move, r, node.player)) { best.child = { terminal: 1, N: 0, board: nb, player: node.player === 1 ? 2 : 1 }; v = -1; /* mover won → bad for next */ }
    else { best.child = { N: 0, children: null, board: nb, player: node.player === 1 ? 2 : 1 }; v = simulate(net, best.child, opts, false); }
  } else if (best.child.terminal) { v = -1; }
  else { v = simulate(net, best.child, opts, false); }
  best.N++; best.W += v; node.N++;
  return -v;
}
function addDirichlet(node, eps) {
  const ms = Object.keys(node.children).map(Number); const a = 0.9;
  const g = ms.map(() => -Math.log(1 - Math.random())); const sum = g.reduce((x, y) => x + y, 0) || 1;
  ms.forEach((m, i) => { node.children[m].P = (1 - eps) * node.children[m].P + eps * (g[i] / sum); });
}
function visitPolicy(root) { const pi = new Float32Array(COLS); let tot = 0; for (const m in root.children) { pi[m] = root.children[m].N; tot += root.children[m].N; } if (tot) for (let i = 0; i < COLS; i++) pi[i] /= tot; return pi; }

// ---------- self-play ----------
function selfPlay(net, sims) {
  const b = newBoard(); let player = 1; const traj = []; let ply = 0;
  for (;;) {
    const moves = legal(b); if (!moves.length) { return finalize(traj, 0); }
    const root = mcts(net, b, player, sims, { dirichlet: 0.25 });
    const pi = visitPolicy(root);
    traj.push({ x: encode(b, player), pi: Float32Array.from(pi), player });
    // sample (temperature) early, greedy later
    let move;
    if (ply < 10) { let rnd = Math.random(), acc = 0; move = moves[0]; for (const m of moves) { acc += pi[m]; if (rnd <= acc) { move = m; break; } } }
    else { let bn = -1; for (const m of moves) if (root.children[m].N > bn) { bn = root.children[m].N; move = m; } }
    const r = drop(b, move, player);
    if (wins(b, move, r, player)) return finalize(traj, player);
    player = player === 1 ? 2 : 1; ply++;
  }
}
function finalize(traj, winner) { return traj.map(t => ({ x: t.x, pi: t.pi, z: winner === 0 ? 0 : (winner === t.player ? 1 : -1) })); }

// ---------- training (Adam, value MSE + policy cross-entropy) ----------
function makeAdam(net) { const m = {}, v = {}; for (const k in net) { m[k] = new Float32Array(net[k].length); v[k] = new Float32Array(net[k].length); } return { m, v, t: 0 }; }
function trainBatch(net, ad, batch, lr) {
  const grads = {}; for (const k in net) grads[k] = new Float32Array(net[k].length);
  let lossV = 0, lossP = 0;
  for (const s of batch) {
    const f = forward(net, s.x);
    // value head grad: d/dv MSE(tanh) -> (value - z) * (1 - value^2)
    const dv = (f.value - s.z) * (1 - f.value * f.value); lossV += (f.value - s.z) ** 2;
    // policy: softmax over ALL cols, CE vs pi (pi already 0 on illegal)
    let mx = -Infinity; for (let i = 0; i < COLS; i++) mx = Math.max(mx, f.pl[i]);
    let sum = 0; const sm = new Float32Array(COLS); for (let i = 0; i < COLS; i++) { sm[i] = Math.exp(f.pl[i] - mx); sum += sm[i]; }
    for (let i = 0; i < COLS; i++) sm[i] /= sum;
    const dpl = new Float32Array(COLS); for (let i = 0; i < COLS; i++) { dpl[i] = sm[i] - s.pi[i]; if (s.pi[i] > 0) lossP -= s.pi[i] * Math.log(sm[i] + 1e-9); }
    // back through heads to h2
    const dh2 = new Float32Array(H2);
    for (let i = 0; i < H2; i++) { let g = dv * net.Wv[i]; for (let o = 0; o < COLS; o++) g += dpl[o] * net.Wp[o * H2 + i]; dh2[i] = g * (f.h2[i] > 0 ? 1 : 0); }
    for (let i = 0; i < H2; i++) { grads.Wv[i] += dv * f.h2[i]; for (let o = 0; o < COLS; o++) grads.Wp[o * H2 + i] += dpl[o] * f.h2[i]; }
    grads.bv[0] += dv; for (let o = 0; o < COLS; o++) grads.bp[o] += dpl[o];
    // h2 = relu(W2 h1) ; back to h1
    const dh1 = new Float32Array(H1);
    for (let i = 0; i < H2; i++) { const g = dh2[i]; const base = i * H1; for (let j = 0; j < H1; j++) { grads.W2[base + j] += g * f.h1[j]; dh1[j] += g * net.W2[base + j]; } grads.b2[i] += g; }
    for (let j = 0; j < H1; j++) dh1[j] *= (f.h1[j] > 0 ? 1 : 0);
    for (let i = 0; i < H1; i++) { const g = dh1[i]; const base = i * IN; for (let j = 0; j < IN; j++) grads.W1[base + j] += g * s.x[j]; grads.b1[i] += g; }
  }
  const n = batch.length; ad.t++;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8, bc1 = 1 - Math.pow(b1, ad.t), bc2 = 1 - Math.pow(b2, ad.t);
  for (const k in net) {
    const W = net[k], G = grads[k], M = ad.m[k], V = ad.v[k];
    for (let i = 0; i < W.length; i++) { const g = G[i] / n; M[i] = b1 * M[i] + (1 - b1) * g; V[i] = b2 * V[i] + (1 - b2) * g * g; W[i] -= lr * (M[i] / bc1) / (Math.sqrt(V[i] / bc2) + eps); }
  }
  return { v: lossV / n, p: lossP / n };
}

// ---------- main loop ----------
const ITERS = parseInt(process.argv[2] || '4', 10);
const GAMES = parseInt(process.argv[3] || '40', 10);
const SIMS = parseInt(process.argv[4] || '80', 10);
const net = newNet(), adam = makeAdam(net);
const buffer = []; const BUFMAX = 16000;
const t0 = Date.now();
const dest = path.resolve(__dirname, '../js/games/connect4-weights.json');
function save(meta) { const out = {}; for (const k in net) out[k] = Array.from(net[k], v => +v.toFixed(5)); out.meta = meta; fs.writeFileSync(dest, JSON.stringify(out)); }
console.error(`training: ${ITERS} iters x ${GAMES} games x ${SIMS} sims`);
for (let it = 0; it < ITERS; it++) {
  let samples = 0;
  for (let g = 0; g < GAMES; g++) { const data = selfPlay(net, SIMS); for (const s of data) buffer.push(s); samples += data.length; }
  while (buffer.length > BUFMAX) buffer.shift();
  let lv = 0, lp = 0, steps = 0;
  const EPOCHS = 4, BS = 64;
  for (let e = 0; e < EPOCHS; e++) {
    for (let i = buffer.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const tmp = buffer[i]; buffer[i] = buffer[j]; buffer[j] = tmp; }
    for (let i = 0; i + BS <= buffer.length; i += BS) { const l = trainBatch(net, adam, buffer.slice(i, i + BS), 0.002); lv += l.v; lp += l.p; steps++; }
  }
  save({ in: IN, h1: H1, h2: H2, cols: COLS, rows: ROWS, iters: it + 1, ofIters: ITERS, games: GAMES, sims: SIMS });   // checkpoint
  console.error(`iter ${it + 1}/${ITERS}  buf=${buffer.length}  lossV=${(lv / (steps || 1)).toFixed(3)}  lossP=${(lp / (steps || 1)).toFixed(3)}  t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.error('wrote ' + dest + ' (' + (fs.statSync(dest).size / 1024).toFixed(0) + ' KB)');

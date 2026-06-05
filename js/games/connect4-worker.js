/* Connect Four worker: runs MCTS away from the canvas render thread. */
const COLS = 7, ROWS = 6, NC = COLS * ROWS, IN = NC * 2;
const CPUCT = 1.6, ROLLOUT_W = 0.5;
let net = null, netPromise = null, activeId = 0;

const newBoard = a => Int8Array.from(a);
const other = p => p === 1 ? 2 : 1;
const legal = b => { const m = []; for (let c = 0; c < COLS; c++) if (!b[(ROWS - 1) * COLS + c]) m.push(c); return m; };
function drop(b, c, p) {
  let r = 0;
  while (r < ROWS && b[r * COLS + c]) r++;
  if (r >= ROWS) return -1;
  b[r * COLS + c] = p;
  return r;
}
function winLine(b, c, r, p) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) {
        n++;
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (n >= 4) return true;
  }
  return false;
}
function encode(b, pl) {
  const x = new Float32Array(IN), opp = other(pl);
  for (let i = 0; i < NC; i++) {
    if (b[i] === pl) x[i] = 1;
    else if (b[i] === opp) x[NC + i] = 1;
  }
  return x;
}
const f = a => Float32Array.from(a);
function loadNet() {
  if (netPromise) return netPromise;
  netPromise = fetch('connect4-weights.json')
    .then(r => r.json())
    .then(w => {
      const meta = w.meta || {};
      net = { W1: f(w.W1), b1: f(w.b1), W2: f(w.W2), b2: f(w.b2), Wp: f(w.Wp), bp: f(w.bp), Wv: f(w.Wv), bv: f(w.bv), H1: meta.h1, H2: meta.h2 };
      return net;
    })
    .catch(() => {
      net = null;
      return null;
    });
  return netPromise;
}
function forward(b, pl) {
  const x = encode(b, pl), H1 = net.H1, H2 = net.H2;
  const h1 = new Float32Array(H1);
  for (let i = 0; i < H1; i++) {
    let s = net.b1[i], base = i * IN;
    for (let j = 0; j < IN; j++) s += net.W1[base + j] * x[j];
    h1[i] = s > 0 ? s : 0;
  }
  const h2 = new Float32Array(H2);
  for (let i = 0; i < H2; i++) {
    let s = net.b2[i], base = i * H1;
    for (let j = 0; j < H1; j++) s += net.W2[base + j] * h1[j];
    h2[i] = s > 0 ? s : 0;
  }
  const pl2 = new Float32Array(COLS);
  for (let i = 0; i < COLS; i++) {
    let s = net.bp[i], base = i * H2;
    for (let j = 0; j < H2; j++) s += net.Wp[base + j] * h2[j];
    pl2[i] = s;
  }
  let vs = net.bv[0];
  for (let j = 0; j < H2; j++) vs += net.Wv[j] * h2[j];
  return { pl: pl2, value: Math.tanh(vs) };
}
function rollout(b, player) {
  const bb = Int8Array.from(b);
  let p = player;
  for (;;) {
    const m = legal(bb);
    if (!m.length) return 0;
    const c = m[(Math.random() * m.length) | 0], r = drop(bb, c, p);
    if (winLine(bb, c, r, p)) return p === player ? 1 : -1;
    p = other(p);
  }
}
function leafEval(b, player, moves) {
  if (!net) {
    const pr = {};
    for (const m of moves) pr[m] = 1 / moves.length;
    return { priors: pr, v: rollout(b, player) };
  }
  const fr = forward(b, player);
  let mx = -Infinity;
  for (const m of moves) mx = Math.max(mx, fr.pl[m]);
  let sum = 0;
  const pr = {};
  for (const m of moves) { pr[m] = Math.exp(fr.pl[m] - mx); sum += pr[m]; }
  for (const m of moves) pr[m] /= sum || 1;
  return { priors: pr, v: (1 - ROLLOUT_W) * fr.value + ROLLOUT_W * rollout(b, player) };
}
function search(node) {
  if (node.terminal !== undefined) return node.terminal;
  if (!node.children) {
    const moves = legal(node.board);
    if (!moves.length) { node.terminal = 0; return 0; }
    const ev = leafEval(node.board, node.player, moves);
    node.children = {};
    for (const m of moves) node.children[m] = { move: m, N: 0, Wv: 0, P: ev.priors[m], child: null };
    node.N = (node.N || 0) + 1;
    return ev.v;
  }
  let best = null, bestU = -Infinity;
  const sq = Math.sqrt(Math.max(1, node.N));
  for (const m in node.children) {
    const e = node.children[m], q = e.N ? e.Wv / e.N : 0, u = q + CPUCT * e.P * sq / (1 + e.N);
    if (u > bestU) { bestU = u; best = e; }
  }
  if (!best.child) {
    const nb = Int8Array.from(node.board), r = drop(nb, best.move, node.player), opp = other(node.player);
    if (winLine(nb, best.move, r, node.player)) best.child = { board: nb, player: opp, terminal: -1 };
    else if (!legal(nb).length) best.child = { board: nb, player: opp, terminal: 0 };
    else best.child = { board: nb, player: opp, children: null, N: 0 };
  }
  const v = -search(best.child);
  best.N++;
  best.Wv += v;
  node.N = (node.N || 0) + 1;
  return v;
}
function visits(root) {
  const a = new Array(COLS).fill(0);
  if (root.children) for (const m in root.children) a[m] = root.children[m].N;
  return a;
}
function bestMove(root) {
  const v = visits(root);
  let move = -1, bn = -1;
  for (let c = 0; c < COLS; c++) if (v[c] > bn) { bn = v[c]; move = c; }
  if (move < 0) {
    const m = legal(root.board);
    move = m[(Math.random() * m.length) | 0];
  }
  return { move, visits: v };
}
const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));

self.onmessage = async e => {
  const msg = e.data || {};
  if (msg.type === 'cancel') {
    activeId++;
    return;
  }
  if (msg.type !== 'search') return;
  const id = msg.id;
  activeId = id;
  await loadNet();
  if (activeId !== id) return;
  const root = { board: newBoard(msg.board), player: msg.ai, children: null, N: 0 };
  const target = Math.max(1, msg.target | 0);
  const chunk = Math.max(24, Math.round(120 * (msg.aiScale || 1)));
  let sims = 0;
  while (sims < target && activeId === id) {
    const end = Math.min(target, sims + chunk);
    while (sims < end) {
      search(root);
      sims++;
    }
    self.postMessage({ type: 'progress', id, sims, visits: visits(root) });
    await yieldTurn();
  }
  if (activeId !== id) return;
  const choice = bestMove(root);
  self.postMessage({ type: 'done', id, sims, move: choice.move, visits: choice.visits });
};

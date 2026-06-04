/* Four in a Row — Connect Four against an AlphaZero-style AI.
   The AI runs MCTS (PUCT) guided by a small policy+value network trained from
   self-play (ai/connect4 -> connect4-weights.json). Leaf positions
   are scored by blending the network's value with a quick random rollout, so the
   AI is strong even before the net loads. The search runs incrementally across
   frames, and you can watch its column preferences ("thinking") build live. */
Arcade.register({
  id: 'connect4',
  name: 'Four in a Row',
  emoji: '🔴',
  desc: 'Connect Four against an AlphaZero-style AI that learned from self-play. Watch it think, then try to beat it.',
  color: '#5ef2ff',

  start(root, api) {
    const COLS = 7, ROWS = 6, NC = COLS * ROWS, IN = NC * 2;
    let W = 0, H = 0, cell = 0, bx = 0, by = 0, bw = 0, bh = 0;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    function layout(v) { W = v.w; H = v.h; const maxW = Math.min(W * 0.94, 560), maxH = H * 0.82; cell = Math.min(maxW / COLS, maxH / (ROWS + 1)); bw = cell * COLS; bh = cell * ROWS; bx = (W - bw) / 2; by = (H - bh) / 2 + cell * 0.4; }
    layout(view);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">YOU <b id="c4-you">0</b></span><span id="c4-turn">—</span><span class="b">AI <b id="c4-ai">0</b></span>`;
    root.appendChild(hud);

    // ---------- game logic ----------
    const newBoard = () => new Int8Array(NC);
    const legal = b => { const m = []; for (let c = 0; c < COLS; c++) if (!b[(ROWS - 1) * COLS + c]) m.push(c); return m; };
    function drop(b, c, p) { let r = 0; while (r < ROWS && b[r * COLS + c]) r++; if (r >= ROWS) return -1; b[r * COLS + c] = p; return r; }
    function winLine(b, c, r, p) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const line = [[r, c]];
        for (const s of [1, -1]) { let rr = r + dr * s, cc = c + dc * s; while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) { line.push([rr, cc]); rr += dr * s; cc += dc * s; } }
        if (line.length >= 4) return line;
      }
      return null;
    }
    const encode = (b, pl) => { const x = new Float32Array(IN), opp = pl === 1 ? 2 : 1; for (let i = 0; i < NC; i++) { if (b[i] === pl) x[i] = 1; else if (b[i] === opp) x[NC + i] = 1; } return x; };

    // ---------- network ----------
    let net = null, modelMeta = null, modelStatus = 'Loading local model...';
    fetch('./js/games/connect4-weights.json').then(r => r.json()).then(w => {
      modelMeta = w.meta || {};
      net = { W1: f(w.W1), b1: f(w.b1), W2: f(w.W2), b2: f(w.b2), Wp: f(w.Wp), bp: f(w.bp), Wv: f(w.Wv), bv: f(w.bv), H1: modelMeta.h1, H2: modelMeta.h2 };
      if (state === 'menu') showMenu();
    }).catch(() => {
      net = null;
      modelStatus = 'Weights unavailable; using rollout search fallback.';
      if (state === 'menu') showMenu();
    });
    function f(a) { return Float32Array.from(a); }
    function modelText() {
      if (!modelMeta) return modelStatus;
      const parts = [];
      if (modelMeta.iters) parts.push(`${modelMeta.iters} train iters`);
      if (modelMeta.games) parts.push(`${modelMeta.games} games/iter`);
      if (modelMeta.sims) parts.push(`${modelMeta.sims} sims/search`);
      return `Local model loaded: ${parts.join(', ') || 'weights ready'}.`;
    }
    function forward(b, pl) {
      const x = encode(b, pl), H1 = net.H1, H2 = net.H2;
      const h1 = new Float32Array(H1); for (let i = 0; i < H1; i++) { let s = net.b1[i]; const base = i * IN; for (let j = 0; j < IN; j++) s += net.W1[base + j] * x[j]; h1[i] = s > 0 ? s : 0; }
      const h2 = new Float32Array(H2); for (let i = 0; i < H2; i++) { let s = net.b2[i]; const base = i * H1; for (let j = 0; j < H1; j++) s += net.W2[base + j] * h1[j]; h2[i] = s > 0 ? s : 0; }
      const pl2 = new Float32Array(COLS); for (let i = 0; i < COLS; i++) { let s = net.bp[i]; const base = i * H2; for (let j = 0; j < H2; j++) s += net.Wp[base + j] * h2[j]; pl2[i] = s; }
      let vs = net.bv[0]; for (let j = 0; j < H2; j++) vs += net.Wv[j] * h2[j];
      return { pl: pl2, value: Math.tanh(vs) };
    }
    function rollout(b, player) {
      const bb = Int8Array.from(b); let p = player;
      for (;;) { const m = legal(bb); if (!m.length) return 0; const c = m[(Math.random() * m.length) | 0], r = drop(bb, c, p); if (winLine(bb, c, r, p)) return p === player ? 1 : -1; p = p === 1 ? 2 : 1; }
    }
    const CPUCT = 1.6, ROLLOUT_W = 0.5;
    function leafEval(b, player, moves) {
      if (!net) { const pr = {}; for (const m of moves) pr[m] = 1 / moves.length; return { priors: pr, v: rollout(b, player) }; }
      const fr = forward(b, player); let mx = -Infinity; for (const m of moves) mx = Math.max(mx, fr.pl[m]);
      let sum = 0; const pr = {}; for (const m of moves) { pr[m] = Math.exp(fr.pl[m] - mx); sum += pr[m]; } for (const m of moves) pr[m] /= sum;
      return { priors: pr, v: (1 - ROLLOUT_W) * fr.value + ROLLOUT_W * rollout(b, player) };
    }
    // incremental MCTS. search(node) returns value for the player to move at node.
    function search(node) {
      if (node.terminal !== undefined) return node.terminal;
      if (!node.children) {
        const moves = legal(node.board);
        if (!moves.length) { node.terminal = 0; return 0; }
        const ev = leafEval(node.board, node.player, moves);
        node.children = {}; for (const m of moves) node.children[m] = { move: m, N: 0, Wv: 0, P: ev.priors[m], child: null };
        node.N = (node.N || 0) + 1; return ev.v;
      }
      let best = null, bestU = -Infinity; const sq = Math.sqrt(Math.max(1, node.N));
      for (const m in node.children) { const e = node.children[m], q = e.N ? e.Wv / e.N : 0, u = q + CPUCT * e.P * sq / (1 + e.N); if (u > bestU) { bestU = u; best = e; } }
      if (!best.child) {
        const nb = Int8Array.from(node.board), r = drop(nb, best.move, node.player), other = node.player === 1 ? 2 : 1;
        if (winLine(nb, best.move, r, node.player)) best.child = { board: nb, player: other, terminal: -1 };
        else if (!legal(nb).length) best.child = { board: nb, player: other, terminal: 0 };
        else best.child = { board: nb, player: other, children: null, N: 0 };
      }
      const v = -search(best.child);
      best.N++; best.Wv += v; node.N = (node.N || 0) + 1; return v;
    }
    const visits = root => { const a = new Array(COLS).fill(0); if (root.children) for (const m in root.children) a[m] = root.children[m].N; return a; };

    // ---------- state ----------
    let board, turn, you, ai, state, win, anim, aiRoot, aiSims, aiTarget, hoverCol, youScore, aiScore, streak, result;
    function setTurnLabel() { const el = document.getElementById('c4-turn'); if (el) el.textContent = state === 'over' ? '·' : (turn === you ? 'YOUR TURN' : 'AI THINKING…'); }
    function sync() { document.getElementById('c4-you').textContent = youScore; document.getElementById('c4-ai').textContent = aiScore; setTurnLabel(); }

    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Four in a Row</h2>
        <p class="msg">Drop discs and connect four. You're <b style="color:#5ef2ff">cyan</b>; the AI is
        <b style="color:#ffb65e">gold</b> and runs Monte-Carlo Tree Search guided by a net it trained against itself —
        the bars above the board show what it's considering. Pick a strength:</p>
        <p class="msg"><b>AI lab:</b> ${modelText()}</p>
        <button class="btn" data-act="140">RELAXED</button>
        <button class="btn" data-act="500">SHARP</button>
        <button class="btn alt" data-act="1400">RUTHLESS</button>`;
    }
    function play(sims) {
      board = newBoard(); you = 1; ai = 2; turn = 1; win = null; anim = null; aiRoot = null; aiSims = 0; aiTarget = sims; result = null;
      if (youScore == null) { youScore = 0; aiScore = 0; streak = 0; }
      state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; sync();
    }
    function gameOver(winner) {
      state = 'over'; result = winner; setTurnLabel();
      if (winner === you) { youScore++; streak++; if (api.setBest('connect4', streak)) {} } else if (winner === ai) { aiScore++; streak = 0; }
      sync();
      const title = winner === you ? 'You win! 🎉' : winner === ai ? 'AI wins' : 'Draw';
      hud.style.display = 'flex';
      setTimeout(() => {
        if (state !== 'over') return;
        ov.classList.remove('hidden');
        ov.innerHTML = `<h2>${title}</h2>
          <div class="stat-row">
            <div class="stat"><span class="v">${youScore}</span><span class="l">You</span></div>
            <div class="stat"><span class="v">${aiScore}</span><span class="l">AI</span></div>
            <div class="stat"><span class="v">${api.getBest('connect4')}</span><span class="l">Best streak</span></div>
          </div>
          <button class="btn" data-act="${aiTarget}">REMATCH ↻</button>
          <button class="btn alt" data-act="menu">CHANGE LEVEL</button>`;
      }, 900);
    }
    ov.addEventListener('click', e => { const a = e.target.dataset.act; if (!a) return; if (a === 'menu') showMenu(); else play(parseInt(a, 10)); });

    // ---------- input ----------
    const colAt = cx => { const c = Math.floor((cx - bx) / cell); return c >= 0 && c < COLS ? c : -1; };
    api.on(view.canvas, 'pointermove', e => { hoverCol = state === 'playing' && turn === you && !anim ? colAt(e.clientX) : -1; });
    api.on(view.canvas, 'pointerleave', () => { hoverCol = -1; });
    api.on(view.canvas, 'pointerdown', e => {
      if (state !== 'playing' || turn !== you || anim) return;
      const c = colAt(e.clientX); if (c < 0 || !legal(board).includes(c)) return;
      humanMove(c);
    });

    function humanMove(c) { startDrop(c, you, () => { afterMove(c, you); }); }
    function startDrop(c, p, done) {
      let r = 0; while (r < ROWS && board[r * COLS + c]) r++;
      anim = { c, r, p, y: by - cell * 0.5, vy: 0, targetY: by + (ROWS - 1 - r) * cell + cell / 2, done };
    }
    function afterMove(c, p) {
      const r = (() => { for (let rr = ROWS - 1; rr >= 0; rr--) if (board[rr * COLS + c] === p) return rr; return 0; })();
      const line = winLine(board, c, r, p);
      if (line) { win = line; gameOver(p); return; }
      if (!legal(board).length) { gameOver(0); return; }
      turn = turn === 1 ? 2 : 1; aiRoot = null; aiSims = 0; setTurnLabel();
    }

    // ---------- update ----------
    function update() {
      if (anim) {
        anim.vy += cell * 0.045; anim.y += anim.vy;
        if (anim.y >= anim.targetY) { board[anim.r * COLS + anim.c] = anim.p; const d = anim.done; anim = null; d(); }
        return;
      }
      if (state === 'playing' && turn === ai) {
        if (!aiRoot) { aiRoot = { board: Int8Array.from(board), player: ai, children: null, N: 0 }; aiSims = 0; }
        const batch = 45;
        for (let i = 0; i < batch && aiSims < aiTarget; i++) { search(aiRoot); aiSims++; }
        if (aiSims >= aiTarget) {
          const v = visits(aiRoot); let move = -1, bn = -1; for (let c = 0; c < COLS; c++) if (v[c] > bn) { bn = v[c]; move = c; }
          if (move < 0) { const m = legal(board); move = m[(Math.random() * m.length) | 0]; }
          const mv = move; startDrop(mv, ai, () => afterMove(mv, ai));
          aiRoot = null;
        }
      }
    }

    // ---------- render ----------
    function discColor(p, x, y, r) { const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); if (p === 1) { g.addColorStop(0, '#bff6ff'); g.addColorStop(1, '#28b6d8'); } else { g.addColorStop(0, '#ffe6b0'); g.addColorStop(1, '#e8922e'); } return g; }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      // thinking bars (AI column preference)
      if (state === 'playing' && turn === ai && aiRoot) {
        const v = visits(aiRoot); const tot = v.reduce((a, b) => a + b, 0) || 1;
        for (let c = 0; c < COLS; c++) { const h = (v[c] / tot) * cell * 0.9; ctx.fillStyle = 'rgba(255,182,94,0.55)'; ctx.fillRect(bx + c * cell + cell * 0.2, by - cell * 0.5 - h, cell * 0.6, h); }
      } else if (state === 'playing' && turn === you && hoverCol >= 0 && legal(board).includes(hoverCol)) {
        ctx.fillStyle = 'rgba(94,242,255,0.16)'; ctx.fillRect(bx + hoverCol * cell, by, cell, bh);
        const x = bx + hoverCol * cell + cell / 2; ctx.fillStyle = discColor(you, x, by - cell * 0.45, cell * 0.38); ctx.beginPath(); ctx.arc(x, by - cell * 0.45, cell * 0.38, 0, Math.PI * 2); ctx.fill();
      }
      // board panel
      roundRect(bx - 6, by - 6, bw + 12, bh + 12, 14); ctx.fillStyle = '#16204a'; ctx.fill();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const x = bx + c * cell + cell / 2, y = by + (ROWS - 1 - r) * cell + cell / 2, p = board[r * COLS + c];
        if (p) { ctx.fillStyle = discColor(p, x, y, cell * 0.4); ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.fillStyle = '#0c1430'; ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2); ctx.fill(); }
      }
      // falling disc
      if (anim) { const x = bx + anim.c * cell + cell / 2; ctx.fillStyle = discColor(anim.p, x, anim.y, cell * 0.4); ctx.beginPath(); ctx.arc(x, anim.y, cell * 0.4, 0, Math.PI * 2); ctx.fill(); }
      // win highlight
      if (win) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; for (const [r, c] of win) { const x = bx + c * cell + cell / 2, y = by + (ROWS - 1 - r) * cell + cell / 2; ctx.beginPath(); ctx.arc(x, y, cell * 0.43, 0, Math.PI * 2); ctx.stroke(); } }
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

    api.loop(() => { if (state === 'playing') update(); draw(); });
    showMenu();

    // inert test seam (no-op in production): lets a headless harness drive a game
    if (typeof window !== 'undefined' && window.__c4test) {
      window.__c4test({
        get state() { return state; }, get turn() { return turn; }, get anim() { return !!anim; },
        get you() { return you; }, get netReady() { return !!net; },
        legal: () => legal(board), play: c => humanMove(c), start: sims => play(sims),
      });
    }
  },
});

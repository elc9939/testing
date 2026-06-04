/* 2048 — slide tiles, merge equal numbers, reach 2048. Tiles animate smoothly
   from their old cell to the new one, merges pop, and fresh tiles fade in. */
Arcade.register({
  id: 'twenty48',
  name: '2048',
  emoji: '🔢',
  desc: 'Swipe to slide the grid; equal tiles merge and double. Smooth, addictive, and made for one thumb.',
  color: '#ffb65e',

  start(root, api) {
    const N = 4, GAP = 12, DUR = 110;
    let W = 0, H = 0, board = 0, cell = 0, bx = 0, by = 0;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    function layout(v) { W = v.w; H = v.h; board = Math.min(Math.min(W, H) * 0.9, 480); cell = (board - GAP * (N + 1)) / N; bx = (W - board) / 2; by = (H - board) / 2 + 8; }
    layout(view);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="tt-score">0</b></span><span class="b">BEST <b id="tt-best">0</b></span>`;
    root.appendChild(hud);

    let tiles, score, state, animT, won;
    let nextId = 1;
    const cx = c => bx + GAP + c * (cell + GAP);
    const cy = r => by + GAP + r * (cell + GAP);

    function sync() { document.getElementById('tt-score').textContent = score; document.getElementById('tt-best').textContent = api.getBest('twenty48'); }
    function emptyCells() { const occ = {}; for (const t of tiles) if (!t.absorbed) occ[t.r * N + t.c] = 1; const out = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!occ[r * N + c]) out.push([r, c]); return out; }
    function addTile(r, c, value) { tiles.push({ id: nextId++, r, c, sr: r, sc: c, value, scale: 0 }); }
    function spawn() { const e = emptyCells(); if (!e.length) return; const [r, c] = e[(Math.random() * e.length) | 0]; addTile(r, c, Math.random() < 0.9 ? 2 : 4); }

    function reset() { tiles = []; score = 0; won = false; animT = null; spawn(); spawn(); sync(); }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>2048</h2>
        <p class="msg">Slide with arrow keys, <b>WASD</b>, or swipe. When two tiles with the same number touch,
        they merge into one. Get a tile to <b>2048</b> — then keep going for a high score.</p>
        <button class="btn" data-act="play">PLAY ▸</button>`;
    }
    function play() { reset(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; }
    function banner(title, sub) {
      hud.style.display = 'none'; ov.classList.remove('hidden');
      const best = api.setBest('twenty48', score);
      ov.innerHTML = `<h2>${title}</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
          <div class="stat"><span class="v">${api.getBest('twenty48')}</span><span class="l">Best</span></div>
        </div>
        ${best ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:18px"></div>'}
        <button class="btn" data-act="play">${sub}</button>${title.includes('2048') ? '<button class="btn alt" data-act="cont">KEEP GOING</button>' : ''}`;
    }
    ov.addEventListener('click', e => { const a = e.target.dataset.act; if (a === 'play') play(); else if (a === 'cont') { state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; } });

    // ---- movement ----
    function move(dir) {
      if (state !== 'playing' || animT !== null) return;
      const grid = Array.from({ length: N }, () => new Array(N).fill(null));
      for (const t of tiles) { t.absorbed = false; t.merged = false; t.sr = t.r; t.sc = t.c; grid[t.r][t.c] = t; }
      const rows = dir === 'l' || dir === 'r', forward = dir === 'l' || dir === 'u';
      const order = forward ? [0, 1, 2, 3] : [3, 2, 1, 0];
      const start = forward ? 0 : N - 1, step = forward ? 1 : -1;
      let moved = false, gained = 0;
      for (let k = 0; k < N; k++) {
        let place = start, last = null;
        for (const pos of order) {
          const t = rows ? grid[k][pos] : grid[pos][k];
          if (!t) continue;
          if (last && last.value === t.value && !last.merged) {
            if (rows) { t.r = k; t.c = last.c; } else { t.r = last.r; t.c = k; }
            t.absorbed = true; last.merged = true; last.newValue = last.value * 2; gained += last.value * 2;
            if (last.newValue === 2048) won = true;
          } else {
            const nr = rows ? k : place, nc = rows ? place : k;
            if (t.r !== nr || t.c !== nc) moved = true;
            t.r = nr; t.c = nc; place += step; last = t;
          }
        }
      }
      if (tiles.some(t => t.absorbed)) moved = true;
      if (!moved) return;
      score += gained; sync();
      animT = 0;
    }
    function commit() {
      tiles = tiles.filter(t => !t.absorbed);
      for (const t of tiles) if (t.merged) { t.value = t.newValue; t.scale = 1.22; t.merged = false; }
      spawn();
      for (const t of tiles) { t.sr = t.r; t.sc = t.c; }
      animT = null;
      if (won && state === 'playing') { state = 'won'; banner('You hit 2048!', 'NEW GAME'); won = false; return; }
      if (!emptyCells().length && !canMove()) { state = 'over'; banner('Game Over', 'PLAY AGAIN ↻'); }
    }
    function canMove() {
      const g = Array.from({ length: N }, () => new Array(N).fill(0));
      for (const t of tiles) g[t.r][t.c] = t.value;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { if (!g[r][c]) return true; if (c < N - 1 && g[r][c] === g[r][c + 1]) return true; if (r < N - 1 && g[r][c] === g[r + 1][c]) return true; }
      return false;
    }

    // ---- input ----
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase(); let d = null;
      if (k === 'arrowleft' || k === 'a') d = 'l'; else if (k === 'arrowright' || k === 'd') d = 'r';
      else if (k === 'arrowup' || k === 'w') d = 'u'; else if (k === 'arrowdown' || k === 's') d = 'd';
      if (d) { move(d); e.preventDefault(); }
    });
    let sw = null;
    api.on(view.canvas, 'pointerdown', e => { sw = { x: e.clientX, y: e.clientY }; });
    api.on(window, 'pointerup', e => {
      if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
    });

    // ---- look ----
    const ease = t => t * t * (3 - 2 * t);
    function tileColor(v) {
      const p = Math.min(Math.log2(v) - 1, 10);
      const hue = 28 + p * 20, light = 40 + Math.min(p, 6) * 3;
      return `hsl(${hue},78%,${light}%)`;
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

    function update() { if (animT !== null) { animT += 16.7; if (animT >= DUR) commit(); } for (const t of tiles) t.scale += (1 - t.scale) * 0.22; }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      // board backing
      ctx.fillStyle = '#141a33'; roundRect(bx, by, board, board, 14); ctx.fill();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(cx(c), cy(r), cell, cell, 9); ctx.fill(); }
      if (state === 'menu') return;
      const p = animT !== null ? ease(animT / DUR) : 1;
      const ordered = tiles.slice().sort((a, b) => (a.scale) - (b.scale));
      for (const t of ordered) {
        const tr = t.sr + (t.r - t.sr) * p, tc = t.sc + (t.c - t.sc) * p;
        const sc = Math.max(0.01, t.scale), sz = cell * sc, ox = (cell - sz) / 2;
        const x = cx(tc) + ox, y = cy(tr) + ox;
        ctx.fillStyle = tileColor(t.value); roundRect(x, y, sz, sz, 9 * sc); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(x, y, sz, sz * 0.42, 9 * sc); ctx.fill();
        ctx.fillStyle = t.value <= 4 ? '#2a2140' : '#fff';
        ctx.font = `900 ${Math.round(cell * 0.34 * sc * (t.value >= 1000 ? 0.78 : 1))}px system-ui,sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.value, cx(tc) + cell / 2, cy(tr) + cell / 2);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    api.loop(() => { if (state === 'playing' || state === 'won' || state === 'over') update(); draw(); });
    showMenu();
  },
});

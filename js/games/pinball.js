/* Neon Pinball — a single-table pinball with real ball + flipper physics.
   Everything lives in a fixed virtual table (380x640, portrait) that is scaled
   to fit the canvas, so the geometry and tuning stay resolution-independent. */
Arcade.register({
  id: 'pinball',
  name: 'Neon Pinball',
  emoji: '🎯',
  desc: 'Real flipper-and-ball physics. Light the bumpers, ride the combo multiplier, keep it off the drain.',
  color: '#ff5ec4',

  start(root, api) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const TW = 380, TH = 640;                 // virtual table size
    let s = 1, offX = 0, offY = 0, W = 0, H = 0;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    function layout(v) { W = v.w; H = v.h; s = Math.min(W / TW, H / TH); offX = (W - TW * s) / 2; offY = (H - TH * s) / 2; }
    layout(view);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="pb-score">0</b></span>
      <span id="pb-balls">●●●</span><span class="b">COMBO x<b id="pb-mult">1</b></span>`;
    root.appendChild(hud);

    // ---- table geometry (virtual coords; y is down) ----
    // walls: [x1, y1, x2, y2, restitution]
    const WALLS = [
      [24, 70, 96, 30, 0.6], [96, 30, 284, 22, 0.6], [284, 22, 356, 70, 0.6],   // top dome
      [24, 70, 24, 470, 0.6],                                                    // left wall
      [356, 70, 356, 602, 0.5],                                                  // right outer (launch lane)
      [332, 300, 332, 602, 0.5],                                                 // lane divider
      [332, 602, 356, 602, 0.2],                                                 // lane floor
      [24, 470, 108, 556, 0.55],                                                 // left lower funnel
      [332, 470, 272, 556, 0.55],                                                // right lower funnel
      [90, 452, 120, 516, 1.25], [290, 452, 260, 516, 1.25],                     // slingshots (kickers)
    ];
    const SLING_IDX = new Set([8, 9]);        // which WALLS are scoring slingshots
    // bumpers: {x, y, r, score}
    const BUMPERS = [
      { x: 132, y: 168, r: 18, score: 100 }, { x: 248, y: 168, r: 18, score: 100 },
      { x: 190, y: 236, r: 20, score: 100 }, { x: 190, y: 104, r: 14, score: 150 },
    ];
    const POSTS = [{ x: 64, y: 320, r: 7 }, { x: 300, y: 320, r: 7 }];           // tiny bouncers
    for (const b of BUMPERS) b.flash = 0;
    for (const p of POSTS) p.flash = 0;

    // flippers pivot near the drain and flick upward
    const LF = { px: 120, py: 556, len: 66, rest: 0.42, up: -0.46, ang: 0.42, w: 0, active: false };
    const RF = { px: 260, py: 556, len: 66, rest: Math.PI - 0.42, up: Math.PI + 0.46, ang: Math.PI - 0.42, w: 0, active: false };

    let ball, balls, score, mult, comboT, state, charge, charging, shake, particles, trail, simAcc = 0;

    function reset() {
      score = 0; balls = 3; mult = 1; comboT = 0; shake = 0; particles = []; trail = [];
      spawnBall();
    }
    function spawnBall() { ball = { x: 344, y: 590, vx: 0, vy: 0, r: 8, lane: true }; charge = 0; charging = false; }
    function sync() {
      document.getElementById('pb-score').textContent = score;
      document.getElementById('pb-mult').textContent = mult;
      document.getElementById('pb-balls').textContent = '●'.repeat(Math.max(0, balls)) + '○'.repeat(Math.max(0, 3 - balls));
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Neon Pinball</h2>
        <p class="msg">Hold to charge the plunger, release to launch. Flip with <b>A</b>/<b>D</b>, ←/→,
        or tap the left/right side of the table. Hit bumpers to build the combo — don't let it drain.</p>
        <button class="btn" data-act="play">PLAY ▸</button>`;
    }
    function play() { reset(); sync(); simAcc = 0; state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; }
    function gameOver() {
      state = 'over'; hud.style.display = 'none';
      const best = api.setBest('pinball', score);
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Ball Drained</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
          <div class="stat"><span class="v">${api.getBest('pinball')}</span><span class="l">Best</span></div>
        </div>
        ${best ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
        <button class="btn" data-act="play">PLAY AGAIN ↻</button>`;
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    // ---- input ----
    const toVX = cx => (cx - offX) / s;
    function pressSide(cx) {                    // tap halves flip; full press also charges in lane
      if (state !== 'playing') return;
      if (ball.lane) { charging = true; return; }
      if (toVX(cx) < TW / 2) LF.active = true; else RF.active = true;
    }
    function releaseAll() {
      if (charging && ball && ball.lane) { ball.vy = -(8.2 + charge * 9); ball.vx = rand(-0.4, 0.2); ball.lane = false; }
      charging = false; charge = 0; LF.active = false; RF.active = false;
    }
    api.on(view.canvas, 'pointerdown', e => { e.preventDefault(); pressSide(e.clientX); });
    api.on(window, 'pointerup', () => releaseAll());
    const keys = {};
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase();
      if (keys[k]) return; keys[k] = true;
      if (state !== 'playing') return;
      if (k === 'a' || k === 'arrowleft') LF.active = true;
      else if (k === 'd' || k === 'arrowright') RF.active = true;
      else if (k === ' ' || k === 'arrowup' || k === 'arrowdown') { if (ball.lane) charging = true; e.preventDefault(); }
    });
    api.on(window, 'keyup', e => {
      const k = e.key.toLowerCase(); keys[k] = false;
      if (k === 'a' || k === 'arrowleft') LF.active = false;
      else if (k === 'd' || k === 'arrowright') RF.active = false;
      else if (k === ' ' || k === 'arrowup' || k === 'arrowdown') {
        if (charging && ball && ball.lane) { ball.vy = -(8.2 + charge * 9); ball.vx = rand(-0.4, 0.2); ball.lane = false; }
        charging = false; charge = 0;
      }
    });

    // ---- physics helpers ----
    function closestOnSeg(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
      let t = ((px - x1) * dx + (py - y1) * dy) / l2; t = clamp(t, 0, 1);
      return { x: x1 + t * dx, y: y1 + t * dy };
    }
    function pop(x, y, color, n) { for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), sp = rand(0.6, 3.2); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(160, 340), max: 340, color, r: rand(1, 2.6) }); } }
    function addScore(n) { score += n * mult; comboT = 2200; mult = clamp(1 + Math.floor(comboHits / 4), 1, 9); sync(); }
    let comboHits = 0;

    function collideSeg(b, x1, y1, x2, y2, e, sling) {
      const q = closestOnSeg(b.x, b.y, x1, y1, x2, y2);
      let dx = b.x - q.x, dy = b.y - q.y, d = Math.hypot(dx, dy);
      if (d >= b.r) return false;
      if (d < 0.0001) { dx = -(y2 - y1); dy = x2 - x1; d = Math.hypot(dx, dy) || 1; }
      const nx = dx / d, ny = dy / d;
      b.x = q.x + nx * b.r; b.y = q.y + ny * b.r;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
      if (sling) { b.vx += nx * 3.4; b.vy += ny * 3.4; comboHits++; addScore(50); pop(q.x, q.y, '#9cff5e', 8); shake = Math.max(shake, 3); }
      return true;
    }
    function collideCircle(b, c, e, pushOut, onHit) {
      let dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy), rr = b.r + c.r;
      if (d >= rr) return false;
      const nx = dx / (d || 1), ny = dy / (d || 1);
      b.x = c.x + nx * rr; b.y = c.y + ny * rr;
      const vn = b.vx * nx + b.vy * ny;
      b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
      if (pushOut) { b.vx += nx * pushOut; b.vy += ny * pushOut; }
      if (onHit) onHit(nx, ny);
      return true;
    }
    function collideFlipper(b, f) {
      const tx = f.px + Math.cos(f.ang) * f.len, ty = f.py + Math.sin(f.ang) * f.len;
      const q = closestOnSeg(b.x, b.y, f.px, f.py, tx, ty);
      let dx = b.x - q.x, dy = b.y - q.y, d = Math.hypot(dx, dy); const rad = b.r + 5.5;
      if (d >= rad) return;
      if (d < 0.0001) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d;
      b.x = q.x + nx * rad; b.y = q.y + ny * rad;
      const rxp = q.x - f.px, ryp = q.y - f.py;       // surface velocity from flipper rotation
      const svx = -f.w * ryp * 1.25, svy = f.w * rxp * 1.25;
      const rvx = b.vx - svx, rvy = b.vy - svy, vn = rvx * nx + rvy * ny;
      if (vn < 0) { const e = 0.45; b.vx = svx + rvx - (1 + e) * vn * nx; b.vy = svy + rvy - (1 + e) * vn * ny; }
    }

    const GRAV = 0.23, SUB = 4, MAXV = 15;
    function flipperStep(f) { const target = f.active ? f.up : f.rest, prev = f.ang; f.ang += (target - f.ang) * 0.5; f.w = f.ang - prev; }

    function updateStep() {
      if (charging) charge = clamp(charge + 0.022, 0, 1);
      flipperStep(LF); flipperStep(RF);
      comboT = Math.max(0, comboT - 16.7); if (comboT === 0) { comboHits = 0; mult = 1; }
      for (const b of BUMPERS) b.flash = Math.max(0, b.flash - 0.08);
      for (const p of POSTS) p.flash = Math.max(0, p.flash - 0.08);
      shake = Math.max(0, shake - 0.4);

      if (ball.lane && !ball.launched2) { /* resting in lane */ }
      if (!ball.lane) {
        for (let i = 0; i < SUB; i++) {
          ball.vy += GRAV / SUB;
          const sp = Math.hypot(ball.vx, ball.vy); if (sp > MAXV) { ball.vx *= MAXV / sp; ball.vy *= MAXV / sp; }
          ball.x += ball.vx / SUB; ball.y += ball.vy / SUB;
          for (let w = 0; w < WALLS.length; w++) { const W2 = WALLS[w]; collideSeg(ball, W2[0], W2[1], W2[2], W2[3], W2[4], SLING_IDX.has(w)); }
          for (const c of BUMPERS) collideCircle(ball, c, 0.5, 3.6, (nx, ny) => { comboHits++; addScore(c.score); c.flash = 1; pop(c.x + nx * c.r, c.y + ny * c.r, c.score > 100 ? '#ffd45e' : '#5ef2ff', 12); shake = Math.max(shake, 4); });
          for (const p of POSTS) collideCircle(ball, p, 0.85, 0, () => { p.flash = 1; });
          collideFlipper(ball, LF); collideFlipper(ball, RF);
        }
        trail.push({ x: ball.x, y: ball.y }); if (trail.length > 12) trail.shift();
        if (ball.y > 624) { // drained
          balls--; sync(); pop(ball.x, 620, '#ff5ec4', 16); shake = 6;
          if (balls <= 0) { gameOver(); return; }
          spawnBall();
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 16.7; if (p.life <= 0) particles.splice(i, 1); }
    }

    // ---- rendering ----
    function drawSeg(x1, y1, x2, y2, color, wdt) { ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(offX + (shake ? rand(-shake, shake) : 0), offY + (shake ? rand(-shake, shake) : 0));
      ctx.scale(s, s);
      // table bed
      ctx.fillStyle = '#0b0f24'; ctx.fillRect(0, 0, TW, TH);
      const bg = ctx.createRadialGradient(TW / 2, 200, 20, TW / 2, 200, 320);
      bg.addColorStop(0, 'rgba(94,242,255,0.07)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, TH);
      if (state !== 'menu') {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let w = 0; w < WALLS.length; w++) { const W2 = WALLS[w]; drawSeg(W2[0], W2[1], W2[2], W2[3], SLING_IDX.has(w) ? '#9cff5e' : '#3a63b8', SLING_IDX.has(w) ? 6 : 4); }
        for (const p of POSTS) { ctx.fillStyle = p.flash > 0.1 ? '#fff' : '#5e7bd8'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        for (const c of BUMPERS) {
          const gl = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, c.r + 8 + c.flash * 14);
          gl.addColorStop(0, c.flash > 0.1 ? '#ffffff' : (c.score > 100 ? 'rgba(255,212,94,0.9)' : 'rgba(94,242,255,0.9)'));
          gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl;
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 8 + c.flash * 14, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = c.score > 100 ? '#ffd45e' : '#5ef2ff'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#0b0f24'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.5, 0, Math.PI * 2); ctx.fill();
        }
        // flippers
        for (const f of [LF, RF]) { const tx = f.px + Math.cos(f.ang) * f.len, ty = f.py + Math.sin(f.ang) * f.len; drawSeg(f.px, f.py, tx, ty, '#ff5ec4', 11); ctx.fillStyle = '#ff9ad9'; ctx.beginPath(); ctx.arc(f.px, f.py, 6, 0, Math.PI * 2); ctx.fill(); }
        // plunger gauge
        if (ball.lane) { ctx.fillStyle = 'rgba(156,255,94,0.25)'; ctx.fillRect(336, 602 - charge * 120, 16, charge * 120); }
        // particles
        for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        // ball + trail
        for (let i = 0; i < trail.length; i++) { ctx.globalAlpha = i / trail.length * 0.4; ctx.fillStyle = '#eaf6ff'; ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, ball.r * 0.7, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        const gb = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r * 2.2);
        gb.addColorStop(0, '#ffffff'); gb.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gb; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#dfe9f5'; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    api.loop(dt => {
      if (state === 'playing') {
        simAcc += Math.min(dt, 50);
        let steps = 0;
        while (simAcc >= 16.7 && steps < 4 && state === 'playing') {
          updateStep();
          simAcc -= 16.7;
          steps++;
        }
        if (steps >= 4) simAcc = 0;
      }
      draw();
    });
    showMenu();
  },
});

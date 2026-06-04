/* Orbit — a gravity sandbox. Fling planets around a star and watch them trace
   glowing n-body orbits. Planets pull on each other, merge on contact, and burn
   up in the star. A relaxed toy; "score" is the orbits your system completes. */
Arcade.register({
  id: 'orbit',
  name: 'Orbit',
  emoji: '🪐',
  desc: 'A gravity sandbox: drag to fling planets, watch them swing into orbit, merge, and trail light across space.',
  color: '#9b8cff',

  start(root, api) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const G = 1.0, STAR_M = 1400, SOFT = 80;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    let W = 0, H = 0, stars = [], planets = [], field = [], orbits = 0;
    let drag = null;                          // {x0,y0,x,y} while aiming a fling

    function layout(v) {
      W = v.w; H = v.h;
      field = []; for (let i = 0; i < 90; i++) field.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + 0.2, a: Math.random() * 0.5 + 0.2 });
      if (!stars.length) stars = [{ x: W / 2, y: H / 2, m: STAR_M, r: 26 }];
      else { stars[0].x = W / 2; stars[0].y = H / 2; }
    }
    layout(view);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">PLANETS <b id="ob-n">0</b></span><span class="b">ORBITS <b id="ob-orb">0</b></span>`;
    root.appendChild(hud);
    const reset = { x: 0, y: 0, w: 92, h: 34 };
    function placeReset() { reset.x = W - reset.w - 14; reset.y = 14; }

    let state;
    function sync() { document.getElementById('ob-n').textContent = planets.length; document.getElementById('ob-orb').textContent = orbits; }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Orbit</h2>
        <p class="msg">Drag from empty space and release to fling a planet — the longer the drag, the faster it goes.
        Aim sideways past the star for a clean orbit. Planets pull on each other and merge on contact.</p>
        <button class="btn" data-act="play">PLAY ▸</button>`;
    }
    function play() { planets = []; orbits = 0; stars = [{ x: W / 2, y: H / 2, m: STAR_M, r: 26 }]; placeReset(); sync(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; seed(); }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });
    function seed() {                          // start with a couple of planets so it's alive
      const a = stars[0]; for (const [R, dir] of [[150, 1], [240, -1]]) { const v = Math.sqrt(G * a.m / R) * dir; addPlanet(a.x + R, a.y, 0, v); }
    }

    function planetColor() { const h = (Math.random() * 360) | 0; return `hsl(${h},75%,62%)`; }
    function addPlanet(x, y, vx, vy) {
      const m = rand(4, 9), p = { x, y, vx, vy, m, r: clamp(3 + Math.sqrt(m), 3, 16), color: planetColor(), trail: [], acc: 0, refX: x - stars[0].x, refY: y - stars[0].y };
      planets.push(p); sync();
    }

    const toV = (cx, cy) => ({ x: cx, y: cy });   // canvas is unscaled
    function inReset(x, y) { return x >= reset.x && x <= reset.x + reset.w && y >= reset.y && y <= reset.y + reset.h; }
    api.on(view.canvas, 'pointerdown', e => {
      if (state !== 'playing') return; e.preventDefault();
      const p = toV(e.clientX, e.clientY);
      if (inReset(p.x, p.y)) { planets = []; orbits = 0; sync(); return; }
      drag = { x0: p.x, y0: p.y, x: p.x, y: p.y };
    });
    api.on(window, 'pointermove', e => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; } });
    api.on(window, 'pointerup', e => {
      if (!drag) return;
      const vx = (drag.x - drag.x0) * 0.045, vy = (drag.y - drag.y0) * 0.045;
      addPlanet(drag.x0, drag.y0, vx, vy); drag = null;
    });
    api.on(window, 'keydown', e => { if (state === 'playing' && (e.key === 'c' || e.key === 'C')) { planets = []; orbits = 0; sync(); } });

    function update() {
      // gravity from stars + other planets (softened), symplectic Euler
      for (const p of planets) {
        let ax = 0, ay = 0;
        for (const s of stars) { const dx = s.x - p.x, dy = s.y - p.y, d2 = dx * dx + dy * dy + SOFT, inv = G * s.m / (d2 * Math.sqrt(d2)); ax += dx * inv; ay += dy * inv; }
        for (const o of planets) { if (o === p) continue; const dx = o.x - p.x, dy = o.y - p.y, d2 = dx * dx + dy * dy + SOFT, inv = G * o.m / (d2 * Math.sqrt(d2)); ax += dx * inv; ay += dy * inv; }
        p.vx += ax; p.vy += ay;
      }
      for (let i = planets.length - 1; i >= 0; i--) {
        const p = planets[i];
        p.x += p.vx; p.y += p.vy;
        p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 60) p.trail.shift();
        // orbit counting around the primary star (accumulated angle)
        const s0 = stars[0], nx = p.x - s0.x, ny = p.y - s0.y;
        const ang = Math.atan2(ny, nx), ref = Math.atan2(p.refY, p.refX);
        let d = ang - ref; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        p.acc += d; p.refX = nx; p.refY = ny;
        if (Math.abs(p.acc) >= Math.PI * 2) { p.acc -= Math.sign(p.acc) * Math.PI * 2; orbits++; sync(); }
        // burn up in a star
        let burned = false;
        for (const s of stars) { const dx = s.x - p.x, dy = s.y - p.y; if (Math.hypot(dx, dy) < s.r + p.r) { burst(p.x, p.y, p.color, 18); planets.splice(i, 1); sync(); burned = true; break; } }
        if (burned) continue;
        // fly far off → lost
        if (p.x < -W || p.x > 2 * W || p.y < -H || p.y > 2 * H) { planets.splice(i, 1); sync(); }
      }
      // merge planets on contact (mass + momentum conserved)
      for (let i = 0; i < planets.length; i++) for (let j = i + 1; j < planets.length; j++) {
        const a = planets[i], b = planets[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) {
          const m = a.m + b.m;
          a.x = (a.x * a.m + b.x * b.m) / m; a.y = (a.y * a.m + b.y * b.m) / m;
          a.vx = (a.vx * a.m + b.vx * b.m) / m; a.vy = (a.vy * a.m + b.vy * b.m) / m;
          a.m = m; a.r = clamp(3 + Math.sqrt(m), 3, 22); burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffffff', 12);
          planets.splice(j, 1); sync(); j--;
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.x += p.vx; p.y += p.vy; p.life -= 16.7; if (p.life <= 0) parts.splice(i, 1); }
    }
    const parts = [];
    function burst(x, y, color, n) { for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), sp = rand(0.5, 2.6); parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(220, 480), max: 480, color, r: rand(1, 2.4) }); } }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, W, H);
      for (const f of field) { ctx.globalAlpha = f.a; ctx.fillStyle = '#cdd6ff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (state !== 'menu') {
        // trails
        for (const p of planets) {
          ctx.strokeStyle = p.color; ctx.lineCap = 'round';
          for (let i = 1; i < p.trail.length; i++) { ctx.globalAlpha = i / p.trail.length * 0.5; ctx.lineWidth = i / p.trail.length * p.r * 0.8; ctx.beginPath(); ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
        // stars
        for (const s of stars) {
          const gl = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, s.r * 3);
          gl.addColorStop(0, 'rgba(255,236,170,0.95)'); gl.addColorStop(0.4, 'rgba(255,170,80,0.5)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        // planets
        for (const p of planets) {
          const gl = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r * 2);
          gl.addColorStop(0, p.color); gl.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        // particles
        for (const p of parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        // aim arrow
        if (drag) {
          ctx.strokeStyle = '#9b8cff'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.moveTo(drag.x0, drag.y0); ctx.lineTo(drag.x, drag.y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(155,140,255,0.8)'; ctx.beginPath(); ctx.arc(drag.x0, drag.y0, 5, 0, Math.PI * 2); ctx.fill();
        }
        // reset pill
        ctx.fillStyle = 'rgba(155,140,255,0.16)'; ctx.strokeStyle = 'rgba(155,140,255,0.7)'; ctx.lineWidth = 1.5;
        roundRect(reset.x, reset.y, reset.w, reset.h, 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#cdd6ff'; ctx.font = '600 15px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('↻ Reset', reset.x + reset.w / 2, reset.y + reset.h / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

    api.loop(() => { if (state === 'playing') update(); draw(); });
    placeReset(); showMenu();
  },
});

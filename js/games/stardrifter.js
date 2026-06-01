/* Star Drifter — dodge asteroids, grab orbs & power-ups, survive. */
Arcade.register({
  id: 'stardrifter',
  name: 'Star Drifter',
  emoji: '🚀',
  desc: 'Dodge an endless asteroid storm. Grab orbs and power-ups to survive as long as you can.',
  color: '#5ef2ff',

  start(root, api) {
    const view = api.makeCanvas(root);
    const ctx = view.ctx;
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const POWER = { SHIELD: 'shield', SLOW: 'slow', DOUBLE: 'double' };

    // overlay UI
    const ov = document.createElement('div');
    ov.className = 'center-overlay';
    ov.innerHTML = `
      <h2>Star Drifter</h2>
      <p class="msg">Move with mouse, touch, or arrows/WASD. Fly into 🔵 orbs for points and grab
      🛡️ shield · 🐢 slow-mo · ✨ score×2 power-ups. You have 3 lives.</p>
      <button class="btn" data-act="play">PLAY ▸</button>`;
    root.appendChild(ov);
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="sd-score">0</b></span>
      <span id="sd-lives">♥♥♥</span><span class="b">BEST <b id="sd-best">0</b></span>`;
    root.appendChild(hud);

    let state = 'menu', score, lives, startTime, elapsed, lastSpawn, spawnGap;
    let shieldTime, doubleTime, invuln, slowUntil, shake;
    let ship, asteroids, orbs, powerups, particles;
    const stars = [];
    const pointer = { x: view.w / 2, y: view.h / 2 };
    const keys = {};

    function initStars() {
      stars.length = 0;
      for (let i = 0; i < 130; i++)
        stars.push({ x: Math.random() * view.w, y: Math.random() * view.h, z: rand(.2, 1), s: rand(.5, 2) });
    }
    initStars();
    asteroids = []; orbs = []; powerups = []; particles = []; // safe defaults for menu-state draw

    function reset() {
      ship = { x: view.w / 2, y: view.h * .75, r: 14, vx: 0, vy: 0, angle: -Math.PI / 2 };
      asteroids = []; orbs = []; powerups = []; particles = [];
      score = 0; lives = 3; elapsed = 0; spawnGap = 900; lastSpawn = 0;
      shieldTime = doubleTime = invuln = slowUntil = shake = 0;
      startTime = performance.now();
      pointer.x = ship.x; pointer.y = ship.y;
    }
    const sEl = () => document.getElementById('sd-score');
    function hudUpdate() {
      document.getElementById('sd-score').textContent = Math.floor(score);
      document.getElementById('sd-best').textContent = api.getBest('stardrifter');
      document.getElementById('sd-lives').textContent =
        '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives));
    }

    function play() {
      reset(); state = 'playing';
      ov.classList.add('hidden'); hud.style.display = 'flex'; hudUpdate();
    }
    function gameOver() {
      state = 'over'; hud.style.display = 'none';
      const isBest = api.setBest('stardrifter', score);
      ov.classList.remove('hidden');
      ov.innerHTML = `
        <h2>Game Over</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${Math.floor(score)}</span><span class="l">Score</span></div>
          <div class="stat"><span class="v">${api.getBest('stardrifter')}</span><span class="l">Best</span></div>
          <div class="stat"><span class="v">${Math.floor(elapsed / 1000)}s</span><span class="l">Survived</span></div>
        </div>
        ${isBest ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
        <button class="btn" data-act="play">PLAY AGAIN ↻</button>`;
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    // input
    const setPointer = e => { const t = e.touches ? e.touches[0] : e; pointer.x = t.clientX; pointer.y = t.clientY; };
    api.on(view.canvas, 'mousemove', setPointer);
    api.on(view.canvas, 'touchstart', e => { e.preventDefault(); setPointer(e); }, { passive: false });
    api.on(view.canvas, 'touchmove', e => { e.preventDefault(); setPointer(e); }, { passive: false });
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase(); keys[k] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    api.on(window, 'keyup', e => { keys[e.key.toLowerCase()] = false; });

    const slowActive = () => performance.now() < slowUntil;
    const pColor = t => t === POWER.SHIELD ? '#5ef2ff' : t === POWER.SLOW ? '#9cff5e' : '#ffd45e';
    const pIcon = t => t === POWER.SHIELD ? '🛡️' : t === POWER.SLOW ? '🐢' : '✨';

    function burst(x, y, color, n, spd) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = rand(.4, 1) * spd;
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(300, 700), max: 700, color, r: rand(1.5, 4) });
      }
    }
    function spawnAsteroid() {
      const edge = Math.floor(rand(0, 4)), size = rand(16, 42);
      let x, y;
      if (edge === 0) { x = rand(0, view.w); y = -size; }
      else if (edge === 1) { x = view.w + size; y = rand(0, view.h); }
      else if (edge === 2) { x = rand(0, view.w); y = view.h + size; }
      else { x = -size; y = rand(0, view.h); }
      const a = Math.atan2(ship.y + rand(-view.h * .2, view.h * .2) - y, ship.x + rand(-view.w * .2, view.w * .2) - x);
      const spd = rand(1.4, 2.6) + elapsed / 40000;
      const verts = []; const n = Math.floor(rand(7, 11));
      for (let i = 0; i < n; i++) verts.push(rand(.72, 1.12));
      asteroids.push({ x, y, r: size, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, spin: rand(-.04, .04), rot: 0, verts, hue: rand(200, 320) });
    }
    function loseLife() {
      if (shieldTime > 0) { shieldTime = 0; invuln = 800; burst(ship.x, ship.y, '#5ef2ff', 24, 5); return; }
      if (invuln > 0) return;
      lives--; invuln = 1400; shake = 18;
      burst(ship.x, ship.y, '#ff5ec4', 40, 7);
      hudUpdate();
      if (lives <= 0) gameOver();
    }

    function update(dt) {
      elapsed = performance.now() - startTime;
      spawnGap = Math.max(280, 900 - elapsed / 60);
      if (shieldTime > 0) shieldTime -= dt;
      if (doubleTime > 0) doubleTime -= dt;
      if (invuln > 0) invuln -= dt;
      const ts = slowActive() ? .5 : 1;

      let tx = pointer.x, ty = pointer.y;
      if (keys['arrowleft'] || keys['a']) tx = ship.x - 120;
      if (keys['arrowright'] || keys['d']) tx = ship.x + 120;
      if (keys['arrowup'] || keys['w']) ty = ship.y - 120;
      if (keys['arrowdown'] || keys['s']) ty = ship.y + 120;
      ship.vx = (ship.vx + (tx - ship.x) * .014) * .86;
      ship.vy = (ship.vy + (ty - ship.y) * .014) * .86;
      ship.x = clamp(ship.x + ship.vx, ship.r, view.w - ship.r);
      ship.y = clamp(ship.y + ship.vy, ship.r, view.h - ship.r);
      if (Math.abs(ship.vx) + Math.abs(ship.vy) > .5) ship.angle = Math.atan2(ship.vy, ship.vx);

      if (Math.abs(ship.vx) + Math.abs(ship.vy) > 1.2 && Math.random() < .6)
        particles.push({ x: ship.x - Math.cos(ship.angle) * 12, y: ship.y - Math.sin(ship.angle) * 12,
          vx: -Math.cos(ship.angle) * rand(.5, 1.5), vy: -Math.sin(ship.angle) * rand(.5, 1.5), life: 320, max: 320, color: '#ffb15e', r: rand(1.5, 3.5) });

      if (elapsed - lastSpawn > spawnGap) { lastSpawn = elapsed; spawnAsteroid(); if (elapsed > 4000 && Math.random() < .3) spawnAsteroid(); }
      if (orbs.length < 3 && Math.random() < .02) orbs.push({ x: rand(40, view.w - 40), y: rand(40, view.h - 40), r: 9, pulse: Math.random() * 6, life: 9000 });
      if (Math.random() < .0016 && powerups.length < 2) {
        const t = [POWER.SHIELD, POWER.SLOW, POWER.DOUBLE][Math.floor(Math.random() * 3)];
        powerups.push({ x: rand(50, view.w - 50), y: rand(50, view.h - 50), r: 14, type: t, life: 8000, pulse: 0 });
      }
      score += dt * .006 * (doubleTime > 0 ? 2 : 1);

      for (let i = asteroids.length - 1; i >= 0; i--) {
        const o = asteroids[i]; o.x += o.vx * ts; o.y += o.vy * ts; o.rot += o.spin * ts;
        const pad = o.r + 60;
        if (o.x < -pad || o.x > view.w + pad || o.y < -pad || o.y > view.h + pad) { asteroids.splice(i, 1); continue; }
        if (Math.hypot(o.x - ship.x, o.y - ship.y) < o.r + ship.r - 4) { loseLife(); burst(o.x, o.y, '#9aa8ff', 12, 4); asteroids.splice(i, 1); }
      }
      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i]; o.pulse += dt * .005; o.life -= dt;
        if (o.life <= 0) { orbs.splice(i, 1); continue; }
        if (Math.hypot(o.x - ship.x, o.y - ship.y) < o.r + ship.r) { score += doubleTime > 0 ? 50 : 25; burst(o.x, o.y, '#5ef2ff', 18, 4); orbs.splice(i, 1); hudUpdate(); }
      }
      for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i]; p.pulse += dt * .006; p.life -= dt;
        if (p.life <= 0) { powerups.splice(i, 1); continue; }
        if (Math.hypot(p.x - ship.x, p.y - ship.y) < p.r + ship.r) {
          if (p.type === POWER.SHIELD) shieldTime = 6000;
          else if (p.type === POWER.SLOW) slowUntil = performance.now() + 4500;
          else doubleTime = 8000;
          burst(p.x, p.y, pColor(p.type), 26, 5); powerups.splice(i, 1);
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.x += p.vx * ts; p.y += p.vy * ts; p.vx *= .97; p.vy *= .97; p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (const s of stars) { s.y += s.z * .4 * ts; if (s.y > view.h) { s.y = 0; s.x = Math.random() * view.w; } }
      if (shake > .4) shake *= .86;
      hudUpdate();
    }

    function drawShip() {
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle + Math.PI / 2);
      if (shieldTime > 0) {
        ctx.beginPath(); ctx.arc(0, 0, ship.r + 10, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(94,242,255,${.5 + .4 * Math.sin(performance.now() / 120)})`; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(0, -ship.r - 4); ctx.lineTo(ship.r, ship.r); ctx.lineTo(0, ship.r * .4); ctx.lineTo(-ship.r, ship.r); ctx.closePath();
      const g = ctx.createLinearGradient(0, -ship.r, 0, ship.r); g.addColorStop(0, '#eaf6ff'); g.addColorStop(1, '#5ef2ff');
      ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -2, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#ff5ec4'; ctx.fill();
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.save();
      if (shake > .4) ctx.translate(rand(-shake, shake), rand(-shake, shake));
      for (const s of stars) { ctx.globalAlpha = .3 + s.z * .6; ctx.fillStyle = '#cdd9ff'; ctx.fillRect(s.x, s.y, s.s, s.s); }
      ctx.globalAlpha = 1;
      if (state !== 'menu') {
        for (const o of orbs) {
          const r = o.r + Math.sin(o.pulse) * 2;
          const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 2.4);
          g.addColorStop(0, 'rgba(94,242,255,.9)'); g.addColorStop(1, 'rgba(94,242,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#dffaff'; ctx.beginPath(); ctx.arc(o.x, o.y, r * .55, 0, Math.PI * 2); ctx.fill();
        }
        for (const p of powerups) {
          const r = p.r + Math.sin(p.pulse) * 3;
          ctx.save(); ctx.globalAlpha = p.life < 2000 ? .4 + .6 * Math.abs(Math.sin(p.pulse * 3)) : 1;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.8);
          g.addColorStop(0, pColor(p.type)); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.font = (r * 1.4) + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(pIcon(p.type), p.x, p.y + 1); ctx.restore();
        }
        for (const o of asteroids) {
          ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot); ctx.beginPath();
          for (let i = 0; i < o.verts.length; i++) {
            const a = (i / o.verts.length) * Math.PI * 2, rr = o.r * o.verts[i];
            const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fillStyle = `hsl(${o.hue},30%,24%)`; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = `hsl(${o.hue},70%,60%)`; ctx.stroke(); ctx.restore();
        }
        if (state === 'over' || !(invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0)) drawShip();
      }
      for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.restore();

      if (state === 'playing') {
        let bx = 20, by = view.h - 24;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '15px "Trebuchet MS",sans-serif';
        const bar = (label, t, max, color) => {
          if (t <= 0) return;
          ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(bx, by - 7, 90, 8);
          ctx.fillStyle = color; ctx.fillRect(bx, by - 7, 90 * clamp(t / max, 0, 1), 8);
          ctx.fillStyle = '#fff'; ctx.fillText(label, bx + 100, by); by -= 26;
        };
        bar('🛡️ Shield', shieldTime, 6000, '#5ef2ff');
        bar('✨ Double', doubleTime, 8000, '#ffd45e');
        if (slowActive()) bar('🐢 Slow', slowUntil - performance.now(), 4500, '#9cff5e');
      }
    }

    api.loop(dt => {
      if (state === 'playing') update(dt);
      else for (const s of stars) { s.y += s.z * .3; if (s.y > view.h) { s.y = 0; s.x = Math.random() * view.w; } }
      draw();
    });
  },
});

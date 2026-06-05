/* Reaction Rush — tap targets as fast as you can before time runs out. */
(() => {
let activeTimer = null;
Arcade.register({
  id: 'reaction',
  name: 'Reaction Rush',
  emoji: '🎯',
  desc: 'A 30-second target-tapping frenzy. Hit them fast for combos; misses cost you points.',
  color: '#9cff5e',

  start(root, api) {
    const view = api.makeCanvas(root);
    const ctx = view.ctx;
    const perf = api.perf;
    const rand = (a, b) => a + Math.random() * (b - a);

    let state, score, combo, bestCombo, timeLeft, roundStart, target, targetAge, spawnDelay, sinceSpawn, reactSum, reactN, particles = [], floaters = [];
    let syncStamp = 0;

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="rx-score">0</b></span>
      <span id="rx-combo">×1</span><span class="b">TIME <b id="rx-time">30.0</b></span>`;
    root.appendChild(hud);

    function reset() {
      score = 0; combo = 0; bestCombo = 0; timeLeft = 30; roundStart = 0; target = null; particles = []; floaters = [];
      spawnDelay = 850; sinceSpawn = 0; reactSum = 0; reactN = 0;
    }
    function sync(force = false) {
      const now = performance.now();
      if (!force && now - syncStamp < 80) return;
      syncStamp = now;
      document.getElementById('rx-score').textContent = score;
      document.getElementById('rx-combo').textContent = '×' + (1 + Math.floor(combo / 3));
      document.getElementById('rx-time').textContent = Math.max(0, timeLeft).toFixed(1);
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Reaction Rush</h2>
        <p class="msg">Tap or click each target the instant it appears. Consecutive hits build a multiplier;
        misses break the combo and cost points. How high can you score in 30 seconds?</p>
        <button class="btn alt" data-act="play">PLAY ▸</button>`;
      ov.querySelector('.msg').textContent = 'Tap each target the instant it appears. Consecutive hits build a multiplier; gold targets pay extra, moving targets test tracking, and misses break the combo.';
    }
    function play() {
      reset(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; sync(true);
      spawnTarget();
      roundStart = performance.now();
      if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
    }
    function end() {
      if (state === 'over') return;
      state = 'over'; hud.style.display = 'none'; if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
      const isBest = api.setBest('reaction', score);
      const avg = reactN ? Math.round(reactSum / reactN) : 0;
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Time!</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
          <div class="stat"><span class="v">${avg}ms</span><span class="l">Avg Reaction</span></div>
          <div class="stat"><span class="v">${api.getBest('reaction')}</span><span class="l">Best</span></div>
        </div>
        ${isBest ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
        <button class="btn alt" data-act="play">PLAY AGAIN ↻</button>`;
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    function spawnTarget() {
      const r = rand(28, 46);
      const roll = Math.random();
      const type = reactN > 7 && roll < .22 ? 'moving' : roll > .82 ? 'bonus' : 'normal';
      target = { x: rand(r + 10, view.w - r - 10), y: rand(r + 60, view.h - r - 10), r: type === 'bonus' ? r * .82 : r,
        born: performance.now(), hue: type === 'bonus' ? 45 : type === 'moving' ? 195 : rand(80, 180), type,
        vx: type === 'moving' ? rand(-1.4, 1.4) : 0, vy: type === 'moving' ? rand(-1.0, 1.0) : 0 };
      targetAge = 0; sinceSpawn = 0;
    }
    function popText(x, y, text, color) {
      floaters.push({ x, y, text, color, life: 650, max: 650, vy: -0.7 });
    }
    function burst(x, y, color, n) {
      const count = perf.particleCount(n);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, s = rand(1, 5);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(260, 560), max: 560, color, r: rand(2, 5) });
      }
      const limit = perf.particleLimit(180);
      if (particles.length > limit) particles.splice(0, particles.length - limit);
    }

    function hit(x, y) {
      if (state !== 'playing' || !target) return;
      if (Math.hypot(x - target.x, y - target.y) <= target.r) {
        const rt = performance.now() - target.born;
        reactSum += rt; reactN++;
        combo++; bestCombo = Math.max(bestCombo, combo);
        const mult = 1 + Math.floor(combo / 3);
        const speedBonus = Math.max(0, 30 - Math.floor(rt / 30));
        const targetBonus = target.type === 'bonus' ? 45 : target.type === 'moving' ? 18 : 0;
        const gained = (10 + speedBonus + targetBonus) * mult;
        score += gained;
        popText(target.x, target.y - target.r, '+' + gained, target.type === 'bonus' ? '#ffd45e' : '#ffffff');
        burst(target.x, target.y, target.type === 'bonus' ? '#ffd45e' : '#9cff5e', target.type === 'bonus' ? 24 : 16);
        spawnDelay = Math.max(420, spawnDelay - 12);
        target = null; sinceSpawn = 0; sync(true);
      } else {
        combo = 0; score = Math.max(0, score - 5); popText(x, y, '-5', '#ff5ec4'); sync(true);
      }
    }
    api.on(view.canvas, 'mousedown', e => hit(e.clientX, e.clientY));
    api.on(view.canvas, 'touchstart', e => { e.preventDefault(); const t = e.touches[0]; hit(t.clientX, t.clientY); }, { passive: false });

    api.loop((dt, now) => {
      const frame = Math.min(2.4, dt / 16.7);
      ctx.clearRect(0, 0, view.w, view.h);
      if (state === 'playing') {
        timeLeft = 30 - (now - roundStart) / 1000;
        if (timeLeft <= 0) {
          timeLeft = 0;
          sync(true);
          end();
        }
        sinceSpawn += dt;
        if (!target && sinceSpawn >= spawnDelay) spawnTarget();
        if (target) {
          targetAge += dt;
          if (target.type === 'moving') {
            target.x += target.vx * frame; target.y += target.vy * frame;
            if (target.x < target.r + 8 || target.x > view.w - target.r - 8) target.vx *= -1;
            if (target.y < target.r + 60 || target.y > view.h - target.r - 8) target.vy *= -1;
          }
          // targets time out after ~1.4s -> miss
          if (targetAge > (target.type === 'bonus' ? 1050 : 1400)) {
            popText(target.x, target.y, 'MISS', '#ff5ec4');
            combo = 0; target = null; sinceSpawn = 0; sync(true);
          }
        }
        sync();
      }
      if (target) {
        const t = target, age = performance.now() - t.born;
        const grow = Math.min(1, age / 140);
        const r = t.r * grow;
        const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, r);
        g.addColorStop(0, `hsl(${t.hue},90%,75%)`);
        g.addColorStop(.7, `hsl(${t.hue},80%,52%)`);
        g.addColorStop(1, `hsl(${t.hue},80%,40%)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, r * .55, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(t.x, t.y, r * .2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        if (t.type === 'bonus') {
          ctx.fillStyle = '#05060f'; ctx.font = '900 15px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', t.x, t.y + 1);
        } else if (t.type === 'moving') {
          ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(t.x - r * .4, t.y); ctx.lineTo(t.x + r * .4, t.y); ctx.moveTo(t.x, t.y - r * .4); ctx.lineTo(t.x, t.y + r * .4); ctx.stroke();
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.x += p.vx * frame; p.y += p.vy * frame; p.vx *= Math.pow(.94, frame); p.vy *= Math.pow(.94, frame); p.life -= dt;
        ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        if (p.life <= 0) particles.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      ctx.font = '900 18px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.y += f.vy * frame; f.life -= dt;
        ctx.globalAlpha = Math.max(0, f.life / f.max); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        if (f.life <= 0) floaters.splice(i, 1);
      }
      ctx.globalAlpha = 1;
    });
    showMenu();
  },

  stop() { if (activeTimer) { clearInterval(activeTimer); activeTimer = null; } },
});
})();

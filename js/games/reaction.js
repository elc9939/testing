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
    const rand = (a, b) => a + Math.random() * (b - a);

    let state, score, combo, bestCombo, timeLeft, target, targetAge, spawnDelay, sinceSpawn, reactSum, reactN;

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="rx-score">0</b></span>
      <span id="rx-combo">×1</span><span class="b">TIME <b id="rx-time">30.0</b></span>`;
    root.appendChild(hud);

    function reset() {
      score = 0; combo = 0; bestCombo = 0; timeLeft = 30; target = null;
      spawnDelay = 850; sinceSpawn = 0; reactSum = 0; reactN = 0;
    }
    function sync() {
      document.getElementById('rx-score').textContent = score;
      document.getElementById('rx-combo').textContent = '×' + (1 + Math.floor(combo / 3));
      document.getElementById('rx-time').textContent = Math.max(0, timeLeft).toFixed(1);
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; if (activeTimer) clearInterval(activeTimer);
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Reaction Rush</h2>
        <p class="msg">Tap or click each target the instant it appears. Consecutive hits build a multiplier;
        misses break the combo and cost points. How high can you score in 30 seconds?</p>
        <button class="btn alt" data-act="play">PLAY ▸</button>`;
    }
    function play() {
      reset(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; sync();
      spawnTarget();
      const t0 = performance.now();
      if (activeTimer) clearInterval(activeTimer);
      activeTimer = setInterval(() => {
        if (state !== 'playing') return;
        timeLeft = 30 - (performance.now() - t0) / 1000;
        if (timeLeft <= 0) { timeLeft = 0; end(); }
        sync();
      }, 80);
    }
    function end() {
      state = 'over'; hud.style.display = 'none'; if (activeTimer) clearInterval(activeTimer);
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
      target = { x: rand(r + 10, view.w - r - 10), y: rand(r + 60, view.h - r - 10), r, born: performance.now(), hue: rand(80, 180) };
      targetAge = 0; sinceSpawn = 0;
    }

    function hit(x, y) {
      if (state !== 'playing' || !target) return;
      if (Math.hypot(x - target.x, y - target.y) <= target.r) {
        const rt = performance.now() - target.born;
        reactSum += rt; reactN++;
        combo++; bestCombo = Math.max(bestCombo, combo);
        const mult = 1 + Math.floor(combo / 3);
        const speedBonus = Math.max(0, 30 - Math.floor(rt / 30));
        score += (10 + speedBonus) * mult;
        spawnDelay = Math.max(420, spawnDelay - 12);
        target = null; sinceSpawn = 0; sync();
      } else {
        combo = 0; score = Math.max(0, score - 5); sync();
      }
    }
    api.on(view.canvas, 'mousedown', e => hit(e.clientX, e.clientY));
    api.on(view.canvas, 'touchstart', e => { e.preventDefault(); const t = e.touches[0]; hit(t.clientX, t.clientY); }, { passive: false });

    api.loop(dt => {
      ctx.clearRect(0, 0, view.w, view.h);
      if (state === 'playing') {
        sinceSpawn += dt;
        if (!target && sinceSpawn >= spawnDelay) spawnTarget();
        if (target) {
          targetAge += dt;
          // targets time out after ~1.4s -> miss
          if (targetAge > 1400) { combo = 0; target = null; sinceSpawn = 0; sync(); }
        }
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
      }
    });
    showMenu();
  },

  stop() { if (activeTimer) { clearInterval(activeTimer); activeTimer = null; } },
});
})();

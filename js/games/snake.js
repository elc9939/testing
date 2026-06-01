/* Neon Snake — classic snake with smooth controls and wrap-free walls. */
Arcade.register({
  id: 'snake',
  name: 'Neon Snake',
  emoji: '🐍',
  desc: 'Eat the glowing fruit, grow longer, and don\'t bite your tail or the walls.',
  color: '#9cff5e',

  start(root, api) {
    const COLS = 24, ROWS = 24;
    let cell = 20, offX = 0, offY = 0;
    const view = api.makeCanvas(root, {
      onResize: v => {
        cell = Math.floor(Math.min(v.w, v.h) * 0.92 / COLS);
        offX = (v.w - cell * COLS) / 2;
        offY = (v.h - cell * ROWS) / 2;
      },
    });
    const ctx = view.ctx;

    let snake, dir, nextDir, food, score, state, stepMs, acc;

    const ov = document.createElement('div');
    ov.className = 'center-overlay';
    root.appendChild(ov);
    const hud = document.createElement('div');
    hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="sn-score">0</b></span><span class="b">BEST <b id="sn-best">0</b></span>`;
    root.appendChild(hud);

    function placeFood() {
      while (true) {
        const f = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
        if (!snake.some(s => s.x === f.x && s.y === f.y)) { food = f; return; }
      }
    }
    function reset() {
      snake = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }];
      dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
      score = 0; stepMs = 130; acc = 0; placeFood();
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none';
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Neon Snake</h2>
        <p class="msg">Steer with arrow keys, WASD, or swipe. Each fruit grows you and speeds things up.</p>
        <button class="btn" data-act="play">PLAY ▸</button>`;
    }
    function play() { reset(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; sync(); }
    function gameOver() {
      state = 'over'; hud.style.display = 'none';
      const best = api.setBest('snake', score);
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Game Over</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
          <div class="stat"><span class="v">${api.getBest('snake')}</span><span class="l">Best</span></div>
        </div>
        ${best ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
        <button class="btn alt" data-act="play">PLAY AGAIN ↻</button>`;
    }
    function sync() {
      document.getElementById('sn-score').textContent = score;
      document.getElementById('sn-best').textContent = api.getBest('snake');
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    function turn(x, y) {
      if (x === -dir.x && y === -dir.y) return; // no 180°
      nextDir = { x, y };
    }
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') { turn(0, -1); e.preventDefault(); }
      else if (k === 'arrowdown' || k === 's') { turn(0, 1); e.preventDefault(); }
      else if (k === 'arrowleft' || k === 'a') { turn(-1, 0); e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { turn(1, 0); e.preventDefault(); }
    });
    let tsx = 0, tsy = 0;
    api.on(view.canvas, 'touchstart', e => { tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; }, { passive: true });
    api.on(view.canvas, 'touchend', e => {
      const dx = e.changedTouches[0].clientX - tsx, dy = e.changedTouches[0].clientY - tsy;
      if (Math.abs(dx) + Math.abs(dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0); else turn(0, dy > 0 ? 1 : -1);
    }, { passive: true });

    function step() {
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || snake.some(s => s.x === head.x && s.y === head.y)) {
        gameOver(); return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 10; stepMs = Math.max(60, stepMs - 3); placeFood(); sync();
      } else snake.pop();
    }

    function draw() {
      ctx.clearRect(0, 0, view.w, view.h);
      // board
      ctx.fillStyle = 'rgba(255,255,255,.03)';
      ctx.fillRect(offX, offY, cell * COLS, cell * ROWS);
      ctx.strokeStyle = 'rgba(156,255,94,.25)'; ctx.lineWidth = 2;
      ctx.strokeRect(offX, offY, cell * COLS, cell * ROWS);
      // grid dots
      ctx.fillStyle = 'rgba(255,255,255,.04)';
      for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++)
        ctx.fillRect(offX + x * cell + cell / 2 - 1, offY + y * cell + cell / 2 - 1, 2, 2);

      if (food) {
        const fx = offX + food.x * cell + cell / 2, fy = offY + food.y * cell + cell / 2;
        const pulse = 1 + Math.sin(performance.now() / 200) * .12;
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, cell * 1.1);
        g.addColorStop(0, '#ff5ec4'); g.addColorStop(1, 'rgba(255,94,196,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, cell * 1.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(fx, fy, cell * .3 * pulse, 0, Math.PI * 2); ctx.fill();
      }
      if (snake) snake.forEach((s, i) => {
        const t = 1 - i / snake.length;
        ctx.fillStyle = i === 0 ? '#eaffd9' : `hsl(${95 + t * 30}, 90%, ${45 + t * 18}%)`;
        const pad = 2, x = offX + s.x * cell + pad, y = offY + s.y * cell + pad, sz = cell - pad * 2;
        const r = sz * .3;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, sz, sz, r) : ctx.rect(x, y, sz, sz);
        ctx.fill();
      });
    }

    api.loop(dt => {
      if (state === 'playing') { acc += dt; while (acc >= stepMs) { acc -= stepMs; step(); } }
      draw();
    });
    showMenu();
  },
});

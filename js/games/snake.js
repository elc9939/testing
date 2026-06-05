/* Neon Snake — classic snake with smooth controls and wrap-free walls. */
Arcade.register({
  id: 'snake',
  name: 'Neon Snake',
  emoji: '🐍',
  desc: 'Eat the glowing fruit, grow longer, and don\'t bite your tail or the walls.',
  color: '#9cff5e',

  start(root, api) {
    const COLS = 24, ROWS = 24;
    const MAX_TURN_QUEUE = 4, MAX_STEPS_PER_FRAME = 3;
    let cell = 20, offX = 0, offY = 0;
    const view = api.makeCanvas(root, {
      onResize: v => {
        cell = Math.floor(Math.min(v.w, v.h) * 0.92 / COLS);
        offX = (v.w - cell * COLS) / 2;
        offY = (v.h - cell * ROWS) / 2;
      },
    });
    const ctx = view.ctx;

    let snake = null, dir, nextDir, turnQueue = [], food = null, bonus = null, obstacles = [], particles = [], score = 0, state, stepMs = 130, acc = 0, eaten = 0, paused = false;

    const ov = document.createElement('div');
    ov.className = 'center-overlay';
    root.appendChild(ov);
    const hud = document.createElement('div');
    hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="sn-score">0</b></span><span>LEN <b id="sn-len">3</b></span><span class="b">BEST <b id="sn-best">0</b></span>`;
    root.appendChild(hud);

    function occupied(x, y) {
      return snake.some(s => s.x === x && s.y === y) || obstacles.some(o => o.x === x && o.y === y) || (bonus && bonus.x === x && bonus.y === y);
    }
    function placeFood() {
      while (true) {
        const f = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
        if (!occupied(f.x, f.y)) { food = f; return; }
      }
    }
    function placeBonus() {
      if (bonus || eaten < 4 || Math.random() > .34) return;
      for (let tries = 0; tries < 80; tries++) {
        const b = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0, life: 6200, pulse: 0 };
        if (!occupied(b.x, b.y)) { bonus = b; return; }
      }
    }
    function addObstacle() {
      if (obstacles.length >= 18) return;
      for (let tries = 0; tries < 100; tries++) {
        const o = { x: 2 + ((Math.random() * (COLS - 4)) | 0), y: 2 + ((Math.random() * (ROWS - 4)) | 0) };
        if (Math.abs(o.x - snake[0].x) + Math.abs(o.y - snake[0].y) > 7 && !occupied(o.x, o.y)) { obstacles.push(o); return; }
      }
    }
    function reset() {
      snake = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }];
      dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
      turnQueue = []; obstacles = []; particles = []; bonus = null;
      score = 0; eaten = 0; paused = false; stepMs = 130; acc = 0; placeFood();
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none';
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Neon Snake</h2>
        <p class="msg">Steer with arrows, WASD, or swipe. Fruit grows you, bonus fruit expires fast,
        and obstacle blocks appear as your score climbs. Press P to pause.</p>
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
      document.getElementById('sn-len').textContent = snake ? snake.length : 3;
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    function turn(x, y) {
      if (turnQueue.length) {
        const lastQueued = turnQueue[turnQueue.length - 1];
        if (x === -lastQueued.x && y === -lastQueued.y) return;
        if (lastQueued.x === x && lastQueued.y === y) return;
        if (turnQueue.length < MAX_TURN_QUEUE) turnQueue.push({ x, y });
        return;
      }
      if (x === -dir.x && y === -dir.y) return; // no 180°
      const last = turnQueue.length ? turnQueue[turnQueue.length - 1] : nextDir;
      if (x === -last.x && y === -last.y) return;
      if (last.x === x && last.y === y) return;
      if (turnQueue.length < MAX_TURN_QUEUE) turnQueue.push({ x, y });
    }
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') { turn(0, -1); e.preventDefault(); }
      else if (k === 'arrowdown' || k === 's') { turn(0, 1); e.preventDefault(); }
      else if (k === 'arrowleft' || k === 'a') { turn(-1, 0); e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { turn(1, 0); e.preventDefault(); }
      else if (k === 'p') { if (state === 'playing') paused = !paused; }
      else if (k === 'r' && state === 'playing') play();
    });
    let tsx = 0, tsy = 0;
    api.on(view.canvas, 'touchstart', e => { tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; }, { passive: true });
    api.on(view.canvas, 'touchend', e => {
      const dx = e.changedTouches[0].clientX - tsx, dy = e.changedTouches[0].clientY - tsy;
      if (Math.abs(dx) + Math.abs(dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0); else turn(0, dy > 0 ? 1 : -1);
    }, { passive: true });

    function step() {
      if (paused) return;
      if (turnQueue.length) nextDir = turnQueue.shift();
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      const eatsFood = head.x === food.x && head.y === food.y;
      const eatsBonus = bonus && head.x === bonus.x && head.y === bonus.y;
      const body = eatsFood || eatsBonus ? snake : snake.slice(0, -1);
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS ||
          body.some(s => s.x === head.x && s.y === head.y) ||
          obstacles.some(o => o.x === head.x && o.y === head.y)) {
        gameOver(); return;
      }
      snake.unshift(head);
      if (eatsFood) {
        score += 10; eaten++; stepMs = Math.max(54, stepMs - 2.5);
        if (eaten >= 6 && eaten % 4 === 0) addObstacle();
        placeFood(); placeBonus(); sync();
      } else if (eatsBonus) {
        const left = bonus.life / 6200;
        score += 25 + Math.floor(left * 35);
        bonus = null; stepMs = Math.max(50, stepMs - 1.5); sync();
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
      if (bonus) {
        const bx = offX + bonus.x * cell + cell / 2, by = offY + bonus.y * cell + cell / 2;
        const life = Math.max(0, bonus.life / 6200);
        const pulse = 1 + Math.sin(performance.now() / 105) * .16;
        ctx.strokeStyle = `rgba(255,212,94,${0.35 + life * 0.45})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(bx, by, cell * .42 * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * life); ctx.stroke();
        ctx.fillStyle = '#ffd45e'; ctx.beginPath(); ctx.arc(bx, by, cell * .24 * pulse, 0, Math.PI * 2); ctx.fill();
      }
      for (const o of obstacles) {
        const x = offX + o.x * cell + 3, y = offY + o.y * cell + 3, sz = cell - 6;
        ctx.fillStyle = 'rgba(255,94,196,.24)';
        ctx.fillRect(x, y, sz, sz);
        ctx.strokeStyle = 'rgba(255,94,196,.65)'; ctx.lineWidth = 2; ctx.strokeRect(x + .5, y + .5, sz - 1, sz - 1);
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
      if (paused && state === 'playing') {
        ctx.fillStyle = 'rgba(5,6,15,.55)'; ctx.fillRect(0, 0, view.w, view.h);
        ctx.fillStyle = '#eaf2ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '900 36px "Trebuchet MS",sans-serif'; ctx.fillText('PAUSED', view.w / 2, view.h / 2);
        ctx.font = '700 15px "Trebuchet MS",sans-serif'; ctx.fillText('Press P to resume', view.w / 2, view.h / 2 + 34);
      }
    }

    api.loop(dt => {
      if (state === 'playing') {
        if (bonus && !paused) { bonus.life -= dt; bonus.pulse += dt * .006; if (bonus.life <= 0) bonus = null; }
        acc += paused ? 0 : dt;
        let steps = 0;
        while (acc >= stepMs && steps < MAX_STEPS_PER_FRAME && state === 'playing') {
          acc -= stepMs;
          step();
          steps++;
        }
        if (steps >= MAX_STEPS_PER_FRAME) acc = Math.min(acc, stepMs * 0.35);
      }
      draw();
    });
    showMenu();
  },
});

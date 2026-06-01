/* Brick Blaster — paddle + ball brick breaker with multi-row levels. */
Arcade.register({
  id: 'breakout',
  name: 'Brick Blaster',
  emoji: '🧱',
  desc: 'Bounce the ball, smash every brick, and clear wave after wave without dropping it.',
  color: '#ffd45e',

  start(root, api) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    let paddle, ball, bricks = [], score, lives, level, state, W = 800, H = 600, paddleW;
    const COLS = 9, ROWS = 5, GAP = 6;
    let brickW, brickH, topPad;

    const view = api.makeCanvas(root, { onResize: v => layout(v) });
    const ctx = view.ctx;

    const ov = document.createElement('div');
    ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">SCORE <b id="bk-score">0</b></span>
      <span id="bk-lives">●●●</span><span class="b">LVL <b id="bk-lvl">1</b></span>`;
    root.appendChild(hud);

    function layout(v) {
      W = v.w; H = v.h;
      paddleW = clamp(W * 0.18, 80, 180);
      brickW = (Math.min(W, 720) - GAP * (COLS + 1)) / COLS;
      brickH = 24;
      topPad = Math.max(70, H * 0.12);
      if (paddle) paddle.y = H - 40;
    }
    layout(view);

    function buildBricks() {
      bricks = [];
      const totalW = COLS * brickW + (COLS - 1) * GAP;
      const startX = (W - totalW) / 2;
      const rows = Math.min(ROWS + Math.floor(level / 2), 8);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < COLS; c++)
          bricks.push({
            x: startX + c * (brickW + GAP), y: topPad + r * (brickH + GAP),
            w: brickW, h: brickH, hue: 200 + r * 26, hits: r < 1 && level > 2 ? 2 : 1,
          });
    }
    function resetBall() {
      paddle = { x: W / 2, y: H - 40 };
      const spd = 6 + level * 0.4;
      const ang = (-Math.PI / 2) + (Math.random() - .5) * 0.6;
      ball = { x: W / 2, y: H - 60, r: 9, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, stuck: true };
    }
    function reset() { score = 0; lives = 3; level = 1; buildBricks(); resetBall(); sync(); }
    function sync() {
      document.getElementById('bk-score').textContent = score;
      document.getElementById('bk-lvl').textContent = level;
      document.getElementById('bk-lives').textContent = '●'.repeat(Math.max(0, lives)) + '○'.repeat(Math.max(0, 3 - lives));
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Brick Blaster</h2>
        <p class="msg">Move the paddle with mouse, touch, or ←/→. Click or press Space to launch.
        Clear all bricks to advance.</p>
        <button class="btn" data-act="play">PLAY ▸</button>`;
    }
    function play() { reset(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; }
    function gameOver(win) {
      state = 'over'; hud.style.display = 'none';
      const best = api.setBest('breakout', score);
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>${win ? 'You Cleared Out!' : 'Game Over'}</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
          <div class="stat"><span class="v">${level}</span><span class="l">Level</span></div>
          <div class="stat"><span class="v">${api.getBest('breakout')}</span><span class="l">Best</span></div>
        </div>
        ${best ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
        <button class="btn" data-act="play">PLAY AGAIN ↻</button>`;
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    const movePaddle = x => { if (paddle) paddle.x = clamp(x, paddleW / 2, W - paddleW / 2); };
    api.on(view.canvas, 'mousemove', e => movePaddle(e.clientX));
    api.on(view.canvas, 'touchmove', e => { e.preventDefault(); movePaddle(e.touches[0].clientX); }, { passive: false });
    api.on(view.canvas, 'mousedown', () => { if (ball) ball.stuck = false; });
    api.on(view.canvas, 'touchstart', e => { e.preventDefault(); if (ball) ball.stuck = false; }, { passive: false });
    const keys = {};
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase(); keys[k] = true;
      if (k === ' ') { if (ball) ball.stuck = false; e.preventDefault(); }
    });
    api.on(window, 'keyup', e => { keys[e.key.toLowerCase()] = false; });

    function update() {
      if (keys['arrowleft'] || keys['a']) movePaddle(paddle.x - 11);
      if (keys['arrowright'] || keys['d']) movePaddle(paddle.x + 11);
      if (ball.stuck) { ball.x = paddle.x; ball.y = paddle.y - 18; return; }

      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx *= -1; }
      if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx *= -1; }
      if (ball.y < ball.r) { ball.y = ball.r; ball.vy *= -1; }

      // paddle
      if (ball.vy > 0 && ball.y + ball.r >= paddle.y - 8 && ball.y < paddle.y + 8 &&
          Math.abs(ball.x - paddle.x) < paddleW / 2 + ball.r) {
        const hit = (ball.x - paddle.x) / (paddleW / 2); // -1..1
        const spd = Math.hypot(ball.vx, ball.vy);
        const ang = -Math.PI / 2 + hit * (Math.PI / 3);
        ball.vx = Math.cos(ang) * spd; ball.vy = Math.sin(ang) * spd;
        ball.y = paddle.y - 18;
      }
      // bricks
      for (let i = bricks.length - 1; i >= 0; i--) {
        const b = bricks[i];
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w &&
            ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
          const overL = ball.x + ball.r - b.x, overR = b.x + b.w - (ball.x - ball.r);
          const overT = ball.y + ball.r - b.y, overB = b.y + b.h - (ball.y - ball.r);
          const min = Math.min(overL, overR, overT, overB);
          if (min === overL || min === overR) ball.vx *= -1; else ball.vy *= -1;
          b.hits--;
          if (b.hits <= 0) { bricks.splice(i, 1); score += 10; } else score += 5;
          sync();
          break;
        }
      }
      // fell off
      if (ball.y > H + 30) {
        lives--; sync();
        if (lives <= 0) { gameOver(false); return; }
        resetBall();
      }
      // level clear
      if (bricks.length === 0) {
        level++; if (level > 9) { gameOver(true); return; }
        buildBricks(); resetBall(); sync();
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      if (state !== 'menu') {
        for (const b of bricks) {
          const light = b.hits > 1 ? 62 : 50;
          ctx.fillStyle = `hsl(${b.hue},70%,${light}%)`;
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(b.x, b.y, b.w, 4);
        }
        if (paddle) {
          const g = ctx.createLinearGradient(0, paddle.y - 6, 0, paddle.y + 6);
          g.addColorStop(0, '#fff'); g.addColorStop(1, '#ffd45e');
          ctx.fillStyle = g;
          ctx.beginPath();
          const px = paddle.x - paddleW / 2;
          ctx.roundRect ? ctx.roundRect(px, paddle.y - 7, paddleW, 14, 7) : ctx.rect(px, paddle.y - 7, paddleW, 14);
          ctx.fill();
        }
        if (ball) {
          const g = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r * 2);
          g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(94,242,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#eaf6ff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    api.loop(() => { if (state === 'playing') update(); draw(); });
    showMenu();
  },
});

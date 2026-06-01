/* Stick Leap — a reach-the-flag platformer with a procedural, IK-driven
   stick figure in a classic "stickman games" style: a bold solid-black
   figure on a light background. No sprites — every limb is solved each frame,
   giving a live run cycle, jump anticipation, landing squash-and-stretch and
   idle breathing. Controls: ←/→ or A/D to run, Space/↑/W to jump (hold for
   height), plus on-screen touch buttons. Single jump with coyote + buffer. */
(() => {
const PUBLIC = {
  id: 'stickrun',
  name: 'Stick Leap',
  emoji: '🏃',
  desc: 'Run, leap across the gaps, grab coins and reach the flag. A hand-animated stick hero.',
  color: '#ff9f6e',
};

// ---------- tuning ----------
const STEP = 1000 / 60;          // fixed physics timestep (ms)
const GRA = 0.62, MAXV = 3.7, RUN_ACC = 0.7, AIR_ACC = 0.45;
const FRICTION = 0.80, JUMP = -12.4, TERMINAL = 15;
const COYOTE = 7, BUFFER = 7, CUT = 0.42;
const PW = 20, PH = 58;          // player collision box (w, h); y = feet (bottom)

// ---------- levels (world coords, y down) ----------
const G = 470;
function lvl(data) {
  // derive width/height from contents
  let w = 0, h = 0;
  for (const p of data.platforms) { w = Math.max(w, p.x + p.w); h = Math.max(h, p.y + p.h); }
  w = Math.max(w, data.flag.x + 80);
  return Object.assign({ w, h: Math.max(h, G + 120) }, data);
}
const LEVELS = [
  lvl({
    spawn: { x: 90, y: G },
    platforms: [
      { x: 0, y: G, w: 540, h: 160 },
      { x: 640, y: G, w: 360, h: 160 },
      { x: 1090, y: G - 70, w: 210, h: 230 },
      { x: 1400, y: G, w: 560, h: 160 },
    ],
    coins: [[300, G - 60], [420, G - 60], [690, G - 120], [860, G - 60],
            [1180, G - 130], [1520, G - 60], [1640, G - 120]],
    flag: { x: 1860, y: G },
  }),
  lvl({
    spawn: { x: 80, y: G },
    platforms: [
      { x: 0, y: G, w: 360, h: 160 },
      { x: 470, y: G - 60, w: 150, h: 220 },
      { x: 720, y: G - 130, w: 150, h: 290 },
      { x: 980, y: G - 60, w: 170, h: 220 },
      { x: 1250, y: G, w: 300, h: 160 },
      { x: 1650, y: G - 80, w: 160, h: 240 },
      { x: 1900, y: G, w: 460, h: 160 },
    ],
    coins: [[250, G - 60], [540, G - 120], [795, G - 190], [1060, G - 120],
            [1380, G - 60], [1500, G - 130], [1720, G - 140], [2050, G - 60], [2180, G - 60]],
    flag: { x: 2270, y: G },
  }),
  lvl({
    spawn: { x: 80, y: G },
    platforms: [
      { x: 0, y: G, w: 300, h: 160 },
      { x: 410, y: G - 40, w: 110, h: 200 },
      { x: 620, y: G - 90, w: 110, h: 250 },
      { x: 840, y: G - 150, w: 120, h: 310 },
      { x: 1080, y: G - 90, w: 110, h: 250 },
      { x: 1290, y: G - 30, w: 130, h: 190 },
      { x: 1520, y: G - 110, w: 120, h: 270 },
      { x: 1760, y: G - 60, w: 130, h: 220 },
      { x: 2010, y: G, w: 520, h: 160 },
    ],
    coins: [[455, G - 100], [675, G - 150], [900, G - 210], [1135, G - 150],
            [1355, G - 90], [1580, G - 170], [1820, G - 120],
            [2120, G - 60], [2260, G - 110], [2400, G - 60]],
    flag: { x: 2470, y: G },
  }),
];

PUBLIC.start = function (root, api) {
  const view = api.makeCanvas(root);
  const ctx = view.ctx;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- DOM: overlay, HUD, touch buttons ----------
  const ov = document.createElement('div');
  ov.className = 'center-overlay';
  root.appendChild(ov);

  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.style.display = 'none';
  hud.style.color = '#1a1a1a';              // dark text for the light game background
  hud.style.textShadow = '0 1px 2px rgba(255,255,255,.6)';
  hud.innerHTML = `<span>LVL <b id="sr-lvl">1</b>/3</span>
    <span>🪙 <b id="sr-coins" style="color:#b8860b">0</b></span>
    <span>⏱ <b id="sr-time">0.0</b></span>`;
  root.appendChild(hud);

  const style = document.createElement('style');
  style.textContent = `
    .sr-touch{position:absolute;bottom:max(18px,env(safe-area-inset-bottom));z-index:30;display:flex;gap:14px;
      opacity:.55;touch-action:none}
    .sr-left{left:max(16px,env(safe-area-inset-left))}
    .sr-right{right:max(16px,env(safe-area-inset-right))}
    .sr-btn{width:68px;height:68px;border-radius:50%;border:2.5px solid rgba(22,22,22,.55);
      background:rgba(255,255,255,.45);color:#161616;font-size:28px;font-weight:900;display:flex;
      align-items:center;justify-content:center;user-select:none;-webkit-user-select:none}
    .sr-btn:active{background:rgba(22,22,22,.78);color:#fff}
    @media (hover:hover) and (pointer:fine){ .sr-touch{opacity:.32} }`;
  root.appendChild(style);

  function mkBtn(cls, label) {
    const b = document.createElement('div');
    b.className = 'sr-btn'; b.textContent = label;
    cls.appendChild(b);
    return b;
  }
  const padL = document.createElement('div'); padL.className = 'sr-touch sr-left';
  const padR = document.createElement('div'); padR.className = 'sr-touch sr-right';
  const btnLeft = mkBtn(padL, '◀'), btnRight = mkBtn(padL, '▶'), btnJump = mkBtn(padR, '⤒');
  root.appendChild(padL); root.appendChild(padR);
  padL.style.display = padR.style.display = 'none';

  // ---------- input ----------
  const input = { left: false, right: false, jumpHeld: false };
  let jumpBuf = 0;
  const press = (held) => { if (held) { jumpBuf = BUFFER; input.jumpHeld = true; } else input.jumpHeld = false; };

  api.on(window, 'keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = true;
    else if (k === 'arrowright' || k === 'd') input.right = true;
    else if (k === 'arrowup' || k === 'w' || k === ' ') { if (!e.repeat) press(true); e.preventDefault(); }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  });
  api.on(window, 'keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = false;
    else if (k === 'arrowright' || k === 'd') input.right = false;
    else if (k === 'arrowup' || k === 'w' || k === ' ') press(false);
  });
  function hold(btn, set) {
    const on = e => { e.preventDefault(); set(true); };
    const off = e => { e.preventDefault(); set(false); };
    api.on(btn, 'pointerdown', on); api.on(btn, 'pointerup', off);
    api.on(btn, 'pointerleave', off); api.on(btn, 'pointercancel', off);
  }
  hold(btnLeft, v => input.left = v);
  hold(btnRight, v => input.right = v);
  hold(btnJump, v => press(v));

  // ---------- game state ----------
  let state, li, player, cam, coinsLeft, totalCoins, runCoins, runTime, deaths, particles, flagWave;

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: 1,
      grounded: false, coyote: 0, jumpCut: false, airTime: 0,
      anim: { phase: 0, lean: 0, squash: 0 },
    };
  }
  function loadLevel(i, keepRun) {
    li = i;
    const L = LEVELS[i];
    player = makePlayer(L.spawn);
    coinsLeft = L.coins.map(c => ({ x: c[0], y: c[1], got: false }));
    totalCoins = coinsLeft.length;
    cam = { x: 0, y: 0 };
    particles = [];
    flagWave = 0;
    if (!keepRun) { runCoins = 0; runTime = 0; deaths = 0; }
    centerCam(true);
    syncHud();
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function syncHud() {
    document.getElementById('sr-lvl').textContent = li + 1;
    const got = totalCoins - coinsLeft.filter(c => !c.got).length;
    document.getElementById('sr-coins').textContent = got;
    document.getElementById('sr-time').textContent = (runTime / 1000).toFixed(1);
  }

  function showMenu() {
    state = 'menu';
    hud.style.display = 'none';
    padL.style.display = padR.style.display = 'none';
    ov.classList.remove('hidden');
    ov.innerHTML = `<h2>Stick Leap</h2>
      <p class="msg">Run with ←/→ or A/D, jump with Space / ↑ (hold longer to jump higher).
      On a phone, use the on-screen buttons. Grab coins and reach the 🚩 flag across 3 levels.</p>
      <button class="btn" data-act="play" style="background:#ff9f6e;box-shadow:0 0 22px rgba(255,159,110,.5)">PLAY ▸</button>`;
    loadLevel(0, false);
  }
  function play() {
    state = 'playing';
    ov.classList.add('hidden');
    hud.style.display = 'flex';
    padL.style.display = padR.style.display = 'flex';
    loadLevel(0, false);
  }
  function nextLevel() {
    if (li + 1 < LEVELS.length) {
      burst(player.x, player.y - PH / 2, '#ffd45e', 30, 6);
      loadLevel(li + 1, true);
    } else win();
  }
  function win() {
    state = 'win';
    hud.style.display = 'none';
    padL.style.display = padR.style.display = 'none';
    const timeBonus = Math.max(0, 6000 - Math.floor(runTime / 1000) * 25);
    const score = runCoins * 100 + timeBonus;
    const isBest = api.setBest('stickrun', score);
    ov.classList.remove('hidden');
    ov.innerHTML = `<h2>You reached the end! 🚩</h2>
      <div class="stat-row">
        <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
        <div class="stat"><span class="v">${runCoins}</span><span class="l">Coins</span></div>
        <div class="stat"><span class="v">${(runTime / 1000).toFixed(1)}s</span><span class="l">Time</span></div>
      </div>
      ${isBest ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
      <button class="btn" data-act="play" style="background:#ff9f6e;box-shadow:0 0 22px rgba(255,159,110,.5)">PLAY AGAIN ↻</button>`;
  }
  ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

  // ---------- particles ----------
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(.3, 1) * spd;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: rand(300, 650), max: 650, color, r: rand(1.5, 3.5) });
    }
  }
  function dust(x, y, dir) {
    for (let i = 0; i < 8; i++)
      particles.push({ x, y, vx: rand(-1, 1) - dir * .6, vy: rand(-1.6, -.2), life: rand(220, 420), max: 420, color: '#8f8b7d', r: rand(1.5, 3.5) });
  }

  // ---------- physics ----------
  function box() { return { x: player.x - PW / 2, y: player.y - PH, w: PW, h: PH }; }
  function hit(b, p) { return b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y; }

  function physics() {
    const L = LEVELS[li];
    const acc = player.grounded ? RUN_ACC : AIR_ACC;
    if (input.left && !input.right) { player.vx -= acc; player.facing = -1; }
    else if (input.right && !input.left) { player.vx += acc; player.facing = 1; }
    else if (player.grounded) player.vx *= FRICTION;
    player.vx = clamp(player.vx, -MAXV, MAXV);

    // jump (buffered + coyote)
    if (jumpBuf > 0 && (player.grounded || player.coyote > 0)) {
      player.vy = JUMP; player.grounded = false; player.coyote = 0; jumpBuf = 0; player.jumpCut = false;
      player.anim.squash = -0.5;            // stretch on takeoff
      dust(player.x, player.y, player.facing);
    }
    if (jumpBuf > 0) jumpBuf--;
    // variable height
    if (!input.jumpHeld && player.vy < 0 && !player.jumpCut) { player.vy *= CUT; player.jumpCut = true; }

    player.vy = Math.min(player.vy + GRA, TERMINAL);

    // integrate + collide (x then y)
    player.x += player.vx;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (player.vx > 0) player.x = p.x - PW / 2; else if (player.vx < 0) player.x = p.x + p.w + PW / 2;
      player.vx = 0;
    }
    const wasAir = !player.grounded;
    player.y += player.vy;
    let landed = false;
    player.grounded = false;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (player.vy > 0) { player.y = p.y; player.grounded = true; landed = true; }
      else if (player.vy < 0) player.y = p.y + p.h + PH;
      if (player.vy > 6) player.anim.squash = clamp(player.vy / TERMINAL, 0, 1) * 0.9; // squash on impact
      player.vy = 0;
    }
    if (player.grounded) { player.coyote = COYOTE; player.jumpCut = false; player.airTime = 0; }
    else { if (player.coyote > 0) player.coyote--; player.airTime++; }
    if (landed && wasAir && Math.abs(player.vx) >= 0) dust(player.x, player.y, 0);

    // coins
    for (const c of coinsLeft) if (!c.got && Math.hypot(c.x - player.x, c.y - (player.y - PH / 2)) < 22) {
      c.got = true; runCoins++; burst(c.x, c.y, '#ffd45e', 12, 3.5); syncHud();
    }
    // flag
    if (Math.abs(player.x - L.flag.x) < 26 && Math.abs((player.y) - L.flag.y) < 90) { nextLevel(); return; }

    // fell in a pit -> respawn
    if (player.y - PH > L.h + 120) { deaths++; respawn(); }
    syncHud();
  }
  function respawn() {
    const s = LEVELS[li].spawn;
    burst(player.x, Math.min(player.y, LEVELS[li].h), '#ff6b6b', 16, 4);
    player.x = s.x; player.y = s.y; player.vx = player.vy = 0; player.grounded = false;
  }

  function centerCam(snap) {
    const L = LEVELS[li];
    const tx = L.w <= view.w ? (L.w - view.w) / 2 : clamp(player.x - view.w / 2, 0, L.w - view.w);
    const ty = L.h <= view.h ? (L.h - view.h) / 2 : clamp((player.y - PH / 2) - view.h * 0.55, 0, L.h - view.h);
    if (snap) { cam.x = tx; cam.y = ty; } else { cam.x = lerp(cam.x, tx, 0.12); cam.y = lerp(cam.y, ty, 0.12); }
  }

  // ---------- animation params (real-time smoothing) ----------
  function animate(dt) {
    const a = player.anim, sp = Math.abs(player.vx), moveAmt = clamp(sp / MAXV, 0, 1);
    // run-cycle phase advances with ground speed (dt is in ms). Tuned so the
    // gait reads at ~1.5–2 strides/sec at top speed — not a blur.
    if (player.grounded) a.phase += (sp * 0.0030 + 0.0009) * dt;
    else a.phase += 0.0016 * dt;                       // slow flail in the air
    const leanTarget = clamp(player.vx * 0.035, -0.34, 0.34)
      + (player.grounded ? 0 : clamp(player.vy * 0.010, -0.12, 0.16));
    a.lean = lerp(a.lean, leanTarget, 1 - Math.pow(0.0015, dt / 1000));
    a.squash = lerp(a.squash, 0, 1 - Math.pow(0.004, dt / 1000)); // ease impact squash back
    return moveAmt;
  }

  // ---------- IK (two-bone) ----------
  function ik(ax, ay, bx, by, l1, l2, bend) {
    let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
    const min = Math.abs(l1 - l2) + 0.01, max = l1 + l2 - 0.01;
    if (d < min) d = min; if (d > max) d = max;
    if (d === 0) d = 0.01;
    const len = Math.hypot(dx, dy) || 1;
    const ex = ax + (dx / len) * d, ey = ay + (dy / len) * d;     // clamped end
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const baseX = ax + (ex - ax) * (a / d), baseY = ay + (ey - ay) * (a / d);
    const px = -(ey - ay) / d, py = (ex - ax) / d;
    return { jx: baseX + px * h * bend, jy: baseY + py * h * bend, ex, ey };
  }

  // ---------- draw the stick figure (classic stickman; origin at feet) ----------
  // Solid black, straight-segment limbs with round joints — no shading.
  const INK = '#161616';
  function seg(ax, ay, jx, jy, bx, by, w) {     // two-bone limb: hip→joint→foot
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.lineTo(bx, by); ctx.stroke();
  }
  function foot(x, y, f, ang) {
    ctx.lineCap = 'round'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * f * 9, y + Math.sin(ang) * 9);
    ctx.stroke();
  }

  function drawStick(moveAmt) {
    const a = player.anim, f = player.facing, p = a.phase, air = !player.grounded;
    const now = performance.now();
    // metrics — bigger, with long legs so knees stay comfortably bent
    const hipH = 34, torso = 32, neck = 3, headR = 12;
    const thigh = 24, shin = 22, uArm = 17, fArm = 16;
    const strideH = 17, lift = 16, armStride = 13, bounceAmp = 8, sway = 3, stanceW = 7;

    // bouncy vertical motion of the upper body; stance feet stay planted so the
    // legs compress/extend — that's the bounce. Gentle breathing when idle.
    const bob = bounceAmp * moveAmt * (0.5 - 0.5 * Math.cos(2 * p));
    const breathe = (1 - moveAmt) * Math.sin(now * 0.0027) * 1.6;

    ctx.save();
    ctx.translate(player.x, player.y);
    // squash & stretch: impact squash + a subtle run pulse synced to the bounce
    const runPulse = moveAmt * Math.cos(2 * p) * 0.05;
    const sy = (1 - a.squash * 0.45) * (1 + runPulse);
    const sx = (1 + a.squash * 0.42) * (1 - runPulse * 0.6);
    ctx.scale(sx, sy);

    const hipX = sway * moveAmt * Math.sin(p);
    const hipY = -hipH - bob + breathe;
    const upX = Math.sin(a.lean) * f, upY = -Math.cos(a.lean);
    const shX = hipX + upX * torso, shY = hipY + upY * torso;
    const headCX = shX + upX * (neck + headR), headCY = shY + upY * (neck + headR);

    ctx.strokeStyle = INK; ctx.fillStyle = INK;

    // foot target on the ground for a running gait (swing arc forward, drag back)
    function footPos(theta, legSign) {
      if (air) {
        const tuck = clamp(0.65 - player.vy * 0.045, 0, 1);       // tuck rising, reach falling
        return { x: legSign * 6 + f * 4, y: -tuck * 18 + Math.max(0, player.vy) * 0.5, ang: 0 };
      }
      let c = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const front = f * strideH, back = -f * strideH;
      let fx, fy, ang;
      if (c < Math.PI) {                                          // swing: arc foot forward
        const t = c / Math.PI, e = t * t * (3 - 2 * t);
        fx = back + (front - back) * e; fy = -lift * Math.sin(Math.PI * t); ang = -0.3 * (1 - t);
      } else {                                                    // stance: drag back, planted
        const t = (c - Math.PI) / Math.PI;
        fx = front + (back - front) * t; fy = 0; ang = 0;
      }
      return { x: fx * moveAmt + legSign * stanceW * (1 - moveAmt), y: fy * moveAmt, ang };
    }

    // arm hand target (pendulum swing opposite the legs; raises in the air)
    function handPos(theta) {
      if (air) {
        const raise = clamp(0.75 - player.vy * 0.05, -0.5, 1);
        return { x: shX + f * (6 + (1 - raise) * 12), y: shY - raise * 22 + (1 - raise) * 10 };
      }
      const sw = Math.sin(theta);
      return { x: shX + f * sw * armStride * moveAmt + f * 2,
               y: shY + (uArm + fArm) * 0.62 - Math.max(0, sw) * 6 * moveAmt };
    }

    // Knees bend FORWARD (in the facing direction): bend = -f.
    // Elbows trail BACKWARD: bend = +f.
    // ----- far limbs first (same solid black; just drawn behind) -----
    let h = handPos(p);                       // far arm
    let ka = ik(shX, shY, h.x, h.y, uArm, fArm, f);
    seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 6);

    let lt = footPos(p + Math.PI, +1);        // far leg (foot anchored to ground y≈0)
    let k = ik(hipX, hipY, hipX + lt.x, lt.y, thigh, shin, -f);
    seg(hipX, hipY, k.jx, k.jy, k.ex, k.ey, 7);
    foot(k.ex, k.ey, f, lt.ang);

    // ----- torso -----
    ctx.lineCap = 'round'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();

    // ----- near leg -----
    lt = footPos(p, -1);
    k = ik(hipX, hipY, hipX + lt.x, lt.y, thigh, shin, -f);
    seg(hipX, hipY, k.jx, k.jy, k.ex, k.ey, 8);
    foot(k.ex, k.ey, f, lt.ang);

    // ----- head (plain solid black) -----
    ctx.beginPath(); ctx.arc(headCX, headCY, headR, 0, Math.PI * 2); ctx.fill();

    // ----- near arm -----
    h = handPos(p + Math.PI);
    ka = ik(shX, shY, h.x, h.y, uArm, fArm, f);
    seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 7);

    ctx.restore();
  }

  // ---------- world rendering (light "stickman games" theme) ----------
  function drawBackground(L) {
    // clean whiteish paper background
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, '#fbfaf6'); g.addColorStop(1, '#e9e7dd');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);
    // one faint distant hill layer for a touch of depth
    drawHills(L, 0.3, '#dcd9cd', view.h * 0.74, 70);
  }
  function drawHills(L, par, color, baseY, amp) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, view.h);
    const off = cam.x * par;
    for (let x = 0; x <= view.w; x += 24) {
      const wx = x + off;
      const y = baseY - Math.sin(wx * 0.006) * amp - Math.sin(wx * 0.013 + 2) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(view.w, view.h); ctx.closePath(); ctx.fill();
  }
  function drawPlatform(p) {
    const x = p.x - cam.x, y = p.y - cam.y;
    ctx.fillStyle = '#cbc7b8'; ctx.fillRect(x, y, p.w, p.h);          // light body
    ctx.fillStyle = INK; ctx.fillRect(x, y, p.w, 5);                 // bold black ledge
  }
  function drawCoin(c) {
    if (c.got) return;
    const x = c.x - cam.x, y = c.y - cam.y;
    const spin = Math.cos(performance.now() * 0.005 + c.x);
    ctx.save(); ctx.translate(x, y); ctx.scale(Math.abs(spin) * 0.8 + 0.2, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
    g.addColorStop(0, '#ffe07a'); g.addColorStop(.7, '#f5b424'); g.addColorStop(1, '#c8901a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#8a5e10'; ctx.stroke();
    ctx.restore();
  }
  function drawFlag(L) {
    const x = L.flag.x - cam.x, y = L.flag.y - cam.y;
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 80); ctx.stroke();
    ctx.fillStyle = '#e23b4e'; ctx.beginPath();
    ctx.moveTo(x, y - 80);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, wob = Math.sin(flagWave + t * 6) * 5 * t;
      ctx.lineTo(x + 36 * t, y - 80 + 11 * t + wob);
    }
    for (let i = 8; i >= 0; i--) {
      const t = i / 8, wob = Math.sin(flagWave + t * 6) * 5 * t;
      ctx.lineTo(x + 36 * t, y - 62 + 11 * t + wob);
    }
    ctx.closePath(); ctx.fill();
  }

  function render(moveAmt) {
    const L = LEVELS[li];
    drawBackground(L);
    ctx.save();
    for (const p of L.platforms) drawPlatform(p);
    for (const c of coinsLeft) drawCoin(c);
    drawFlag(L);
    // particles
    for (const pt of particles) {
      ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x - cam.x, pt.y - cam.y, pt.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // figure (translate by camera)
    ctx.translate(-cam.x, -cam.y);
    drawStick(moveAmt);
    ctx.restore();
  }

  // ---------- main loop (fixed-step physics + smooth anim/render) ----------
  let acc = 0;
  api.loop(dt => {
    if (state === 'playing') {
      runTime += dt;
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 5) { physics(); acc -= STEP; if (state !== 'playing') break; }
      flagWave += dt * 0.006;
      centerCam(false);
    }
    const moveAmt = (player ? animate(dt) : 0);
    if (player) render(moveAmt);
  });

  showMenu();
};

Arcade.register(PUBLIC);
})();

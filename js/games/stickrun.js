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
const FLOAT_FUEL = 620;          // ms of lift a flyer (Mage) gets before needing to touch down
const PW = 20, PH = 58;          // player collision box (w, h); y = feet (bottom)

// ---------- RPG classes (data-driven so more can be added easily) ----------
// weapon: how the held weapon is drawn; moves: primary attacks cycled per click;
// reach: weapon reach multiplier; speedMul: run-speed multiplier; trail: RGB of
// the swing/cast trail; dur: per-move animation lengths (ms); ranged: casts bolts.
const CLASSES = [
  { id: 'knight', name: 'Knight', emoji: '🗡️', color: '#5ea0ff', blurb: 'Heavy, grounded blade.',
    weapon: 'sword', main: 'slash', alt: 'stab', reach: 1.0, speedMul: 1.0, trail: [120, 170, 255], dur: { slash: 360, stab: 300 },
    // heavy & lumbering: big slow bounce, deep landing squash
    style: { hipH: 44, stanceW: 8, strideH: 13, lift: 10, bounceAmp: 5.5, cadence: 0.78, armStride: 11, baseLean: 0.02, squash: 1.3,
      breatheAmp: 1.9, breatheSpd: 0.0019, hover: 0, idle: 'shift', spring: { lean: [70, 20], head: [62, 20], aim: [100, 21] } } },
  { id: 'rogue', name: 'Rogue', emoji: '🔪', color: '#9cff5e', blurb: 'Fast, twitchy daggers.',
    weapon: 'dagger', main: 'slash', alt: 'throw', reach: 0.78, speedMul: 1.3, trail: [150, 255, 110], dur: { slash: 230, throw: 240 }, dual: true,
    // athletic & quick: upright, long smooth strides, low bounce, only a slight lean
    style: { hipH: 46, stanceW: 4, strideH: 15, lift: 7, bounceAmp: 1.1, cadence: 1.1, armStride: 12, baseLean: 0.06, squash: 0.9,
      breatheAmp: 1.1, breatheSpd: 0.0034, hover: 0, idle: 'sneak', spring: { lean: [150, 9], head: [120, 9], aim: [170, 12] } } },
  { id: 'lancer', name: 'Lancer', emoji: '🔱', color: '#ffd45e', blurb: 'Disciplined spear reach.',
    weapon: 'spear', main: 'stab', alt: 'slash', reach: 1.0, speedMul: 0.95, trail: [255, 212, 94], dur: { stab: 340, slash: 420 },
    // tall & disciplined: erect posture, long deliberate strides, almost no bounce, steady arms
    style: { hipH: 47, stanceW: 10, strideH: 16, lift: 8, bounceAmp: 1.2, cadence: 0.92, armStride: 6, baseLean: 0.04, squash: 0.95,
      breatheAmp: 1.0, breatheSpd: 0.0016, hover: 0, idle: 'brace', spring: { lean: [110, 22], head: [95, 22], aim: [125, 24] } } },
  { id: 'mage', name: 'Mage', emoji: '🪄', color: '#ff77d2', blurb: 'Floaty staff caster.',
    weapon: 'staff', main: 'cast', alt: 'castSpread', reach: 0.95, speedMul: 0.9, trail: [255, 140, 220], dur: { cast: 210, castSpread: 300 }, ranged: true, gravityMul: 0.55, fly: true,
    // ethereal: glides with feet barely lifting and hovers even while moving
    style: { hipH: 49, stanceW: 4, strideH: 9, lift: 5, bounceAmp: 1.0, cadence: 0.75, armStride: 6, baseLean: -0.05, squash: 0.8,
      breatheAmp: 2.4, breatheSpd: 0.0016, hover: 6, idle: 'float', spring: { lean: [60, 10], head: [55, 11], aim: [90, 12] } } },
];

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
    boxes: [[330, G - 30], [770, G - 30], [1500, G - 30]],
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
    boxes: [[200, G - 30], [1380, G - 30], [2080, G - 30]],
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
    boxes: [[160, G - 30], [2120, G - 30], [2300, G - 30]],
    flag: { x: 2470, y: G },
  }),
];

PUBLIC.start = function (root, api) {
  const view = api.makeCanvas(root);
  const ctx = view.ctx;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // spring-damper smoothing for secondary motion (lag + overshoot = "life").
  // o[key] is the value, o[key+'V'] its velocity. k=stiffness, d=damping
  // (underdamped d < 2*sqrt(k) overshoots). dt in seconds.
  function springTo(o, key, target, k, d, dt) {
    const v = o[key + 'V'] || 0;
    const nv = v + ((target - o[key]) * k - v * d) * dt;
    o[key] += nv * dt; o[key + 'V'] = nv;
  }
  function springAngle(o, key, target, k, d, dt) {     // shortest-path angular spring
    const diff = Math.atan2(Math.sin(target - o[key]), Math.cos(target - o[key]));
    const v = o[key + 'V'] || 0;
    const nv = v + (diff * k - v * d) * dt;
    o[key] += nv * dt; o[key + 'V'] = nv;
  }

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
    @media (hover:hover) and (pointer:fine){ .sr-touch{opacity:.32} }
    .sr-classes{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:560px}
    .sr-class{cursor:pointer;width:124px;display:flex;flex-direction:column;align-items:center;gap:5px;
      padding:14px 10px;border-radius:14px;background:rgba(20,24,40,.7);border:2px solid var(--cc);
      color:#eaf2ff;transition:transform .12s,box-shadow .2s}
    .sr-class:hover{transform:translateY(-3px);box-shadow:0 0 20px var(--cc)}
    .sr-class:active{transform:translateY(-1px) scale(.98)}
    .sr-class b{font-size:17px;letter-spacing:.5px}
    .sr-class small{opacity:.72;font-size:11.5px;line-height:1.3}`;
  root.appendChild(style);

  function mkBtn(cls, label) {
    const b = document.createElement('div');
    b.className = 'sr-btn'; b.textContent = label;
    cls.appendChild(b);
    return b;
  }
  const padL = document.createElement('div'); padL.className = 'sr-touch sr-left';
  const padR = document.createElement('div'); padR.className = 'sr-touch sr-right';
  const btnLeft = mkBtn(padL, '◀'), btnRight = mkBtn(padL, '▶');
  const btnMain = mkBtn(padR, '⚔'), btnAlt = mkBtn(padR, '✦'), btnJump = mkBtn(padR, '⤒');
  root.appendChild(padL); root.appendChild(padR);
  padL.style.display = padR.style.display = 'none';

  // ---------- input ----------
  const input = { left: false, right: false, jumpHeld: false };
  const pointer = { x: 0, y: 0, active: false };   // cursor, sets the attack direction
  let jumpBuf = 0;
  const press = (held) => { if (held) { jumpBuf = BUFFER; input.jumpHeld = true; } else input.jumpHeld = false; };
  function triggerAttack(type) {
    if (!player || state !== 'playing' || !type) return false;
    const a = player.anim;
    if (a.atkActive) return false;           // one swing at a time
    // choose the attack direction from the cursor at the moment of the click
    const shX = player.x, shY = player.y - 77;
    const tx = pointer.active ? pointer.x + cam.x : shX + player.facing * 60;
    const ty = pointer.active ? pointer.y + cam.y : shY;
    a.atkAim = Math.atan2(ty - shY, tx - shX);
    if (pointer.active) player.facing = Math.cos(a.atkAim) >= 0 ? 1 : -1;   // turn to face it
    a.aimShown = a.atkAim; a.aimShownV = 0;  // seed the blade spring so it whips from the start
    a.atkActive = true; a.atkType = type; a.atkT = 0; a.struck = false;
    return true;
  }
  const mainAttack = () => triggerAttack(cls.main);
  const altAttack = () => triggerAttack(cls.alt);
  api.on(view.canvas, 'mousemove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; });
  api.on(view.canvas, 'mousedown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; e.preventDefault();
    if (e.button === 2) altAttack(); else mainAttack();
  });
  api.on(view.canvas, 'contextmenu', e => e.preventDefault());

  api.on(window, 'keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = true;
    else if (k === 'arrowright' || k === 'd') input.right = true;
    else if (k === 'arrowup' || k === 'w' || k === ' ') { if (!e.repeat) press(true); e.preventDefault(); }
    else if (k === 'j') { if (!e.repeat) mainAttack(); }
    else if (k === 'l') { if (!e.repeat) altAttack(); }
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
  api.on(btnMain, 'pointerdown', e => { e.preventDefault(); mainAttack(); });
  api.on(btnAlt, 'pointerdown', e => { e.preventDefault(); altAttack(); });

  // ---------- game state ----------
  let state, li, player, cam, coinsLeft, totalCoins, runCoins, runTime, deaths, particles, flagWave, slashTrail, projectiles, boxes;
  let cls = CLASSES[0];   // selected class
  let freeze = 0, lastMoveAmt = 0;   // hit-stop, last anim amount

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: 1,
      grounded: false, coyote: 0, jumpCut: false, airTime: 0, floatFuel: FLOAT_FUEL,
      anim: { phase: 0, lean: 0, leanV: 0, squash: 0, air: 0, atkActive: false, atkType: null, atkT: 0,
              struck: false, headLag: 0, headLagV: 0, aimShown: 0, aimShownV: 0, aimTarget: 0, atkAim: 0, lastFacing: 0, _dt: 0.016,
              bhx: null, bhy: null, bhxV: 0, bhyV: 0, whx: null, why: null, whxV: 0, whyV: 0 },
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
    slashTrail = [];
    projectiles = [];
    boxes = (L.boxes || []).map(b => ({ x: b[0], y: b[1] - 14, w: 44, h: 44, vx: 0, vy: 0, angle: 0, va: 0, m: 1.6 }));
    flagWave = 0; freeze = 0;
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
    const cards = CLASSES.map(c => `
      <button class="sr-class" data-cls="${c.id}" style="--cc:${c.color}">
        <span style="font-size:30px">${c.emoji}</span>
        <b style="color:${c.color}">${c.name}</b>
        <small>${c.blurb}</small>
      </button>`).join('');
    ov.innerHTML = `<h2>Stick Leap</h2>
      <p class="msg">Choose your class. Run with ←/→ or A/D, jump with Space / ↑ (Mage holds to float).
      Left-click (or J) = main attack, right-click (or L) = special — aimed at the cursor. Knock the
      crates around, grab coins, reach the 🚩 flag.</p>
      <div class="sr-classes">${cards}</div>`;
    loadLevel(0, false);
  }
  function play(clsId) {
    if (clsId) cls = CLASSES.find(c => c.id === clsId) || cls;
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
  ov.addEventListener('click', e => {
    const card = e.target.closest && e.target.closest('[data-cls]');
    if (card) { play(card.dataset.cls); return; }
    if (e.target.dataset.act === 'play') play();   // win-screen: replay same class
  });

  // ---------- particles ----------
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(.3, 1) * spd;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: rand(300, 650), max: 650, color, r: rand(1.5, 3.5) });
    }
  }

  // ---------- physics ----------
  function box() { return { x: player.x - PW / 2, y: player.y - PH, w: PW, h: PH }; }
  function hit(b, p) { return b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y; }

  // dynamic crates: gravity, terrain + box-box collision, friction, bounce, and SPIN
  function updateBoxes() {
    const L = LEVELS[li];
    for (const b of boxes) {
      b.vy = Math.min(b.vy + 0.55, 16);
      // horizontal
      b.x += b.vx;
      for (const p of L.platforms) if (hit(b, p)) { b.x = b.vx > 0 ? p.x - b.w : p.x + p.w; b.vx *= -0.25; b.va += b.vx * 0.01; }
      for (const o of boxes) if (o !== b && hit(b, o)) { b.x = b.x < o.x ? o.x - b.w : o.x + o.w; const t = b.vx; b.vx = o.vx * 0.4; o.vx = t * 0.4; }
      // vertical
      let onG = false;
      b.y += b.vy;
      for (const p of L.platforms) if (hit(b, p)) { if (b.vy > 0) { b.y = p.y - b.h; onG = true; b.vy = b.vy > 4 ? -b.vy * 0.22 : 0; } else if (b.vy < 0) { b.y = p.y + p.h; b.vy = 0; } }
      for (const o of boxes) if (o !== b && hit(b, o)) { if (b.vy > 0) { b.y = o.y - b.h; onG = true; b.vy = 0; } else if (b.vy < 0) { b.y = o.y + o.h; b.vy = 0; } }
      b.vx *= onG ? 0.86 : 0.995;
      if (Math.abs(b.vx) < 0.05) b.vx = 0;
      // rotation: spins freely in the air; on the ground it rolls a little then settles flat
      b.angle += b.va;
      if (onG) {
        b.va = b.va * 0.8 + (b.vx / b.w) * 0.5 * 0.2;     // couple spin to rolling
        const near = Math.round(b.angle / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(b.vx) < 1.5) { b.angle += (near - b.angle) * 0.18; b.va *= 0.6; }   // settle upright
      } else b.va *= 0.99;
      if (b.y > L.h + 300) { b.y = -40; b.x = LEVELS[li].spawn.x + 200; b.vy = b.vx = b.va = 0; b.angle = 0; }
    }
  }
  // apply an impulse to one crate (force scaled by its mass), with a tumble
  function pushBox(b, dx, dy, force) {
    const f = force / b.m;
    b.vx += dx * f; b.vy += dy * f - 2 / b.m;
    b.va += dx * 0.05 + (Math.random() - 0.5) * 0.22;     // torque -> tumble
    b.va = clamp(b.va, -0.6, 0.6);
    burst(b.x + b.w / 2, b.y + b.h / 2, '#caa15a', 8, 3);
  }
  // attacks shove nearby crates
  function hitBoxes(ix, iy, dx, dy, force) {
    for (const b of boxes) if (Math.hypot(b.x + b.w / 2 - ix, b.y + b.h / 2 - iy) < 52) pushBox(b, dx, dy, force);
  }

  function physics() {
    const L = LEVELS[li];
    const acc = player.grounded ? RUN_ACC : AIR_ACC;
    if (input.left && !input.right) { player.vx -= acc; player.facing = -1; }
    else if (input.right && !input.left) { player.vx += acc; player.facing = 1; }
    else if (player.grounded) player.vx *= FRICTION;
    player.vx = clamp(player.vx, -maxV(), maxV());

    const g = cls.gravityMul || 1;
    if (cls.fly) {
      // Mage levitates: hold to gain a little height (limited fuel), then it floats/sinks
      if (input.jumpHeld && player.floatFuel > 0) { player.vy -= 1.0; player.floatFuel -= STEP; }
      player.vy = clamp(player.vy, -3.4, TERMINAL * g);
      jumpBuf = 0;
      player.vy = Math.min(player.vy + GRA * g, TERMINAL * g);   // gentle gravity pulls back down
    } else {
      // jump (buffered + coyote)
      if (jumpBuf > 0 && (player.grounded || player.coyote > 0)) {
        player.vy = JUMP; player.grounded = false; player.coyote = 0; jumpBuf = 0; player.jumpCut = false;
        player.anim.squash = -0.5;            // stretch on takeoff
      }
      if (jumpBuf > 0) jumpBuf--;
      if (!input.jumpHeld && player.vy < 0 && !player.jumpCut) { player.vy *= CUT; player.jumpCut = true; }  // variable height
      player.vy = Math.min(player.vy + GRA * g, TERMINAL * g);
    }

    updateBoxes();   // crates move under their own physics each step

    // integrate + collide (x then y) — against terrain, then crates
    player.x += player.vx;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (player.vx > 0) player.x = p.x - PW / 2; else if (player.vx < 0) player.x = p.x + p.w + PW / 2;
      player.vx = 0;
    }
    for (const b of boxes) if (hit(box(), b)) {           // shove crates sideways (heavier = harder)
      if (player.vx > 0) { b.x = player.x + PW / 2; b.vx = Math.max(b.vx, (player.vx * 0.85 + 0.6) / b.m); player.vx *= 0.5; b.va += 0.012; }
      else if (player.vx < 0) { b.x = player.x - PW / 2 - b.w; b.vx = Math.min(b.vx, (player.vx * 0.85 - 0.6) / b.m); player.vx *= 0.5; b.va -= 0.012; }
    }
    player.y += player.vy;
    player.grounded = false;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (player.vy > 0) { player.y = p.y; player.grounded = true; }
      else if (player.vy < 0) player.y = p.y + p.h + PH;
      if (player.vy > 6) player.anim.squash = clamp(player.vy / TERMINAL, 0, 1) * 0.9; // squash on impact
      player.vy = 0;
    }
    for (const b of boxes) if (hit(box(), b)) {           // stand on / bonk crates
      if (player.vy > 0 && (player.y - player.vy) <= b.y + 8) { player.y = b.y; player.grounded = true; player.vy = 0; }
      else if (player.vy < 0 && (player.y - PH - player.vy) >= b.y + b.h - 8) { player.y = b.y + b.h + PH; player.vy = 0; b.vy += 1; }
    }
    if (player.grounded) { player.coyote = COYOTE; player.jumpCut = false; player.airTime = 0; player.floatFuel = FLOAT_FUEL; }
    else { if (player.coyote > 0) player.coyote--; player.airTime++; }

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

  // ---------- continuous animation system ----------
  // Everything is driven smoothly from the body's velocity and a few eased
  // signals (no discrete walk/run/jump/idle states): `moveAmt` blends standing
  // into running, `a.air` blends ground pose into an air pose, and attacks layer
  // a procedural swing on top. Exponential smoothing keeps it fluid and stable.
  const maxV = () => MAXV * cls.speedMul;
  function animate(dt) {
    const a = player.anim, S = cls.style, sp = Math.abs(player.vx), moveAmt = clamp(sp / maxV(), 0, 1);
    a.phase += (player.grounded ? sp * 0.0030 + 0.0010 : 0.0014) * dt * S.cadence;  // class gait tempo
    a.air = lerp(a.air, player.grounded ? 0 : 1, 1 - Math.pow(0.0006, dt / 1000));
    a.squash = lerp(a.squash, 0, 1 - Math.pow(0.004, dt / 1000));
    // ---- secondary-motion springs, tuned per class (the fluidity + personality layer) ----
    const dts = Math.min(dt, 32) / 1000;          // clamp for stability
    a._dt = dts;                                  // shared with the hand springs in drawStick
    const leanTarget = clamp(player.vx * 0.02, -0.14, 0.14) + S.baseLean;
    springTo(a, 'lean', leanTarget, S.spring.lean[0], S.spring.lean[1], dts);
    springTo(a, 'headLag', clamp(-player.vx * 1.1, -6, 6), S.spring.head[0], S.spring.head[1], dts);
    springAngle(a, 'aimShown', a.aimTarget, S.spring.aim[0], S.spring.aim[1], dts);
    if (a.atkActive) {
      a.atkT += dt / ((cls.dur[a.atkType] || 320) * 1.2);
      const sp = (a.atkType === 'cast' || a.atkType === 'castSpread' || a.atkType === 'throw') ? 0.4 : 0.5;
      if (!a.struck && a.atkT >= sp) { a.struck = true; onStrike(a.atkType); }   // impact / release moment
      if (a.atkT >= 1) { a.atkActive = false; a.atkT = 0; }
    }
    return moveAmt;
  }
  // fired once at the impact/release frame
  function onStrike(type) {
    const ang = player.anim.atkAim;
    if (type === 'cast') { spawnBolt(ang, 1.4); return; }
    if (type === 'castSpread') { for (const d of [-0.22, 0, 0.22]) spawnBolt(ang + d, 1.1); return; }
    if (type === 'throw') { spawnDagger(ang); return; }
    // melee (slash / stab): hit-stop, lunge, crate impulse, impact burst
    freeze = type === 'stab' ? 65 : 55;
    player.vx += player.facing * (type === 'stab' ? 8 : 6);
    const reach = 34 + cls.reach * 36;
    const tx = player.x + Math.cos(ang) * reach, ty = (player.y - 77) + Math.sin(ang) * reach;
    hitBoxes(tx, ty, Math.cos(ang), Math.sin(ang), type === 'stab' ? 16 : 14);
    burst(tx, ty, cls.color, 16, 6);
    burst(tx, ty, '#ffffff', 10, 4.5);
  }
  // a fast, punchy magic bolt (size = power)
  function spawnBolt(ang, power) {
    const shX = player.x, shY = player.y - 77, spd = 14;
    const mx = shX + Math.cos(ang) * 46, my = shY + Math.sin(ang) * 46;
    projectiles.push({ kind: 'bolt', x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1100, color: cls.color, r: 9 * power, hit: 13 * power });
    burst(mx, my, '#ffffff', 9, 4); burst(mx, my, cls.color, 8, 3);
  }
  // a spinning thrown dagger
  function spawnDagger(ang) {
    const shX = player.x, shY = player.y - 70, spd = 15;
    const mx = shX + Math.cos(ang) * 30, my = shY + Math.sin(ang) * 30;
    projectiles.push({ kind: 'dagger', x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1400, color: '#cfd6df', angle: ang, spin: 0.5, hit: 11 });
  }

  // ---------- IK (two-bone) ----------
  // bendScale (<1) visually straightens the joint without moving the end point,
  // so we can keep feet planted but show less knee bend.
  function ik(ax, ay, bx, by, l1, l2, bend, bendScale) {
    let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
    const min = Math.abs(l1 - l2) + 0.01, max = l1 + l2 - 0.01;
    if (d < min) d = min; if (d > max) d = max;
    const len = Math.hypot(dx, dy) || 1;
    const ex = ax + (dx / len) * d, ey = ay + (dy / len) * d;     // clamped end
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a)) * (bendScale == null ? 1 : bendScale);
    const baseX = ax + (ex - ax) * (a / d), baseY = ay + (ey - ay) * (a / d);
    const px = -(ey - ay) / d, py = (ex - ax) / d;
    return { jx: baseX + px * h * bend, jy: baseY + py * h * bend, ex, ey };
  }

  const ease = x => x * x * (3 - 2 * x);
  const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
  // a diagonal SLASH: cock up from the aim, hold, then cut straight down through it
  function slashAngle(t) {
    if (t < 0.32) return lerp(0, -1.15, ease(t / 0.32));           // raise to above the aim
    if (t < 0.42) return -1.15;                                    // hold (anticipation)
    if (t < 0.56) return lerp(-1.15, 1.25, ease((t - 0.42) / 0.14)); // fast cut down through the aim
    return lerp(1.25, 0, ease((t - 0.56) / 0.44));                 // recover
  }
  // thrust reach (0=drawn-in .. >1 = overshoot): big load, explosive lunge-out, recover
  function stabReach(t) {
    if (t < 0.34) return lerp(0, -0.45, ease(t / 0.34));           // pull way back to load
    if (t < 0.44) return -0.45;                                    // hold
    if (t < 0.54) return lerp(-0.45, 1.25, ease((t - 0.44) / 0.10)); // explosive thrust (overshoots)
    if (t < 0.70) return 1.25;                                     // hold full extension
    return lerp(1.25, 0, ease((t - 0.70) / 0.30));                 // retract
  }

  // ---------- draw the stick figure (classic stickman; origin at feet) ----------
  // Solid black, straight two-bone limbs, no feet, no shading.
  const INK = '#161616';
  function seg(ax, ay, jx, jy, bx, by, w) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.lineTo(bx, by); ctx.stroke();
  }

  // blade/weapon length per class (used for the swing trail + bolt origin)
  const WLEN = { sword: 30, dagger: 16, spear: 50, staff: 32 };
  // draw the held weapon from the hand along `ang`; `scale` stretches it lengthwise (smear)
  function drawWeapon(hx, hy, ang, scale) {
    const L = scale || 1, dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const blade = (len, halfW, fill) => {
      len *= L;
      ctx.beginPath();
      ctx.moveTo(hx + dx * 3 + nx * halfW, hy + dy * 3 + ny * halfW);
      ctx.lineTo(hx + dx * len, hy + dy * len);
      ctx.lineTo(hx + dx * 3 - nx * halfW, hy + dy * 3 - ny * halfW);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
    };
    const guard = (hw) => { ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx + nx * hw, hy + ny * hw); ctx.lineTo(hx - nx * hw, hy - ny * hw); ctx.stroke(); };
    const handle = (back) => { ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(hx - dx * back, hy - dy * back); ctx.lineTo(hx + dx * 2, hy + dy * 2); ctx.stroke(); };

    if (cls.weapon === 'sword') { handle(5); guard(6); blade(30, 3, '#7d828c'); }
    else if (cls.weapon === 'dagger') { handle(4); guard(4); blade(16, 2.6, '#9aa0aa'); }
    else if (cls.weapon === 'spear') {
      handle(8);
      ctx.strokeStyle = '#6b5330'; ctx.lineCap = 'round'; ctx.lineWidth = 3.5;   // wooden shaft
      ctx.beginPath(); ctx.moveTo(hx - dx * 8, hy - dy * 8); ctx.lineTo(hx + dx * 42 * L, hy + dy * 42 * L); ctx.stroke();
      // steel head
      ctx.beginPath();
      ctx.moveTo(hx + dx * 42 * L + nx * 3.5, hy + dy * 42 * L + ny * 3.5);
      ctx.lineTo(hx + dx * 50 * L, hy + dy * 50 * L);
      ctx.lineTo(hx + dx * 42 * L - nx * 3.5, hy + dy * 42 * L - ny * 3.5);
      ctx.closePath(); ctx.fillStyle = '#9aa0aa'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = INK; ctx.stroke();
    } else { // staff
      ctx.strokeStyle = '#6b5330'; ctx.lineCap = 'round'; ctx.lineWidth = 3.5;   // shaft
      ctx.beginPath(); ctx.moveTo(hx - dx * 6, hy - dy * 6); ctx.lineTo(hx + dx * 30 * L, hy + dy * 30 * L); ctx.stroke();
      // glowing orb at the tip (class colour)
      const ox = hx + dx * 32 * L, oy = hy + dy * 32 * L;
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, 9);
      g.addColorStop(0, '#ffffff'); g.addColorStop(.5, cls.color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawStick(moveAmt) {
    const a = player.anim, f = player.facing, p = a.phase, air = a.air;
    const now = performance.now();
    // metrics — body proportions are shared; STANCE & motion come from the class style
    const S = cls.style;
    const hipH = S.hipH, torso = 30, neck = 4, headR = 12;
    const thigh = 24, shin = 24, uArm = 18, fArm = 16, armLen = uArm + fArm;
    const strideH = S.strideH, lift = S.lift, armStride = S.armStride, bounceAmp = S.bounceAmp, sway = 2, stanceW = S.stanceW;
    const guardReach = armLen * 0.6;            // bent-elbow "on guard" hold

    const idleAmt = (1 - moveAmt) * (1 - air);
    const bob = bounceAmp * moveAmt * (0.5 - 0.5 * Math.cos(2 * p));   // downward compression
    const breathe = idleAmt * Math.sin(now * S.breatheSpd) * S.breatheAmp;
    // signature idle flourish + hover (the "personality" beat)
    let idleX = 0, idleY = 0, hoverY = 0;
    if (S.idle === 'shift') idleX = Math.sin(now * 0.0016) * 2.6 * idleAmt;              // Knight: heavy weight shift
    else if (S.idle === 'sneak') idleX = Math.sin(now * 0.003) * 1.3 * idleAmt;          // Rogue: low restless sway
    else if (S.idle === 'brace') idleY = Math.sin(now * 0.0014) * 0.7 * idleAmt;         // Lancer: barely moves
    else if (S.idle === 'float')                                                         // Mage: hovers even while moving
      hoverY = S.hover * (0.45 + 0.55 * idleAmt) + Math.sin(now * 0.0019) * 3 * idleAmt + Math.sin(now * 0.0027) * 1.3;

    const postureLean = 0, guardCrouch = 0;            // (no cursor aiming for now)

    // ----- attack scalars (whole-body reaction) -----
    let atkLean = 0, atkHip = 0, slashT = null, stabT = null, castT = null, throwT = null;
    if (a.atkActive) {
      const t = a.atkT, ty = a.atkType, bell = Math.max(0, Math.sin(Math.min(1, t) * Math.PI));
      if (ty === 'stab') { stabT = t; const l = Math.max(0, stabReach(t)); atkHip = f * l * 11; atkLean = f * l * 0.10; }   // big lunge
      else if (ty === 'cast' || ty === 'castSpread') { castT = t; atkHip = f * bell * 3; atkLean = f * bell * 0.05; }
      else if (ty === 'throw') { throwT = t; atkHip = f * bell * 4; atkLean = f * bell * 0.13; }
      else { slashT = t; atkHip = f * bell * 6; atkLean = f * bell * 0.16; }   // overhead slash body commit
    }

    ctx.save();
    ctx.translate(player.x, player.y - hoverY);         // hoverY floats the whole figure (Mage)
    const runPulse = moveAmt * (1 - air) * Math.cos(2 * p) * 0.04;
    const sy = (1 - a.squash * 0.40 * S.squash) * (1 + runPulse);
    const sx = (1 + a.squash * 0.36 * S.squash) * (1 - runPulse * 0.6);
    ctx.scale(sx, sy);

    const hipX = sway * moveAmt * Math.sin(p) * (1 - air) + atkHip + idleX;
    const hipY = -hipH + bob + guardCrouch + breathe + idleY;
    const lean = a.lean + atkLean + postureLean;
    const upX = Math.sin(lean) * f, upY = -Math.cos(lean);
    const shX = hipX + upX * torso, shY = hipY + upY * torso;
    const headCX = shX + upX * (neck + headR), headCY = shY + upY * (neck + headR);

    ctx.strokeStyle = INK; ctx.fillStyle = INK;

    // foot target: blend the ground running gait with an air pose by `air`
    function legFoot(theta, legSign) {
      let c = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const front = f * strideH, back = -f * strideH;
      let gx, gy;
      if (c < Math.PI) { const t = c / Math.PI, e = ease(t); gx = back + (front - back) * e; gy = -lift * Math.sin(Math.PI * t); }
      else { const t = (c - Math.PI) / Math.PI; gx = front + (back - front) * t; gy = 0; }
      gx = gx * moveAmt + legSign * stanceW * (1 - moveAmt); gy *= moveAmt;
      const tuck = clamp(0.4 - player.vy * 0.03, -0.3, 0.55);
      const ax = legSign * 4 + f * 5 * Math.max(0, tuck), ay = -tuck * 10;
      return { x: lerp(gx, ax, air), y: lerp(gy, ay, air) };
    }
    // free (back) arm: straight at rest, swings when running
    function armHand(theta) {
      const sw = Math.sin(theta), ratio = lerp(0.92, 0.74, moveAmt);
      const gx = shX + f * sw * armStride * moveAmt + f * 2;
      const gy = shY + armLen * ratio - Math.max(0, sw) * 5 * moveAmt;
      const raise = clamp(0.55 - player.vy * 0.045, -0.4, 1);
      const ax = shX + f * (6 + (1 - raise) * 10), ay = shY - raise * 18 + (1 - raise) * 8;
      return { x: lerp(gx, ax, air), y: lerp(gy, ay, air) };
    }

    // ----- back arm (ragdoll: hand position springs loosely so the elbow swings) -----
    let h = armHand(p);
    if (a.bhx === null) { a.bhx = h.x; a.bhy = h.y; }
    springTo(a, 'bhx', h.x, 120, 12, a._dt); springTo(a, 'bhy', h.y, 120, 12, a._dt);
    let ka = ik(shX, shY, a.bhx, a.bhy, uArm, fArm, f);
    seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 6);
    if (cls.dual) drawWeapon(ka.ex, ka.ey, Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx), 1);   // Rogue's off-hand dagger

    // ----- far leg ----- (knees bend forward: bend = -f; 0.6 = visually straighter)
    let lt = legFoot(p + Math.PI, +1);
    let k = ik(hipX, hipY, hipX + lt.x, lt.y, thigh, shin, -f, 0.6);
    seg(hipX, hipY, k.jx, k.jy, k.ex, k.ey, 7);

    // ----- torso + head -----
    ctx.lineCap = 'round'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
    ctx.beginPath(); ctx.arc(headCX + a.headLag * (1 - air), headCY, headR, 0, Math.PI * 2); ctx.fill();

    // ----- near leg -----
    lt = legFoot(p, -1);
    k = ik(hipX, hipY, hipX + lt.x, lt.y, thigh, shin, -f, 0.6);
    seg(hipX, hipY, k.jx, k.jy, k.ex, k.ey, 8);

    // ----- weapon arm: rests & swings with the run; attacks drive toward the cursor -----
    // Limbs STRETCH (smear) during the fast snap, then snap back — wide & punchy.
    const attacking = a.atkActive;
    let handT, drawAim, stretch = 1;
    if (attacking) {
      let aim = a.atkAim, ext = 0;
      if (slashT !== null) {
        // OVERHEAD slash: raise the weapon overhead, then cut straight down through the aim
        const up = -Math.PI / 2;
        if (slashT < 0.4) aim = lerpAngle(a.atkAim, up, ease(slashT / 0.4));
        else if (slashT < 0.56) aim = lerpAngle(up, a.atkAim + 0.55, ease((slashT - 0.4) / 0.16));
        else aim = lerpAngle(a.atkAim + 0.55, a.atkAim, ease((slashT - 0.56) / 0.44));
        const chop = clamp((slashT - 0.4) / 0.16, 0, 1);
        stretch = 1 + Math.sin(chop * Math.PI) * 1.1;               // up to ~2.1x at the cut
        ext = 0.55 + 0.45 * Math.sin(Math.min(1, slashT) * Math.PI);
      } else if (stabT !== null) {
        const sr = Math.max(0, stabReach(stabT)); stretch = 1 + sr * 0.8; ext = sr;
      } else if (throwT !== null) {
        // cock back, then whip forward (knife released at the strike frame)
        if (throwT < 0.4) { aim = a.atkAim - 0.5 * f * ease(throwT / 0.4); ext = -0.3 * ease(throwT / 0.4); }
        else { ext = 1.1 - 1.1 * ease(clamp((throwT - 0.4) / 0.3, 0, 1)); stretch = 1 + Math.max(0, ext) * 0.7; }
      } else if (castT !== null) {
        const cr = Math.max(0, Math.sin(Math.min(1, castT) * Math.PI)); stretch = 1 + cr * 0.5; ext = cr;
      }
      const armLenS = (uArm + fArm) * stretch, extTargetS = armLenS * cls.reach;
      const reach = guardReach + (extTargetS - guardReach) * ext;
      a.aimTarget = aim;
      drawAim = a.aimShown;                                          // angle spring -> blade whips & overshoots
      handT = { x: shX + Math.cos(drawAim) * reach, y: shY + Math.sin(drawAim) * reach };
    } else {
      handT = armHand(p + Math.PI);                                  // rest: swing opposite the back arm
      drawAim = null;
    }
    if (a.whx === null) { a.whx = handT.x; a.why = handT.y; }
    springTo(a, 'whx', handT.x, attacking ? 300 : 150, attacking ? 26 : 14, a._dt);
    springTo(a, 'why', handT.y, attacking ? 300 : 150, attacking ? 26 : 14, a._dt);
    const wbend = attacking ? (Math.cos(a.atkAim) >= 0 ? 1 : -1) : f;
    ka = ik(shX, shY, a.whx, a.why, uArm * stretch, fArm * stretch, wbend);   // bones stretch too
    seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 7 / Math.sqrt(stretch));        // thins as it stretches
    const wAng = drawAim != null ? drawAim : Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx);
    drawWeapon(ka.ex, ka.ey, wAng, stretch);

    // swing trail on the sweeping melee attacks
    if (slashT !== null || stabT !== null) {
      const wl = (WLEN[cls.weapon] || 24) * stretch;
      slashTrail.push({ x: player.x + ka.ex + Math.cos(wAng) * wl, y: (player.y - hoverY) + ka.ey + Math.sin(wAng) * wl, life: 220 });
      if (slashTrail.length > 34) slashTrail.shift();
    }

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
  function drawBox(b) {
    const cx = b.x + b.w / 2 - cam.x, cy = b.y + b.h / 2 - cam.y, hw = b.w / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(b.angle || 0);
    ctx.fillStyle = '#bb8a4e'; ctx.fillRect(-hw, -hw, b.w, b.h);          // wood
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.lineJoin = 'miter';
    ctx.strokeRect(-hw + 1.5, -hw + 1.5, b.w - 3, b.h - 3);
    ctx.lineWidth = 1.5;                                                  // plank cross
    ctx.beginPath();
    ctx.moveTo(-hw + 3, -hw + 3); ctx.lineTo(hw - 3, hw - 3);
    ctx.moveTo(hw - 3, -hw + 3); ctx.lineTo(-hw + 3, hw - 3);
    ctx.stroke();
    ctx.restore();
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
    for (const b of boxes) drawBox(b);
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
    // projectiles: glowing bolts and spinning thrown daggers
    for (const b of projectiles) {
      if (b.kind === 'dagger') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(2, 0); ctx.stroke();          // grip
        ctx.beginPath();                                                              // blade
        ctx.moveTo(2, -2.4); ctx.lineTo(14, 0); ctx.lineTo(2, 2.4); ctx.closePath();
        ctx.fillStyle = '#cfd6df'; ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke();
        ctx.restore();
      } else {
        const r = b.r || 10;
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 1.3);
        g.addColorStop(0, '#ffffff'); g.addColorStop(.5, b.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r * 1.3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // weapon swing trail: a bold fading arc (class colour) through the recent tips
    if (slashTrail.length > 1) {
      const [tr, tg, tb] = cls.trail;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < slashTrail.length; i++) {
        const a0 = slashTrail[i - 1], a1 = slashTrail[i];
        const al = clamp(a1.life / 220, 0, 1);
        ctx.strokeStyle = `rgba(${tr},${tg},${tb},${al * 0.85})`;
        ctx.lineWidth = 3 + al * 13;
        ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
      }
    }
    drawStick(moveAmt);
    ctx.restore();
  }

  // ---------- main loop (fixed-step physics + smooth anim/render) ----------
  let acc = 0;
  api.loop(dt => {
    if (state === 'playing') {
      if (freeze > 0) { freeze -= dt; }     // hit-stop: pause sim, hold the frame
      else {
        runTime += dt;
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard++ < 5) { physics(); acc -= STEP; if (state !== 'playing') break; }
        flagWave += dt * 0.006;
        // age effects: particles fly & fade; the sword trail fades out
        for (let i = particles.length - 1; i >= 0; i--) {
          const pt = particles[i]; pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.12; pt.life -= dt;
          if (pt.life <= 0) particles.splice(i, 1);
        }
        for (let i = slashTrail.length - 1; i >= 0; i--) { if ((slashTrail[i].life -= dt) <= 0) slashTrail.splice(i, 1); }
        const L = LEVELS[li];
        for (let i = projectiles.length - 1; i >= 0; i--) {
          const b = projectiles[i];
          b.x += b.vx; b.y += b.vy; b.life -= dt;
          if (b.kind === 'dagger') { b.angle += b.spin; b.vy += 0.18; }          // thrown knives arc slightly
          const crate = boxes.find(bx => b.x > bx.x && b.x < bx.x + bx.w && b.y > bx.y && b.y < bx.y + bx.h);
          if (crate) { const sp = Math.hypot(b.vx, b.vy) || 1; pushBox(crate, b.vx / sp, b.vy / sp, b.hit); }
          const dead = b.life <= 0 || crate || L.platforms.some(pl => b.x > pl.x && b.x < pl.x + pl.w && b.y > pl.y && b.y < pl.y + pl.h);
          if (dead) { burst(b.x, b.y, b.color, 10, 3); projectiles.splice(i, 1); }
        }
      }
      centerCam(false);
    }
    const moveAmt = player ? (freeze > 0 ? lastMoveAmt : (lastMoveAmt = animate(dt))) : 0;
    if (player) render(moveAmt);
  });

  showMenu();
};

Arcade.register(PUBLIC);
})();

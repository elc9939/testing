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
const ROGUE_MAX_KNIVES = 5, ROGUE_REGEN = 1550;
const MAGE_HOVER_HEIGHT = 42;

// ---------- RPG classes (data-driven so more can be added easily) ----------
// weapon: how the held weapon is drawn; moves: primary attacks cycled per click;
// reach: weapon reach multiplier; speedMul: run-speed multiplier; trail: RGB of
// the swing/cast trail; dur: per-move animation lengths (ms); ranged: casts bolts.
const CLASSES = [
  { id: 'knight', name: 'Knight', emoji: '🗡️', color: '#5ea0ff', blurb: 'Heavy, grounded blade.',
    weapon: 'sword', offhand: 'shield', main: 'slash', alt: 'shieldBash', move: 'shieldStep',
    reach: 1.0, speedMul: 0.98, trail: [120, 170, 255], dur: { slash: 360, shieldBash: 260 }, moveDur: { shieldStep: 320 },
    // armored duelist: grounded sword stance with a shield-side weight shift
    style: { hipH: 44, stanceW: 10, strideH: 12, lift: 9, bounceAmp: 4.4, cadence: 0.72, armStride: 8, baseLean: 0.01, squash: 1.25,
      breatheAmp: 1.9, breatheSpd: 0.0019, hover: 0, idle: 'shift', spring: { lean: [70, 20], head: [62, 20], aim: [135, 18] } } },
  { id: 'rogue', name: 'Rogue', emoji: '🔪', color: '#9cff5e', blurb: 'Fast, twitchy daggers.',
    weapon: 'dagger', main: 'dualSlash', alt: 'throw', move: 'slide',
    reach: 0.78, speedMul: 1.32, trail: [150, 255, 110], dur: { dualSlash: 330, throw: 235, legSweep: 260 }, moveDur: { slide: 300 }, dual: true,
    // athletic & quick: low knife stance, long smooth strides, restless hands
    style: { hipH: 46, stanceW: 5, strideH: 15, lift: 7, bounceAmp: 1.0, cadence: 1.14, armStride: 12, baseLean: 0.08, squash: 0.9,
      breatheAmp: 1.1, breatheSpd: 0.0034, hover: 0, idle: 'sneak', spring: { lean: [150, 9], head: [120, 9], aim: [170, 12] } } },
  { id: 'lancer', name: 'Lancer', emoji: '🔱', color: '#ffd45e', blurb: 'Disciplined spear reach.',
    weapon: 'lance', main: 'braceThrust', alt: 'lanceCharge', move: 'brace',
    reach: 1.18, speedMul: 0.82, trail: [255, 212, 94], dur: { braceThrust: 380, lanceCharge: 560 }, moveDur: { brace: 620 }, tank: true,
    // tall & tanky: rooted feet, small bounce, hands braced around the lance
    style: { hipH: 47, stanceW: 13, strideH: 13, lift: 6, bounceAmp: 0.8, cadence: 0.74, armStride: 4, baseLean: 0.02, squash: 0.75,
      breatheAmp: 0.75, breatheSpd: 0.0013, hover: 0, idle: 'lance', spring: { lean: [85, 24], head: [75, 24], aim: [110, 25] } } },
  { id: 'mage', name: 'Mage', emoji: '🪄', color: '#ff77d2', blurb: 'Floaty staff caster.',
    weapon: 'staff', main: 'cast', alt: 'arcaneBloom', move: 'airDash',
    reach: 0.96, speedMul: 0.96, trail: [255, 140, 220], dur: { cast: 210, arcaneBloom: 420 }, moveDur: { airDash: 260 }, ranged: true, gravityMul: 1, fly: true,
    // grounded until the player holds hover; then legs trail and the staff drives flight
    style: { hipH: 49, stanceW: 5, strideH: 8, lift: 5, bounceAmp: 1.0, cadence: 0.72, armStride: 5, baseLean: -0.03, squash: 0.75,
      breatheAmp: 1.5, breatheSpd: 0.0017, hover: 3, idle: 'mystic', spring: { lean: [62, 11], head: [55, 12], aim: [90, 12] } } },
  { id: 'ranger', name: 'Ranger', emoji: '🏹', color: '#53d4ff', blurb: 'Mobile bow shots.',
    weapon: 'bow', main: 'arrow', alt: 'volley', move: 'backstep',
    reach: 0.92, speedMul: 1.08, trail: [83, 212, 255], dur: { arrow: 230, volley: 330 }, moveDur: { backstep: 260 }, ranged: true,
    style: { hipH: 46, stanceW: 8, strideH: 14, lift: 7, bounceAmp: 1.3, cadence: 0.98, armStride: 8, baseLean: 0.04, squash: 0.8,
      breatheAmp: 1.0, breatheSpd: 0.0021, hover: 0, idle: 'archer', spring: { lean: [115, 14], head: [96, 15], aim: [145, 16] } } },
  { id: 'monk', name: 'Monk', emoji: '🥋', color: '#ff8f5e', blurb: 'Vaulting staff sweeps.',
    weapon: 'bo', main: 'staffSweep', alt: 'vaultKick', move: 'vault',
    reach: 1.04, speedMul: 1.12, trail: [255, 143, 94], dur: { staffSweep: 320, vaultKick: 360 }, moveDur: { vault: 420 },
    style: { hipH: 45, stanceW: 9, strideH: 12, lift: 9, bounceAmp: 1.6, cadence: 1.02, armStride: 9, baseLean: 0.02, squash: 0.75,
      breatheAmp: 1.2, breatheSpd: 0.0024, hover: 0, idle: 'monk', spring: { lean: [130, 13], head: [108, 13], aim: [155, 15] } } },
  { id: 'warden', name: 'Warden', emoji: '🔨', color: '#c79bff', blurb: 'Slow hammer shockwaves.',
    weapon: 'hammer', main: 'crush', alt: 'quake', move: 'shoulder',
    reach: 1.08, speedMul: 0.84, trail: [199, 155, 255], dur: { crush: 430, quake: 520 }, moveDur: { shoulder: 360 }, tank: true,
    style: { hipH: 43, stanceW: 12, strideH: 10, lift: 6, bounceAmp: 3.2, cadence: 0.66, armStride: 7, baseLean: 0.03, squash: 1.35,
      breatheAmp: 1.6, breatheSpd: 0.0014, hover: 0, idle: 'heavy', spring: { lean: [72, 25], head: [66, 24], aim: [105, 24] } } },
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
    <span id="sr-ammo" style="display:none">🔪 <b id="sr-knives">0</b></span>
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
  const btnMain = mkBtn(padR, '⚔'), btnAlt = mkBtn(padR, '✦'), btnMove = mkBtn(padR, '↯'), btnJump = mkBtn(padR, '⤒');
  root.appendChild(padL); root.appendChild(padR);
  padL.style.display = padR.style.display = 'none';

  // ---------- input ----------
  const input = { left: false, right: false, down: false, jumpHeld: false };
  const pointer = { x: 0, y: 0, active: false };   // cursor, sets the attack direction
  let jumpBuf = 0;
  const press = (held) => {
    if (held && player && state === 'playing' && cls.id === 'rogue' && !player.grounded && player.coyote <= 0 && !player.rogueAirJump) {
      player.rogueAirJump = true;
      player.vy = JUMP * 0.78;
      player.vx += player.facing * 1.7;
      player.flip = { active: true, t: 0, dur: 520, dir: player.facing };
      player.anim.squash = -0.35;
      burst(player.x, player.y - 34, cls.color, 12, 2.8);
      jumpBuf = 0; input.jumpHeld = true;
      return;
    }
    if (held) { jumpBuf = BUFFER; input.jumpHeld = true; } else input.jumpHeld = false;
  };
  function aimedAngle() {
    const shX = player.x, shY = player.y - 77;
    const tx = pointer.active ? pointer.x + cam.x : shX + player.facing * 60;
    const ty = pointer.active ? pointer.y + cam.y : shY;
    return Math.atan2(ty - shY, tx - shX);
  }
  function triggerAttack(type) {
    if (!player || state !== 'playing' || !type) return false;
    const a = player.anim;
    if (a.atkActive) return false;           // one swing at a time
    if (cls.id === 'rogue' && type === 'throw') {
      if (player.knifeAmmo <= 0) return false;
      player.knifeAmmo--;
      player.knifeRegen = 0;
      syncHud();
    }
    // choose the attack direction from the cursor at the moment of the click
    a.atkAim = aimedAngle();
    if (pointer.active) player.facing = Math.cos(a.atkAim) >= 0 ? 1 : -1;   // turn to face it
    a.aimShown = a.atkAim; a.aimShownV = 0;  // seed the blade spring so it whips from the start
    a.atkActive = true; a.atkType = type; a.atkT = 0; a.struck = false;
    a.struck2 = false;
    return true;
  }
  function triggerMove() {
    if (!player || state !== 'playing' || !cls.move || player.move.active) return false;
    let type = cls.move;
    if (cls.id === 'rogue') type = 'slide';
    const dur = (cls.moveDur && cls.moveDur[type]) || 320;
    player.move = { active: true, type, t: 0, dur, struck: false };
    if (type === 'airDash') {
      const dir = input.left && !input.right ? -1 : input.right && !input.left ? 1 : player.facing;
      player.facing = dir;
      player.vx = dir * 7.8; player.vy = Math.min(player.vy, -1.6);
      burst(player.x - dir * 14, player.y - 30, cls.color, 12, 3.2);
    } else if (type === 'backstep') {
      player.vx = -player.facing * 6.8; player.vy = Math.min(player.vy, -2.0);
      burst(player.x + player.facing * 18, player.y - 22, cls.color, 8, 2.6);
    } else if (type === 'vault') {
      player.vx += player.facing * 3.8; player.vy = -8.8; player.grounded = false;
      burst(player.x, player.y - 8, cls.color, 10, 2.8);
    } else if (type === 'shieldStep' || type === 'shoulder') {
      player.vx = player.facing * (type === 'shoulder' ? 6.8 : 5.2);
      burst(player.x, player.y - 24, cls.color, 8, 2.4);
    } else if (type === 'brace') {
      player.vx = player.facing * 3.0;
      burst(player.x, player.y - 28, cls.color, 8, 1.8);
    }
    return true;
  }
  const mainAttack = () => triggerAttack(cls.id === 'rogue' && input.down ? 'legSweep' : cls.main);
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
    else if (k === 'arrowdown' || k === 's') input.down = true;
    else if (k === 'arrowup' || k === 'w' || k === ' ') { if (!e.repeat) press(true); e.preventDefault(); }
    else if (k === 'j') { if (!e.repeat) mainAttack(); }
    else if (k === 'l') { if (!e.repeat) altAttack(); }
    else if (k === 'k' || k === 'shift') { if (!e.repeat) triggerMove(); }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  });
  api.on(window, 'keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = false;
    else if (k === 'arrowright' || k === 'd') input.right = false;
    else if (k === 'arrowdown' || k === 's') input.down = false;
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
  api.on(btnMove, 'pointerdown', e => { e.preventDefault(); triggerMove(); });

  // ---------- game state ----------
  let state, li, player, cam, coinsLeft, totalCoins, runCoins, runTime, deaths, particles, flagWave, slashTrail, projectiles, droppedKnives, boxes;
  let cls = CLASSES[0];   // selected class
  let freeze = 0, lastMoveAmt = 0;   // hit-stop, last anim amount

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: 1,
      grounded: false, coyote: 0, jumpCut: false, airTime: 0, rogueAirJump: false, knifeAmmo: ROGUE_MAX_KNIVES, knifeRegen: 0,
      move: { active: false, type: null, t: 0, dur: 0, struck: false },
      flip: { active: false, t: 0, dur: 0, dir: 1 },
      anim: { phase: 0, lean: 0, leanV: 0, squash: 0, air: 0, atkActive: false, atkType: null, atkT: 0,
              struck: false, struck2: false, headLag: 0, headLagV: 0, aimShown: 0, aimShownV: 0, aimTarget: 0, atkAim: 0, lastFacing: 0, fly: 0, _dt: 0.016,
              bhx: null, bhy: null, bhxV: 0, bhyV: 0, whx: null, why: null, whxV: 0, whyV: 0,
              shAng: 0, shAngV: 0, elAng: 0, elAngV: 0, blAng: 0, blAngV: 0 },
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
    droppedKnives = [];
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
    const ammo = document.getElementById('sr-ammo');
    if (ammo) {
      ammo.style.display = cls.id === 'rogue' && state === 'playing' ? 'inline' : 'none';
      document.getElementById('sr-knives').textContent = player ? player.knifeAmmo : ROGUE_MAX_KNIVES;
    }
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
      <p class="msg">Choose your class. Run with ←/→ or A/D, jump or hover with Space / ↑, and use K / Shift for class movement.
      Left-click (or J) = main attack, right-click (or L) = special — Rogue can S/↓ + attack to sweep. Knock the
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
  function pointSegDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
    const x = ax + vx * t, y = ay + vy * t;
    return Math.hypot(px - x, py - y);
  }
  function closestPointOnSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
    return { x: ax + vx * t, y: ay + vy * t };
  }
  function pointAabbDist(px, py, r) {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

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
  function hitBoxesSegment(ax, ay, bx, by, dx, dy, force, radius) {
    const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy) || 1;
    const nx = dx == null ? sx / sl : dx, ny = dy == null ? sy / sl : dy;
    for (const b of boxes) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const p = closestPointOnSeg(cx, cy, ax, ay, bx, by);
      if (pointAabbDist(p.x, p.y, b) <= radius) pushBox(b, nx, ny, force);
    }
  }
  function projectileHitsBox(p, ax, ay, b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const q = closestPointOnSeg(cx, cy, ax, ay, p.x, p.y);
    const r = p.kind === 'dagger' || p.kind === 'arrow' ? 4.5 : p.r || 8;
    return pointAabbDist(q.x, q.y, b) <= r;
  }
  function bodyCapsules() {
    const S = cls.style, hip = { x: player.x, y: player.y - S.hipH };
    const sh = { x: player.x + player.anim.lean * player.facing * 14, y: hip.y - 30 };
    return [
      { ax: sh.x, ay: sh.y, bx: hip.x, by: hip.y, r: 8 },
      { ax: sh.x, ay: sh.y - 16, bx: sh.x, by: sh.y - 16, r: 13 },
      { ax: hip.x - player.facing * 4, ay: hip.y, bx: player.x - 9, by: player.y, r: 5 },
      { ax: hip.x + player.facing * 4, ay: hip.y, bx: player.x + 9, by: player.y, r: 5 },
    ];
  }
  function coinTouchesPlayer(c) {
    const coinR = 9, pad = 2;
    return bodyCapsules().some(s => pointSegDist(c.x, c.y, s.ax, s.ay, s.bx, s.by) <= s.r + coinR + pad);
  }
  function pushBoxesRadial(x, y, force, radius) {
    for (const b of boxes) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < radius) pushBox(b, (cx - x) / (d || 1), (cy - y) / (d || 1), force * (1 - d / radius));
    }
  }
  function hoverSurfaceY(x, maxDrop) {
    const L = LEVELS[li], bottom = player.y + maxDrop;
    let y = Infinity;
    for (const p of L.platforms) if (x > p.x - 10 && x < p.x + p.w + 10 && p.y >= player.y - 4 && p.y <= bottom) y = Math.min(y, p.y);
    for (const b of boxes) if (x > b.x - 10 && x < b.x + b.w + 10 && b.y >= player.y - 4 && b.y <= bottom) y = Math.min(y, b.y);
    return y === Infinity ? null : y;
  }
  function spawnDroppedKnife(x, y, angle, vx, vy) {
    droppedKnives.push({ x, y, vx: (vx || 0) * 0.12, vy: (vy || 0) * 0.12, angle, grounded: false, life: 9000 });
  }
  function updateDroppedKnives(dt) {
    const L = LEVELS[li];
    for (let i = droppedKnives.length - 1; i >= 0; i--) {
      const k = droppedKnives[i];
      k.life -= dt;
      if (!k.grounded) {
        k.vy = Math.min(k.vy + 0.45, 12);
        k.x += k.vx; k.y += k.vy;
        k.vx *= 0.98;
        for (const p of L.platforms) if (k.x > p.x && k.x < p.x + p.w && k.y > p.y - 3 && k.y < p.y + p.h) {
          k.y = p.y - 3; k.vx = k.vy = 0; k.grounded = true;
        }
      }
      if (k.grounded && cls.id === 'rogue' && player.knifeAmmo < ROGUE_MAX_KNIVES && Math.hypot(k.x - player.x, k.y - (player.y - 25)) < 28) {
        player.knifeAmmo++;
        player.knifeRegen = 0;
        burst(k.x, k.y, '#cfd6df', 8, 2.4);
        syncHud();
        droppedKnives.splice(i, 1);
      } else if (k.life <= 0) droppedKnives.splice(i, 1);
    }
  }
  function updateRogueAmmo() {
    if (cls.id !== 'rogue') return;
    if (player.knifeAmmo >= ROGUE_MAX_KNIVES) { player.knifeRegen = 0; return; }
    player.knifeRegen += STEP;
    while (player.knifeRegen >= ROGUE_REGEN && player.knifeAmmo < ROGUE_MAX_KNIVES) {
      player.knifeRegen -= ROGUE_REGEN;
      player.knifeAmmo++;
      burst(player.x, player.y - 32, '#cfd6df', 5, 1.8);
    }
  }
  function activeMove(type) {
    return player && player.move && player.move.active && (!type || player.move.type === type);
  }
  function mageHovering() {
    return cls.id === 'mage' && input.jumpHeld;
  }
  function maxV() {
    let m = MAXV * cls.speedMul;
    if (mageHovering()) m *= 1.62;
    if (activeMove('airDash')) m = Math.max(m, 8.6);
    if (activeMove('slide')) m = Math.max(m, 8.0);
    if (activeMove('lanceCharge') || activeMove('shoulder')) m = Math.max(m, 7.2);
    if (activeMove('backstep')) m = Math.max(m, 6.8);
    return m;
  }
  function updateClassMove() {
    const m = player.move;
    if (!m.active) return;
    m.t += STEP / m.dur;
    const t = clamp(m.t, 0, 1), bell = Math.sin(t * Math.PI);
    if (m.type === 'slide') {
      player.vx = player.facing * (6.8 + 1.8 * (1 - t));
      player.vy = Math.min(player.vy, 1.5);
      if (!m.struck && t > 0.32) {
        m.struck = true;
        hitBoxesSegment(player.x + player.facing * 4, player.y - 8, player.x + player.facing * 58, player.y - 8, player.facing, -0.35, 14, 11);
        burst(player.x + player.facing * 30, player.y - 10, cls.color, 10, 3);
      }
    } else if (m.type === 'shieldStep') {
      player.vx = player.facing * (3.4 + bell * 2.6);
      if (!m.struck && t > 0.36) {
        m.struck = true;
        hitBoxesSegment(player.x + player.facing * 28, player.y - 56, player.x + player.facing * 42, player.y - 24, player.facing, -0.1, 18, 14);
        burst(player.x + player.facing * 30, player.y - 34, cls.color, 12, 3);
      }
    } else if (m.type === 'brace') {
      player.vx = player.facing * (2.4 + bell * 2.2);
      if (!m.struck && t > 0.48) {
        m.struck = true;
        hitBoxesSegment(player.x + player.facing * 10, player.y - 62, player.x + player.facing * 92, player.y - 64, player.facing, -0.05, 20, 9);
      }
    } else if (m.type === 'airDash') {
      player.vx = player.facing * (7.4 - t * 1.4);
      player.vy = Math.min(player.vy, -0.35 + t * 1.2);
      if (Math.random() < 0.45) particles.push({ x: player.x - player.facing * rand(8, 28), y: player.y - rand(24, 56),
        vx: -player.facing * rand(0.6, 1.5), vy: rand(-0.4, 0.7), life: rand(160, 310), max: 310, color: cls.color, r: rand(1.2, 2.6) });
    } else if (m.type === 'backstep') {
      player.vx = -player.facing * (5.8 - t * 2.4);
      player.vy = Math.min(player.vy, 1.2);
    } else if (m.type === 'vault') {
      if (t < 0.56) { player.vx = player.facing * (3.8 + bell * 2.2); player.vy = Math.min(player.vy, -3.2 + t * 7); }
      if (!m.struck && t > 0.36) {
        m.struck = true;
        hitBoxesSegment(player.x + player.facing * 10, player.y - 34, player.x + player.facing * 64, player.y - 48, player.facing, -0.8, 17, 11);
        burst(player.x + player.facing * 28, player.y - 38, cls.color, 11, 3.2);
      }
    } else if (m.type === 'shoulder') {
      player.vx = player.facing * (5.4 + bell * 2.4);
      if (!m.struck && t > 0.34) {
        m.struck = true;
        hitBoxesSegment(player.x + player.facing * 18, player.y - 52, player.x + player.facing * 46, player.y - 28, player.facing, 0, 22, 15);
        burst(player.x + player.facing * 28, player.y - 32, cls.color, 12, 3);
      }
    }
    if (m.t >= 1) player.move = { active: false, type: null, t: 0, dur: 0, struck: false };
  }
  function updateRogueFlip() {
    if (!player.flip || !player.flip.active) return;
    player.flip.t += STEP / player.flip.dur;
    if (player.flip.t >= 1) player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
  }

  function physics() {
    const L = LEVELS[li];
    const acc = player.grounded ? RUN_ACC : AIR_ACC;
    if (input.left && !input.right) { player.vx -= acc; player.facing = -1; }
    else if (input.right && !input.left) { player.vx += acc; player.facing = 1; }
    else if (player.grounded) player.vx *= FRICTION;
    updateClassMove();
    updateRogueFlip();
    player.vx = clamp(player.vx, -maxV(), maxV());

    const g = cls.gravityMul || 1;
    if (cls.fly && mageHovering()) {
      jumpBuf = 0;
      const surface = hoverSurfaceY(player.x, MAGE_HOVER_HEIGHT + 150);
      player.vy = Math.min(player.vy + GRA * 0.18, TERMINAL * 0.45);
      if (surface !== null) {
        const targetY = surface - MAGE_HOVER_HEIGHT;
        player.vy += clamp((targetY - player.y) * 0.075, -1.05, 1.0);
        if (player.y > targetY - 2 && player.vy > 0) player.vy *= 0.34;
      } else {
        player.vy += clamp((-0.18 - player.vy) * 0.08, -0.36, 0.28);
      }
      player.vy = clamp(player.vy, -5.2, 4.5);
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
    updateRogueAmmo();

    updateBoxes();   // crates move under their own physics each step

    // integrate + collide (x then y) — against terrain, then crates
    player.x += player.vx;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (player.vx > 0) player.x = p.x - PW / 2; else if (player.vx < 0) player.x = p.x + p.w + PW / 2;
      player.vx = 0;
    }
    for (const b of boxes) if (hit(box(), b)) {           // shove crates sideways (heavier = harder)
      const sturdy = cls.tank || activeMove('brace') || activeMove('shoulder') || activeMove('shieldStep');
      const shove = sturdy ? 1.35 : 0.85, loss = sturdy ? 0.78 : 0.5;
      if (player.vx > 0) { b.x = player.x + PW / 2; b.vx = Math.max(b.vx, (player.vx * shove + 0.6) / b.m); player.vx *= loss; b.va += sturdy ? 0.025 : 0.012; }
      else if (player.vx < 0) { b.x = player.x - PW / 2 - b.w; b.vx = Math.min(b.vx, (player.vx * shove - 0.6) / b.m); player.vx *= loss; b.va -= sturdy ? 0.025 : 0.012; }
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
    if (cls.fly && mageHovering()) {
      const surface = hoverSurfaceY(player.x, MAGE_HOVER_HEIGHT + 150);
      if (surface !== null) {
        const targetY = surface - MAGE_HOVER_HEIGHT;
        if (player.y > targetY) { player.y = lerp(player.y, targetY, 0.55); player.vy = Math.min(player.vy, 0); }
        player.grounded = Math.abs(player.y - targetY) < 8;
      }
    }
    if (player.grounded) {
      player.coyote = COYOTE; player.jumpCut = false; player.airTime = 0; player.rogueAirJump = false;
      if (player.flip && player.flip.active) player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
    }
    else { if (player.coyote > 0) player.coyote--; player.airTime++; }

    // coins
    for (const c of coinsLeft) if (!c.got && coinTouchesPlayer(c)) {
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
    player.move = { active: false, type: null, t: 0, dur: 0, struck: false };
    player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
    player.rogueAirJump = false;
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
  function animate(dt) {
    const a = player.anim, S = cls.style, sp = Math.abs(player.vx), moveAmt = clamp(sp / maxV(), 0, 1);
    a.phase += (player.grounded ? sp * 0.0030 + 0.0010 : 0.0014) * dt * S.cadence;  // class gait tempo
    a.air = lerp(a.air, player.grounded ? 0 : 1, 1 - Math.pow(0.0006, dt / 1000));
    a.fly = lerp(a.fly || 0, mageHovering() || activeMove('airDash') ? 1 : 0, 1 - Math.pow(0.0003, dt / 1000));
    a.squash = lerp(a.squash, 0, 1 - Math.pow(0.004, dt / 1000));
    // ---- secondary-motion springs, tuned per class (the fluidity + personality layer) ----
    const dts = Math.min(dt, 32) / 1000;          // clamp for stability
    a._dt = dts;                                  // shared with the hand springs in drawStick
    const leanTarget = clamp(player.vx * (mageHovering() ? 0.032 : 0.02), -0.20, 0.20) + S.baseLean;
    springTo(a, 'lean', leanTarget, S.spring.lean[0], S.spring.lean[1], dts);
    springTo(a, 'headLag', clamp(-player.vx * 1.1, -6, 6), S.spring.head[0], S.spring.head[1], dts);
    springAngle(a, 'aimShown', a.aimTarget, S.spring.aim[0], S.spring.aim[1], dts);
    if (a.atkActive) {
      a.atkT += dt / ((cls.dur[a.atkType] || 320) * 1.2);
      const sp = strikePoint(a.atkType);
      if (a.atkType === 'dualSlash') {
        if (!a.struck && a.atkT >= 0.34) { a.struck = true; onStrike(a.atkType, 0); }
        if (!a.struck2 && a.atkT >= 0.64) { a.struck2 = true; onStrike(a.atkType, 1); }
      } else if (!a.struck && a.atkT >= sp) { a.struck = true; onStrike(a.atkType, 0); }   // impact / release moment
      if (a.atkT >= 1) { a.atkActive = false; a.atkT = 0; }
    }
    return moveAmt;
  }
  function strikePoint(type) {
    if (type === 'throw') return 0.46;
    if (type === 'arrow') return 0.24;
    if (type === 'volley') return 0.32;
    if (type === 'cast') return 0.38;
    if (type === 'arcaneBloom' || type === 'quake') return 0.48;
    if (type === 'shieldBash' || type === 'legSweep') return 0.38;
    if (type === 'lanceCharge') return 0.52;
    return 0.5;
  }
  // fired once at the impact/release frame
  function onStrike(type, phase) {
    const ang = player.anim.atkAim;
    if (type === 'cast') { spawnBolt(ang, 1.4); return; }
    if (type === 'arcaneBloom') { spawnMageSigil(ang); return; }
    if (type === 'throw') { spawnDagger(ang); return; }
    if (type === 'arrow') { spawnArrow(ang, 1); return; }
    if (type === 'volley') { for (const d of [-0.12, 0, 0.12]) spawnArrow(ang + d, 0.92); return; }
    if (type === 'quake') {
      const qx = player.x + player.facing * 26, qy = player.y - 10;
      freeze = 46; player.vx *= 0.35;
      burst(qx, qy, cls.color, 30, 5.6); burst(qx, qy, '#ffffff', 10, 3.2);
      pushBoxesRadial(qx, qy, 28, 128);
      return;
    }
    // melee: light hit-stop, body follow-through, crate impulse, impact burst
    const heavy = type === 'lanceCharge' || type === 'braceThrust' || type === 'crush';
    freeze = type === 'lanceCharge' ? 44 : type === 'crush' ? 42 : type === 'shieldBash' ? 30 : type === 'legSweep' ? 22 : heavy ? 36 : 24;
    player.vx += player.facing * (type === 'lanceCharge' ? 15 : type === 'braceThrust' ? 8.5 : type === 'shieldBash' ? 6.5 : type === 'dualSlash' ? 3.6 : type === 'vaultKick' ? 7 : type === 'crush' ? 5 : 5.5);
    if (type === 'vaultKick') { player.vy = Math.min(player.vy, -4.6); player.grounded = false; }
    const seg = meleeSegment(type, ang, phase);
    hitBoxesSegment(seg.ax, seg.ay, seg.bx, seg.by, seg.dx, seg.dy, seg.force, seg.r);
    burst(seg.bx, seg.by, cls.color, type === 'dualSlash' ? 12 : heavy ? 22 : 15, type === 'dualSlash' ? 3.4 : 5.2);
    if (type !== 'dualSlash') burst(seg.bx, seg.by, '#ffffff', heavy ? 12 : 8, 3.4);
  }
  function meleeSegment(type, ang, phase) {
    const f = player.facing, shX = player.x, shY = player.y - 72;
    if (type === 'legSweep') return { ax: player.x + f * 2, ay: player.y - 10, bx: player.x + f * 64, by: player.y - 7, dx: f, dy: -0.35, force: 18, r: 10 };
    if (type === 'shieldBash') return { ax: player.x + f * 38, ay: player.y - 56, bx: player.x + f * 42, by: player.y - 26, dx: f, dy: -0.1, force: 21, r: 15 };
    if (type === 'lanceCharge') return { ax: shX + f * 8, ay: shY + 10, bx: shX + f * 128, by: shY + 4, dx: f, dy: -0.04, force: 32, r: 8 };
    if (type === 'braceThrust') return { ax: shX + f * 6, ay: shY + 8, bx: shX + f * 108, by: shY + 2, dx: f, dy: -0.04, force: 24, r: 8 };
    if (type === 'crush') return { ax: shX + f * 18, ay: shY - 8, bx: shX + f * 58, by: player.y - 12, dx: f * 0.55, dy: 0.9, force: 30, r: 18 };
    if (type === 'staffSweep') {
      const side = Math.cos(ang) >= 0 ? 1 : -1, a = ang + side * 0.55;
      return { ax: shX - Math.cos(a) * 22, ay: shY - Math.sin(a) * 22, bx: shX + Math.cos(a) * 62, by: shY + Math.sin(a) * 62, dx: Math.cos(a), dy: Math.sin(a), force: 17, r: 9 };
    }
    if (type === 'vaultKick') return { ax: player.x + f * 8, ay: player.y - 38, bx: player.x + f * 66, by: player.y - 48, dx: f, dy: -0.7, force: 17, r: 11 };
    if (type === 'dualSlash') {
      const hand = phase === 0 ? 1 : -1, a = rogueSlashAngle(phase === 0 ? 0.40 : 0.68, ang, hand);
      return { ax: shX + f * 5, ay: shY, bx: shX + Math.cos(a) * 58, by: shY + Math.sin(a) * 58, dx: Math.cos(a), dy: Math.sin(a), force: 14, r: 11 };
    }
    // every other weapon swing: the hit blade IS the drawn blade, sampled from
    // the same pose at the impact frame (hand -> weapon tip).
    const pose = weaponPose(type, strikePoint(type), ang, f);
    const ch = armChain(shX, shY, pose.shAng, pose.elBend);
    const bladeAng = ch.foreAng + pose.wrBend;
    const wl = WLEN[cls.weapon] || 24;
    const tx = ch.hx + Math.cos(bladeAng) * wl, ty = ch.hy + Math.sin(bladeAng) * wl;
    const FORCE = { lanceCharge: 32, braceThrust: 24, crush: 30, staffSweep: 17, stab: 16, lunge: 18 };
    const force = FORCE[type] != null ? FORCE[type] : 16;
    const r = type === 'crush' ? 18 : (type === 'lanceCharge' || type === 'braceThrust') ? 9 : 11;
    return { ax: ch.hx, ay: ch.hy, bx: tx, by: ty, dx: Math.cos(bladeAng), dy: Math.sin(bladeAng), force, r };
  }
  // a fast, punchy magic bolt (size = power)
  function spawnBolt(ang, power) {
    const shX = player.x, shY = player.y - 77, spd = 19;
    const mx = shX + Math.cos(ang) * 46, my = shY + Math.sin(ang) * 46;
    projectiles.push({ kind: 'bolt', x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1100, color: cls.color, r: 9 * power, hit: 13 * power, sparkle: 2 });
    burst(mx, my, '#ffffff', 16, 5); burst(mx, my, cls.color, 22, 4.2);
  }
  // a straight thrown dagger that can be recovered after landing
  function spawnDagger(ang) {
    const shX = player.x + player.facing * 11, shY = player.y - 96, spd = 22;
    const mx = shX + Math.cos(ang) * 22, my = shY + Math.sin(ang) * 10;
    projectiles.push({ kind: 'dagger', x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1400, color: '#cfd6df', angle: ang, hit: 11 });
  }
  function spawnArrow(ang, power) {
    const shX = player.x, shY = player.y - 72, spd = 22 * power;
    const mx = shX + Math.cos(ang) * 34, my = shY + Math.sin(ang) * 34;
    projectiles.push({ kind: 'arrow', x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1300, color: cls.color, angle: ang, hit: 10 * power });
    burst(mx, my, cls.color, 8, 2.4);
  }
  function spawnMageSigil(ang) {
    const shX = player.x, shY = player.y - 76;
    const mx = shX + Math.cos(ang) * 42, my = shY + Math.sin(ang) * 42;
    projectiles.push({ kind: 'sigil', x: mx, y: my, vx: Math.cos(ang) * 5.8, vy: Math.sin(ang) * 5.8,
      life: 620, age: 0, color: cls.color, r: 16, hit: 18, angle: ang });
    burst(mx, my, '#ffffff', 18, 3.2);
    burst(mx, my, cls.color, 32, 3.8);
  }
  function explodeSigil(b) {
    burst(b.x, b.y, b.color, 34, 5.2);
    burst(b.x, b.y, '#ffffff', 18, 3.6);
    pushBoxesRadial(b.x, b.y, 18, 92);
    for (let i = 0; i < 8; i++) {
      const a = b.angle + i * Math.PI / 4 + Math.sin(b.age * 0.02) * 0.25;
      const spd = 9.5;
      projectiles.push({ kind: 'bolt', x: b.x, y: b.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        life: 520, color: b.color, r: 5.5, hit: 8, sparkle: 1 });
    }
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
  function rogueSlashAngle(t, baseAim, hand) {
    const side = Math.cos(baseAim) >= 0 ? 1 : -1;
    const offset = hand * side;
    const start = hand > 0 ? 0.04 : 0.34;
    const end = hand > 0 ? 0.58 : 0.94;
    const u = clamp((t - start) / (end - start), 0, 1);
    const wind = baseAim - offset * 0.72;
    const bite = baseAim + offset * 0.62;
    if (u < 0.28) return lerpAngle(baseAim - offset * 0.12, wind, ease(u / 0.28));
    if (u < 0.68) return lerpAngle(wind, bite, ease((u - 0.28) / 0.40));
    return lerpAngle(bite, baseAim + offset * 0.08, ease((u - 0.68) / 0.32));
  }
  function rogueSlashActive(t, hand) {
    const start = hand > 0 ? 0.04 : 0.34;
    const end = hand > 0 ? 0.62 : 0.98;
    return t >= start && t <= end;
  }
  function rogueSlashCut(t, hand) {
    const start = hand > 0 ? 0.04 : 0.34;
    const end = hand > 0 ? 0.58 : 0.94;
    return clamp((t - start) / (end - start), 0, 1);
  }
  // thrust reach (0=drawn-in .. >1 = overshoot): big load, explosive lunge-out, recover
  function stabReach(t) {
    if (t < 0.34) return lerp(0, -0.45, ease(t / 0.34));           // pull way back to load
    if (t < 0.44) return -0.45;                                    // hold
    if (t < 0.54) return lerp(-0.45, 1.25, ease((t - 0.44) / 0.10)); // explosive thrust (overshoots)
    if (t < 0.70) return 1.25;                                     // hold full extension
    return lerp(1.25, 0, ease((t - 0.70) / 0.30));                 // retract
  }
  function lungeReach(t) {
    if (t < 0.26) return lerp(0, -0.28, ease(t / 0.26));
    if (t < 0.46) return lerp(-0.28, 1.42, ease((t - 0.26) / 0.20));
    if (t < 0.66) return 1.42;
    return lerp(1.42, 0.12, ease((t - 0.66) / 0.34));
  }

  // ===========================================================================
  // ARTICULATED WEAPON ARM
  // The visible arm is still two segments (shoulder -> elbow -> hand), but it is
  // now driven by JOINT ANGLES instead of an IK hand-target, so the elbow can
  // lag the shoulder and *whip*. The blade gets its own wrist joint (its angle
  // is forearm + wristBend) so it trails then snaps through the arc rather than
  // rigidly pointing where the hand points. No bone-stretching ("smear") — the
  // punch comes from the whip, the body lean and the hit-stop. One shared
  // evaluator (weaponPose) defines every swing as data, and the melee hitbox is
  // derived from the exact same pose, so what you see is what hits.
  // ===========================================================================
  const UARM = 18, FARM = 16;                  // upper-arm / forearm bone lengths
  // piecewise keyframe with smoothstep easing between stops: [[t,val],...]
  function kfa(t, stops) {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a0 = stops[i], a1 = stops[i + 1];
      if (t <= a1[0]) return lerp(a0[1], a1[1], ease((t - a0[0]) / (a1[0] - a0[0] || 1)));
    }
    return stops[stops.length - 1][1];
  }
  function attackArc(type) {
    if (type === 'crush') return 'chop';
    if (type === 'stab' || type === 'lunge' || type === 'braceThrust' || type === 'lanceCharge') return 'thrust';
    if (type === 'cast' || type === 'arcaneBloom') return 'cast';
    if (type === 'throw') return 'throw';
    if (type === 'arrow' || type === 'volley') return 'shoot';
    if (type === 'shieldBash') return 'bash';
    if (type === 'legSweep' || type === 'vaultKick') return 'kick';
    return 'arc';                               // slash / staffSweep / generic swing
  }
  // The one swing primitive: returns absolute shoulder angle + relative elbow &
  // wrist bends for an attack at normalised time t. `s` mirrors the whole motion
  // by which way you're aiming, so a swing always cocks up-and-back then cuts
  // down-and-through, for either facing.
  function weaponPose(type, t, aim, f) {
    const s = (Math.cos(aim) >= 0 ? 1 : -1);
    const arc = attackArc(type);
    let shAng, elBend, wrBend;
    if (arc === 'arc') {
      // diagonal slash: raise above the aim, hold, then snap down through it
      shAng = aim + s * kfa(t, [[0, 0.10], [0.26, -0.95], [0.36, -0.95], [0.58, 0.72], [1, 0.18]]);
      // elbow coils tight on the wind-up, then snaps open at the cut (the whip)
      elBend = s * kfa(t, [[0, -0.55], [0.34, -1.20], [0.50, -0.12], [0.62, 0.06], [1, -0.55]]);
      // blade lays back over the shoulder, then whips forward, leading the hand
      wrBend = s * kfa(t, [[0, 0.30], [0.36, 0.90], [0.50, -0.55], [0.66, -0.08], [1, 0.28]]);
    } else if (arc === 'chop') {
      // overhead: raise straight up, slam straight down through the aim
      const up = -Math.PI / 2;
      shAng = t < 0.40 ? lerpAngle(aim, up, ease(t / 0.40))
        : t < 0.58 ? lerpAngle(up, aim + s * 0.45, ease((t - 0.40) / 0.18))
          : lerpAngle(aim + s * 0.45, aim, ease((t - 0.58) / 0.42));
      elBend = s * kfa(t, [[0, -0.40], [0.40, -1.30], [0.56, -0.05], [0.70, 0.05], [1, -0.50]]);
      wrBend = s * kfa(t, [[0, 0.20], [0.40, 0.85], [0.56, -0.45], [0.70, 0.00], [1, 0.20]]);
    } else if (arc === 'thrust') {
      // straight stab: coil the elbow to draw the hand in, then explode it out
      shAng = aim + s * 0.05 * Math.sin(clamp(t, 0, 1) * Math.PI);
      elBend = s * kfa(t, [[0, -0.40], [0.34, -2.00], [0.44, -2.00], [0.54, -0.05], [0.70, -0.05], [1, -0.60]]);
      wrBend = s * kfa(t, [[0, 0.20], [0.44, 0.45], [0.54, 0.00], [1, 0.15]]);
    } else if (arc === 'cast') {
      const bell = Math.sin(clamp(t, 0, 1) * Math.PI);
      shAng = aim - s * 0.10 * (1 - bell);
      elBend = s * lerp(-1.00, -0.20, bell);
      wrBend = s * 0.15 * (1 - bell);
    } else if (arc === 'throw') {
      const up = -Math.PI / 2;
      shAng = t < 0.36 ? lerpAngle(aim, up, ease(t / 0.36))
        : t < 0.56 ? lerpAngle(up, aim, ease((t - 0.36) / 0.20)) : aim;
      elBend = s * kfa(t, [[0, -0.50], [0.36, -1.50], [0.50, -0.10], [0.62, 0.05], [1, -0.50]]);
      wrBend = s * kfa(t, [[0, 0.30], [0.36, 1.00], [0.52, -0.50], [0.66, -0.05], [1, 0.20]]);
    } else if (arc === 'shoot') {
      shAng = aim; elBend = s * -0.15; wrBend = 0;     // bow arm holds steady toward the aim
    } else if (arc === 'bash') {
      shAng = (f > 0 ? 0 : Math.PI); elBend = f * 0.25; wrBend = 0;
    } else {                                            // kick: weapon arm just braces low
      shAng = (f > 0 ? -0.20 : Math.PI + 0.20); elBend = f * 0.50; wrBend = 0;
    }
    return { shAng, elBend, wrBend };
  }
  // forward-kinematic chain from the three joint angles
  function armChain(shX, shY, shAng, elBend) {
    const ex = shX + Math.cos(shAng) * UARM, ey = shY + Math.sin(shAng) * UARM;
    const foreAng = shAng + elBend;
    const hx = ex + Math.cos(foreAng) * FARM, hy = ey + Math.sin(foreAng) * FARM;
    return { ex, ey, hx, hy, foreAng };
  }

  // ---------- draw the stick figure (classic stickman; origin at feet) ----------
  // Solid black, straight two-bone limbs, no feet, no shading.
  const INK = '#161616';
  function seg(ax, ay, jx, jy, bx, by, w) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.lineTo(bx, by); ctx.stroke();
  }

  // blade/weapon length per class (used for the swing trail + bolt origin)
  const WLEN = { sword: 30, dagger: 16, spear: 50, lance: 82, staff: 46, bow: 34, bo: 52, hammer: 46 };
  // draw the held weapon from the hand along `ang`; `scale` stretches it lengthwise (smear)
  function drawWeapon(hx, hy, ang, scale) {
    ctx.save();
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
    } else if (cls.weapon === 'lance') {
      ctx.strokeStyle = '#6b5330'; ctx.lineCap = 'round'; ctx.lineWidth = 4.2;
      ctx.beginPath(); ctx.moveTo(hx - dx * 34, hy - dy * 34); ctx.lineTo(hx + dx * 74 * L, hy + dy * 74 * L); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx - dx * 10 + nx * 5, hy - dy * 10 + ny * 5); ctx.lineTo(hx - dx * 10 - nx * 5, hy - dy * 10 - ny * 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx + dx * 12 + nx * 5, hy + dy * 12 + ny * 5); ctx.lineTo(hx + dx * 12 - nx * 5, hy + dy * 12 - ny * 5); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx + dx * 74 * L + nx * 5.5, hy + dy * 74 * L + ny * 5.5);
      ctx.lineTo(hx + dx * 88 * L, hy + dy * 88 * L);
      ctx.lineTo(hx + dx * 74 * L - nx * 5.5, hy + dy * 74 * L - ny * 5.5);
      ctx.closePath(); ctx.fillStyle = '#aeb4bd'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#9a6b3f'; ctx.beginPath(); ctx.arc(hx - dx * 38, hy - dy * 38, 3.5, 0, Math.PI * 2); ctx.fill();
    } else if (cls.weapon === 'staff') {
      ctx.strokeStyle = '#62462c'; ctx.lineCap = 'round'; ctx.lineWidth = 4.2;
      ctx.beginPath(); ctx.moveTo(hx - dx * 18, hy - dy * 18); ctx.lineTo(hx + dx * 44 * L, hy + dy * 44 * L); ctx.stroke();
      ctx.strokeStyle = '#9aa0aa'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(hx + dx * 44 * L + nx * 5, hy + dy * 44 * L + ny * 5); ctx.lineTo(hx + dx * 44 * L - nx * 5, hy + dy * 44 * L - ny * 5); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(hx + dx * 49 * L, hy + dy * 49 * L, 5.5, 0.25, Math.PI * 1.75); ctx.stroke();
    } else if (cls.weapon === 'bow') {
      ctx.strokeStyle = '#6b5330'; ctx.lineCap = 'round'; ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(hx + nx * 20, hy + ny * 20);
      ctx.quadraticCurveTo(hx - dx * 12, hy - dy * 12, hx - nx * 20, hy - ny * 20);
      ctx.stroke();
      ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx + nx * 19, hy + ny * 19); ctx.lineTo(hx - nx * 19, hy - ny * 19); ctx.stroke();
      ctx.strokeStyle = '#8b6a3b'; ctx.lineWidth = 2.3;
      ctx.beginPath(); ctx.moveTo(hx - dx * 8, hy - dy * 8); ctx.lineTo(hx + dx * 26 * L, hy + dy * 26 * L); ctx.stroke();
      ctx.fillStyle = '#aeb4bd'; ctx.beginPath();
      ctx.moveTo(hx + dx * 30 * L, hy + dy * 30 * L);
      ctx.lineTo(hx + dx * 22 * L + nx * 3, hy + dy * 22 * L + ny * 3);
      ctx.lineTo(hx + dx * 22 * L - nx * 3, hy + dy * 22 * L - ny * 3);
      ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
    } else if (cls.weapon === 'bo') {
      ctx.strokeStyle = '#6b5330'; ctx.lineCap = 'round'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx - dx * 30, hy - dy * 30); ctx.lineTo(hx + dx * 48 * L, hy + dy * 48 * L); ctx.stroke();
      ctx.strokeStyle = '#303030'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(hx - dx * 26 + nx * 3, hy - dy * 26 + ny * 3); ctx.lineTo(hx - dx * 26 - nx * 3, hy - dy * 26 - ny * 3);
      ctx.moveTo(hx + dx * 42 * L + nx * 3, hy + dy * 42 * L + ny * 3); ctx.lineTo(hx + dx * 42 * L - nx * 3, hy + dy * 42 * L - ny * 3); ctx.stroke();
    } else if (cls.weapon === 'hammer') {
      ctx.strokeStyle = '#5f432b'; ctx.lineCap = 'round'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx - dx * 16, hy - dy * 16); ctx.lineTo(hx + dx * 35 * L, hy + dy * 35 * L); ctx.stroke();
      const cx = hx + dx * 42 * L, cy = hy + dy * 42 * L;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.fillStyle = '#7d828c'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
      ctx.fillRect(-6, -10, 14, 20); ctx.strokeRect(-6, -10, 14, 20);
      ctx.restore();
    }
    ctx.restore();
  }
  function drawShield(hx, hy, face, scale) {
    ctx.save();
    ctx.translate(hx, hy); ctx.scale(scale || 1, scale || 1);
    ctx.fillStyle = '#5ea0ff'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(face * -9, -12);
    ctx.quadraticCurveTo(face * 12, -9, face * 10, 6);
    ctx.quadraticCurveTo(0, 17, face * -10, 6);
    ctx.quadraticCurveTo(face * -12, -8, face * -9, -12);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(face * -5, -7); ctx.lineTo(face * 5, 8); ctx.stroke();
    ctx.restore();
  }

  function drawStick(moveAmt) {
    const a = player.anim, f = player.facing, p = a.phase, air = a.air;
    const fly = a.fly || 0, moveType = player.move.active ? player.move.type : null, moveT = player.move.active ? clamp(player.move.t, 0, 1) : 0;
    const flipActive = player.flip && player.flip.active;
    const flipT = flipActive ? clamp(player.flip.t, 0, 1) : 0;
    const flipCurl = flipActive ? Math.sin(flipT * Math.PI) : 0;
    const flipLead = flipActive ? Math.sin(flipT * Math.PI * 2) : 0;
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
    else if (S.idle === 'lance') idleY = Math.sin(now * 0.0012) * 0.35 * idleAmt;        // Lancer: locked-down stance
    else if (S.idle === 'mystic') idleY = Math.sin(now * 0.0017) * 0.9 * idleAmt;        // Mage: grounded staff breathing
    else if (S.idle === 'archer') idleX = Math.sin(now * 0.0018) * 1.0 * idleAmt;
    else if (S.idle === 'monk') idleY = Math.sin(now * 0.0025) * 0.8 * idleAmt;
    else if (S.idle === 'heavy') idleY = Math.sin(now * 0.0011) * 0.6 * idleAmt;
    hoverY = fly * (S.hover + Math.sin(now * 0.004) * 1.8);

    let postureLean = 0, guardCrouch = 0;            // (no cursor aiming for now)
    if (moveType === 'slide') { postureLean -= f * 0.26; guardCrouch = 13 * Math.sin(moveT * Math.PI); }
    else if (moveType === 'shoulder' || moveType === 'shieldStep' || moveType === 'brace') postureLean += f * 0.16 * Math.sin(moveT * Math.PI);
    else if (moveType === 'airDash') postureLean += f * 0.22;
    if (flipActive) {
      postureLean += player.flip.dir * (Math.PI * 2 * ease(flipT) + 0.18 * flipLead);
      guardCrouch -= 8 * flipCurl;
    }

    // ----- attack scalars (whole-body reaction) -----
    let atkLean = 0, atkHip = 0, slashT = null, stabT = null, lungeT = null, castT = null, throwT = null, shootT = null;
    if (a.atkActive) {
      const t = a.atkT, ty = a.atkType, bell = Math.max(0, Math.sin(Math.min(1, t) * Math.PI));
      if (ty === 'stab' || ty === 'braceThrust') { stabT = t; const l = Math.max(0, stabReach(t)); atkHip = f * l * (ty === 'braceThrust' ? 14 : 11); atkLean = f * l * 0.10; }
      else if (ty === 'lunge' || ty === 'lanceCharge') { lungeT = t; const l = Math.max(0, lungeReach(t)); atkHip = f * l * 20; atkLean = f * l * 0.19; }
      else if (ty === 'cast' || ty === 'arcaneBloom') { castT = t; atkHip = f * bell * 3; atkLean = f * bell * 0.05; }
      else if (ty === 'arrow' || ty === 'volley') { shootT = t; atkHip = -f * bell * 2; atkLean = -f * bell * 0.05; }
      else if (ty === 'throw') { throwT = t; atkHip = f * bell * 3; atkLean = -f * 0.08 + f * bell * 0.14; }
      else { slashT = t; atkHip = f * bell * (ty === 'dualSlash' ? 4 : 6); atkLean = f * bell * (ty === 'dualSlash' ? 0.11 : 0.16); }   // slash body commit
    }

    ctx.save();
    ctx.translate(player.x, player.y - hoverY);         // hoverY floats the whole figure (Mage)
    const runPulse = moveAmt * (1 - air) * Math.cos(2 * p) * 0.04;
    const sy = (1 - a.squash * 0.40 * S.squash) * (1 + runPulse);
    const sx = (1 + a.squash * 0.36 * S.squash) * (1 - runPulse * 0.6);
    ctx.scale(sx, sy);

    const hipX = sway * moveAmt * Math.sin(p) * (1 - air) + atkHip + idleX;
    const hipY = -hipH + bob + guardCrouch + breathe + idleY - flipCurl * 7;
    const lean = a.lean + atkLean + postureLean;
    const upX = Math.sin(lean) * f, upY = -Math.cos(lean);
    const shX = hipX + upX * torso, shY = hipY + upY * torso;
    let headCX = shX + upX * (neck + headR), headCY = shY + upY * (neck + headR);
    if (flipActive) {
      headCX = lerp(headCX, hipX - player.flip.dir * (8 + flipLead * 5), flipCurl * 0.55);
      headCY = lerp(headCY, hipY - 18 + Math.abs(flipLead) * 5, flipCurl * 0.55);
    }

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
      let foot = { x: lerp(gx, ax, air), y: lerp(gy, ay, air) };
      if (fly > 0) {
        foot.x = lerp(foot.x, -f * (18 + legSign * 3) + legSign * 4, fly);
        foot.y = lerp(foot.y, -7 + legSign * 5 + Math.sin(now * 0.006 + legSign) * 2, fly);
      }
      if (moveType === 'slide') {
        const frontLeg = legSign === -1;
        foot.x = frontLeg ? f * (26 + 8 * Math.sin(moveT * Math.PI)) : -f * 15;
        foot.y = frontLeg ? -1 : -9;
      } else if (a.atkActive && a.atkType === 'legSweep') {
        const frontLeg = legSign === -1;
        const sweep = Math.sin(Math.min(1, a.atkT) * Math.PI);
        foot.x = frontLeg ? f * (18 + 30 * sweep) : -f * 10;
        foot.y = frontLeg ? -2 : -8;
      } else if (flipActive) {
        const kick = Math.sin((flipT + (legSign > 0 ? 0.10 : -0.06)) * Math.PI * 2);
        foot.x = lerp(foot.x, -player.flip.dir * (12 + flipCurl * 16) + legSign * (7 - flipCurl * 2) + kick * 3, flipCurl);
        foot.y = lerp(foot.y, -18 + legSign * 4 + flipCurl * 9, flipCurl);
      }
      return foot;
    }
    // free (back) arm: straight at rest, swings when running
    function armHand(theta) {
      const sw = Math.sin(theta), ratio = lerp(0.92, 0.74, moveAmt);
      const gx = shX + f * sw * armStride * moveAmt + f * 2;
      const gy = shY + armLen * ratio - Math.max(0, sw) * 5 * moveAmt;
      const raise = clamp(0.55 - player.vy * 0.045, -0.4, 1);
      const ax = shX + f * (6 + (1 - raise) * 10), ay = shY - raise * 18 + (1 - raise) * 8;
      let hand = { x: lerp(gx, ax, air), y: lerp(gy, ay, air) };
      if (fly > 0) {
        hand.x = lerp(hand.x, shX - f * (18 + Math.sin(theta) * 5), fly);
        hand.y = lerp(hand.y, shY + 14 + Math.cos(theta) * 5, fly);
      }
      if (flipActive) {
        const sweep = Math.sin((flipT + (theta === p ? 0.08 : -0.08)) * Math.PI * 2);
        hand.x = lerp(hand.x, shX - player.flip.dir * (12 + flipCurl * 14) + sweep * 5, flipCurl);
        hand.y = lerp(hand.y, shY + 10 + flipCurl * 12, flipCurl);
      }
      return hand;
    }

    // ----- back arm (ragdoll: hand position springs loosely so the elbow swings) -----
    const knifeTrick = cls.id === 'rogue' && !a.atkActive && idleAmt > 0.72 && ((now % 4300) / 4300) > 0.70
      ? ease((((now % 4300) / 4300) - 0.70) / 0.30) : 0;
    let h = armHand(p), offhandAim = null, offhandStretch = 1;
    if (cls.id === 'rogue' && slashT !== null && rogueSlashActive(slashT, -1)) {
      const cut = rogueSlashCut(slashT, -1);
      offhandAim = rogueSlashAngle(slashT, a.atkAim, -1);
      offhandStretch = 1 + Math.sin(cut * Math.PI) * 0.28;
      const reach = guardReach + (armLen * 0.86 - guardReach) * (0.35 + 0.65 * Math.sin(cut * Math.PI));
      h = { x: shX + Math.cos(offhandAim) * reach, y: shY + Math.sin(offhandAim) * reach };
    } else if (cls.offhand === 'shield') {
      const push = (a.atkActive && a.atkType === 'shieldBash') || moveType === 'shieldStep' ? Math.sin(Math.min(1, a.atkT || moveT) * Math.PI) : 0;
      h = { x: shX + f * (14 + push * 24), y: shY + 14 - push * 8 };
    } else if (cls.weapon === 'lance') {
      h = { x: shX - f * 4, y: shY + 18 };
    } else if (cls.weapon === 'staff' || cls.weapon === 'bo') {
      h = { x: shX - f * (fly ? 14 : 8), y: shY + 18 + fly * 7 };
    } else if (cls.weapon === 'bow') {
      h = { x: shX - f * 10, y: shY + 10 };
    }
    if (a.bhx === null) { a.bhx = h.x; a.bhy = h.y; }
    springTo(a, 'bhx', h.x, offhandAim ? 180 : 120, offhandAim ? 17 : 12, a._dt);
    springTo(a, 'bhy', h.y, offhandAim ? 180 : 120, offhandAim ? 17 : 12, a._dt);
    let ka = ik(shX, shY, a.bhx, a.bhy, uArm * offhandStretch, fArm * offhandStretch, f);
    seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 6 / Math.sqrt(offhandStretch));
    if (cls.dual) {
      let offAng = offhandAim != null ? offhandAim : Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx);
      if (knifeTrick) offAng += f * Math.PI * 4 * knifeTrick;
      drawWeapon(ka.ex, ka.ey, offAng, offhandStretch);
      if (offhandAim != null) {
        slashTrail.push({ x: player.x + ka.ex + Math.cos(offAng) * WLEN.dagger * offhandStretch, y: (player.y - hoverY) + ka.ey + Math.sin(offAng) * WLEN.dagger * offhandStretch, life: 170 });
        if (slashTrail.length > 38) slashTrail.shift();
      }
    } else if (cls.offhand === 'shield') {
      drawShield(ka.ex, ka.ey, f, (a.atkActive && a.atkType === 'shieldBash') || moveType === 'shieldStep' ? 1.15 : 1);
    }

    // ----- far leg ----- (knees bend forward: bend = -f; 0.6 = visually straighter)
    let lt = legFoot(p + Math.PI, +1);
    let k = ik(hipX, hipY, hipX + lt.x, lt.y, thigh, shin, -f, 0.6);
    seg(hipX, hipY, k.jx, k.jy, k.ex, k.ey, 7);

    // ----- torso + head -----
    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    ctx.lineCap = 'round'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
    ctx.beginPath(); ctx.arc(headCX + a.headLag * (1 - air), headCY, headR, 0, Math.PI * 2); ctx.fill();

    // ----- near leg -----
    lt = legFoot(p, -1);
    k = ik(hipX, hipY, hipX + lt.x, lt.y, thigh, shin, -f, 0.6);
    seg(hipX, hipY, k.jx, k.jy, k.ex, k.ey, 8);

    // ----- weapon arm: ARTICULATED chain driven by joint angles -----
    // Attacks run through one shared swing engine (weaponPose): the shoulder
    // leads, the elbow & wrist lag then SNAP, so the blade whips through the arc.
    // The joint angles are spring-smoothed for secondary motion (no bone-stretch).
    const attacking = a.atkActive;
    const rogueDual = cls.id === 'rogue' && attacking && a.atkType === 'dualSlash';
    if (attacking && !rogueDual) {
      const pose = weaponPose(a.atkType, a.atkT, a.atkAim, f);
      springAngle(a, 'shAng', pose.shAng, 240, 22, a._dt);                            // shoulder leads
      springAngle(a, 'elAng', pose.elBend, 240, 20, a._dt);                           // elbow lags -> whip
      springAngle(a, 'blAng', pose.shAng + pose.elBend + pose.wrBend, 220, 16, a._dt); // blade wrist
      const wc = armChain(shX, shY, a.shAng, a.elAng);
      seg(shX, shY, wc.ex, wc.ey, wc.hx, wc.hy, 7);
      drawWeapon(wc.hx, wc.hy, a.blAng, 1);
      const kind = attackArc(a.atkType);
      if (kind === 'arc' || kind === 'chop' || kind === 'thrust') {                   // trail on melee arcs
        const wl = WLEN[cls.weapon] || 24;
        slashTrail.push({ x: player.x + wc.hx + Math.cos(a.blAng) * wl, y: (player.y - hoverY) + wc.hy + Math.sin(a.blAng) * wl, life: 220 });
        if (slashTrail.length > 34) slashTrail.shift();
      }
    } else {
      // Resting holds + rogue dual-wield keep their hand-target IK for now; we
      // capture the resulting joint angles so the swing engine starts seamlessly.
      let handT, drawAim, stretch = 1;
      if (rogueDual) {
        let aim = a.atkAim, ext = 0.44;
        if (rogueSlashActive(slashT, 1)) {
          aim = rogueSlashAngle(slashT, a.atkAim, 1);
          const cut = rogueSlashCut(slashT, 1);
          stretch = 1 + Math.sin(cut * Math.PI) * 0.34;
          ext = cut < 0.28 ? lerp(0.38, 0.58, ease(cut / 0.28))
            : cut < 0.68 ? lerp(0.58, 0.96, ease((cut - 0.28) / 0.40))
            : lerp(0.96, 0.46, ease((cut - 0.68) / 0.32));
        } else { aim = a.atkAim - f * 0.18; }
        a.aimTarget = aim;
        drawAim = a.aimShown;
        const armLenS = (uArm + fArm) * stretch, extTargetS = armLenS * cls.reach;
        const reach = guardReach + (extTargetS - guardReach) * ext;
        handT = { x: shX + Math.cos(drawAim) * reach, y: shY + Math.sin(drawAim) * reach };
      } else if (cls.weapon === 'lance') {
        drawAim = f > 0 ? -0.04 : Math.PI + 0.04;
        handT = { x: shX + f * 18, y: shY + 16 };
      } else if (cls.weapon === 'staff') {
        drawAim = fly > 0.25 ? Math.atan2(player.vy * 0.18, f) : -Math.PI / 2 + f * 0.16;
        handT = { x: shX + f * (fly > 0.25 ? 22 : 12), y: shY + (fly > 0.25 ? 6 : 19) };
      } else if (cls.weapon === 'bow') {
        drawAim = f > 0 ? 0 : Math.PI;
        handT = { x: shX + f * 17, y: shY + 7 };
      } else if (cls.weapon === 'bo') {
        drawAim = f > 0 ? -0.36 : Math.PI + 0.36;
        handT = { x: shX + f * 12, y: shY + 18 };
      } else if (cls.weapon === 'hammer') {
        drawAim = f > 0 ? -1.08 : Math.PI + 1.08;
        handT = { x: shX + f * 12, y: shY + 12 };
      } else if (cls.id === 'rogue') {
        drawAim = flipActive ? -Math.PI / 2 + player.flip.dir * 0.35 : f > 0 ? 0.12 : Math.PI - 0.12;
        handT = flipActive
          ? { x: shX - player.flip.dir * (10 + flipCurl * 12), y: shY + 10 + flipCurl * 12 }
          : { x: shX + f * 16, y: shY + 22 };
      } else if (cls.weapon === 'sword') {
        drawAim = f > 0 ? -0.20 : Math.PI + 0.20;
        handT = { x: shX + f * 14, y: shY + 18 };
      } else {
        handT = armHand(p + Math.PI);                                  // rest: swing opposite the back arm
        drawAim = null;
      }
      if (a.whx === null) { a.whx = handT.x; a.why = handT.y; }
      springTo(a, 'whx', handT.x, rogueDual ? 220 : 150, rogueDual ? 19 : 14, a._dt);
      springTo(a, 'why', handT.y, rogueDual ? 220 : 150, rogueDual ? 19 : 14, a._dt);
      const wbend = rogueDual ? (Math.cos(a.atkAim) >= 0 ? 1 : -1) : f;
      ka = ik(shX, shY, a.whx, a.why, uArm * stretch, fArm * stretch, wbend);
      seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 7 / Math.sqrt(stretch));
      let wAng = drawAim != null ? drawAim : Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx);
      if (knifeTrick && !rogueDual) wAng += f * Math.PI * 4 * knifeTrick;
      drawWeapon(ka.ex, ka.ey, wAng, stretch);
      if (rogueDual && slashT !== null) {
        const wl = (WLEN[cls.weapon] || 24) * stretch;
        slashTrail.push({ x: player.x + ka.ex + Math.cos(wAng) * wl, y: (player.y - hoverY) + ka.ey + Math.sin(wAng) * wl, life: 220 });
        if (slashTrail.length > 34) slashTrail.shift();
      }
      // seed the swing-engine joints from the current pose for a seamless handoff
      if (!attacking) {
        a.shAng = Math.atan2(ka.jy - shY, ka.jx - shX); a.shAngV = 0;
        a.elAng = Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx) - a.shAng; a.elAngV = 0;
        a.blAng = wAng; a.blAngV = 0;
      }
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
    for (const k of droppedKnives) {
      ctx.save(); ctx.translate(k.x - cam.x, k.y - cam.y); ctx.rotate(k.angle);
      ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(1, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1, -2); ctx.lineTo(11, 0); ctx.lineTo(1, 2); ctx.closePath();
      ctx.fillStyle = '#cfd6df'; ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    // figure (translate by camera)
    ctx.translate(-cam.x, -cam.y);
    // projectiles: glowing bolts, sigils, and thrown daggers
    for (const b of projectiles) {
      if (b.kind === 'dagger') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(2, 0); ctx.stroke();          // grip
        ctx.beginPath();                                                              // blade
        ctx.moveTo(2, -2.4); ctx.lineTo(14, 0); ctx.lineTo(2, 2.4); ctx.closePath();
        ctx.fillStyle = '#cfd6df'; ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'arrow') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.strokeStyle = '#5f432b'; ctx.lineCap = 'round'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(10, 0); ctx.stroke();
        ctx.fillStyle = '#aeb4bd'; ctx.strokeStyle = INK; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(8, -3); ctx.lineTo(8, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = b.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-20, -4); ctx.moveTo(-14, 0); ctx.lineTo(-20, 4); ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'sigil') {
        const r = b.r || 16;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle + (b.age || 0) * 0.014);
        ctx.strokeStyle = b.color; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); ctx.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8)); ctx.stroke();
        }
        ctx.restore();
      } else {
        const r = b.r || 10;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.fillStyle = b.color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(0, r * 0.55); ctx.lineTo(-r, 0); ctx.lineTo(0, -r * 0.55); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
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
        updateDroppedKnives(dt);
        for (let i = slashTrail.length - 1; i >= 0; i--) { if ((slashTrail[i].life -= dt) <= 0) slashTrail.splice(i, 1); }
        const L = LEVELS[li];
        for (let i = projectiles.length - 1; i >= 0; i--) {
          const b = projectiles[i];
          const px = b.x, py = b.y;
          b.x += b.vx; b.y += b.vy; b.life -= dt;
          if (b.kind === 'dagger') { b.vy += 0.18; }          // thrown knives arc slightly, without spinning
          else if (b.kind === 'arrow') { b.vy += 0.045; b.angle = Math.atan2(b.vy, b.vx); }
          else if (b.kind === 'bolt') {
            for (let s = 0; s < (b.sparkle || 1); s++) if (Math.random() < 0.65) {
              const trail = rand(0.12, 0.45);
              particles.push({ x: b.x - b.vx * trail + rand(-2.5, 2.5), y: b.y - b.vy * trail + rand(-2.5, 2.5),
                vx: -b.vx * rand(0.01, 0.035) + rand(-0.45, 0.45), vy: -b.vy * rand(0.01, 0.035) + rand(-0.45, 0.45),
                life: rand(180, 360), max: 360, color: Math.random() < 0.35 ? '#ffffff' : b.color, r: rand(1, 2.7) });
            }
          } else if (b.kind === 'sigil') {
            b.age += dt;
            b.angle += 0.045;
            b.vx *= 0.985; b.vy *= 0.985;
            if (Math.random() < 0.9) particles.push({ x: b.x + rand(-10, 10), y: b.y + rand(-10, 10),
              vx: rand(-0.5, 0.5), vy: rand(-0.6, 0.2), life: rand(220, 430), max: 430, color: Math.random() < 0.35 ? '#ffffff' : b.color, r: rand(1.2, 3.2) });
            if (b.age > 430) b.life = 0;
          }
          const crate = boxes.find(bx => projectileHitsBox(b, px, py, bx));
          if (crate) { const sp = Math.hypot(b.vx, b.vy) || 1; pushBox(crate, b.vx / sp, b.vy / sp, b.hit); }
          const dead = b.life <= 0 || crate || L.platforms.some(pl => b.x > pl.x && b.x < pl.x + pl.w && b.y > pl.y && b.y < pl.y + pl.h);
          if (dead) {
            if (b.kind === 'dagger') spawnDroppedKnife(b.x, b.y, b.angle, b.vx, b.vy);
            else if (b.kind === 'sigil') explodeSigil(b);
            else {
              burst(b.x, b.y, b.color, b.kind === 'bolt' ? 20 : 10, b.kind === 'bolt' ? 4 : 3);
              if (b.kind === 'bolt') burst(b.x, b.y, '#ffffff', 10, 3.4);
            }
            projectiles.splice(i, 1);
          }
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

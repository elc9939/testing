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
const MAGE_HOVER_STEP = 92;

// ---------- RPG classes ----------
// weapon: how the held weapon is drawn; moves: primary attacks cycled per click;
// reach: weapon reach multiplier; speedMul: run-speed multiplier; trail: RGB of
// the swing/cast trail; dur: per-move animation lengths (ms); ranged: casts bolts.
const CLASSES = [
  { id: 'knight', name: 'Knight', emoji: '🗡️', color: '#5ea0ff', blurb: 'Heavy, grounded blade.',
    weapon: 'sword', offhand: 'shield', main: 'slash', alt: 'shieldBash', move: 'shieldStep',
    reach: 1.0, speedMul: 0.98, trail: [120, 170, 255], dur: { slash: 380, shieldBash: 260 }, moveDur: { shieldStep: 320 },
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
    reach: 1.18, speedMul: 0.82, trail: [255, 212, 94], dur: { braceThrust: 520, lanceCharge: 640 }, moveDur: { brace: 620 }, tank: true,
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
];

// ---------- action timeline library ----------
// Every satisfying move needs the same bones: a readable wind-up, an active
// window, and a recovery/cancel tail. Keeping that data together lets the combat
// feel be tuned without chasing scattered timing constants through the file.
const DEFAULT_ATTACK = {
  kind: 'melee', strike: 0.50, hitstop: 20, impulse: 5.5, durScale: 1.2,
  phases: { anticipation: [0.00, 0.30], active: [0.38, 0.62], recovery: [0.62, 1.00] },
  sweep: [-0.16, -0.08, 0.00, 0.06],
};
const ATTACK_TIMELINES = {
  slash: { kind: 'melee', strike: 0.50, hitstop: 20, impulse: 5.8, tags: ['blade', 'combo'] },
  dualSlash: { kind: 'melee', strike: 0.44, hitstop: 16, impulse: 3.6, tags: ['blade', 'fast'],
    phases: { anticipation: [0.00, 0.20], active: [0.26, 0.60], recovery: [0.60, 1.00] },
    sweep: [-0.12, -0.06, 0.00, 0.06] },
  rogueStab: { kind: 'melee', strike: 0.42, hitstop: 14, impulse: 4.0, tags: ['blade', 'fast', 'stab'],
    phases: { anticipation: [0.00, 0.22], active: [0.32, 0.54], recovery: [0.54, 1.00] },
    sweep: [-0.07, 0.00, 0.07] },
  legSweep: { kind: 'melee', strike: 0.38, hitstop: 17, impulse: 4.2, tags: ['low', 'control'] },
  shieldBash: { kind: 'melee', strike: 0.38, hitstop: 24, impulse: 6.5, tags: ['guard', 'bash'] },
  lanceSwing: { kind: 'melee', strike: 0.50, hitstop: 34, impulse: 6.8, tags: ['reach', 'heavy', 'swing'],
    phases: { anticipation: [0.00, 0.34], active: [0.40, 0.68], recovery: [0.68, 1.00] },
    sweep: [-0.18, -0.08, 0.00, 0.08, 0.16] },
  braceThrust: { kind: 'melee', strike: 0.54, hitstop: 34, impulse: 10.5, tags: ['reach', 'heavy', 'stab'],
    phases: { anticipation: [0.00, 0.40], active: [0.48, 0.70], recovery: [0.70, 1.00] },
    sweep: [-0.06, -0.02, 0.00, 0.05] },
  lanceCharge: { kind: 'melee', strike: 0.54, hitstop: 34, impulse: 9.0, tags: ['reach', 'heavy', 'stab', 'charge'],
    phases: { anticipation: [0.00, 0.26], active: [0.28, 0.76], recovery: [0.76, 1.00] },
    sweep: [-0.04, 0.00, 0.04, 0.10] },
  crush: { kind: 'melee', strike: 0.50, hitstop: 42, impulse: 5.0, tags: ['heavy', 'impact'] },
  staffSweep: { kind: 'melee', strike: 0.50, hitstop: 26, impulse: 5.5, tags: ['staff', 'arc'] },
  vaultKick: { kind: 'melee', strike: 0.50, hitstop: 24, impulse: 7.0, tags: ['air', 'kick'] },
  throw: { kind: 'projectile', strike: 0.46, hitstop: 0, impulse: 0, tags: ['projectile', 'ammo'],
    phases: { anticipation: [0.00, 0.28], active: [0.40, 0.50], recovery: [0.50, 1.00] } },
  arrow: { kind: 'projectile', strike: 0.24, hitstop: 0, impulse: 0, tags: ['projectile'],
    phases: { anticipation: [0.00, 0.16], active: [0.21, 0.30], recovery: [0.30, 1.00] } },
  volley: { kind: 'projectile', strike: 0.32, hitstop: 0, impulse: 0, tags: ['projectile', 'burst'] },
  cast: { kind: 'projectile', strike: 0.38, hitstop: 0, impulse: 0, tags: ['magic'] },
  arcaneBloom: { kind: 'projectile', strike: 0.48, hitstop: 0, impulse: 0, tags: ['magic', 'area'] },
  quake: { kind: 'area', strike: 0.48, hitstop: 46, impulse: 0, tags: ['area', 'heavy'] },
};
const DEFAULT_MOTION = {
  phases: { anticipation: [0.00, 0.18], active: [0.18, 0.72], recovery: [0.72, 1.00] },
  tags: ['move'],
};
const MOTION_TIMELINES = {
  slide: { tags: ['move', 'low', 'attack'], phases: { anticipation: [0.00, 0.12], active: [0.12, 0.66], recovery: [0.66, 1.00] } },
  airDash: { tags: ['move', 'air', 'burst'], phases: { anticipation: [0.00, 0.10], active: [0.10, 0.78], recovery: [0.78, 1.00] } },
  brace: { tags: ['move', 'tank', 'reach'], phases: { anticipation: [0.00, 0.28], active: [0.28, 0.78], recovery: [0.78, 1.00] } },
  shieldStep: { tags: ['move', 'guard'], phases: { anticipation: [0.00, 0.18], active: [0.18, 0.70], recovery: [0.70, 1.00] } },
  shoulder: { tags: ['move', 'tank', 'bash'], phases: { anticipation: [0.00, 0.16], active: [0.16, 0.68], recovery: [0.68, 1.00] } },
  backstep: { tags: ['move', 'evade'], phases: { anticipation: [0.00, 0.08], active: [0.08, 0.70], recovery: [0.70, 1.00] } },
  vault: { tags: ['move', 'air', 'staff'], phases: { anticipation: [0.00, 0.20], active: [0.20, 0.72], recovery: [0.72, 1.00] } },
};

function withDefaults(spec, fallback) {
  return Object.assign({}, fallback, spec || {}, {
    phases: Object.assign({}, fallback.phases, (spec && spec.phases) || {}),
  });
}
function attackSpec(type) { return withDefaults(ATTACK_TIMELINES[type], DEFAULT_ATTACK); }
function motionSpec(type) { return withDefaults(MOTION_TIMELINES[type], DEFAULT_MOTION); }

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
    enemies: [
      { cls: 'rogue', x: 1180, y: G - 70, min: 1100, max: 1280 },
      { cls: 'knight', x: 1560, y: G, min: 1430, max: 1800 },
    ],
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
    enemies: [
      { cls: 'lancer', x: 1390, y: G, min: 1270, max: 1530 },
      { cls: 'ranger', x: 1720, y: G - 80, min: 1660, max: 1800 },
    ],
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
    enemies: [
      { cls: 'knight', x: 1340, y: G - 30, min: 1300, max: 1410 },
      { cls: 'mage', x: 2150, y: G, min: 2040, max: 2360 },
    ],
    flag: { x: 2470, y: G },
  }),
];
const TEST_ARENA = lvl({
  spawn: { x: 90, y: G },
  platforms: [
    { x: 0, y: G, w: 420, h: 160 },
    { x: 500, y: G, w: 220, h: 160 },
    { x: 760, y: G - 36, w: 180, h: 196 },
    { x: 1000, y: G - 72, w: 180, h: 232 },
    { x: 1240, y: G, w: 420, h: 160 },
    { x: 1740, y: G - 110, w: 180, h: 270 },
    { x: 1980, y: G, w: 420, h: 160 },
  ],
  coins: [[260, G - 58], [560, G - 58], [850, G - 94], [1080, G - 130],
          [1380, G - 58], [1810, G - 168], [2140, G - 58]],
  boxes: [[330, G - 30], [820, G - 66], [1320, G - 30], [2060, G - 30]],
  dummies: [[310, G], [1120, G - 72], [2120, G]],
  enemies: [
    { cls: 'knight', x: 560, y: G, min: 500, max: 700 },
    { cls: 'rogue', x: 850, y: G - 36, min: 770, max: 930 },
    { cls: 'lancer', x: 1400, y: G, min: 1280, max: 1620 },
    { cls: 'ranger', x: 1820, y: G - 110, min: 1750, max: 1910 },
    { cls: 'mage', x: 2150, y: G, min: 2010, max: 2380 },
  ],
  flag: { x: 2300, y: G },
});

PUBLIC.start = function (root, api) {
  const view = api.makeCanvas(root);
  const ctx = view.ctx;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const levels = query.has('arena') ? [TEST_ARENA] : LEVELS;
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
  hud.innerHTML = `<span>LVL <b id="sr-lvl">1</b>/<b id="sr-lvls">3</b></span>
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
  function triggerAttack(type, opts) {
    if (!player || state !== 'playing' || !type) return false;
    const a = player.anim;
    if (a.atkActive) return false;           // one swing at a time
    if (cls.id === 'rogue' && type === 'legSweep') {
      if (player.move && player.move.active && player.move.type === 'slide') {
        player.move = { active: false, type: null, t: 0, dur: 0, struck: false, phase: 'idle', spec: DEFAULT_MOTION };
        player.vx *= 0.62;
      }
      player.intent.down = true;
    }
    if (cls.id === 'rogue' && type === 'throw') {
      if (player.knifeAmmo <= 0) return false;
      player.knifeAmmo--;
      player.knifeRegen = 0;
      syncHud();
    }
    if (opts && opts.aim != null) {
      // AI / scripted swing: aim is supplied directly (enemies target the hero).
      a.atkAim = opts.aim;
      player.facing = Math.cos(a.atkAim) >= 0 ? 1 : -1;
    } else {
      // choose the attack direction from the cursor at the moment of the click
      a.atkAim = aimedAngle();
      // with no cursor (touch), auto-aim melee at a nearby target ahead so taps
      // connect — the arc sweep then covers head-to-body.
      if (!pointer.active) {
        const kind = attackArc(type);
        if (kind === 'arc' || kind === 'chop' || kind === 'thrust') {
          let tgt = null, td = 160;
          const aim = c => { const dist = Math.hypot(c.x - player.x, c.y - (player.y - 60));
            if (dist < td && Math.sign(c.x - player.x) === player.facing) { td = dist; tgt = c; } };
          if (dummies) for (const d of dummies) aim({ x: d.pts.chest.x, y: d.pts.chest.y });
          if (fighters) for (const e of fighters) aim({ x: e.x, y: e.y - 44 });
          if (tgt) a.atkAim = Math.atan2(tgt.y - (player.y - 77), tgt.x - player.x);
        }
      }
      if (pointer.active) player.facing = Math.cos(a.atkAim) >= 0 ? 1 : -1;   // turn to face it
    }
    a.aimShown = a.atkAim; a.aimShownV = 0;  // seed the blade spring so it whips from the start
    a.action = startAttackAction(type);
    a.atkActive = true; a.atkType = type; a.atkT = 0; a.atkDur = a.action.dur; a.atkPhase = 'anticipation'; a.struck = false;
    a.struck2 = false;
    a.atkVar = (Math.random() * 64) | 0;     // vary the swing so motions aren't identical
    if (isLancerAttack(type)) player.vx *= 0.18;
    // rogue dual-wield: one tap = one hand, alternating each strike
    if (cls.id === 'rogue' && type === 'dualSlash') { a.rogueHand = a.rogueHandNext | 0; a.rogueHandNext = a.rogueHand ? 0 : 1; }
    // knight slash combo: chain taps cycle diagonal -> horizontal -> overhead
    if (type === 'slash') {
      const nowMs = performance.now();
      a.slashFlavor = (nowMs - (a.comboAt || 0) < 850) ? ((a.slashFlavor | 0) + 1) % 3 : 0;
      a.comboAt = nowMs;
    }
    return true;
  }
  function triggerMove() {
    if (!player || state !== 'playing' || !cls.move || player.move.active) return false;
    let type = cls.move;
    if (cls.id === 'rogue') type = 'slide';
    const dur = (cls.moveDur && cls.moveDur[type]) || 320;
    player.move = startMotion(type, dur);
    if (type === 'airDash') {
      const it = player.intent;
      const dir = it.left && !it.right ? -1 : it.right && !it.left ? 1 : player.facing;
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
  function rogueMainAttackType() {
    if (player.intent.down) return 'legSweep';
    const i = player && player.anim ? (player.anim.rogueComboNext || 0) : 0;
    return i === 2 || i === 4 ? 'rogueStab' : 'dualSlash';
  }
  function mainAttack() {
    const type = cls.id === 'rogue' ? rogueMainAttackType() : cls.main;
    const ok = triggerAttack(type);
    if (ok && cls.id === 'rogue' && type !== 'legSweep') player.anim.rogueComboNext = ((player.anim.rogueComboNext || 0) + 1) % 5;
    return ok;
  }
  const altAttack = () => triggerAttack(cls.alt);
  api.on(view.canvas, 'mousemove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; });
  api.on(view.canvas, 'mousedown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; e.preventDefault();
    if (e.button === 2) altAttack(); else mainAttack();
  });
  api.on(view.canvas, 'contextmenu', e => e.preventDefault());

  api.on(window, 'keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'f2' || k === ';') { debug.enabled = !debug.enabled; e.preventDefault(); return; }
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
  let state, li, player, hero, cam, coinsLeft, totalCoins, runCoins, runTime, deaths, particles, flagWave, slashTrail, projectiles, droppedKnives, boxes, dummies, fighters;
  let cls = CLASSES[0];   // selected class
  let freeze = 0, lastMoveAmt = 0, shakeT = 0, shakeP = 0;   // hit-stop, last anim amount, camera impact
  const debug = {
    enabled: query.has('debug'),
    segments: [], body: true, weapons: true, projectiles: true, dummies: true, coins: true,
  };

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: 1,
      team: 'hero', intent: input, cls: null,
      grounded: false, coyote: 0, jumpCut: false, airTime: 0, rogueAirJump: false, invuln: 0, knifeAmmo: ROGUE_MAX_KNIVES, knifeRegen: 0, forceCrouch: false,
      move: { active: false, type: null, t: 0, dur: 0, struck: false, phase: 'idle', spec: DEFAULT_MOTION },
      flip: { active: false, t: 0, dur: 0, dir: 1 },
      anim: { phase: 0, lean: 0, leanV: 0, squash: 0, air: 0, atkActive: false, atkType: null, atkT: 0,
              struck: false, struck2: false, headLag: 0, headLagV: 0, aimShown: 0, aimShownV: 0, aimTarget: 0, atkAim: 0, lastFacing: 0, fly: 0, _dt: 0.016,
              atkVar: 0, rogueHand: 0, rogueHandNext: 0, rogueComboNext: 0, atkDur: 320, atkPhase: 'idle', action: null,
              bhx: null, bhy: null, bhxV: 0, bhyV: 0, whx: null, why: null, whxV: 0, whyV: 0,
              shAng: 0, shAngV: 0, elAng: 0, elAngV: 0, blAng: 0, blAngV: 0 },
    };
  }
  function loadLevel(i, keepRun) {
    li = i;
    const L = levels[i];
    player = makePlayer(L.spawn);
    player.cls = cls; hero = player;       // the human is just the "hero" actor
    coinsLeft = L.coins.map(c => ({ x: c[0], y: c[1], got: false }));
    totalCoins = coinsLeft.length;
    cam = { x: 0, y: 0 };
    particles = [];
    slashTrail = [];
    projectiles = [];
    droppedKnives = [];
    boxes = (L.boxes || []).map(b => ({ x: b[0], y: b[1] - 14, w: 44, h: 44, vx: 0, vy: 0, angle: 0, va: 0, m: 1.6 }));
    dummies = (L.dummies || [[L.spawn.x + 210, L.spawn.y]]).map(p => makeDummy(p[0], p[1]));
    // enemies are full class fighters (see makeFighter); a legacy [x,y,min,max,hp]
    // array still works and defaults to a knight.
    fighters = (L.enemies || []).map(e => {
      const s = Array.isArray(e) ? { x: e[0], y: e[1], min: e[2], max: e[3], hp: e[4] } : e;
      return makeFighter(s.cls || 'knight', s.x, s.y, { min: s.min, max: s.max, hp: s.hp, facing: s.facing });
    });
    flagWave = 0; freeze = 0;
    if (!keepRun) { runCoins = 0; runTime = 0; deaths = 0; }
    centerCam(true);
    syncHud();
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function addShake(power, dur) {
    shakeP = Math.max(shakeP, power);
    shakeT = Math.max(shakeT, dur);
  }

  function timelinePhase(spec, t) {
    const p = spec.phases || DEFAULT_ATTACK.phases;
    if (t < p.anticipation[1]) return 'anticipation';
    if (t < p.active[1]) return t >= p.active[0] ? 'active' : 'commit';
    return 'recovery';
  }
  function phaseAmount(spec, name, t) {
    const p = spec.phases && spec.phases[name];
    if (!p) return 0;
    return clamp((t - p[0]) / Math.max(0.001, p[1] - p[0]), 0, 1);
  }
  function attackDuration(type) {
    const spec = attackSpec(type);
    return ((cls.dur && cls.dur[type]) || spec.dur || 320) * (spec.durScale || 1);
  }
  function startAttackAction(type) {
    const spec = attackSpec(type), dur = attackDuration(type);
    return { type, spec, t: 0, dur, phase: 'anticipation', active: false, recovery: 0 };
  }
  function startMotion(type, dur) {
    const spec = motionSpec(type);
    return { active: true, type, t: 0, dur, struck: false, spec, phase: 'anticipation' };
  }
  function currentActionLayer() {
    const a = player && player.anim;
    if (!a || !a.atkActive) return { active: false, type: null, t: 0, phase: 'idle', spec: DEFAULT_ATTACK, commit: 0, activeAmt: 0, recovery: 0 };
    const spec = a.action ? a.action.spec : attackSpec(a.atkType);
    const t = clamp(a.atkT, 0, 1);
    return {
      active: true,
      type: a.atkType,
      t,
      phase: timelinePhase(spec, t),
      spec,
      commit: Math.sin(phaseAmount(spec, 'anticipation', t) * Math.PI * 0.5),
      activeAmt: Math.sin(phaseAmount(spec, 'active', t) * Math.PI),
      recovery: phaseAmount(spec, 'recovery', t),
    };
  }
  function rememberDebugSegment(kind, ax, ay, bx, by, r, color, life) {
    if (!debug.enabled) return;
    debug.segments.push({ kind, ax, ay, bx, by, r: r || 2, color: color || '#ff405f', life: life || 220, max: life || 220 });
    if (debug.segments.length > 80) debug.segments.shift();
  }

  function syncHud() {
    if (player && player.team === 'enemy') return;   // enemy actions never touch the human HUD
    document.getElementById('sr-lvl').textContent = li + 1;
    document.getElementById('sr-lvls').textContent = levels.length;
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
    if (li + 1 < levels.length) {
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
  function actorPosture(act) {
    const m = act.move && act.move.active ? act.move : null;
    const mt = m ? clamp(m.t, 0, 1) : 0;
    const slide = m && m.type === 'slide' ? Math.sin(mt * Math.PI) : 0;
    const shoulder = m && (m.type === 'shoulder' || m.type === 'shieldStep' || m.type === 'brace') ? Math.sin(mt * Math.PI) : 0;
    const sweep = act.anim && act.anim.atkActive && act.anim.atkType === 'legSweep' ? Math.sin(clamp(act.anim.atkT, 0, 1) * Math.PI) : 0;
    const forcedDown = act.forceCrouch && act.grounded && !slide ? 1 : 0;
    const down = ((act.intent && act.intent.down && act.grounded && !slide) || forcedDown) ? 1 : 0;
    const crouch = clamp(Math.max(down * 0.72, slide, sweep * 0.88), 0, 1);
    return {
      crouch, down, slide, sweep, shoulder,
      drop: Math.max(down * 17, slide * 28, sweep * 22, shoulder * 5),
      lean: -act.facing * (down * 0.16 + slide * 0.72 + sweep * 0.42) + act.facing * shoulder * 0.16,
      w: PW + slide * 28 + sweep * 18 + shoulder * 8,
      h: PH - Math.max(down * 15, slide * 24, sweep * 20),
      ox: act.facing * (slide * 9 + sweep * 7 + shoulder * 4),
    };
  }
  function actorBox(act) {
    const p = actorPosture(act);
    return { x: act.x + p.ox - p.w / 2, y: act.y - p.h, w: p.w, h: p.h, posture: p };
  }
  function actorStandingBox(act) {
    return { x: act.x - PW / 2, y: act.y - PH, w: PW, h: PH };
  }
  function box() { return actorBox(player); }
  function actorHeight(act) { return actorBox(act).h; }
  function resolveActorSide(act, solid) {
    const b = actorBox(act);
    if (act.vx > 0) act.x += solid.x - (b.x + b.w);
    else if (act.vx < 0) act.x += solid.x + solid.w - b.x;
  }
  function hit(b, p) { return b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y; }
  function solidHitsBox(r) {
    const L = levels[li];
    for (const p of L.platforms) if (hit(r, p)) return true;
    for (const b of boxes) if (hit(r, b)) return true;
    return false;
  }
  function updateCrouchConstraint(act) {
    if (!act || !act.grounded) { if (act) act.forceCrouch = false; return; }
    const sliding = act.move && act.move.active && act.move.type === 'slide';
    const sweeping = act.anim && act.anim.atkActive && act.anim.atkType === 'legSweep';
    if (sliding || sweeping || act.intent && act.intent.down) { act.forceCrouch = false; return; }
    act.forceCrouch = solidHitsBox(actorStandingBox(act));
  }
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
  function visualHoverOffset() {
    const a = player && player.anim, S = cls && cls.style;
    return a && S ? (a.fly || 0) * (S.hover || 0) : 0;
  }

  // dynamic crates: gravity, terrain + box-box collision, friction, bounce, and SPIN
  function updateBoxes() {
    const L = levels[li];
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
      if (b.y > L.h + 300) { b.y = -40; b.x = L.spawn.x + 200; b.vy = b.vx = b.va = 0; b.angle = 0; }
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
    if (player.team === 'enemy') {
      if (hero && !(hero.invuln > 0) && segHitActor(ix, iy, ix, iy, 32, hero)) hurtHero(dx, dy, force, ix, iy);
    } else {
      if (dummies) for (const d of dummies) { const n = dummyNearest(d, ix, iy); if (n.p && n.d < 42) hurtDummy(d, dx, dy, force, ix, iy); }
      if (fighters) for (const e of fighters.slice()) { const h = segHitActor(ix, iy, ix, iy, 32, e); if (h) hurtFighter(e, dx, dy, force, h.x, h.y); }
    }
  }
  function hitBoxesSegment(ax, ay, bx, by, dx, dy, force, radius) {
    const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy) || 1;
    const nx = dx == null ? sx / sl : dx, ny = dy == null ? sy / sl : dy;
    rememberDebugSegment('ability', ax, ay, bx, by, radius || 10, '#ffb020', 220);
    for (const b of boxes) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const p = closestPointOnSeg(cx, cy, ax, ay, bx, by);
      if (pointAabbDist(p.x, p.y, b) <= radius) pushBox(b, nx, ny, force);
    }
    if (player.team === 'enemy') {
      if (hero && !(hero.invuln > 0)) { const h = segHitActor(ax, ay, bx, by, radius, hero); if (h) hurtHero(nx, ny, force, h.x, h.y); }
    } else {
      hitDummiesSegment(ax, ay, bx, by, nx, ny, force, radius);
      if (fighters) for (const e of fighters.slice()) { const h = segHitActor(ax, ay, bx, by, radius, e); if (h) hurtFighter(e, nx, ny, force, h.x, h.y); }
    }
  }
  function projectileHitsBox(p, ax, ay, b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const q = closestPointOnSeg(cx, cy, ax, ay, p.x, p.y);
    const r = projectileRadius(p);
    return pointAabbDist(q.x, q.y, b) <= r;
  }
  function projectileRadius(p) {
    return p.kind === 'dagger' || p.kind === 'arrow' ? 4.5 : p.r || 8;
  }
  function projectileHitsDummy(p, ax, ay, d) {
    const r = projectileRadius(p) + 13;
    let best = null, bd = Infinity;
    for (const k in d.pts) {
      const pt = d.pts[k];
      if (pt.pin) continue;
      const q = closestPointOnSeg(pt.x, pt.y, ax, ay, p.x, p.y);
      const dd = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (dd < bd) { bd = dd; best = pt; }
    }
    return bd <= r ? { p: best, d: bd } : null;
  }
  // body collision capsules (torso, head, two legs) for ANY actor — the basis for
  // coin pickup, enemy hits on the hero, and the hero's hits on enemy fighters.
  function actorCapsules(act) {
    const S = act.cls.style, post = actorPosture(act), hov = (act.anim.fly || 0) * (S.hover || 0);
    const baseY = act.y - hov, hip = { x: act.x - act.facing * post.slide * 7, y: baseY - S.hipH + post.drop };
    const lean = (act.anim.lean || 0) + post.lean;
    const upX = Math.sin(lean) * act.facing, upY = -Math.cos(lean);
    const sh = { x: hip.x + upX * 30, y: hip.y + upY * 30 };
    const legSpread = 9 + post.slide * 20 + post.sweep * 16;
    const backLeg = -act.facing * (9 + post.slide * 30);
    const frontLeg = act.facing * legSpread;
    return [
      { ax: sh.x, ay: sh.y, bx: hip.x, by: hip.y, r: 8 },
      { ax: sh.x, ay: sh.y - 16, bx: sh.x, by: sh.y - 16, r: 13 },
      { ax: hip.x - act.facing * 4, ay: hip.y, bx: act.x + backLeg, by: baseY - post.slide * 2, r: 5 },
      { ax: hip.x + act.facing * 4, ay: hip.y, bx: act.x + frontLeg, by: baseY - post.sweep * 5, r: 5 },
    ];
  }
  function bodyCapsules() { return actorCapsules(player); }
  function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }
  function onSeg(ax, ay, bx, by, px, py) {
    const eps = 0.0001;
    return Math.abs(orient(ax, ay, bx, by, px, py)) <= eps &&
      px >= Math.min(ax, bx) - eps && px <= Math.max(ax, bx) + eps &&
      py >= Math.min(ay, by) - eps && py <= Math.max(ay, by) + eps;
  }
  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const o1 = orient(ax, ay, bx, by, cx, cy);
    const o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay);
    const o4 = orient(cx, cy, dx, dy, bx, by);
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
    return onSeg(ax, ay, bx, by, cx, cy) || onSeg(ax, ay, bx, by, dx, dy) ||
      onSeg(cx, cy, dx, dy, ax, ay) || onSeg(cx, cy, dx, dy, bx, by);
  }
  // closest distance between two 2D segments. Crossing segments are distance 0;
  // otherwise the minimum is one endpoint projected onto the opposite segment.
  function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
      pointSegDist(ax, ay, cx, cy, dx, dy), pointSegDist(bx, by, cx, cy, dx, dy),
      pointSegDist(cx, cy, ax, ay, bx, by), pointSegDist(dx, dy, ax, ay, bx, by));
  }
  // does a blade/projectile segment (radius r) strike an actor's body? returns the
  // closest contact point on the body, or null.
  function segHitActor(ax, ay, bx, by, r, act) {
    let best = null, bd = Infinity;
    for (const c of actorCapsules(act)) {
      const d = segSegDist(ax, ay, bx, by, c.ax, c.ay, c.bx, c.by);
      if (d <= (r || 10) + c.r && d < bd) {
        bd = d;
        const mid = closestPointOnSeg((c.ax + c.bx) / 2, (c.ay + c.by) / 2, ax, ay, bx, by);
        best = { x: (mid.x + (c.ax + c.bx) / 2) / 2, y: (mid.y + (c.ay + c.by) / 2) / 2 };
      }
    }
    return best;
  }
  function coinTouchesPlayer(c) {
    const coinR = 9, pad = 2;
    return bodyCapsules().some(s => pointSegDist(c.x, c.y, s.ax, s.ay, s.bx, s.by) <= s.r + coinR + pad);
  }
  function pushBoxesRadial(x, y, force, radius, team) {
    team = team || (player ? player.team : 'hero');
    for (const b of boxes) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < radius) pushBox(b, (cx - x) / (d || 1), (cy - y) / (d || 1), force * (1 - d / radius));
    }
    if (team === 'enemy') {
      if (hero && !(hero.invuln > 0)) {
        const d = Math.hypot(hero.x - x, (hero.y - 40) - y);
        if (d < radius + 20) hurtHero((hero.x - x) / (d || 1), ((hero.y - 40) - y) / (d || 1), force * (1 - d / (radius + 20)), hero.x, hero.y - 30);
      }
    } else {
      if (dummies) for (const d of dummies) {
        const n = dummyNearest(d, x, y);
        if (n.p && n.d < radius + 16) hurtDummy(d, (n.p.x - x) / (n.d || 1), (n.p.y - y) / (n.d || 1), force * (1 - n.d / (radius + 16)), n.p.x, n.p.y);
      }
      if (fighters) for (const e of fighters.slice()) {
        const d = Math.hypot(e.x - x, (e.y - 44) - y);
        if (d < radius + 20) hurtFighter(e, (e.x - x) / (d || 1), ((e.y - 44) - y) / (d || 1), force * (1 - d / (radius + 20)), e.x, e.y - 44);
      }
    }
  }

  // ===========================================================================
  // ENEMY TRAINING DUMMY — verlet ragdoll
  // A jointed stick body of point-masses connected by distance-constraint bones.
  // The feet are PINNED to the ground (sticky feet); everything above hangs and
  // swings under gravity (floppy joints). A weak "muscle" pulls only the spine &
  // legs back toward an upright rest pose, so it self-rights but stays loose.
  // Hits apply an impulse at the ACTUAL impact point on the body, so a blow to
  // the head, an arm or the gut whips that part and propagates through the rest.
  // ===========================================================================
  // proportions match the hero exactly (thigh/shin 24, torso 30, uArm/fArm ~18/16,
  // headR 12), so the dummy is a clone of the character — the base for real enemies.
  const DUMMY = { headR: 12 };
  const DUMMY_REST = {                         // offsets from the foot anchor (y up = negative)
    footL: [-8, 0], footR: [8, 0],
    kneeL: [-8, -24], kneeR: [8, -24],
    hip: [0, -48], chest: [0, -78], head: [0, -94],
    elbowL: [-11, -64], handL: [-13, -48], elbowR: [11, -64], handR: [13, -48],
  };
  const DUMMY_BONES = [
    ['footL', 'kneeL'], ['kneeL', 'hip'], ['footR', 'kneeR'], ['kneeR', 'hip'],
    ['hip', 'chest'], ['chest', 'head'],
    ['chest', 'elbowL'], ['elbowL', 'handL'], ['chest', 'elbowR'], ['elbowR', 'handR'],
  ];
  const DUMMY_LIMBS = [                         // drawn as 2-segment limbs (root, joint, tip, width)
    ['hip', 'kneeL', 'footL', 7], ['hip', 'kneeR', 'footR', 7],
    ['chest', 'elbowL', 'handL', 6], ['chest', 'elbowR', 'handR', 6],
  ];
  // muscle = how strongly each joint is pulled back to its upright rest pose
  // (an "active ragdoll"). Core & legs are stiff so it STANDS; arms & head are
  // soft so they stay floppy and fling when hit, then ease back.
  const DUMMY_MUSCLE = {
    hip: 0.26, chest: 0.20, head: 0.11, kneeL: 0.22, kneeR: 0.22,
    elbowL: 0.06, handL: 0.05, elbowR: 0.06, handR: 0.05,
  };
  const DG = 0.48, DDAMP = 0.985, DSOLVE = 6;
  function makeDummy(x, y, opts) {
    opts = opts || {};
    const pts = {};
    for (const k in DUMMY_REST) {
      const wx = x + DUMMY_REST[k][0], wy = y + DUMMY_REST[k][1];
      pts[k] = { x: wx, y: wy, px: wx, py: wy, pin: k === 'footL' || k === 'footR' };
    }
    const bones = DUMMY_BONES.map(([a, b]) => [a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y)]);
    return {
      baseX: x, baseY: y, homeX: x, pts, bones, flash: 0,
      kind: opts.kind || 'dummy',
      patrolMin: opts.patrolMin == null ? x - 90 : opts.patrolMin,
      patrolMax: opts.patrolMax == null ? x + 90 : opts.patrolMax,
      dir: opts.dir || (Math.random() < 0.5 ? -1 : 1),
      hp: opts.hp || 1,
      attackCd: 0,
      defeated: false,
    };
  }
  function updateDummies(dt) {
    if (!dummies) return;
    const steps = Math.max(1, Math.round(dt / 16.7));    // keep verlet stable if dt is large
    for (const d of dummies) {
      d.flash = Math.max(0, d.flash - dt);
      updateEnemyAI(d, dt);
      for (let s = 0; s < steps; s++) dummyStep(d);
    }
  }
  function updateEnemyAI(d, dt) {
    if (!player || state !== 'playing' || d.kind !== 'enemy' || d.defeated) return;
    d.attackCd = Math.max(0, d.attackCd - dt);
    const dx = player.x - d.baseX, dy = player.y - d.baseY;
    const sees = Math.abs(dx) < 270 && Math.abs(dy) < 95;
    if (sees && Math.abs(dx) > 10) d.dir = dx > 0 ? 1 : -1;
    const speed = sees ? 0.72 : 0.34;
    d.baseX = clamp(d.baseX + d.dir * speed, d.patrolMin, d.patrolMax);
    if (!sees && (d.baseX <= d.patrolMin + 1 || d.baseX >= d.patrolMax - 1)) d.dir *= -1;
    const n = dummyNearest(d, player.x, player.y - 36);
    if (n.p && n.d < 34 && d.attackCd <= 0 && (!player.invuln || player.invuln <= 0)) {
      d.attackCd = 850;
      bumpPlayerFromEnemy(d);
    }
  }
  function bumpPlayerFromEnemy(d) {
    const dir = player.x >= d.baseX ? 1 : -1;
    player.invuln = 700;
    player.vx += dir * 5.2;
    player.vy = Math.min(player.vy, -4.0);
    player.grounded = false;
    player.anim.squash = -0.34;
    freeze = Math.max(freeze, 12);
    addShake(3.4, 120);
    burst(player.x, player.y - 34, '#ff5a5a', 14, 3.4);
  }
  function dummyStep(d) {
    const groundY = d.baseY;
    // integrate
    for (const k in d.pts) {
      const p = d.pts[k];
      if (p.pin) { p.x = d.baseX + DUMMY_REST[k][0]; p.y = groundY; p.px = p.x; p.py = p.y; continue; }
      const vx = (p.x - p.px) * DDAMP, vy = (p.y - p.py) * DDAMP;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + DG;
    }
    // muscles pull the spine & legs toward the upright rest pose (self-righting)
    for (const k in DUMMY_MUSCLE) {
      const p = d.pts[k];
      const m = d.defeated ? DUMMY_MUSCLE[k] * 0.08 : DUMMY_MUSCLE[k];
      p.x += (d.baseX + DUMMY_REST[k][0] - p.x) * m;
      p.y += (d.baseY + DUMMY_REST[k][1] - p.y) * m;
    }
    // satisfy bone lengths + pins + floor
    for (let it = 0; it < DSOLVE; it++) {
      for (const [a, b, len] of d.bones) {
        const pa = d.pts[a], pb = d.pts[b];
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dd = Math.hypot(dx, dy) || 1;
        const diff = (dd - len) / dd;
        const wa = pa.pin ? 0 : (pb.pin ? 1 : 0.5), wb = pb.pin ? 0 : (pa.pin ? 1 : 0.5);
        pa.x += dx * diff * wa; pa.y += dy * diff * wa;
        pb.x -= dx * diff * wb; pb.y -= dy * diff * wb;
      }
      for (const k in d.pts) {
        const p = d.pts[k];
        if (p.pin) { p.x = d.baseX + DUMMY_REST[k][0]; p.y = groundY; }
        else if (p.y > groundY) { p.y = groundY; p.px = p.x + (p.x - p.px) * 0.4; }   // floor + a little slide friction
      }
    }
  }
  function dummyNearest(d, x, y) {
    let best = null, bd = Infinity;
    for (const k in d.pts) { const p = d.pts[k]; if (p.pin) continue; const dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p; } }
    return { p: best, d: bd };
  }
  // apply an impulse AT a point on the body (displacing a verlet node = giving it velocity)
  function hurtDummy(d, nx, ny, force, hx, hy) {
    const k = clamp(force, 4, 44);
    nx = nx || 0; ny = ny || 0;
    const near = dummyNearest(d, hx, hy);
    if (!near.p) return;
    const imp = k * 0.85;
    near.p.x += nx * imp + rand(-1, 1); near.p.y += ny * imp - k * 0.12 + rand(-1, 1);
    // a softer share to every other joint so the whole body reacts to the blow
    for (const key in d.pts) {
      const p = d.pts[key]; if (p.pin || p === near.p) continue;
      const dist = Math.hypot(p.x - hx, p.y - hy) + 8, f2 = k * 0.9 / dist;
      p.x += nx * f2; p.y += ny * f2;
    }
    d.flash = 200;
    if (d.kind === 'enemy' && !d.defeated) {
      d.hp -= Math.max(0.5, k / 16);
      if (d.hp <= 0) {
        d.defeated = true;
        d.flash = 650;
        d.attackCd = 9999;
        for (const foot of ['footL', 'footR']) d.pts[foot].pin = false;
        burst(hx, hy, '#ff5a5a', 26, 5.2);
        addShake(4.5, 150);
      }
    }
    burst(hx, hy, '#ffd089', Math.min(18, 6 + (k | 0)), 4.2);
    burst(hx, hy, '#d9534f', 8, 3.2);
    freeze = Math.max(freeze, Math.min(18, 6 + k * 0.28));
  }
  function hitDummiesSegment(ax, ay, bx, by, nx, ny, force, radius) {
    if (!dummies) return;
    for (const d of dummies) {
      // find the body point the blade passes closest to — that's where it lands
      let best = null, bd = Infinity;
      for (const k in d.pts) {
        const p = d.pts[k], cp = closestPointOnSeg(p.x, p.y, ax, ay, bx, by);
        const dd = Math.hypot(cp.x - p.x, cp.y - p.y);
        if (dd < bd) { bd = dd; best = p; }
      }
      if (best && bd <= (radius || 10) + 12) hurtDummy(d, nx, ny, force, best.x, best.y);
    }
  }
  function drawDummy(d) {
    const P = k => ({ x: d.pts[k].x - cam.x, y: d.pts[k].y - cam.y });
    const hot = clamp(d.flash / 200, 0, 1);
    const enemy = d.kind === 'enemy';
    const ink = d.defeated ? '#6a6360' : hot > 0.02 ? '#a9544b' : enemy ? '#2c1618' : INK;
    const fL = P('footL'), fR = P('footR'), midX = (fL.x + fR.x) / 2, baseY = Math.max(fL.y, fR.y);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!enemy || !d.defeated) {
      ctx.fillStyle = enemy ? '#7a2d32' : '#5a4d3d';
      ctx.beginPath(); ctx.moveTo(midX - 17, baseY + 3); ctx.lineTo(midX + 17, baseY + 3);
      ctx.lineTo(midX + 9, baseY - 7); ctx.lineTo(midX - 9, baseY - 7); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    for (const [a, j, b, w] of DUMMY_LIMBS) { const pa = P(a), pj = P(j), pb = P(b); seg(pa.x, pa.y, pj.x, pj.y, pb.x, pb.y, w); }
    const hip = P('hip'), chest = P('chest'), head = P('head');
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();   // torso
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(chest.x, chest.y); ctx.lineTo(head.x, head.y); ctx.stroke(); // neck
    ctx.beginPath(); ctx.arc(head.x, head.y, DUMMY.headR, 0, Math.PI * 2); ctx.fill();
    if (enemy && !d.defeated) {
      ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2;
      const dir = d.dir || 1;
      ctx.beginPath(); ctx.moveTo(head.x + dir * 2, head.y - 2); ctx.lineTo(head.x + dir * 8, head.y - 2); ctx.stroke();
    }
    const tx = lerp(hip.x, chest.x, 0.55), ty = lerp(hip.y, chest.y, 0.55);
    ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.fillStyle = '#e7e0d2'; ctx.fill();
    ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fillStyle = enemy ? '#ff5a5a' : hot > 0.02 ? '#ff5436' : '#c2452f'; ctx.fill();
    ctx.restore();
  }

  // ===========================================================================
  // ENEMY FIGHTERS — full class actors driven by AI
  // An enemy is the SAME kind of actor as the hero (position, velocity, anim,
  // class). We reuse the entire animation + attack engine by temporarily
  // rebinding the `player`/`cls` singletons to a fighter while we think/step/draw
  // it (withActor). Each class gets a movement brain that decides how to close,
  // space, kite or retreat, and which abilities to use. On death the fighter
  // hands its pose off to the verlet ragdoll for the floppy collapse.
  // ===========================================================================
  function withActor(act, fn) {                 // run engine code as if `act` were the player
    const sp = player, sc = cls;
    player = act; cls = act.cls;
    try { return fn(); } finally { player = sp; cls = sc; }
  }
  function enemyDefaultHp(id) { return id === 'lancer' ? 6 : id === 'knight' ? 5 : 3; }
  function enemyAggro(id) { return (id === 'mage' || id === 'ranger') ? 340 : id === 'rogue' ? 300 : id === 'lancer' ? 260 : 240; }
  function makeFighter(clsId, x, y, opts) {
    opts = opts || {};
    const cdef = CLASSES.find(c => c.id === clsId) || CLASSES[0];
    const e = makePlayer({ x, y });
    e.cls = cdef; e.team = 'enemy';
    e.intent = { left: false, right: false, down: false, jumpHeld: false, jump: false };
    e.facing = opts.facing || (Math.random() < 0.5 ? -1 : 1);
    e.flash = 0; e.dead = false; e._moveAmt = 0;
    e.maxHp = opts.hp || enemyDefaultHp(clsId); e.hp = e.maxHp;
    e.patrolMin = opts.min == null ? x - 120 : opts.min;
    e.patrolMax = opts.max == null ? x + 120 : opts.max;
    e.brain = {
      dir: e.facing, atkCd: rand(300, 900), moveCd: rand(200, 700), stagger: 0, alert: 0, retreat: 0,
      jumpCd: rand(0, 300), combo: 0, aggroRange: enemyAggro(clsId), tgt: null, pauseT: rand(0, 800),
    };
    return e;
  }
  function surfaceYFor(act, x, maxDrop, maxRise) {
    const L = levels[li], bottom = act.y + (maxDrop == null ? 120 : maxDrop), top = act.y - (maxRise == null ? 8 : maxRise);
    let y = Infinity;
    for (const p of L.platforms) if (x > p.x - 14 && x < p.x + p.w + 14 && p.y >= top && p.y <= bottom) y = Math.min(y, p.y);
    for (const b of boxes) if (x > b.x - 14 && x < b.x + b.w + 14 && b.y >= top && b.y <= bottom) y = Math.min(y, b.y);
    return y === Infinity ? null : y;
  }
  function solidProbe(r) {
    return solidHitsBox(r);
  }
  function fighterNavProbe(e, dir) {
    const b = actorBox(e), cur = surfaceYFor(e, e.x, 64, 12);
    const near = surfaceYFor(e, e.x + dir * 38, 82, 16);
    const far = surfaceYFor(e, e.x + dir * 88, 136, 30);
    const probe = { x: dir > 0 ? b.x + b.w : b.x - 7, y: b.y + 9, w: 7, h: Math.max(16, b.h - 18) };
    return {
      blocked: solidProbe(probe),
      cur, near, far,
      gap: cur !== null && near === null && far !== null && Math.abs(far - cur) < 62,
      ledge: cur !== null && near === null && far === null,
      stepUp: cur !== null && near !== null && near < cur - 12,
      drop: cur !== null && near !== null && near > cur + 34,
    };
  }
  // movement intent helpers (leashed so enemies don't wander off their platform)
  function pressToward(e, dir) {
    const it = e.intent, lo = e.patrolMin - 80, hi = e.patrolMax + 80;
    const nav = e.grounded ? fighterNavProbe(e, dir) : null;
    if (nav && nav.ledge) return;
    if (dir > 0 && e.x < hi) it.right = true; else if (dir < 0 && e.x > lo) it.left = true;
  }
  function patrolFighter(e) {                    // unaware: amble between patrol bounds with pauses
    const b = e.brain;
    if (b.pauseT > 0) { b.pauseT -= STEP; e.facing = b.dir; return; }
    if (b.tgt == null || Math.abs(e.x - b.tgt) < 8) { b.tgt = rand(e.patrolMin, e.patrolMax); b.pauseT = rand(300, 1200); b.dir = b.tgt >= e.x ? 1 : -1; return; }
    pressToward(e, b.tgt > e.x ? 1 : -1);
  }
  function planFighterMobility(e, n) {
    const b = e.brain, it = e.intent, nav = n.nav;
    if (e.cls.fly) {
      it.jumpHeld = b.alert > 0 && (n.dy < 80 || n.adx < 260);
      return;
    }
    if (e.grounded && b.jumpCd <= 0) {
      const chaseUp = n.dy < -34 && n.adx < 230;
      if (chaseUp || nav.blocked || nav.stepUp || nav.gap) {
        it.jump = true;
        b.jumpCd = nav.gap ? 520 : 360;
      }
    } else if (e.cls.id === 'rogue' && !e.rogueAirJump && b.jumpCd <= 0 && n.dy < -28 && n.adx < 210) {
      it.jump = true;                            // Rogue enemy spends its double-jump to follow upward
      b.jumpCd = 520;
    }
  }
  // per-class engagement: how each archetype fights. `n` = {adx, face, aim, dy}.
  const ENEMY_BRAINS = {
    knight(e, n) {                               // press in, trade blows, shield up close
      const b = e.brain;
      if (n.adx > 60) {
        pressToward(e, n.face);
        if ((n.adx < 165 || n.nav.blocked || n.nav.stepUp) && b.moveCd <= 0 && Math.random() < 0.55) { triggerMove(); b.moveCd = rand(1150, 1900); }
      } else if (b.atkCd <= 0) {
        const bash = n.adx < 42 || Math.random() < 0.25;
        triggerAttack(bash ? 'shieldBash' : 'slash', { aim: n.aim });
        b.atkCd = bash ? 760 : rand(540, 820);
      }
    },
    rogue(e, n) {                                // hit-and-run: dart in, combo, dagger poke, peel off
      const b = e.brain;
      if (b.retreat > 0) { pressToward(e, -n.face); return; }
      if (n.adx > 48) {
        pressToward(e, n.face);
        if (n.adx > 170 && e.knifeAmmo > 0 && b.atkCd <= 0) { triggerAttack('throw', { aim: n.aim }); b.atkCd = rand(560, 900); }
        else if (n.adx < 175 && b.moveCd <= 0 && Math.random() < 0.72) { triggerMove(); b.moveCd = rand(760, 1280); }
      } else if (b.atkCd <= 0) {
        const type = (b.combo % 4 === 3 || n.dy > 16 && Math.random() < 0.35) ? 'legSweep' : (b.combo % 3 === 2) ? 'rogueStab' : 'dualSlash';
        e.intent.down = type === 'legSweep';
        triggerAttack(type, { aim: n.aim });
        b.combo++; b.atkCd = rand(230, 360);
        if (b.combo % 3 === 0) b.retreat = rand(420, 720);
      }
    },
    lancer(e, n) {                               // spacing control: hold the hero at spear tip, charge gaps
      const b = e.brain;
      if (n.adx > 104) {
        pressToward(e, n.face);
        if (n.adx < 260 && b.moveCd <= 0 && Math.random() < 0.46) { triggerAttack('lanceCharge', { aim: n.aim }); b.atkCd = 1000; b.moveCd = rand(1450, 2300); }
      } else if (n.adx < 58) { pressToward(e, -n.face); }   // too close — back to range
      else if (b.atkCd <= 0) { triggerAttack('braceThrust', { aim: n.aim }); b.atkCd = rand(900, 1300); }
    },
    mage(e, n) {                                 // floats and kites, raining bolts; blooms up close
      const b = e.brain;
      e.intent.jumpHeld = true;                  // hover
      if (n.adx < 190) { pressToward(e, -n.face); if (n.adx < 120 && b.moveCd <= 0) { triggerMove(); b.moveCd = rand(1300, 2000); } }
      else if (n.adx > 320) pressToward(e, n.face);
      if (b.atkCd <= 0) {
        const close = n.adx < 150;
        triggerAttack(close ? 'arcaneBloom' : 'cast', { aim: n.aim });
        b.atkCd = close ? 1150 : rand(620, 920);
      }
    },
    ranger(e, n) {                               // skirmisher: keep range, arrow/volley, backstep when crowded
      const b = e.brain;
      if (n.adx < 170) { pressToward(e, -n.face); if ((n.adx < 130 || n.nav.blocked) && b.moveCd <= 0) { triggerMove(); b.moveCd = rand(760, 1300); } }
      else if (n.adx > 300) pressToward(e, n.face);
      if (b.atkCd <= 0) {
        const t = (n.adx < 250 && Math.random() < 0.3) ? 'volley' : 'arrow';
        triggerAttack(t, { aim: n.aim });
        b.atkCd = t === 'volley' ? 950 : rand(440, 700);
      }
    },
  };
  function thinkFighter(e, dt) {                 // sets intent + triggers abilities (player === e)
    const b = e.brain, it = e.intent;
    b.atkCd = Math.max(0, b.atkCd - dt); b.moveCd = Math.max(0, b.moveCd - dt);
    b.jumpCd = Math.max(0, b.jumpCd - dt);
    b.stagger = Math.max(0, b.stagger - dt); b.alert = Math.max(0, b.alert - dt); b.retreat = Math.max(0, b.retreat - dt);
    it.left = it.right = it.down = it.jumpHeld = it.jump = false;
    if (b.stagger > 0) return;                   // reeling from a hit — drop guard, no input
    const atkLocked = e.anim.atkActive || (e.move && e.move.active);
    const dx = hero.x - e.x, adx = Math.abs(dx), face = dx >= 0 ? 1 : -1;
    const dy = hero.y - e.y;
    if (adx < b.aggroRange && Math.abs(hero.y - e.y) < 180) b.alert = 1500;
    if (!atkLocked) e.facing = face;
    e.anim.aimTarget = Math.atan2((hero.y - 44) - (e.y - 77), hero.x - e.x);
    if (b.alert <= 0) { patrolFighter(e); return; }
    if (atkLocked) return;                        // committed to a swing — let it finish
    const nav = fighterNavProbe(e, face);
    planFighterMobility(e, { dx, adx, dy, face, aim: e.anim.aimTarget, nav });
    (ENEMY_BRAINS[e.cls.id] || ENEMY_BRAINS.knight)(e, { dx, adx, dy, face, aim: e.anim.aimTarget, nav });
  }
  // trimmed locomotion/collision for an AI actor (player === e during this call)
  function stepActor(dtStep) {
    const p = player, L = levels[li], it = p.intent;
    const acc = p.grounded ? RUN_ACC : AIR_ACC;
    if (lancerAttackLocked()) p.vx *= 0.34;
    else if (it.left && !it.right) { p.vx -= acc; p.facing = -1; }
    else if (it.right && !it.left) { p.vx += acc; p.facing = 1; }
    else if (p.grounded) p.vx *= FRICTION;
    updateCrouchConstraint(p);
    updateClassMove();
    updateRogueFlip();
    updateAttackMotion();
    p.vx = clamp(p.vx, -maxV(), maxV());
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dtStep);
    const g = cls.gravityMul || 1;
    if (cls.fly && mageHovering()) {
      const surface = mageHoverSurface();
      p.vy = Math.min(p.vy + GRA * 0.12, TERMINAL * 0.38);
      if (surface !== null) { const ty = surface - MAGE_HOVER_HEIGHT; p.vy += clamp((ty - p.y) * 0.060, -1.05, 0.72); if (p.y > ty - 2 && p.vy > 0) p.vy *= 0.45; }
      else p.vy += clamp((-0.12 - p.vy) * 0.055, -0.24, 0.18);
      p.vy = clamp(p.vy, -4.2, 3.4);
    } else {
      if (it.jump && cls.id === 'rogue' && !p.grounded && p.coyote <= 0 && !p.rogueAirJump) {
        p.rogueAirJump = true;
        p.vy = JUMP * 0.78;
        p.vx += p.facing * 1.45;
        p.flip = { active: true, t: 0, dur: 520, dir: p.facing };
        p.anim.squash = -0.35;
        burst(p.x, p.y - 34, cls.color, 8, 2.2);
      } else if (it.jump && (p.grounded || p.coyote > 0)) {
        p.vy = JUMP; p.grounded = false; p.coyote = 0; p.jumpCut = false; p.anim.squash = -0.5;
      }
      p.vy = Math.min(p.vy + GRA * g, TERMINAL * g);
    }
    p.x += p.vx;
    for (const pl of L.platforms) if (hit(box(), pl)) { if (mageHoverStepOver(pl)) continue; resolveActorSide(p, pl); p.vx = 0; }
    for (const bx of boxes) if (hit(box(), bx)) {
      if (mageHoverStepOver(bx)) continue;
      const b = box();
      if (p.vx > 0) { bx.x = b.x + b.w; bx.vx = Math.max(bx.vx, (p.vx * 0.85 + 0.6) / bx.m); p.vx *= 0.5; }
      else if (p.vx < 0) { bx.x = b.x - bx.w; bx.vx = Math.min(bx.vx, (p.vx * 0.85 - 0.6) / bx.m); p.vx *= 0.5; }
    }
    p.y += p.vy; p.grounded = false;
    for (const pl of L.platforms) if (hit(box(), pl)) { if (p.vy > 0) { p.y = pl.y; p.grounded = true; } else if (p.vy < 0) p.y = pl.y + pl.h + actorHeight(p); if (p.vy > 6) p.anim.squash = clamp(p.vy / TERMINAL, 0, 1) * 0.9; p.vy = 0; }
    for (const bx of boxes) if (hit(box(), bx)) { if (p.vy > 0 && (p.y - p.vy) <= bx.y + 8) { p.y = bx.y; p.grounded = true; p.vy = 0; } else if (p.vy < 0 && (p.y - actorHeight(p) - p.vy) >= bx.y + bx.h - 8) { p.y = bx.y + bx.h + actorHeight(p); p.vy = 0; bx.vy += 1; } }
    if (cls.fly && mageHovering()) { const surface = mageHoverSurface(); if (surface !== null) { const ty = surface - MAGE_HOVER_HEIGHT; if (p.y > ty) { p.y = lerp(p.y, ty, 0.55); p.vy = Math.min(p.vy, 0); } p.grounded = false; p.coyote = COYOTE; } }
    if (p.grounded) { p.coyote = COYOTE; p.airTime = 0; if (p.flip && p.flip.active) p.flip = { active: false, t: 0, dur: 0, dir: p.facing }; }
    else { if (p.coyote > 0) p.coyote--; p.airTime++; }
    updateRogueAmmo();
  }
  function updateFighters(dtStep) {
    if (!fighters || !fighters.length || state !== 'playing') return;
    const L = levels[li];
    for (let i = fighters.length - 1; i >= 0; i--) {
      const e = fighters[i];
      if (e.dead) { fighters.splice(i, 1); continue; }
      e.flash = Math.max(0, e.flash - dtStep);
      withActor(e, () => { thinkFighter(e, dtStep); stepActor(dtStep); });
      if (e.y - PH > L.h + 180) { burst(e.x, e.y, '#ff5a5a', 12, 3); fighters.splice(i, 1); }   // fell in a pit
    }
  }
  function animateFighters(dt) {
    if (!fighters) return;
    for (const e of fighters) e._moveAmt = withActor(e, () => animate(dt));
  }
  function drawFighters() {
    if (!fighters) return;
    for (const e of fighters) { withActor(e, () => drawStick(e._moveAmt || 0)); drawFighterHealth(e); }
  }
  function drawFighterHealth(e) {
    if (e.hp >= e.maxHp) return;
    const w = 30, x = e.x - w / 2, y = e.y - e.cls.style.hipH - 80 - (e.anim.fly || 0) * (e.cls.style.hover || 0);
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,0.32)'; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = e.cls.color; ctx.fillRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    ctx.restore();
  }
  // hero hits a fighter: knockback + stagger + damage; death hands off to ragdoll
  function hurtFighter(e, nx, ny, force, hx, hy) {
    if (e.dead) return;
    const k = clamp(force, 4, 44);
    e.vx += (nx || 0) * k * 0.55;
    e.vy = Math.min(e.vy + (ny || 0) * k * 0.25, -1.0 - k * 0.05);
    e.grounded = false; e.anim.squash = -0.3; e.flash = 180;
    e.brain.stagger = Math.max(e.brain.stagger, 200); e.brain.alert = 2200; e.brain.retreat = 0;
    e.hp -= Math.max(0.6, k / 14);
    burst(hx, hy, '#ffd089', Math.min(16, 6 + (k | 0)), 4); burst(hx, hy, '#d9534f', 7, 3);
    freeze = Math.max(freeze, Math.min(14, 5 + k * 0.22));
    if (e.hp <= 0) killFighter(e, nx || 0, ny || 0, k, hx, hy);
  }
  function killFighter(e, nx, ny, force, hx, hy) {
    if (e.dead) return;
    e.dead = true;
    const d = makeDummy(e.x, e.y, { kind: 'enemy', hp: 0 });
    d.defeated = true; d.flash = 650; d.attackCd = 9999;
    for (const f of ['footL', 'footR']) d.pts[f].pin = false;
    for (const key in d.pts) { const p = d.pts[key]; p.px = p.x - e.vx; p.py = p.y - e.vy; }   // inherit momentum
    const near = dummyNearest(d, hx, hy), k = clamp(force, 4, 44);
    if (near.p) { near.p.x += nx * k * 0.7; near.p.y += ny * k * 0.7 - k * 0.2; }
    d.pts.chest.x += nx * k * 0.45; d.pts.head.x += nx * k * 0.55; d.pts.head.y -= k * 0.25;
    dummies.push(d);
    const i = fighters.indexOf(e); if (i >= 0) fighters.splice(i, 1);
    burst(hx, hy, '#ff5a5a', 26, 5.2); addShake(4.5, 150);
  }
  // an enemy attack lands on the hero: knock them back with brief i-frames
  function hurtHero(nx, ny, force, hx, hy) {
    if (!hero || (hero.invuln && hero.invuln > 0)) return;
    const k = clamp(force, 4, 40), dir = (nx || 0) >= 0 ? 1 : -1;
    hero.invuln = 640;
    hero.vx += dir * (3.2 + k * 0.12);
    hero.vy = Math.min(hero.vy, -3.2 - k * 0.05);
    hero.grounded = false; hero.anim.squash = -0.3;
    freeze = Math.max(freeze, 12);
    addShake(3.6, 130);
    burst(hx == null ? hero.x : hx, hy == null ? hero.y - 34 : hy, '#ff5a5a', 14, 3.4);
  }
  function hoverSurfaceY(x, maxDrop, maxRise) {
    const L = levels[li], bottom = player.y + maxDrop, top = player.y - (maxRise == null ? 4 : maxRise);
    let y = Infinity;
    for (const p of L.platforms) if (x > p.x - 14 && x < p.x + p.w + 14 && p.y >= top && p.y <= bottom) y = Math.min(y, p.y);
    for (const b of boxes) if (x > b.x - 14 && x < b.x + b.w + 14 && b.y >= top && b.y <= bottom) y = Math.min(y, b.y);
    return y === Infinity ? null : y;
  }
  // Hover target that also peeks ahead in the travel direction and takes the
  // TOPMOST surface, so the mage rises early to scale up over a higher ledge/crate.
  function mageHoverSurface() {
    const dir = player.vx > 0.3 ? 1 : player.vx < -0.3 ? -1 : player.facing;
    const samples = [
      hoverSurfaceY(player.x, MAGE_HOVER_HEIGHT + 150, MAGE_HOVER_STEP),
      hoverSurfaceY(player.x + dir * 34, MAGE_HOVER_HEIGHT + 150, MAGE_HOVER_STEP),
      hoverSurfaceY(player.x + dir * 70, MAGE_HOVER_HEIGHT + 150, MAGE_HOVER_STEP),
    ].filter(y => y !== null);
    return samples.length ? Math.min(...samples) : null;
  }
  function mageHoverStepOver(solid) {
    if (!cls.fly || !mageHovering() || Math.abs(player.vx) < 0.15) return false;
    const targetY = solid.y - MAGE_HOVER_HEIGHT;
    const rise = player.y - targetY;
    if (rise <= 0 || rise > MAGE_HOVER_STEP) return false;
    player.y = lerp(player.y, targetY, 0.42);
    player.vy = Math.min(player.vy, -0.55);
    player.grounded = false;
    player.anim.squash = Math.min(player.anim.squash, -0.12);
    return true;
  }
  function spawnDroppedKnife(x, y, angle, vx, vy) {
    droppedKnives.push({ x, y, vx: (vx || 0) * 0.12, vy: (vy || 0) * 0.12, angle, grounded: false, life: 9000 });
  }
  function updateDroppedKnives(dt) {
    const L = levels[li];
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
  function isLancerAttack(type) {
    return cls.id === 'lancer' && (type === 'braceThrust' || type === 'lanceCharge');
  }
  function lancerAttackLocked() {
    return player && player.anim && player.anim.atkActive && isLancerAttack(player.anim.atkType);
  }
  function mageHovering() {
    return cls.id === 'mage' && player.intent.jumpHeld;
  }
  function maxV() {
    let m = MAXV * cls.speedMul;
    if (mageHovering()) m *= 0.68;
    if (activeMove('airDash')) m = Math.max(m, 8.6);
    if (activeMove('slide')) m = Math.max(m, 8.0);
    if (activeMove('shoulder')) m = Math.max(m, 7.2);
    if (activeMove('backstep')) m = Math.max(m, 6.8);
    if (player && actorPosture(player).down > 0) m *= 0.45;
    if (lancerAttackLocked()) m = Math.min(m, 1.15);
    return m;
  }
  function updateClassMove() {
    const m = player.move;
    if (!m.active) return;
    m.t += STEP / m.dur;
    const t = clamp(m.t, 0, 1), bell = Math.sin(t * Math.PI);
    m.phase = timelinePhase(m.spec || DEFAULT_MOTION, t);
    if (m.type === 'slide') {
      player.vx = player.facing * (6.8 + 1.8 * (1 - t));
      player.vy = Math.min(player.vy, 1.5);
      if (!m.struck && t > 0.32) {
        m.struck = true;
        const b = actorBox(player), y = b.y + b.h - 10;
        hitBoxesSegment(player.x + player.facing * 8, y, player.x + player.facing * 66, y - 2, player.facing, -0.35, 14, 12);
        burst(player.x + player.facing * 30, y, cls.color, 10, 3);
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
    if (m.t >= 1) player.move = { active: false, type: null, t: 0, dur: 0, struck: false, phase: 'idle', spec: DEFAULT_MOTION };
  }
  function updateRogueFlip() {
    if (!player.flip || !player.flip.active) return;
    player.flip.t += STEP / player.flip.dur;
    if (player.flip.t >= 1) player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
  }
  function updateAttackMotion() {
    const a = player.anim;
    if (!a.atkActive || a.atkType !== 'lanceCharge') return;
    const t = clamp(a.atkT, 0, 1);
    player.vx *= t < 0.78 ? 0.42 : 0.68;
    if (t < 0.78) {
      if (Math.random() < 0.28) particles.push({ x: player.x - player.facing * rand(12, 28), y: player.y - rand(8, 34),
        vx: -player.facing * rand(0.3, 1.0), vy: rand(-0.25, 0.45), life: rand(120, 240), max: 240, color: cls.color, r: rand(1, 2.3) });
    }
  }

  function physics() {
    const L = levels[li];
    const acc = player.grounded ? RUN_ACC : AIR_ACC;
    const locked = lancerAttackLocked();
    if (locked) player.vx *= 0.34;
    else if (input.left && !input.right) { player.vx -= acc; player.facing = -1; }
    else if (input.right && !input.left) { player.vx += acc; player.facing = 1; }
    else if (player.grounded) player.vx *= FRICTION;
    updateCrouchConstraint(player);
    updateClassMove();
    updateRogueFlip();
    updateAttackMotion();
    player.vx = clamp(player.vx, -maxV(), maxV());
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - STEP);

    const g = cls.gravityMul || 1;
    if (cls.fly && mageHovering()) {
      jumpBuf = 0;
      const surface = mageHoverSurface();
      player.vy = Math.min(player.vy + GRA * 0.12, TERMINAL * 0.38);
      if (surface !== null) {
        const targetY = surface - MAGE_HOVER_HEIGHT;
        player.vy += clamp((targetY - player.y) * 0.060, -1.05, 0.72);   // gentle lift toward hover height
        if (player.y > targetY - 2 && player.vy > 0) player.vy *= 0.45;
      } else {
        player.vy += clamp((-0.12 - player.vy) * 0.055, -0.24, 0.18);
      }
      player.vy = clamp(player.vy, -4.2, 3.4);
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
    updateDummies(STEP);

    // integrate + collide (x then y) — against terrain, then crates
    player.x += player.vx;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (mageHoverStepOver(p)) continue;
      resolveActorSide(player, p);
      player.vx = 0;
    }
    for (const b of boxes) if (hit(box(), b)) {           // shove crates sideways (heavier = harder)
      if (mageHoverStepOver(b)) continue;
      const sturdy = cls.tank || activeMove('brace') || activeMove('shoulder') || activeMove('shieldStep');
      const shove = sturdy ? 1.35 : 0.85, loss = sturdy ? 0.78 : 0.5;
      const pb = box();
      if (player.vx > 0) { b.x = pb.x + pb.w; b.vx = Math.max(b.vx, (player.vx * shove + 0.6) / b.m); player.vx *= loss; b.va += sturdy ? 0.025 : 0.012; }
      else if (player.vx < 0) { b.x = pb.x - b.w; b.vx = Math.min(b.vx, (player.vx * shove - 0.6) / b.m); player.vx *= loss; b.va -= sturdy ? 0.025 : 0.012; }
    }
    player.y += player.vy;
    player.grounded = false;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (player.vy > 0) { player.y = p.y; player.grounded = true; }
      else if (player.vy < 0) player.y = p.y + p.h + actorHeight(player);
      if (player.vy > 6) player.anim.squash = clamp(player.vy / TERMINAL, 0, 1) * 0.9; // squash on impact
      player.vy = 0;
    }
    for (const b of boxes) if (hit(box(), b)) {           // stand on / bonk crates
      if (player.vy > 0 && (player.y - player.vy) <= b.y + 8) { player.y = b.y; player.grounded = true; player.vy = 0; }
      else if (player.vy < 0 && (player.y - actorHeight(player) - player.vy) >= b.y + b.h - 8) { player.y = b.y + b.h + actorHeight(player); player.vy = 0; b.vy += 1; }
    }
    if (cls.fly && mageHovering()) {
      const surface = mageHoverSurface();
      if (surface !== null) {
        const targetY = surface - MAGE_HOVER_HEIGHT;
        if (player.y > targetY) { player.y = lerp(player.y, targetY, 0.55); player.vy = Math.min(player.vy, 0); }
        player.grounded = false;
        player.coyote = COYOTE;
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
    const L = levels[li], s = L.spawn;
    burst(player.x, Math.min(player.y, L.h), '#ff6b6b', 16, 4);
    player.x = s.x; player.y = s.y; player.vx = player.vy = 0; player.grounded = false;
    player.move = { active: false, type: null, t: 0, dur: 0, struck: false, phase: 'idle', spec: DEFAULT_MOTION };
    player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
    player.rogueAirJump = false;
  }

  function centerCam(snap) {
    const L = levels[li];
    const attackLead = player.anim && player.anim.atkActive && player.anim.atkType === 'lanceCharge' ? player.facing * 80 : 0;
    const moveLead = activeMove('airDash') || activeMove('slide') ? player.facing * 56 : 0;
    const lookX = clamp(player.vx * 18 + attackLead + moveLead, -130, 130);
    const lookY = clamp(player.vy * 10, -56, 76);
    const tx = L.w <= view.w ? (L.w - view.w) / 2 : clamp(player.x + lookX - view.w / 2, 0, L.w - view.w);
    const ty = L.h <= view.h ? (L.h - view.h) / 2 : clamp((player.y - PH / 2 + lookY) - view.h * 0.55, 0, L.h - view.h);
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
      if (!a.action || a.action.type !== a.atkType) a.action = startAttackAction(a.atkType);
      a.atkDur = a.action.dur;
      a.atkT += dt / a.atkDur;
      a.action.t = a.atkT;
      a.action.phase = timelinePhase(a.action.spec, clamp(a.atkT, 0, 1));
      a.action.active = a.action.phase === 'active';
      a.action.recovery = phaseAmount(a.action.spec, 'recovery', a.atkT);
      a.atkPhase = a.action.phase;
      const sp = strikePoint(a.atkType);
      if (!a.struck && a.atkT >= sp) { a.struck = true; onStrike(a.atkType, a.rogueHand); }   // impact / release moment
      if (a.atkT >= 1) { a.atkActive = false; a.atkT = 0; a.atkPhase = 'idle'; a.action = null; }
    }
    return moveAmt;
  }
  function strikePoint(type) {
    return attackSpec(type).strike;
  }
  // fired once at the impact/release frame
  function onStrike(type, phase) {
    const ang = player.anim.atkAim;
    const spec = attackSpec(type);
    const byHero = player.team !== 'enemy';   // enemy swings don't hijack hitstop/camera
    if (type === 'cast') { spawnBolt(ang, 1.4); return; }
    if (type === 'arcaneBloom') { spawnMageSigil(ang); return; }
    if (type === 'throw') { spawnDagger(ang); return; }
    if (type === 'arrow') { spawnArrow(ang, 1); return; }
    if (type === 'volley') { for (const d of [-0.12, 0, 0.12]) spawnArrow(ang + d, 0.92); return; }
    if (type === 'quake') {
      const qx = player.x + player.facing * 26, qy = player.y - 10;
      if (byHero) { freeze = spec.hitstop; addShake(7.5, 180); }
      player.vx *= 0.35;
      burst(qx, qy, cls.color, 30, 5.6); burst(qx, qy, '#ffffff', 10, 3.2);
      pushBoxesRadial(qx, qy, 28, 128, player.team);
      return;
    }
    // melee: light hit-stop, body follow-through, crate impulse, impact burst
    const heavy = spec.tags && spec.tags.includes('heavy');
    if (byHero) {
      freeze = spec.hitstop;
      addShake(type === 'dualSlash' || type === 'rogueStab' ? 1.6 : heavy ? 4.8 : 2.7, heavy ? 150 : 95);
    }
    if (isLancerAttack(type)) player.vx *= 0.18;
    else player.vx += player.facing * spec.impulse;
    if (type === 'vaultKick') { player.vy = Math.min(player.vy, -4.6); player.grounded = false; }
    const seg = meleeSweepHit(type, ang);     // sweeps the arc; hits crates + dummy at the contact point
    burst(seg.bx, seg.by, cls.color, type === 'dualSlash' ? 12 : heavy ? 22 : 15, type === 'dualSlash' ? 3.4 : 5.2);
    if (type !== 'dualSlash') burst(seg.bx, seg.by, '#ffffff', heavy ? 12 : 8, 3.4);
  }
  function attackBodyOffset(type, t, f) {
    const bell = Math.max(0, Math.sin(clamp(t, 0, 1) * Math.PI));
    const clip = actionClip(type, t, f);
    if (clip) {
      const w = clip.weight || 0;
      return { x: (clip.hipX || 0) * w, y: (clip.hipY || 0) * w, lean: (clip.spine || 0) * w };
    }
    if (type === 'lanceSwing') return { x: f * bell * 10, y: 0, lean: f * bell * 0.22 };
    if (type === 'stab' || type === 'rogueStab' || type === 'braceThrust') {
      const l = Math.max(0, stabReach(t));
      return {
        x: f * l * (type === 'braceThrust' ? 19 : type === 'rogueStab' ? 7 : 13),
        y: 0,
        lean: f * l * (type === 'braceThrust' ? 0.18 : type === 'rogueStab' ? 0.08 : 0.12),
      };
    }
    if (type === 'lunge' || type === 'lanceCharge') {
      const l = Math.max(0, lungeReach(t));
      return { x: f * l * 20, y: 0, lean: f * l * 0.19 };
    }
    if (type === 'cast' || type === 'arcaneBloom') return { x: f * bell * 3, y: 0, lean: f * bell * 0.05 };
    if (type === 'arrow' || type === 'volley') return { x: -f * bell * 2, y: 0, lean: -f * bell * 0.05 };
    if (type === 'throw') return { x: f * bell * 3, y: 0, lean: -f * 0.08 + f * bell * 0.14 };
    return { x: f * bell * (type === 'dualSlash' ? 4 : 6), y: 0, lean: f * bell * (type === 'dualSlash' ? 0.11 : 0.16) };
  }
  function meleeRoot(type, t) {
    const f = player.facing, S = cls.style, body = attackBodyOffset(type, t, f);
    const lean = (player.anim.lean || 0) + body.lean;
    const upX = Math.sin(lean) * f, upY = -Math.cos(lean);
    const baseY = player.y - visualHoverOffset();
    const hipX = player.x + body.x;
    const hipY = baseY - S.hipH + body.y;
    return { shX: hipX + upX * 30, shY: hipY + upY * 30, baseY };
  }
  function meleeSegment(type, ang, t) {
    if (t == null) t = strikePoint(type);
    const f = player.facing, root = meleeRoot(type, t), shX = root.shX, shY = root.shY, baseY = root.baseY;
    if (type === 'legSweep') {
      const b = actorBox(player), y = b.y + b.h - 10;
      return { ax: player.x + f * 4, ay: y, bx: player.x + f * 74, by: y - 4, dx: f, dy: -0.35, force: 18, r: 12 };
    }
    if (type === 'shieldBash') return { ax: shX + f * 28, ay: shY + 2, bx: shX + f * 34, by: shY + 34, dx: f, dy: -0.1, force: 21, r: 15 };
    if (type === 'crush') return { ax: shX + f * 18, ay: shY - 8, bx: shX + f * 58, by: baseY - 12, dx: f * 0.55, dy: 0.9, force: 30, r: 18 };
    if (type === 'staffSweep') {
      const side = Math.cos(ang) >= 0 ? 1 : -1, a = ang + side * 0.55;
      return { ax: shX - Math.cos(a) * 22, ay: shY - Math.sin(a) * 22, bx: shX + Math.cos(a) * 62, by: shY + Math.sin(a) * 62, dx: Math.cos(a), dy: Math.sin(a), force: 17, r: 9 };
    }
    if (type === 'vaultKick') return { ax: player.x + f * 8, ay: baseY - 38, bx: player.x + f * 66, by: baseY - 48, dx: f, dy: -0.7, force: 17, r: 11 };
    // every other weapon swing (incl. the rogue's single dual-wield strike): the
    // hit blade IS the drawn blade, sampled from the same pose at impact. If a
    // full-body clip drives the arm, the hitbox follows its arc too.
    const clip = actionClip(type, t, f);
    const pose = (clip && clip.arm) ? clip.arm(t, ang, f) : weaponPose(type, t, ang, f, player.anim.atkVar);
    const ch = armChain(shX, shY, pose.shAng, pose.elBend);
    const bladeAng = ch.foreAng + pose.wrBend;
    const wl = WLEN[cls.weapon] || 24;
    if (type === 'braceThrust' || type === 'lanceCharge') {
      const lineAng = ang;
      const sx = ch.hx + Math.cos(lineAng) * 22, sy = ch.hy + Math.sin(lineAng) * 22;
      const tx = ch.hx + Math.cos(lineAng) * WLEN.lance, ty = ch.hy + Math.sin(lineAng) * WLEN.lance;
      const force = type === 'lanceCharge' ? 30 : 28;
      return { ax: sx, ay: sy, bx: tx, by: ty, dx: Math.cos(lineAng), dy: Math.sin(lineAng), force, r: 8 };
    }
    const bx = ch.hx + Math.cos(bladeAng) * wl, by = ch.hy + Math.sin(bladeAng) * wl;
    let ax = ch.hx, ay = ch.hy;
    if (cls.weapon === 'lance') {
      const start = type === 'lanceSwing' ? -10 : 24;
      ax = ch.hx + Math.cos(bladeAng) * start;
      ay = ch.hy + Math.sin(bladeAng) * start;
    }
    const FORCE = { lanceSwing: 26, lanceCharge: 30, braceThrust: 28, rogueStab: 15, crush: 30, staffSweep: 17, stab: 18, lunge: 18 };
    const force = FORCE[type] != null ? FORCE[type] : 16;
    const r = type === 'crush' ? 18 : type === 'lanceSwing' ? 13 : (type === 'lanceCharge' || type === 'braceThrust') ? 10 : type === 'rogueStab' ? 8 : 11;
    return { ax, ay, bx, by, dx: Math.cos(bladeAng), dy: Math.sin(bladeAng), force, r };
  }
  // Sample the blade across the cut window and test the WHOLE swept arc — so an
  // overhead slash connects with a head-height target on the way down, not just
  // at one instant. Each crate/dummy is hit at most once per strike.
  function meleeSweepHit(type, ang) {
    const spec = attackSpec(type), sp = strikePoint(type), ts = (spec.sweep || DEFAULT_ATTACK.sweep).map(o => sp + o);
    const byHero = player.team !== 'enemy';
    const crateSeen = new Set(), dBest = new Map(), fBest = new Map();
    let impact = null, heroHit = null;
    for (const tt of ts) {
      const s = meleeSegment(type, ang, clamp(tt, 0, 1));
      if (!impact || Math.abs(tt - sp) < 0.001) impact = s;
      rememberDebugSegment('weapon', s.ax, s.ay, s.bx, s.by, s.r, '#ff405f', 260);
      for (const b of boxes) {
        if (crateSeen.has(b)) continue;
        const p = closestPointOnSeg(b.x + b.w / 2, b.y + b.h / 2, s.ax, s.ay, s.bx, s.by);
        if (pointAabbDist(p.x, p.y, b) <= s.r) { pushBox(b, s.dx, s.dy, s.force); crateSeen.add(b); }
      }
      if (byHero) {
        if (dummies) for (const d of dummies) for (const k in d.pts) {
          const p = d.pts[k], cp = closestPointOnSeg(p.x, p.y, s.ax, s.ay, s.bx, s.by);
          const dist = Math.hypot(cp.x - p.x, cp.y - p.y);
          if (dist <= s.r + 13) { const cur = dBest.get(d); if (!cur || dist < cur.dist) dBest.set(d, { dist, p, nx: s.dx, ny: s.dy, force: s.force }); }
        }
        if (fighters) for (const e of fighters) {
          const h = segHitActor(s.ax, s.ay, s.bx, s.by, s.r, e);
          if (h) { const dd = Math.hypot(h.x - e.x, h.y - (e.y - 44)), cur = fBest.get(e); if (!cur || dd < cur.dd) fBest.set(e, { dd, h, nx: s.dx, ny: s.dy, force: s.force }); }
        }
      } else if (hero && !(hero.invuln > 0) && !heroHit) {
        const h = segHitActor(s.ax, s.ay, s.bx, s.by, s.r, hero);
        if (h) heroHit = { h, nx: s.dx, ny: s.dy, force: s.force };
      }
    }
    if (byHero) {
      for (const [d, h] of dBest) hurtDummy(d, h.nx, h.ny, h.force, h.p.x, h.p.y);
      for (const [e, h] of fBest) hurtFighter(e, h.nx, h.ny, h.force, h.h.x, h.h.y);
    } else if (heroHit) {
      hurtHero(heroHit.nx, heroHit.ny, heroHit.force, heroHit.h.x, heroHit.h.y);
    }
    return impact;
  }
  // a fast, punchy magic bolt (size = power)
  function spawnBolt(ang, power) {
    const shX = player.x, shY = player.y - 77, spd = 19;
    const mx = shX + Math.cos(ang) * 46, my = shY + Math.sin(ang) * 46;
    projectiles.push({ kind: 'bolt', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1100, color: cls.color, r: 9 * power, hit: 13 * power, sparkle: 2 });
    burst(mx, my, '#ffffff', 16, 5); burst(mx, my, cls.color, 22, 4.2);
  }
  // a straight thrown dagger that can be recovered after landing
  function spawnDagger(ang) {
    const shX = player.x + player.facing * 11, shY = player.y - 96, spd = 22;
    const mx = shX + Math.cos(ang) * 22, my = shY + Math.sin(ang) * 10;
    projectiles.push({ kind: 'dagger', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1400, color: '#cfd6df', angle: ang, hit: 11 });
  }
  function spawnArrow(ang, power) {
    const shX = player.x, shY = player.y - 72, spd = 22 * power;
    const mx = shX + Math.cos(ang) * 34, my = shY + Math.sin(ang) * 34;
    projectiles.push({ kind: 'arrow', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1300, color: cls.color, angle: ang, hit: 10 * power });
    burst(mx, my, cls.color, 8, 2.4);
  }
  function spawnMageSigil(ang) {
    const shX = player.x, shY = player.y - 76;
    const mx = shX + Math.cos(ang) * 42, my = shY + Math.sin(ang) * 42;
    projectiles.push({ kind: 'sigil', team: player.team, x: mx, y: my, vx: Math.cos(ang) * 5.8, vy: Math.sin(ang) * 5.8,
      life: 620, age: 0, color: cls.color, r: 16, hit: 18, angle: ang });
    burst(mx, my, '#ffffff', 18, 3.2);
    burst(mx, my, cls.color, 32, 3.8);
  }
  function explodeSigil(b) {
    burst(b.x, b.y, b.color, 34, 5.2);
    burst(b.x, b.y, '#ffffff', 18, 3.6);
    pushBoxesRadial(b.x, b.y, 18, 92, b.team);
    for (let i = 0; i < 8; i++) {
      const a = b.angle + i * Math.PI / 4 + Math.sin(b.age * 0.02) * 0.25;
      const spd = 9.5;
      projectiles.push({ kind: 'bolt', team: b.team, x: b.x, y: b.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
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
    if (t < 0.36) return lerp(0, -0.62, ease(t / 0.36));             // deeper draw-back
    if (t < 0.48) return -0.62;                                      // readable brace
    if (t < 0.58) return lerp(-0.62, 1.62, ease((t - 0.48) / 0.10));  // hard extension
    if (t < 0.72) return 1.62;                                       // hold the point out
    return lerp(1.62, 0, ease((t - 0.72) / 0.28));                   // recover
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
  // is forearm + wristBend) so it trails through the arc rather than
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
    if (type === 'stab' || type === 'rogueStab' || type === 'lunge' || type === 'braceThrust' || type === 'lanceCharge') return 'thrust';
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
  // Each archetype has a few authored variants; every attack picks one
  // (a.atkVar) so repeated strikes use different angles/patterns instead of the
  // same canned motion. `back` leans the wind-up off straight-up; `over` is how
  // far the cut overshoots past the aim before settling.
  const ARC_VARIANTS = [
    { back: 0.34, over: 0.80, raiseT: 0.20, cutT: 0.52, coil: 1.20, whip: 0.92 }, // overhead diagonal
    { back: 0.05, over: 1.08, raiseT: 0.15, cutT: 0.47, coil: 1.38, whip: 1.10 }, // wide power swing
    { back: 0.66, over: 0.52, raiseT: 0.23, cutT: 0.56, coil: 1.05, whip: 0.80 }, // steep chop
    { back: -0.50, over: 0.78, raiseT: 0.18, cutT: 0.50, coil: 1.12, whip: 0.98, rising: true }, // rising uppercut
  ];
  const CHOP_VARIANTS = [{ lean: 0.45 }, { lean: 0.05 }, { lean: 0.80 }];
  const THROW_VARIANTS = [{ raiseT: 0.20, over: 0.00 }, { raiseT: 0.16, over: 0.14 }];
  function weaponPose(type, t, aim, f, v) {
    v = v | 0;
    const s = (Math.cos(aim) >= 0 ? 1 : -1);
    const arc = attackArc(type);
    let shAng, elBend, wrBend;
    if (arc === 'arc') {
      const P = ARC_VARIANTS[v % ARC_VARIANTS.length];
      const holdEnd = P.raiseT + 0.08;
      if (P.rising) {
        // uppercut: drop low & back, then cut UP through the aim
        const low = Math.PI / 2 + s * P.back;
        shAng = t < P.raiseT ? lerpAngle(aim, low, ease(t / P.raiseT))
          : t < holdEnd ? low
            : t < P.cutT ? lerpAngle(low, aim - s * P.over, ease((t - holdEnd) / (P.cutT - holdEnd)))
              : lerpAngle(aim - s * P.over, aim - s * 0.10, ease((t - P.cutT) / (1 - P.cutT)));
      } else {
        // raise to the TOP (up & back) FAST, hold, then SLAM down through the aim —
        // the momentum starts from the top, and only the slam tracks the aim.
        const top = -Math.PI / 2 + s * P.back;
        shAng = t < P.raiseT ? lerpAngle(aim, top, ease(t / P.raiseT))
          : t < holdEnd ? top
            : t < P.cutT ? lerpAngle(top, aim + s * P.over, ease((t - holdEnd) / (P.cutT - holdEnd)))
              : lerpAngle(aim + s * P.over, aim + s * 0.12, ease((t - P.cutT) / (1 - P.cutT)));
      }
      elBend = s * kfa(t, [[0, -0.55], [holdEnd, -P.coil], [P.cutT - 0.02, -0.12], [P.cutT + 0.10, 0.06], [1, -0.55]]);
      wrBend = s * kfa(t, [[0, 0.30], [holdEnd + 0.02, P.whip], [P.cutT - 0.02, -0.55], [P.cutT + 0.12, -0.08], [1, 0.28]]);
      if (P.rising) { elBend = -elBend; wrBend = -wrBend; }
    } else if (arc === 'chop') {
      const P = CHOP_VARIANTS[v % CHOP_VARIANTS.length];
      const up = -Math.PI / 2;
      shAng = t < 0.36 ? lerpAngle(aim, up, ease(t / 0.36))
        : t < 0.52 ? lerpAngle(up, aim + s * P.lean, ease((t - 0.36) / 0.16))
          : lerpAngle(aim + s * P.lean, aim, ease((t - 0.52) / 0.48));
      elBend = s * kfa(t, [[0, -0.40], [0.36, -1.30], [0.52, -0.05], [0.66, 0.05], [1, -0.50]]);
      wrBend = s * kfa(t, [[0, 0.20], [0.36, 0.85], [0.52, -0.45], [0.66, 0.00], [1, 0.20]]);
    } else if (arc === 'thrust') {
      const big = type === 'braceThrust' || type === 'lanceCharge' || type === 'stab';
      const lance = type === 'braceThrust' || type === 'lanceCharge';
      if (lance) {
        const line = aim;
        const coil = type === 'lanceCharge'
          ? kfa(t, [[0, 1.10], [0.20, 1.48], [0.34, 0.62], [0.48, 0.12], [0.74, 0.10], [1, 0.58]])
          : kfa(t, [[0, 1.20], [0.30, 1.72], [0.42, 1.66], [0.52, 0.22], [0.74, 0.10], [1, 0.64]]);
        shAng = line - s * coil;
        elBend = s * coil;
        wrBend = 0;
        return { shAng, elBend, wrBend };
      }
      // straight stab: draw the hand back, then extend with the blade itself
      // locked to the aim line so the capsule matches the visible point.
      const coil = type === 'rogueStab'
        ? kfa(t, [[0, 0.68], [0.24, 1.32], [0.38, 1.26], [0.50, 0.12], [0.66, 0.04], [1, 0.52]])
        : big
          ? kfa(t, [[0, 0.78], [0.34, 1.60], [0.48, 1.58], [0.58, 0.14], [0.74, 0.06], [1, 0.58]])
          : kfa(t, [[0, 0.55], [0.30, 1.20], [0.44, 1.15], [0.56, 0.10], [0.72, 0.04], [1, 0.50]]);
      shAng = aim - s * coil;
      elBend = s * coil;
      wrBend = 0;
    } else if (arc === 'cast') {
      const bell = Math.sin(clamp(t, 0, 1) * Math.PI);
      shAng = aim - s * 0.10 * (1 - bell);
      elBend = s * lerp(-1.00, -0.20, bell);
      wrBend = s * 0.15 * (1 - bell);
    } else if (arc === 'throw') {
      const P = THROW_VARIANTS[v % THROW_VARIANTS.length];
      const up = -Math.PI / 2, back = P.raiseT, fwd = P.raiseT + 0.16;
      shAng = t < back ? lerpAngle(aim, up, ease(t / back))
        : t < fwd ? lerpAngle(up, aim - s * P.over, ease((t - back) / 0.16))
          : lerpAngle(aim - s * P.over, aim, ease(clamp((t - fwd) / 0.30, 0, 1)));
      elBend = s * kfa(t, [[0, -0.50], [back, -1.50], [fwd, -0.10], [fwd + 0.10, 0.05], [1, -0.50]]);
      wrBend = s * kfa(t, [[0, 0.30], [back, 1.00], [fwd, -0.50], [fwd + 0.12, -0.05], [1, 0.20]]);
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

  // visible weapon-tip length per class, used by trails and melee capsules
  const WLEN = { sword: 40, dagger: 16, spear: 50, lance: 88, staff: 64, bow: 30, bo: 48, hammer: 46 };
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

    if (cls.weapon === 'sword') { handle(7); guard(7); blade(40, 3.4, '#7d828c'); }
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
      ctx.beginPath(); ctx.moveTo(hx - dx * 48, hy - dy * 48); ctx.lineTo(hx + dx * 64 * L, hy + dy * 64 * L); ctx.stroke();
      ctx.strokeStyle = '#9aa0aa'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(hx + dx * 64 * L + nx * 5, hy + dy * 64 * L + ny * 5); ctx.lineTo(hx + dx * 64 * L - nx * 5, hy + dy * 64 * L - ny * 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - dx * 48 + nx * 4, hy - dy * 48 + ny * 4); ctx.lineTo(hx - dx * 48 - nx * 4, hy - dy * 48 - ny * 4); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(hx + dx * 69 * L, hy + dy * 69 * L, 5.5, 0.25, Math.PI * 1.75); ctx.stroke();
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

  // ===========================================================================
  // ANIMATION CLIPS (prototype pipeline — currently the knight slash)
  // A clip authors the WHOLE body for an action over normalised time t, as named
  // tracks (spine lean, hip drive, head lead, weight shift, off-arm balance). The
  // front/weapon arm keeps the weaponPose swing engine; the clip wraps the body
  // around it so the slash is a coordinated full-body move, tuned in ONE place.
  // `weight` is an ease-in/out envelope used to blend the clip over locomotion.
  // Returns null for actions not yet ported, which fall back to the legacy path.
  // ===========================================================================
  function actionClip(type, t, f) {
    if (type === 'slash') return slashClip(t, f, player.anim.slashFlavor | 0);  // combo flavor
    return null;
  }
  // BODY mechanics baked from real CMU swordplay mocap (subject 02, trial 08) via
  // scripts/bvh2clip.js — the timing/shape is recorded human motion (weight transfer
  // onto the front foot, torso twist peaking mid-cut, hips driving forward, the dip
  // then push). Amplitudes are normalised to our units; the weapon-arm path stays
  // authored because a sword arm points out-of-plane and doesn't survive a 2D
  // projection. The horizontal variant keeps the hand-authored body for comparison.
  const MOCAP_SLASH = {
    spine: [[0, 0], [0.1, 0.013], [0.2, 0.023], [0.3, 0.022], [0.4, 0.029], [0.5, 0.02], [0.6, -0.009], [0.7, -0.078], [0.8, -0.211], [0.9, -0.363], [1, -0.46]],
    hipX: [[0, 0], [0.1, 1.019], [0.2, 2.653], [0.3, 4.302], [0.4, 5.662], [0.5, 6.849], [0.6, 7.835], [0.7, 8.935], [0.8, 10.655], [0.9, 12.653], [1, 14]],
    hipY: [[0, 0], [0.1, 0.129], [0.2, 0.327], [0.3, 0.478], [0.4, 0.606], [0.5, 0.741], [0.6, 0.785], [0.7, 0.405], [0.8, -1.115], [0.9, -3.791], [1, -6]],
    headX: [[0, 0], [0.1, 0.409], [0.2, 0.949], [0.3, 1.181], [0.4, 1.266], [0.5, 1.036], [0.6, 0.29], [0.7, -1.149], [0.8, -3.68], [0.9, -6.769], [1, -9]],
    shoulderShear: [[0, 0], [0.1, 2.579], [0.2, 6.171], [0.3, 9.135], [0.4, 11.057], [0.5, 11.946], [0.6, 12], [0.7, 11.221], [0.8, 9.891], [0.9, 8.497], [1, 7.724]],
    hipPivot: [[0, 0], [0.1, 2.521], [0.2, 5.714], [0.3, 7.931], [0.4, 8.993], [0.5, 9], [0.6, 8.177], [0.7, 7.021], [0.8, 5.669], [0.9, 4.586], [1, 4.13]],
    offArm: [[0, 0], [0.1, 0.765], [0.2, 0.974], [0.3, 1], [0.4, 0.983], [0.5, 0.952], [0.6, 0.914], [0.7, 0.872], [0.8, 0.841], [0.9, 0.846], [1, 0.858]],
    weightShift: [[0, 0], [0.1, 0], [0.2, 0], [0.3, 0.097], [0.4, 0.177], [0.5, 0.257], [0.6, 0.321], [0.7, 0.438], [0.8, 0.69], [0.9, 0.956], [1, 1]],
  };
  // Knight slash combo: consecutive taps cycle distinct cuts for variety.
  //  flavor 0 = diagonal (real mocap body), 1 = horizontal (authored body),
  //  2 = overhead (mocap body, steep vertical arm).
  function slashClip(t, f, flavor) {
    const W = clamp(Math.min(t, 1 - t) / 0.10, 0, 1);
    if (flavor === 1) {                            // HORIZONTAL — hand-authored body
      return {
        weight: W,
        spine: f * kfa(t, [[0, 0], [0.30, -0.30], [0.40, -0.32], [0.50, 0.30], [0.60, 0.46], [0.85, 0.18], [1, 0]]),
        hipX: f * kfa(t, [[0, 0], [0.30, -6], [0.40, -6], [0.55, 14], [0.78, 7], [1, 0]]),
        hipY: 0,
        headX: f * kfa(t, [[0, 0], [0.30, -5], [0.55, 9], [0.85, 3], [1, 0]]),
        weightShift: kfa(t, [[0, 0.5], [0.34, 0.12], [0.55, 0.95], [0.85, 0.70], [1, 0.5]]),
        shoulderShear: f * kfa(t, [[0, 0], [0.30, -9], [0.40, -10], [0.52, 8], [0.62, 12], [0.85, 5], [1, 0]]),
        hipPivot: f * kfa(t, [[0, 0], [0.26, -5], [0.40, -6], [0.50, 7], [0.62, 9], [0.85, 4], [1, 0]]),
        offArm: f * kfa(t, [[0, 0], [0.30, 0.7], [0.52, -1.0], [0.78, -0.4], [1, 0]]),
        arm: (tt, aim) => slashArm(tt, aim, 'horiz'),
      };
    }
    const M = MOCAP_SLASH, style = flavor === 2 ? 'over' : 'diag';   // real mocap body
    return {
      weight: W,
      spine: f * kfa(t, M.spine), hipX: f * kfa(t, M.hipX), hipY: kfa(t, M.hipY),
      headX: f * kfa(t, M.headX), weightShift: kfa(t, M.weightShift),
      shoulderShear: f * kfa(t, M.shoulderShear), hipPivot: f * kfa(t, M.hipPivot),
      offArm: f * kfa(t, M.offArm), arm: (tt, aim) => slashArm(tt, aim, style),
    };
  }
  // weapon-arm arc for a slash: coil over the back shoulder, cut down-and-ACROSS
  // through the aim, follow through past it. Arm stays bent (rotation gives reach).
  function slashArm(t, aim, style) {
    const s = (Math.cos(aim) >= 0 ? 1 : -1);
    const top = style === 'horiz' ? -1.4 : style === 'over' ? -2.4 : -2.0;
    const end = style === 'horiz' ? 1.0 : style === 'over' ? 1.6 : 1.45;
    const shAng = aim + s * kfa(t, [[0, 0.2], [0.26, top], [0.36, top], [0.52, end * 0.5], [0.64, end], [1, end * 0.7]]);
    const elBend = s * kfa(t, [[0, -0.7], [0.36, -1.35], [0.52, -0.5], [0.64, -0.45], [1, -0.8]]);
    const wrBend = s * kfa(t, [[0, 0.5], [0.36, 1.1], [0.52, -0.7], [0.66, -0.2], [1, 0.3]]);
    return { shAng, elBend, wrBend };
  }

  function solveHeroRagdoll(a, target) {
    const R = a.rag || (a.rag = { init: false });
    const lenHC = Math.hypot(target.shX - target.hipX, target.shY - target.hipY);
    const lenCH = Math.hypot(target.headCX - target.shX, target.headCY - target.shY);
    if (!R.init || target.flipActive && !R.flip) {
      R.cx = target.shX; R.cy = target.shY; R.cpx = target.shX; R.cpy = target.shY;
      R.hx = target.headCX; R.hy = target.headCY; R.hpx = target.headCX; R.hpy = target.headCY;
      R.init = true;
    }
    R.flip = target.flipActive;
    const KC = target.flipActive ? 0.7 : 0.30, KH = target.flipActive ? 0.7 : 0.26, DMP = 0.90;
    const dvx = player.vx - (R.lvx || 0); R.lvx = player.vx;
    const dsq = a.squash - (R.lsq || 0); R.lsq = a.squash;
    let impX = clamp(-dvx, -3, 3) * 1.4, impY = clamp(dsq, -1, 1) * 6;
    if (a.atkActive && a.struck && !R.struckSeen) { impX += -target.f * 2.4; impY -= 1.2; R.struckSeen = true; }
    if (!a.atkActive) R.struckSeen = false;
    let cvx = (R.cx - R.cpx) * DMP, cvy = (R.cy - R.cpy) * DMP;
    R.cpx = R.cx; R.cpy = R.cy; R.cx += cvx + impX; R.cy += cvy + impY;
    let hvx = (R.hx - R.hpx) * DMP, hvy = (R.hy - R.hpy) * DMP;
    R.hpx = R.hx; R.hpy = R.hy; R.hx += hvx + impX * 0.7; R.hy += hvy + impY * 0.7;
    R.cx += (target.shX - R.cx) * KC; R.cy += (target.shY - R.cy) * KC;
    R.hx += (target.headCX - R.hx) * KH; R.hy += (target.headCY - R.hy) * KH;
    for (let it = 0; it < 3; it++) {
      let dx = R.cx - target.hipX, dy = R.cy - target.hipY, dd = Math.hypot(dx, dy) || 1, df = (dd - lenHC) / dd;
      R.cx -= dx * df; R.cy -= dy * df;
      let ex = R.hx - R.cx, ey = R.hy - R.cy, ed = Math.hypot(ex, ey) || 1, ef = (ed - lenCH) / ed * 0.5;
      R.cx += ex * ef; R.cy += ey * ef; R.hx -= ex * ef; R.hy -= ey * ef;
    }
    return { shX: R.cx, shY: R.cy, headCX: R.hx, headCY: R.hy };
  }

  function drawStick(moveAmt) {
    const a = player.anim, f = player.facing, p = a.phase, air = a.air;
    const actionLayer = currentActionLayer();
    const fly = a.fly || 0, moveType = player.move.active ? player.move.type : null, moveT = player.move.active ? clamp(player.move.t, 0, 1) : 0;
    const flipActive = player.flip && player.flip.active;
    const flipT = flipActive ? clamp(player.flip.t, 0, 1) : 0;
    const flipCurl = flipActive ? Math.sin(flipT * Math.PI) : 0;
    const flipTuck = flipActive ? ease(Math.min(1, flipCurl * 1.35)) : 0;
    const flipLead = flipActive ? Math.sin(flipT * Math.PI * 2) : 0;
    const now = performance.now();
    // metrics — body proportions are shared; STANCE & motion come from the class style
    const S = cls.style;
    const hipH = S.hipH, torso = 30, neck = 4, headR = 12;
    const thigh = 24, shin = 24, uArm = 18, fArm = 16, armLen = uArm + fArm;
    const strideH = S.strideH, lift = S.lift, armStride = S.armStride, bounceAmp = S.bounceAmp, sway = 2, stanceW = S.stanceW;
    const guardReach = armLen * 0.6;            // bent-elbow "on guard" hold
    const posture = actorPosture(player);

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
    hoverY = fly * (S.hover + Math.sin(now * 0.004) * 1.8);

    let postureLean = 0, guardCrouch = 0;            // (no cursor aiming for now)
    if (moveType === 'slide') { postureLean -= f * 0.72; guardCrouch = 30 * Math.sin(moveT * Math.PI); }
    else if (moveType === 'shoulder' || moveType === 'shieldStep' || moveType === 'brace') postureLean += f * 0.16 * Math.sin(moveT * Math.PI);
    else if (moveType === 'airDash') postureLean += f * 0.22;
    if (posture.down > 0 || posture.sweep > 0) {
      postureLean += posture.lean;
      guardCrouch = Math.max(guardCrouch, posture.drop);
    }
    if (flipActive) {
      postureLean += player.flip.dir * (Math.PI * 1.55 * ease(flipT) + 0.36 * flipLead);
      guardCrouch -= 19 * flipCurl;
    }

    // ----- attack scalars (whole-body reaction) -----
    let atkLean = 0, atkHip = 0, clipHipY = 0, clipHeadX = 0, slashT = null, stabT = null, lungeT = null, castT = null, throwT = null, shootT = null;
    a._clip = null;
    if (actionLayer.active) {
      const t = actionLayer.t, ty = actionLayer.type, bell = Math.max(0, Math.sin(Math.min(1, t) * Math.PI));
      const clip = actionClip(ty, t, f);                  // full-body clip (prototype: knight slash)
      if (clip) {
        slashT = t;                                       // front arm still runs the swing engine
        a._clip = clip;
        const w = clip.weight;
        atkLean = clip.spine * w; atkHip = clip.hipX * w; clipHipY = clip.hipY * w; clipHeadX = clip.headX * w;
      }
      else if (ty === 'lanceSwing') { slashT = t; atkHip = f * bell * 10; atkLean = f * bell * 0.22; }
      else if (ty === 'stab' || ty === 'rogueStab' || ty === 'braceThrust') { stabT = t; const l = Math.max(0, stabReach(t)); atkHip = f * l * (ty === 'braceThrust' ? 19 : ty === 'rogueStab' ? 7 : 13); atkLean = f * l * (ty === 'braceThrust' ? 0.18 : ty === 'rogueStab' ? 0.08 : 0.12); }
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
    const hipY = -hipH + bob + guardCrouch + breathe + idleY - flipCurl * 7 + clipHipY;
    const lean = a.lean + atkLean + postureLean;
    const upX = Math.sin(lean) * f, upY = -Math.cos(lean);
    let shX = hipX + upX * torso, shY = hipY + upY * torso;
    let headCX = shX + upX * (neck + headR), headCY = shY + upY * (neck + headR);
    if (flipActive) {
      headCX = lerp(headCX, hipX - player.flip.dir * (8 + flipLead * 5), flipCurl * 0.55);
      headCY = lerp(headCY, hipY - 18 + Math.abs(flipLead) * 5, flipCurl * 0.55);
    }
    headCX += clipHeadX;                                  // clip: head leads the cut

    // Physics reaction layer: the animated chest/head targets are solved through
    // a light active-ragdoll pass before arms and head render from the result.
    const ragPose = solveHeroRagdoll(a, { hipX, hipY, shX, shY, headCX, headCY, flipActive, f });
    shX = ragPose.shX; shY = ragPose.shY; headCX = ragPose.headCX; headCY = ragPose.headCY;

    // Stick-figure roots: limbs attach directly to the spine endpoints. The
    // action clips still drive lean, head lead, hands, and feet, but they do not
    // draw separate shoulder or hip structure.
    const shFX = shX, shFY = shY, shBX = shX, shBY = shY;
    const hipFX = hipX, hipBX = hipX;

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
        const flyDrive = clamp(Math.abs(player.vx) / 8.5, 0, 1);
        const liftDrive = clamp(-player.vy / 4.5, 0, 1);
        foot.x = lerp(foot.x, -f * (18 + flyDrive * 14 + legSign * 3) + legSign * (4 + flyDrive * 5), fly);
        foot.y = lerp(foot.y, -7 - liftDrive * 5 + legSign * 5 + Math.sin(now * 0.006 + legSign) * 2, fly);
      }
      if (a.atkActive && a.atkType === 'legSweep') {
        const frontLeg = legSign === -1;
        const sweep = Math.sin(Math.min(1, a.atkT) * Math.PI);
        foot.x = frontLeg ? f * (24 + 42 * sweep) : -f * (12 + 8 * sweep);
        foot.y = frontLeg ? -1 : -14;
      } else if (moveType === 'slide') {
        const frontLeg = legSign === -1;
        const slide = Math.sin(moveT * Math.PI);
        foot.x = frontLeg ? f * (50 + 16 * slide) : -f * (30 + 10 * slide);
        foot.y = frontLeg ? 1 : -20;
      } else if (flipActive) {
        const kick = Math.sin((flipT + (legSign > 0 ? 0.12 : -0.08)) * Math.PI * 2);
        const cross = Math.sin((flipT + (legSign > 0 ? 0.20 : -0.16)) * Math.PI * 2);
        foot.x = lerp(foot.x, -player.flip.dir * (2 + flipLead * 5) + legSign * 4 + cross * 2.5, flipTuck);
        foot.y = lerp(foot.y, hipY + 8 + legSign * 3 + Math.abs(kick) * 2, flipTuck);
      } else if (posture.down > 0) {
        const frontLeg = legSign === -1;
        foot.x = lerp(foot.x, frontLeg ? f * 13 : -f * 11, posture.down);
        foot.y = lerp(foot.y, frontLeg ? -1 : -6, posture.down);
      } else if (a._clip) {
        // clip weight-shift: plant the front foot & push off the back heel
        const c = a._clip, frontLeg = legSign === -1, wt = c.weight;
        if (frontLeg) { foot.x = lerp(foot.x, f * (12 + c.weightShift * 9), wt * 0.85); foot.y = lerp(foot.y, 0, wt * 0.85); }
        else { foot.x = lerp(foot.x, -f * 10, wt * 0.7); foot.y = lerp(foot.y, lerp(0, -8, c.weightShift), wt * 0.7); }
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
        const flyDrive = clamp(Math.abs(player.vx) / 8.5, 0, 1);
        hand.x = lerp(hand.x, shX - f * (18 + flyDrive * 10 + Math.sin(theta) * 5), fly);
        hand.y = lerp(hand.y, shY + 14 - flyDrive * 3 + Math.cos(theta) * 5, fly);
      }
      if (moveType === 'slide') {
        const front = theta === p;
        const slide = Math.sin(moveT * Math.PI);
        hand.x = lerp(hand.x, shX + f * (front ? 32 : -18), slide);
        hand.y = lerp(hand.y, shY + (front ? 18 : 24), slide);
      }
      if (posture.down > 0 || posture.sweep > 0) {
        const duck = Math.max(posture.down, posture.sweep);
        const front = theta === p;
        hand.x = lerp(hand.x, shX + f * (front ? 18 : -12), duck);
        hand.y = lerp(hand.y, shY + (front ? 22 : 26), duck);
      }
      if (flipActive) {
        const sweep = Math.sin((flipT + (theta === p ? 0.08 : -0.08)) * Math.PI * 2);
        hand.x = lerp(hand.x, shX - player.flip.dir * (6 + flipCurl * 10) + sweep * 4, flipCurl);
        hand.y = lerp(hand.y, shY + 18 + flipCurl * 7, flipCurl);
      }
      return hand;
    }

    // rogue dual-wield strikes alternate hands; this swing belongs to the off hand
    const rogueOff = cls.id === 'rogue' && a.atkActive && a.atkType === 'dualSlash' && a.rogueHand === 1;
    // ----- back arm (ragdoll: hand position springs loosely so the elbow swings) -----
    const knifeTrick = cls.id === 'rogue' && !a.atkActive && idleAmt > 0.72 && ((now % 4300) / 4300) > 0.70
      ? ease((((now % 4300) / 4300) - 0.70) / 0.30) : 0;
    let h = armHand(p), offhandAim = null, offhandStretch = 1;
    if (rogueOff && slashT !== null) {
      // full-range off-hand swing (uses the same raise-to-top engine as the front hand)
      const pose = weaponPose('dualSlash', slashT, a.atkAim, f, a.atkVar);
      const bc = armChain(shX, shY, pose.shAng, pose.elBend);
      offhandAim = bc.foreAng + pose.wrBend;
      offhandStretch = 1 + Math.sin(clamp(slashT, 0, 1) * Math.PI) * 0.18;
      h = { x: bc.hx, y: bc.hy };
    } else if (cls.id === 'rogue') {
      h = { x: shX - f * 9, y: shY + 20 };                        // off dagger held at low guard
    } else if (cls.offhand === 'shield') {
      const push = (a.atkActive && a.atkType === 'shieldBash') || moveType === 'shieldStep' ? Math.sin(Math.min(1, a.atkT || moveT) * Math.PI) : 0;
      h = { x: shBX + f * (14 + push * 24), y: shBY + 14 - push * 8 };
    } else if (cls.weapon === 'lance') {
      h = { x: shX - f * 4, y: shY + 18 };
    } else if (cls.weapon === 'staff') {
      h = fly > 0.25
        ? { x: shX + f * 10, y: shY + 24 }
        : { x: shX + f * 8, y: shY + 32 };
    } else if (cls.weapon === 'bo') {
      if (a.atkActive && (a.atkType === 'staffSweep' || a.atkType === 'vaultKick')) h = { x: shX - f * 10, y: shY + 20 };
    } else if (cls.weapon === 'bow') {
      if (a.atkActive && (a.atkType === 'arrow' || a.atkType === 'volley')) h = { x: shX - f * 10, y: shY + 10 };
    }
    if (a._clip && offhandAim == null) {                  // off arm counter-balances the swing
      h = { x: h.x + a._clip.offArm * a._clip.weight * 18, y: h.y - Math.abs(a._clip.offArm) * a._clip.weight * 7 };
    }
    if (a.bhx === null) { a.bhx = h.x; a.bhy = h.y; }
    if (offhandAim != null) {
      a.bhx = h.x; a.bhy = h.y; a.bhxV = 0; a.bhyV = 0;
    } else {
      springTo(a, 'bhx', h.x, 120, 12, a._dt);
      springTo(a, 'bhy', h.y, 120, 12, a._dt);
    }
    let ka = ik(shBX, shBY, a.bhx, a.bhy, uArm * offhandStretch, fArm * offhandStretch, f);
    seg(shBX, shBY, ka.jx, ka.jy, ka.ex, ka.ey, 6 / Math.sqrt(offhandStretch));
    if (cls.dual) {
      let offAng = offhandAim != null ? offhandAim : Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx);
      if (knifeTrick) offAng += f * Math.PI * 4 * knifeTrick;
      drawWeapon(ka.ex, ka.ey, offAng, offhandStretch);
      if (offhandAim != null) {
        slashTrail.push({ x: player.x + ka.ex + Math.cos(offAng) * WLEN.dagger * offhandStretch, y: (player.y - hoverY) + ka.ey + Math.sin(offAng) * WLEN.dagger * offhandStretch, life: 170, c: cls.trail });
        if (slashTrail.length > 38) slashTrail.shift();
      }
    } else if (cls.offhand === 'shield') {
      drawShield(ka.ex, ka.ey, f, (a.atkActive && a.atkType === 'shieldBash') || moveType === 'shieldStep' ? 1.15 : 1);
    }

    // ----- far leg ----- (knees bend forward: bend = -f; 0.6 = visually straighter)
    let lt = legFoot(p + Math.PI, +1);
    const flipLegScale = flipActive ? lerp(1, 0.78, flipTuck) : 1;
    const farBend = flipActive ? player.flip.dir : -f;
    const nearBend = flipActive ? -player.flip.dir : -f;
    let k = ik(hipBX, hipY, hipBX + lt.x, lt.y, thigh * flipLegScale, shin * flipLegScale, farBend, flipActive ? 1 : 0.6);
    seg(hipBX, hipY, k.jx, k.jy, k.ex, k.ey, 7);

    // ----- torso + head -----
    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();          // spine
    ctx.beginPath(); ctx.arc(headCX + a.headLag * (1 - air), headCY, headR, 0, Math.PI * 2); ctx.fill();

    // ----- near leg -----
    lt = legFoot(p, -1);
    k = ik(hipFX, hipY, hipFX + lt.x, lt.y, thigh * flipLegScale, shin * flipLegScale, nearBend, flipActive ? 1 : 0.6);
    seg(hipFX, hipY, k.jx, k.jy, k.ex, k.ey, 8);

    // ----- weapon arm: ARTICULATED chain driven by joint angles -----
    // Active attacks draw directly from the shared attack pose. Resting hands
    // still use springs, but strike frames stay aligned with melee capsules.
    const attacking = a.atkActive;
    // rogue dual-wield: one tap = one hand. When the OFF (back) hand is striking
    // (rogueOff, computed above), the front arm just holds guard.
    if (attacking && !rogueOff) {
      // a full-body clip can author its own arm arc; else use the generic engine
      const pose = (a._clip && a._clip.arm) ? a._clip.arm(a.atkT, a.atkAim, f) : weaponPose(a.atkType, a.atkT, a.atkAim, f, a.atkVar);
      a.shAng = pose.shAng; a.shAngV = 0;
      a.elAng = pose.elBend; a.elAngV = 0;
      a.blAng = pose.shAng + pose.elBend + pose.wrBend; a.blAngV = 0;
      const wc = armChain(shFX, shFY, a.shAng, a.elAng);
      seg(shFX, shFY, wc.ex, wc.ey, wc.hx, wc.hy, 7);
      drawWeapon(wc.hx, wc.hy, a.blAng, 1);
      const kind = attackArc(a.atkType);
      if (kind === 'arc' || kind === 'chop' || kind === 'thrust') {                   // trail on melee arcs
        const wl = WLEN[cls.weapon] || 24;
        slashTrail.push({ x: player.x + wc.hx + Math.cos(a.blAng) * wl, y: (player.y - hoverY) + wc.hy + Math.sin(a.blAng) * wl, life: 220, c: cls.trail });
        if (slashTrail.length > 34) slashTrail.shift();
      }
    } else {
      // Resting holds (and rogue front hand holding guard while the off hand
      // swings); we capture the joint angles so the swing engine starts seamlessly.
      let handT, drawAim, stretch = 1;
      if (cls.weapon === 'lance') {
        drawAim = f > 0 ? -0.04 : Math.PI + 0.04;
        handT = { x: shX + f * 18, y: shY + 16 };
      } else if (cls.weapon === 'staff') {
        // two-hand staff grip; while flying the long staff stays upright and a
        // little forward so the arms read like they are steering it.
        drawAim = -Math.PI / 2 + f * (fly > 0.25 ? 0.24 : 0.16);
        handT = fly > 0.25 ? { x: shX + f * 15, y: shY + 8 } : { x: shX + f * 12, y: shY + 19 };
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
          ? { x: shX - player.flip.dir * (5 + flipCurl * 7), y: shY + 18 + flipCurl * 4 }
          : moveType === 'slide'
            ? { x: shX + f * 34, y: shY + 20 }
            : posture.down > 0 || posture.sweep > 0
              ? { x: shX + f * 18, y: shY + 27 }
            : { x: shX + f * 16, y: shY + 22 };
      } else if (cls.weapon === 'sword') {
        drawAim = f > 0 ? -0.20 : Math.PI + 0.20;
        handT = { x: shX + f * 14, y: shY + 18 };
      } else {
        handT = armHand(p + Math.PI);                                  // rest: swing opposite the back arm
        drawAim = null;
      }
      if (a.whx === null) { a.whx = handT.x; a.why = handT.y; }
      springTo(a, 'whx', handT.x, 150, 14, a._dt);
      springTo(a, 'why', handT.y, 150, 14, a._dt);
      ka = ik(shX, shY, a.whx, a.why, uArm * stretch, fArm * stretch, f);
      seg(shX, shY, ka.jx, ka.jy, ka.ex, ka.ey, 7 / Math.sqrt(stretch));
      let wAng = drawAim != null ? drawAim : Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx);
      if (knifeTrick) wAng += f * Math.PI * 4 * knifeTrick;
      drawWeapon(ka.ex, ka.ey, wAng, stretch);
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

  function drawDebugCapsule(ax, ay, bx, by, r, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 0.55 : alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, r * 2);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.globalAlpha *= 0.9;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function drawWorldDebug() {
    if (!debug.enabled || !player) return;
    if (debug.coins) {
      ctx.save();
      ctx.strokeStyle = '#d9a600';
      ctx.globalAlpha = 0.36;
      ctx.lineWidth = 1.5;
      for (const c of coinsLeft) if (!c.got) { ctx.beginPath(); ctx.arc(c.x, c.y, 11, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    if (debug.body) {
      for (const s of bodyCapsules()) drawDebugCapsule(s.ax, s.ay, s.bx, s.by, s.r, '#00a7ff', 0.22);
      if (fighters) for (const e of fighters) {
        for (const s of actorCapsules(e)) drawDebugCapsule(s.ax, s.ay, s.bx, s.by, s.r, e.cls.color || '#ff5a5a', 0.20);
      }
    }
    if (debug.dummies) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#7a5cff';
      ctx.fillStyle = '#7a5cff';
      for (const d of dummies) {
        for (const [a, b] of DUMMY_BONES) {
          const pa = d.pts[a], pb = d.pts[b];
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
        for (const k in d.pts) {
          const p = d.pts[k];
          ctx.beginPath(); ctx.arc(p.x, p.y, p.pin ? 3 : 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
    if (debug.weapons || debug.projectiles) for (const s of debug.segments) {
      if (s.kind === 'projectile' && !debug.projectiles) continue;
      if (s.kind !== 'projectile' && !debug.weapons) continue;
      drawDebugCapsule(s.ax, s.ay, s.bx, s.by, s.r, s.color, clamp(s.life / s.max, 0.12, 0.55));
    }
    if (debug.weapons && player.anim.atkActive && attackSpec(player.anim.atkType).kind === 'melee') {
      const a = player.anim, spec = attackSpec(a.atkType), sp = strikePoint(a.atkType);
      for (const off of spec.sweep || DEFAULT_ATTACK.sweep) {
        const s = meleeSegment(a.atkType, a.atkAim, clamp(sp + off, 0, 1));
        drawDebugCapsule(s.ax, s.ay, s.bx, s.by, s.r, '#ff405f', off === 0 ? 0.36 : 0.18);
      }
    }
  }
  function drawDebugPanel(moveAmt) {
    if (!debug.enabled || !player) return;
    const action = currentActionLayer();
    const move = player.move && player.move.active ? `${player.move.type} ${player.move.phase} ${player.move.t.toFixed(2)}` : 'idle';
    const atk = action.active ? `${action.type} ${action.phase} ${action.t.toFixed(2)}` : 'idle';
    const lines = [
      `DBG ${cls.name}`,
      `atk ${atk}`,
      `move ${move}`,
      `vel ${player.vx.toFixed(1)}, ${player.vy.toFixed(1)}  anim ${moveAmt.toFixed(2)}`,
      `body ${bodyCapsules().length}  traces ${debug.segments.length}`,
    ];
    ctx.save();
    ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textBaseline = 'top';
    const w = Math.max(...lines.map(s => ctx.measureText(s).width)) + 16;
    const h = lines.length * 16 + 12;
    const x = 12, y = 58;
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.strokeStyle = 'rgba(22,22,22,.22)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = '#161616';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + 8, y + 6 + i * 16);
    ctx.restore();
  }

  function render(moveAmt) {
    const L = levels[li];
    const camBase = { x: cam.x, y: cam.y };
    if (shakeT > 0) {
      const p = shakeP * clamp(shakeT / 180, 0, 1);
      cam.x += rand(-p, p);
      cam.y += rand(-p * 0.65, p * 0.65);
    }
    drawBackground(L);
    ctx.save();
    for (const p of L.platforms) drawPlatform(p);
    for (const c of coinsLeft) drawCoin(c);
    for (const b of boxes) drawBox(b);
    for (const d of dummies) drawDummy(d);
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
    // weapon swing trail: a bold fading arc (per-swing class colour) through the recent tips
    if (slashTrail.length > 1) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < slashTrail.length; i++) {
        const a0 = slashTrail[i - 1], a1 = slashTrail[i];
        const al = clamp(a1.life / 220, 0, 1);
        const [tr, tg, tb] = a1.c || cls.trail;
        ctx.strokeStyle = `rgba(${tr},${tg},${tb},${al * 0.85})`;
        ctx.lineWidth = 3 + al * 13;
        ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
      }
    }
    drawFighters();
    drawStick(moveAmt);
    drawWorldDebug();
    ctx.restore();
    cam.x = camBase.x; cam.y = camBase.y;
    drawDebugPanel(moveAmt);
  }

  // ---------- main loop (fixed-step physics + smooth anim/render) ----------
  let acc = 0;
  api.loop(dt => {
    if (state === 'playing') {
      if (shakeT > 0) {
        shakeT = Math.max(0, shakeT - dt);
        if (shakeT === 0) shakeP = 0;
      }
      if (freeze > 0) { freeze -= dt; }     // hit-stop: pause sim, hold the frame
      else {
        runTime += dt;
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard++ < 5) { physics(); updateFighters(STEP); acc -= STEP; if (state !== 'playing') break; }
        flagWave += dt * 0.006;
        // age effects: particles fly & fade; the sword trail fades out
        for (let i = particles.length - 1; i >= 0; i--) {
          const pt = particles[i]; pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.12; pt.life -= dt;
          if (pt.life <= 0) particles.splice(i, 1);
        }
        updateDroppedKnives(dt);
        for (let i = slashTrail.length - 1; i >= 0; i--) { if ((slashTrail[i].life -= dt) <= 0) slashTrail.splice(i, 1); }
        for (let i = debug.segments.length - 1; i >= 0; i--) { if ((debug.segments[i].life -= dt) <= 0) debug.segments.splice(i, 1); }
        const L = levels[li];
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
          if (crate) { const sp = Math.hypot(b.vx, b.vy) || 1; pushBox(crate, b.vx / sp, b.vy / sp, b.hit); addShake(b.kind === 'bolt' || b.kind === 'sigil' ? 2.8 : 1.2, 80); }
          const sp = Math.hypot(b.vx, b.vy) || 1;
          let struckActor = false;
          if ((b.team || 'hero') === 'enemy') {
            // enemy fire seeks the hero
            if (hero && !(hero.invuln > 0) && segHitActor(px, py, b.x, b.y, projectileRadius(b), hero)) {
              hurtHero(b.vx / sp, b.vy / sp, b.hit || 10, b.x, b.y); struckActor = true;
            }
          } else {
            // hero fire hits training dummies + enemy fighters
            if (dummies) for (const d of dummies) {
              const h = projectileHitsDummy(b, px, py, d);
              if (h) { hurtDummy(d, b.vx / sp, b.vy / sp, b.hit || 10, h.p.x, h.p.y); addShake(b.kind === 'bolt' || b.kind === 'sigil' ? 2.5 : 1.1, 75); struckActor = true; break; }
            }
            if (!struckActor && fighters) for (const e of fighters.slice()) {
              const h = segHitActor(px, py, b.x, b.y, projectileRadius(b), e);
              if (h) { hurtFighter(e, b.vx / sp, b.vy / sp, b.hit || 10, h.x, h.y); addShake(b.kind === 'bolt' || b.kind === 'sigil' ? 2.5 : 1.1, 75); struckActor = true; break; }
            }
          }
          rememberDebugSegment('projectile', px, py, b.x, b.y, projectileRadius(b), b.color, 120);
          const hitPlatform = L.platforms.some(pl => projectileHitsBox(b, px, py, pl));
          const dead = b.life <= 0 || crate || struckActor || hitPlatform;
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
    if (player && freeze <= 0) animateFighters(dt);
    if (player) render(moveAmt);
  });

  showMenu();
  // test seam (no-op in production): lets the headless harness drive internals
  if (typeof window !== 'undefined') {
    const testApi = {
      play, onStrike, triggerAttack,
      sampleMelee(type, t) {
        if (!player) return null;
        return meleeSegment(type || cls.main, player.anim.atkAim || (player.facing > 0 ? 0 : Math.PI), t == null ? strikePoint(type || cls.main) : t);
      },
      bodyCapsules() { return player ? bodyCapsules() : []; },
      playerBox() { return player ? actorBox(player) : null; },
      segDistance(a, b) { return segSegDist(a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by); },
      debugSegments() { return debug.segments.slice(); },
      get player() { return player; },
      get dummies() { return dummies; },
      get fighters() { return fighters; },
      get cls() { return cls; },
    };
    if (window.__stickTest) window.__stickTest(testApi);
    if (debug.enabled) window.__stickDebug = testApi;
  }
};

Arcade.register(PUBLIC);
})();

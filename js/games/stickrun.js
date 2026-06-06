/* Stick Arena — a wave-based stick-figure arena fighter with a procedural, IK-driven
   stick figure in a classic "stickman games" style: a bold solid-black
   figure on a light background. No sprites — every limb is solved each frame,
   giving a live run cycle, jump anticipation, landing squash-and-stretch and
   idle breathing. Controls: ←/→ or A/D to run, Space/↑/W to jump (hold for
   height), plus on-screen touch buttons. Single jump with coyote + buffer. */
(() => {
const PUBLIC = {
  id: 'stickrun',
  name: 'Stick Arena',
  emoji: '⚔️',
  desc: 'Pick a fighter, survive waves of class bots, and turn the arena into a brawl.',
  color: '#ff9f6e',
};

// ---------- tuning ----------
const STEP = 1000 / 60;          // fixed physics timestep (ms)
const GRA = 0.62, MAXV = 3.7, RUN_ACC = 0.7, AIR_ACC = 0.45;
const FRICTION = 0.80, JUMP = -12.4, TERMINAL = 15;
const COYOTE = 7, BUFFER = 7, CUT = 0.42;
const PW = 20, PH = 58;          // player collision box (w, h); y = feet (bottom)
const ROGUE_MAX_KNIVES = 6, ROGUE_REGEN = 1150, ROGUE_BURST_MAX = 3, ROGUE_BURST_REGEN = 900, ROGUE_QUEUE_MS = 540, ROGUE_QUEUE_FLASH_MS = 420;
const RANGER_MAX_ARROWS = 7, RANGER_REGEN = 1350, RANGER_DRAW_MAX = 900;
const RANGER_NOCK_TIME = 190, RANGER_RELOAD_TIME = 360, ARROW_GRAVITY = 0.13;
const KNIGHT_SHIELD_TIME = 1250;
const MAGE_HOVER_HEIGHT = 42;
const MAGE_HOVER_STEP = 92;
const MAGE_HOVER_DELAY = 165;
const MAGE_DEBRIS_MAX = 3;
const MAGE_DEBRIS_REGEN = 1250;
const ARENA_WAVE_DELAY = 850;
const ATTACK_COOLDOWN = {
  slash: 110, dualSlash: 80, rogueStab: 95, legSweep: 420,
  shieldBash: 560, braceThrust: 260, cast: 150, arrow: 100,
};
const ABILITY_COOLDOWN = {
  shieldGuard: 1750, throw: 260, lanceCharge: 2300, arcaneBloom: 1650, volley: 1200,
};
const MOVE_COOLDOWN = {
  slide: 520, airDash: 900, brace: 800, shieldStep: 760, backstep: 620,
};
const ACTION_COOLDOWN = Object.assign({}, ATTACK_COOLDOWN, ABILITY_COOLDOWN, MOVE_COOLDOWN);
const SLOT_UNLOCK_WAVE = { e: 1, shift: 2, q: 3 };
const SLOT_COOLDOWN = {
  e: 3200,
  shift: 1800,
  q: 9500,
  knight: { e: 2600, shift: 1700, q: 9000 },
  rogue: { e: 3000, shift: 1400, q: 8200 },
  lancer: { e: 2800, shift: 2100, q: 9800 },
  mage: { e: 3400, shift: 1800, q: 9600 },
  ranger: { e: 2800, shift: 1600, q: 8800 },
};

// ---------- RPG classes ----------
// weapon: how the held weapon is drawn; moves: primary attacks cycled per click;
// reach: weapon reach multiplier; speedMul: run-speed multiplier; trail: RGB of
// the swing/cast trail; dur: per-move animation lengths (ms); ranged: casts bolts.
const CLASSES = [
  { id: 'knight', name: 'Knight', emoji: '🗡️', color: '#5ea0ff', blurb: 'Heavy, grounded blade.',
    weapon: 'sword', offhand: 'shield', main: 'slash', alt: 'shieldGuard', move: 'shieldStep',
    reach: 1.0, speedMul: 0.98, trail: [120, 170, 255], dur: { slash: 380, shieldBash: 260, shieldGuard: 420 }, moveDur: { shieldStep: 320 },
    // armored duelist: grounded sword stance with a shield-side weight shift
    style: { hipH: 44, stanceW: 10, strideH: 12, lift: 9, bounceAmp: 4.4, cadence: 0.72, armStride: 8, baseLean: 0.01, squash: 1.25,
      breatheAmp: 1.9, breatheSpd: 0.0019, hover: 0, idle: 'shift', spring: { lean: [70, 20], head: [62, 20], aim: [135, 18] } } },
  { id: 'rogue', name: 'Rogue', emoji: '🔪', color: '#9cff5e', blurb: 'Fast thrown knives and slippery close-range backup.',
    weapon: 'dagger', main: 'throw', alt: 'dualSlash', move: 'slide',
    reach: 0.78, speedMul: 1.32, trail: [150, 255, 110], dur: { dualSlash: 210, rogueStab: 225, throw: 225, legSweep: 250 }, moveDur: { slide: 300 }, dual: true,
    // athletic & quick: low knife stance, long smooth strides, restless hands
    style: { hipH: 46, stanceW: 5, strideH: 15, lift: 7, bounceAmp: 1.0, cadence: 1.14, armStride: 12, baseLean: 0.08, squash: 0.9,
      breatheAmp: 1.1, breatheSpd: 0.0034, hover: 0, idle: 'sneak', spring: { lean: [150, 9], head: [120, 9], aim: [170, 12] } } },
  { id: 'lancer', name: 'Lancer', emoji: '🔱', color: '#ffd45e', blurb: 'Disciplined spear reach.',
    weapon: 'lance', main: 'braceThrust', alt: 'lanceCharge', move: 'brace',
    reach: 1.18, speedMul: 0.82, trail: [255, 212, 94], dur: { braceThrust: 520, lanceCharge: 1080 }, moveDur: { brace: 620 }, tank: true,
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

// ---------- loadouts, ability descriptions, and first-pass class trees ----------
const LOADOUT_SLOTS = ['attack', 'secondary', 'shift', 'e', 'q'];
const HELP_SLOTS = ['attack', 'secondary', 'shift', 'e', 'q', 'passive'];
const SLOT_LABEL = { attack: 'ATK', secondary: 'ALT', shift: 'SHIFT', jump: 'JUMP', e: 'E', q: 'Q', passive: 'KEY' };
const SLOT_KEY = { attack: 'Click / J', secondary: 'Right / L', shift: 'Shift', e: 'E', q: 'Q', passive: 'Passive' };
const CLASS_TREES = {
  knight: {
    branches: {
      bulwark: { name: 'Bulwark', desc: 'Shield/body control, cover, ally protection, and shove routes.' },
      avenger: { name: 'Avenger', desc: 'Block pressure, store it, then answer with counter-shockwaves.' },
      earthbreaker: { name: 'Earthbreaker', desc: 'Heavy sword impacts that launch crates, barrels, and enemies.' },
    },
  },
  rogue: {
    branches: {
      bladeslinger: { name: 'Bladeslinger', desc: 'Ranged knife pressure, recoverable blades, trick shots, and blade-control payoffs.' },
      acrobat: { name: 'Acrobat', desc: 'Slides, wall movement, vaults, sweeps, and air-control route attacks.' },
      nightshade: { name: 'Nightshade', desc: 'Smoke, poison, partial invisibility, ambush windows, and escape routes.' },
    },
  },
  lancer: {
    branches: {
      phalanx: { name: 'Phalanx', desc: 'Lane denial, bracing, pins, and defensive spear walls.' },
      dragoon: { name: 'Dragoon', desc: 'Committed charges, vaults, carries, and ring-out payoffs.' },
      harpooner: { name: 'Harpooner', desc: 'Hooks, tethers, pulls, and object/enemy repositioning.' },
    },
  },
  mage: {
    branches: {
      graviturge: { name: 'Graviturge', desc: 'Gravity cores, resonance pulses, pull/orbit control, and implosions.' },
      pyromancer: { name: 'Pyromancer', desc: 'Big fire AOE, burn zones, ignition, barrel pressure, and explosions.' },
      spiritbinder: { name: 'Spiritbinder', desc: 'Spirit charges, defeated enemies becoming followers, curses, and ally pressure.' },
    },
  },
  ranger: {
    branches: {
      sharpshooter: { name: 'Sharpshooter', desc: 'Power draw, wall pins, piercing lines, and ledge shots.' },
      trapper: { name: 'Trapper', desc: 'Snares, caltrops, spring traps, barrels, and prepared ground.' },
      beastwarden: { name: 'Beastwarden', desc: 'Marks, decoys, party commands, and ally pressure.' },
    },
  },
};
const ABILITIES = (() => {
  const A = {};
  const add = (id, spec) => { A[id] = Object.assign({ id, draft: true, tier: 1, tags: [] }, spec); };

  // Knight base + branches
  add('kn_slash', { cls: 'knight', slot: 'attack', branch: 'bulwark', tier: 0, name: 'Slash', desc: 'Balanced sword combo with a readable wind-up and clean knockback.', type: 'attack', action: 'slash', draft: false, tags: ['Weapon'] });
  add('kn_guard', { cls: 'knight', slot: 'secondary', branch: 'bulwark', tier: 0, name: 'Shield Guard', desc: 'Raise a large shield that blocks hits from the front for a short window.', type: 'attack', action: 'shieldGuard', draft: false, tags: ['Block'] });
  add('kn_step', { cls: 'knight', slot: 'shift', branch: 'bulwark', tier: 0, name: 'Shield Step', desc: 'Short armored step for staying in range without feeling slippery.', type: 'move', action: 'shieldStep', cd: 1700, draft: false, tags: ['Movement'] });
  add('kn_bash', { cls: 'knight', slot: 'e', branch: 'bulwark', tier: 0, name: 'Shield Bash', desc: 'Drive the shield forward to stagger and shove a target.', type: 'attack', action: 'shieldBash', cd: 2600, draft: false, tags: ['Push'] });
  add('kn_rally', { cls: 'knight', slot: 'q', branch: 'bulwark', tier: 0, name: 'Rally Guard', desc: 'Give yourself and nearby allies a shield burst.', type: 'custom', use: 'knightRally', cd: 9000, draft: false, tags: ['Allies', 'Block'] });
  add('kn_wall', { cls: 'knight', branch: 'bulwark', tier: 1, slot: 'e', name: 'Shield Wall', desc: 'Plant a temporary barricade that blocks bodies, catches projectiles, and can be shoved.', effect: { kind: 'barrier', w: 42, h: 78, life: 5200 }, cd: 3300, tags: ['Walls', 'Crates', 'Block'] });
  add('kn_guardstep', { cls: 'knight', branch: 'bulwark', tier: 2, slot: 'shift', name: 'Guard Step', desc: 'A slower step with a shield flash that body-checks nearby enemies and crates.', type: 'move', action: 'shieldStep', cd: 1450, tags: ['Movement', 'Crates'] });
  add('kn_dome', { cls: 'knight', branch: 'bulwark', tier: 3, slot: 'q', name: 'Rally Dome', desc: 'Large guard burst: shields allies, shoves enemies away, and clears crates around the party.', effect: { kind: 'rallyDome' }, cd: 9800, tags: ['Allies', 'Push', 'Crates'] });
  add('kn_bulwark', { cls: 'knight', branch: 'bulwark', tier: 4, slot: 'passive', name: 'Bulwark', desc: 'Keystone: guard blocks harder, and shield abilities shove bodies and objects harder.', key: true, tags: ['Block', 'Push'] });
  add('kn_riposte', { cls: 'knight', branch: 'avenger', tier: 1, slot: 'attack', name: 'Riposte Slash', desc: 'A tighter counter slash that releases extra force if you recently blocked.', type: 'attack', action: 'slash', tags: ['Counter', 'Weapon'] });
  add('kn_counterguard', { cls: 'knight', branch: 'avenger', tier: 1, slot: 'secondary', name: 'Vengeance Guard', desc: 'Guard stores more blocked impact for your next attack.', type: 'attack', action: 'shieldGuard', tags: ['Counter', 'Block'] });
  add('kn_counterlunge', { cls: 'knight', branch: 'avenger', tier: 2, slot: 'shift', name: 'Counter Lunge', desc: 'Short armored lunge that spends stored guard energy as a forward shove.', type: 'move', action: 'shoulder', cd: 1900, tags: ['Counter', 'Ledges'] });
  add('kn_punish', { cls: 'knight', branch: 'avenger', tier: 3, slot: 'e', name: 'Punish Quake', desc: 'Slam stored guard force into the ground, launching enemies and crates nearby.', type: 'attack', action: 'quake', cd: 3300, tags: ['Counter', 'Crates', 'Launch'] });
  add('kn_vengeance', { cls: 'knight', branch: 'avenger', tier: 4, slot: 'passive', name: 'Vengeance', desc: 'Keystone: blocked damage charges your next hit into a terrain shockwave.', key: true, tags: ['Counter', 'Shockwave'] });
  add('kn_crush', { cls: 'knight', branch: 'earthbreaker', tier: 1, slot: 'attack', name: 'Crush', desc: 'Heavier overhead chop. Slower, but it throws bodies, crates, and barrels harder.', type: 'attack', action: 'crush', tags: ['Crates', 'Barrels'] });
  add('kn_stomp', { cls: 'knight', branch: 'earthbreaker', tier: 1, slot: 'e', name: 'Stomp Launch', desc: 'Ground stomp that pops nearby enemies and loose objects upward.', effect: { kind: 'radial', force: 30, radius: 116, y: -0.85 }, cd: 3300, tags: ['Launch', 'Crates', 'Barrels'] });
  add('kn_cratebreaker', { cls: 'knight', branch: 'earthbreaker', tier: 2, slot: 'secondary', name: 'Crate Breaker', desc: 'A brutal shield chop that punts objects into enemies or barrels.', effect: { kind: 'line', range: 104, force: 38, radius: 18, y: -0.35 }, cd: 2200, tags: ['Crates', 'Barrels'] });
  add('kn_faultline', { cls: 'knight', branch: 'earthbreaker', tier: 3, slot: 'q', name: 'Faultline', desc: 'A long ground rupture that launches bodies and objects down a lane.', effect: { kind: 'faultline' }, cd: 9800, tags: ['Launch', 'Walls', 'Ledges'] });
  add('kn_aftershock', { cls: 'knight', branch: 'earthbreaker', tier: 4, slot: 'passive', name: 'Aftershock', desc: 'Keystone: heavy hits leave a delayed object-shoving aftershock.', key: true, tags: ['Crates', 'Shockwave'] });

  // Rogue base + branches
  add('rg_dual', { cls: 'rogue', branch: 'acrobat', tier: 0, slot: 'secondary', name: 'Twin Slash', desc: 'Close-range backup that alternates both daggers when enemies get inside your throw lane.', type: 'attack', action: 'dualSlash', draft: false, tags: ['Burst'] });
  add('rg_throw', { cls: 'rogue', branch: 'bladeslinger', tier: 0, slot: 'attack', name: 'Knife Toss', desc: 'Quick overhand knife throw. Consumes one knife, then can be recovered or regenerated.', type: 'attack', action: 'throw', draft: false, tags: ['Projectile'] });
  add('rg_slide', { cls: 'rogue', branch: 'acrobat', tier: 0, slot: 'shift', name: 'Slide', desc: 'Low evasive slide that changes your body hitbox.', type: 'move', action: 'slide', cd: 1400, draft: false, tags: ['Movement'] });
  add('rg_fan', { cls: 'rogue', branch: 'bladeslinger', tier: 0, slot: 'e', name: 'Fan Knives', desc: 'Spend up to five knives in a wide, readable spread.', type: 'custom', use: 'rogueFan', cd: 2400, draft: false, tags: ['Projectile'] });
  add('rg_storm', { cls: 'rogue', branch: 'bladeslinger', tier: 0, slot: 'q', name: 'Blade Barrage', desc: 'Summon twenty floating knives that stagger, then streak toward targets one after another.', type: 'custom', use: 'bladeBarrage', cd: 9000, draft: false, tags: ['Projectile', 'Burst'] });
  add('rg_stab', { cls: 'rogue', branch: 'acrobat', tier: 1, slot: 'attack', name: 'Needle Stabs', desc: 'A stab-heavy chain for tighter hitboxes and faster point pressure.', type: 'attack', action: 'rogueStab', tags: ['Burst'] });
  add('rg_dodgecut', { cls: 'rogue', branch: 'acrobat', tier: 1, slot: 'shift', name: 'Dodge Cut', desc: 'Slide through pressure and clip the nearest enemy as you pass.', effect: { kind: 'moveStrike', move: 'slide', range: 72, force: 17 }, cd: 1500, tags: ['Movement', 'Burst'] });
  add('rg_backstab', { cls: 'rogue', branch: 'nightshade', tier: 2, slot: 'e', name: 'Ambush Mark', desc: 'Vanish behind the closest front enemy and stab them toward a ledge.', effect: { kind: 'backstab', hidden: 1 }, cd: 3400, tags: ['Ledges', 'Stealth'] });
  add('rg_assassinate', { cls: 'rogue', branch: 'nightshade', tier: 4, slot: 'passive', name: 'Assassinate', desc: 'Keystone: hidden or smoke attacks hit wounded enemies with extra force.', key: true, tags: ['Burst', 'Stealth'] });
  add('rg_ricochet', { cls: 'rogue', branch: 'bladeslinger', tier: 1, slot: 'attack', name: 'Ricochet Knife', desc: 'Main knife throw bounces once off walls or crates before landing.', type: 'attack', action: 'throw', cd: 280, tags: ['Walls', 'Crates'] });
  add('rg_tripwire', { cls: 'rogue', branch: 'bladeslinger', tier: 1, slot: 'e', name: 'Needle Volley', desc: 'Throw a tight volley of knives that punches through lanes and rattles crates.', effect: { kind: 'knifeFan', count: 5, tight: 1, hit: 13 }, cd: 2200, tags: ['Projectile', 'Crates'] });
  add('rg_smoke', { cls: 'rogue', branch: 'nightshade', tier: 1, slot: 'shift', name: 'Smoke Slide', desc: 'Slide leaves a smoke pop, briefly hides your silhouette, and breaks enemy aim.', effect: { kind: 'smokeSlide', hidden: 1 }, cd: 1800, tags: ['Movement', 'Stealth'] });
  add('rg_explosive', { cls: 'rogue', branch: 'bladeslinger', tier: 3, slot: 'q', name: 'Explosive Knives', desc: 'Throw six heavy knives that burst barrels and shove enemies on impact.', effect: { kind: 'knifeFan', count: 6, explosive: 1, hit: 17 }, cd: 7600, tags: ['Barrels', 'Projectile'] });
  add('rg_trapmaster', { cls: 'rogue', branch: 'bladeslinger', tier: 4, slot: 'passive', name: 'Bladecaller', desc: 'Keystone: knife spreads throw one more blade, ricochet by default, and Blade Barrage adds extra seeking knives.', key: true, tags: ['Projectile', 'Barrels'] });
  add('rg_bladecall', { cls: 'rogue', branch: 'bladeslinger', tier: 2, slot: 'secondary', name: 'Bladecall', desc: 'Recall dropped knives toward you, cutting through enemies on the way back.', effect: { kind: 'bladeRecall' }, cd: 2200, tags: ['Projectile', 'Pull'] });
  add('rg_poisonknife', { cls: 'rogue', branch: 'nightshade', tier: 1, slot: 'secondary', name: 'Poison Knife', desc: 'Throw a quiet knife that poisons targets and leaves a faint toxic trail.', effect: { kind: 'knife', count: 1, poison: 1 }, cd: 760, tags: ['Projectile', 'Poison'] });
  add('rg_smokebomb', { cls: 'rogue', branch: 'nightshade', tier: 2, slot: 'e', name: 'Smoke Bomb', desc: 'Throw a bomb that bursts into a thick drifting smoke cloud, hiding movement and breaking enemy aim.', effect: { kind: 'smokeBomb', r: 154, life: 1900, range: 440 }, cd: 3200, tags: ['Stealth', 'Control'] });
  add('rg_venomcloud', { cls: 'rogue', branch: 'nightshade', tier: 3, slot: 'q', name: 'Venom Cloud', desc: 'Throw a heavier poison bomb that rolls out a choking green cloud and weakens enemies inside.', effect: { kind: 'smokeBomb', r: 218, life: 3000, range: 520, poison: 1 }, cd: 8800, tags: ['Stealth', 'Poison', 'Field'] });
  add('rg_nightshade', { cls: 'rogue', branch: 'nightshade', tier: 4, slot: 'passive', name: 'Nightshade', desc: 'Keystone: smoke and poison windows make enemies lose target lock for longer.', key: true, tags: ['Stealth', 'Poison'] });
  add('rg_sweep', { cls: 'rogue', branch: 'acrobat', tier: 1, slot: 'attack', name: 'Low Sweep', desc: 'A low control strike that pairs with crouch and slide play.', type: 'attack', action: 'legSweep', tags: ['Control'] });
  add('rg_wallkick', { cls: 'rogue', branch: 'acrobat', tier: 1, slot: 'shift', name: 'Wall Kick', desc: 'A rising slide-vault that helps cross platforms and kicks enemies upward.', effect: { kind: 'vaultStrike' }, cd: 1600, tags: ['Movement', 'Launch'] });
  add('rg_vaulttoss', { cls: 'rogue', branch: 'acrobat', tier: 2, slot: 'e', name: 'Vault Toss', desc: 'Vault over a close target and kick them back toward the room.', effect: { kind: 'vaultToss' }, cd: 3200, tags: ['Movement', 'Ledges'] });
  add('rg_airspiral', { cls: 'rogue', branch: 'acrobat', tier: 3, slot: 'q', name: 'Air Spiral', desc: 'Leap and carve a circular air slash that launches clustered enemies.', effect: { kind: 'airSpiral' }, cd: 8400, tags: ['Launch', 'Movement'] });
  add('rg_bloodrush', { cls: 'rogue', branch: 'acrobat', tier: 4, slot: 'passive', name: 'Bloodrush', desc: 'Keystone: each KO refunds Shift and gives a brief invulnerable movement window.', key: true, tags: ['Movement'] });

  // Lancer base + branches
  add('ln_thrust', { cls: 'lancer', branch: 'phalanx', tier: 0, slot: 'attack', name: 'Brace Thrust', desc: 'Pure forward lance stab with long reach.', type: 'attack', action: 'braceThrust', draft: false, tags: ['Reach'] });
  add('ln_charge', { cls: 'lancer', branch: 'dragoon', tier: 0, slot: 'secondary', name: 'Lance Charge', desc: 'Long forced run charge. Pick a direction, then commit.', type: 'attack', action: 'lanceCharge', draft: false, tags: ['Ledges'] });
  add('ln_brace', { cls: 'lancer', branch: 'phalanx', tier: 0, slot: 'shift', name: 'Brace Step', desc: 'Heavy reposition that keeps the lance in front.', type: 'move', action: 'brace', cd: 2100, draft: false, tags: ['Movement'] });
  add('ln_anchor', { cls: 'lancer', branch: 'phalanx', tier: 0, slot: 'e', name: 'Anchor Thrust', desc: 'Plant and stab through a long lane, excellent near ledges.', type: 'custom', use: 'lancerAnchor', cd: 2800, draft: false, tags: ['Reach', 'Ledges'] });
  add('ln_breaker', { cls: 'lancer', branch: 'dragoon', tier: 0, slot: 'q', name: 'Breaker Charge', desc: 'A huge forward stab-charge meant to ring enemies out.', type: 'attack', action: 'lanceCharge', cd: 9800, draft: false, tags: ['Ledges'] });
  add('ln_spearwall', { cls: 'lancer', branch: 'phalanx', tier: 1, slot: 'e', name: 'Spear Wall', desc: 'Create a braced line that pokes enemies and blocks narrow routes.', effect: { kind: 'spearWall' }, cd: 3200, tags: ['Walls', 'Reach'] });
  add('ln_pin', { cls: 'lancer', branch: 'phalanx', tier: 2, slot: 'attack', name: 'Pinning Thrust', desc: 'A precise thrust that spikes enemies into nearby walls or crates.', type: 'attack', action: 'braceThrust', tags: ['Walls', 'Crates'] });
  add('ln_fortress', { cls: 'lancer', branch: 'phalanx', tier: 3, slot: 'q', name: 'Fortress Line', desc: 'A long defensive shock line that pushes enemies away from your lane.', effect: { kind: 'fortressLine' }, cd: 9800, tags: ['Walls', 'Push'] });
  add('ln_ironstance', { cls: 'lancer', branch: 'phalanx', tier: 4, slot: 'passive', name: 'Iron Stance', desc: 'Keystone: standing still primes your next lance hit for extra force and ignores knockback.', key: true, tags: ['Reach', 'Block'] });
  add('ln_skewer', { cls: 'lancer', branch: 'dragoon', tier: 1, slot: 'attack', name: 'Skewer', desc: 'Even longer committed stab that locks your body into the line.', type: 'attack', action: 'lanceCharge', tags: ['Ledges', 'Reach'] });
  add('ln_vault', { cls: 'lancer', branch: 'dragoon', tier: 1, slot: 'e', name: 'Vault Pin', desc: 'A pole-vault style hit that pops enemies upward.', type: 'move', action: 'vault', cd: 3000, tags: ['Launch', 'Movement'] });
  add('ln_carry', { cls: 'lancer', branch: 'dragoon', tier: 2, slot: 'secondary', name: 'Impale Carry', desc: 'Charge carries the first enemy or crate farther before releasing it.', effect: { kind: 'impaleCarry' }, cd: 2600, tags: ['Ledges', 'Crates'] });
  add('ln_momentum', { cls: 'lancer', branch: 'dragoon', tier: 4, slot: 'passive', name: 'Momentum Lance', desc: 'Keystone: lance charges gain extra force near ledges or after a long run.', key: true, tags: ['Ledges'] });
  add('ln_hookthrust', { cls: 'lancer', branch: 'harpooner', tier: 1, slot: 'attack', name: 'Hook Thrust', desc: 'Thrust tags the target with a short yank toward your lance line.', effect: { kind: 'tetherLine', range: 150, pull: 7 }, cd: 500, tags: ['Pull', 'Ledges'] });
  add('ln_chain', { cls: 'lancer', branch: 'harpooner', tier: 1, slot: 'secondary', name: 'Chain Lance', desc: 'Throw a tether point that drags the nearest enemy or crate toward you.', effect: { kind: 'pull', range: 300, all: 0, force: 8.5 }, cd: 1800, tags: ['Pull', 'Crates'] });
  add('ln_reel', { cls: 'lancer', branch: 'harpooner', tier: 2, slot: 'shift', name: 'Reel Step', desc: 'Step backward while pulling a tagged target into the danger zone.', effect: { kind: 'reelStep' }, cd: 1900, tags: ['Pull', 'Movement'] });
  add('ln_maw', { cls: 'lancer', branch: 'harpooner', tier: 3, slot: 'q', name: 'Maw', desc: 'Drag all enemies and loose objects in front into one narrow lane.', effect: { kind: 'pull', range: 360, all: 1, force: 10.5 }, cd: 9400, tags: ['Pull', 'Crates'] });
  add('ln_tethermaster', { cls: 'lancer', branch: 'harpooner', tier: 4, slot: 'passive', name: 'Tether Master', desc: 'Keystone: pulls also tug crates/barrels and briefly slow enemies after the yank.', key: true, tags: ['Pull', 'Crates'] });

  // Mage base + branches
  add('mg_bolt', { cls: 'mage', branch: 'graviturge', tier: 0, slot: 'attack', name: 'Debris Throw', desc: 'Lift a rock or dense gravity orb around the staff, then hurl it for direct damage and object knockback.', effect: { kind: 'gravityDebris', power: 1.0 }, cd: 260, draft: false, tags: ['Gravity', 'Projectile', 'Crates'] });
  add('mg_bloom', { cls: 'mage', branch: 'graviturge', tier: 0, slot: 'secondary', name: 'Gravity Bloom', desc: 'Shoot a seed that blooms into a zero-gravity pull field.', type: 'attack', action: 'arcaneBloom', draft: false, tags: ['Gravity'] });
  add('mg_dash', { cls: 'mage', branch: 'graviturge', tier: 0, slot: 'shift', name: 'Air Dash', desc: 'Short hovering burst. Best for crossing gaps or slipping past pressure.', type: 'move', action: 'airDash', cd: 1800, draft: false, tags: ['Movement'] });
  add('mg_sigil', { cls: 'mage', branch: 'stormcaller', tier: 0, slot: 'e', name: 'Arc Sigil', desc: 'Launch a sigil that pops into a burst of small bolts.', type: 'custom', use: 'mageSigil', cd: 3400, draft: false, tags: ['Projectile'] });
  add('mg_singularity', { cls: 'mage', branch: 'graviturge', tier: 0, slot: 'q', name: 'Black Hole', desc: 'Create a violent black hole that drags enemies, debris, crates, and dummies inward, damages them, then collapses hard.', effect: { kind: 'blackHole', r: 265, life: 2200, range: 620, force: 1.15 }, cd: 9800, draft: false, tags: ['Gravity', 'Pull', 'Crates'] });
  add('mg_staff', { cls: 'mage', branch: 'graviturge', tier: 1, slot: 'attack', name: 'Staff Sweep', desc: 'Close-range staff arc that knocks clustered enemies into your fields.', type: 'attack', action: 'staffSweep', tags: ['Gravity', 'Push'] });
  add('mg_updraft', { cls: 'mage', branch: 'graviturge', tier: 1, slot: 'e', name: 'Mass Slam', desc: 'Grab nearby mass at the cursor and slam enemies, crates, barrels, and dummies downward into the arena.', effect: { kind: 'massSlam', force: 28, radius: 154, range: 380 }, cd: 3300, tags: ['Gravity', 'Damage', 'Crates'] });
  add('mg_gravitywell', { cls: 'mage', branch: 'graviturge', tier: 2, slot: 'secondary', name: 'Gravity Well', desc: 'A shorter-range bloom that opens faster and pulls crates harder.', effect: { kind: 'field', r: 178, life: 2400, range: 360 }, cd: 1900, tags: ['Gravity', 'Crates'] });
  add('mg_gravitycore', { cls: 'mage', branch: 'graviturge', tier: 5, slot: 'e', name: 'Gravity Core', desc: 'Event Horizon prototype: place one persistent core that slowly pulls enemies, dummies, crates, and barrels.', effect: { kind: 'gravityCore', r: 205, range: 460 }, cd: 2600, tags: ['Gravity', 'Crates', 'Field'] });
  add('mg_truehorizon', { cls: 'mage', branch: 'graviturge', tier: 5, slot: 'q', name: 'True Horizon', desc: 'Event Horizon prototype: collapse the active Gravity Core into a larger implosion. If no core exists, create a short singularity.', effect: { kind: 'trueHorizon' }, cd: 10500, tags: ['Gravity', 'Pull', 'Crates'] });
  add('mg_resonance', { cls: 'mage', branch: 'graviturge', tier: 4, slot: 'passive', name: 'Resonance', desc: 'Keystone: repeated spellcasting adds extra echo pressure near affected enemies.', key: true, tags: ['Gravity', 'Projectile'] });
  add('mg_eventhorizon', { cls: 'mage', branch: 'graviturge', tier: 5, slot: 'passive', name: 'Event Horizon', desc: 'Advanced variation: Gravity Core lasts longer, pulls objects harder, and makes core detonation the build payoff.', key: true, tags: ['Gravity', 'Field'] });
  add('mg_resonancepulse', { cls: 'mage', branch: 'graviturge', tier: 3, slot: 'q', name: 'Resonance Pulse', desc: 'Pulse the active Gravity Core outward. Without a core, staff-slam a local shockwave.', effect: { kind: 'resonancePulse' }, cd: 7200, tags: ['Gravity', 'Shockwave', 'Crates'] });
  add('mg_firebolt', { cls: 'mage', branch: 'pyromancer', tier: 1, slot: 'attack', name: 'Firebolt', desc: 'Fast staff-led fire shot. It scorches a small pocket, burns targets, and starts the heat chain.', effect: { kind: 'firebolt', power: 1.18, scorch: 1 }, cd: 240, tags: ['Fire', 'Projectile', 'Burn'] });
  add('mg_flamepool', { cls: 'mage', branch: 'pyromancer', tier: 1, slot: 'secondary', name: 'Flame Flow', desc: 'Pour fire from the staff so it crawls across nearby ground, crates, and barrels instead of appearing from nowhere.', effect: { kind: 'groundFireFlow', range: 320, life: 1550, lanes: 5 }, cd: 2200, tags: ['Fire', 'Field', 'Barrels'] });
  add('mg_flamebreath', { cls: 'mage', branch: 'pyromancer', tier: 2, slot: 'secondary', name: 'Flame Breath', desc: 'Channel a dense stream of fire and smoke from the staff, pushing bodies and heating barrels in its path.', effect: { kind: 'flameBreath', range: 286, life: 760, cone: 0.56, force: 15, heat: 20 }, cd: 1750, tags: ['Fire', 'Burn', 'Barrels', 'Push'] });
  add('mg_ignite', { cls: 'mage', branch: 'pyromancer', tier: 2, slot: 'e', name: 'Ignition Burst', desc: 'Throw a small fire orb from the staff. It bursts on impact, drags an afterburn trail across the floor, and detonates burning targets or hot barrels.', effect: { kind: 'fireBurst', r: 164, range: 520, force: 31, snap: 190, chain: 1 }, cd: 3200, tags: ['Fire', 'Barrels', 'Push'] });
  add('mg_inferno', { cls: 'mage', branch: 'pyromancer', tier: 4, slot: 'q', name: 'Dragon Breath', desc: 'Unleash a huge staff-driven fire torrent. Walls cut it off, objects catch heat, and the floor burns where the flame lands.', effect: { kind: 'dragonBreath', range: 760, life: 1350, cone: 0.42, force: 34, heat: 48 }, cd: 9600, tags: ['Fire', 'Burn', 'Barrels', 'Push'] });
  add('mg_pyromancy', { cls: 'mage', branch: 'pyromancer', tier: 4, slot: 'passive', name: 'Pyromancy', desc: 'Keystone: fire abilities feed lingering ground flames, hot objects glow harder, and Ignition chains farther.', key: true, tags: ['Fire', 'Barrels'] });
  add('mg_spiritbolt', { cls: 'mage', branch: 'spiritbinder', tier: 1, slot: 'attack', name: 'Spirit Bolt', desc: 'Staff-shot soul wisp. Hits tug loose essence toward you and help fuel later bindings.', effect: { kind: 'spiritBolt' }, cd: 320, tags: ['Spirit', 'Projectile'] });
  add('mg_bindspirit', { cls: 'mage', branch: 'spiritbinder', tier: 1, slot: 'secondary', name: 'Bind Spirit', desc: 'Guide the nearest remnant from a defeated body into a temporary ally that remembers its old class.', effect: { kind: 'bindSpirit' }, cd: 2800, tags: ['Spirit', 'Allies'] });
  add('mg_soulflare', { cls: 'mage', branch: 'spiritbinder', tier: 2, slot: 'e', name: 'Soul Flare', desc: 'Shepherd your bound spirits and loose remnants toward a target, making them lash and shove objects on the way.', effect: { kind: 'soulFlare' }, cd: 3600, tags: ['Spirit', 'Allies', 'Push'] });
  add('mg_gravecall', { cls: 'mage', branch: 'spiritbinder', tier: 4, slot: 'q', name: 'Grave Call', desc: 'Call visible remnants first, raising defeated enemies as a short-lived spirit pack before spending stored charges.', effect: { kind: 'graveCall' }, cd: 9800, tags: ['Spirit', 'Allies'] });
  add('mg_spiritbinder', { cls: 'mage', branch: 'spiritbinder', tier: 4, slot: 'passive', name: 'Spiritbinder', desc: 'Keystone: defeated enemies leave guideable soul remnants instead of instantly becoming generic summons.', key: true, tags: ['Spirit', 'Allies'] });
  add('mg_windbolt', { cls: 'mage', branch: 'stormcaller', tier: 1, slot: 'attack', name: 'Wind Bolt', desc: 'A quick bolt that shoves targets and barrels instead of only damaging them.', effect: { kind: 'bolt', power: 1.15, wind: 1 }, cd: 180, tags: ['Push', 'Projectile'] });
  add('mg_gust', { cls: 'mage', branch: 'stormcaller', tier: 1, slot: 'shift', name: 'Gust Hover', desc: 'Air dash leaves a wind burst that knocks enemies and crates away.', effect: { kind: 'gustDash' }, cd: 1900, tags: ['Movement', 'Crates'] });
  add('mg_chain', { cls: 'mage', branch: 'stormcaller', tier: 2, slot: 'e', name: 'Chain Spark', desc: 'Lightning jumps through enemies, metal objects, and crates in a short chain.', effect: { kind: 'chain', jumps: 4 }, cd: 3100, tags: ['Crates', 'Projectile'] });
  add('mg_tempest', { cls: 'mage', branch: 'stormcaller', tier: 3, slot: 'q', name: 'Tempest', desc: 'A wide storm field that repeatedly bumps bodies, barrels, and projectiles.', effect: { kind: 'tempest' }, cd: 9300, tags: ['Field', 'Barrels'] });
  add('mg_overcharge', { cls: 'mage', branch: 'stormcaller', tier: 4, slot: 'passive', name: 'Overcharge', desc: 'Keystone: every fourth spell chains a small lightning burst through nearby objects.', key: true, tags: ['Crates', 'Projectile'] });
  add('mg_phase', { cls: 'mage', branch: 'riftweaver', tier: 1, slot: 'shift', name: 'Phase Step', desc: 'A longer air dash that briefly phases through enemies and crates.', type: 'move', action: 'airDash', cd: 1700, tags: ['Movement'] });
  add('mg_swap', { cls: 'mage', branch: 'riftweaver', tier: 1, slot: 'e', name: 'Swap Sigil', desc: 'Swap places with the nearest front enemy or loose object, then pop them upward.', effect: { kind: 'swap' }, cd: 3600, tags: ['Crates', 'Movement'] });
  add('mg_portal', { cls: 'mage', branch: 'riftweaver', tier: 2, slot: 'secondary', name: 'Portal Shot', desc: 'A bolt that reappears farther along its aim line after the first hit.', effect: { kind: 'portalShot' }, cd: 1600, tags: ['Walls', 'Projectile'] });
  add('mg_collapse', { cls: 'mage', branch: 'riftweaver', tier: 3, slot: 'q', name: 'Rift Collapse', desc: 'Open a short rift, then collapse it to pull enemies and objects through.', effect: { kind: 'riftCollapse' }, cd: 9400, tags: ['Pull', 'Crates'] });
  add('mg_echo', { cls: 'mage', branch: 'riftweaver', tier: 4, slot: 'passive', name: 'Echo', desc: 'Keystone: the first E or secondary spell after Q echoes once at reduced force.', key: true, tags: ['Projectile', 'Gravity'] });

  // Ranger base + branches
  add('rn_arrow', { cls: 'ranger', branch: 'sharpshooter', tier: 0, slot: 'attack', name: 'Draw Shot', desc: 'Hold and release a gravity-affected arrow.', type: 'attack', action: 'arrow', draft: false, tags: ['Projectile'] });
  add('rn_volley', { cls: 'ranger', branch: 'beastwarden', tier: 0, slot: 'secondary', name: 'Volley Draw', desc: 'Hold and release a three-arrow shot from the quiver.', type: 'attack', action: 'volley', draft: false, tags: ['Projectile'] });
  add('rn_backstep', { cls: 'ranger', branch: 'sharpshooter', tier: 0, slot: 'shift', name: 'Backstep', desc: 'Quick retreat that resets bow spacing.', type: 'move', action: 'backstep', cd: 1600, draft: false, tags: ['Movement'] });
  add('rn_kickshot', { cls: 'ranger', branch: 'sharpshooter', tier: 0, slot: 'e', name: 'Power Shot', desc: 'Instant heavy arrow that pierces and pushes.', type: 'custom', use: 'rangerPower', cd: 2800, draft: false, tags: ['Ledges', 'Projectile'] });
  add('rn_arrowstorm', { cls: 'ranger', branch: 'sharpshooter', tier: 0, slot: 'q', name: 'Arrow Storm', desc: 'Fan of arrows for covering a lane or finishing a clump.', type: 'custom', use: 'rangerStorm', cd: 8800, draft: false, tags: ['Projectile'] });
  add('rn_power', { cls: 'ranger', branch: 'sharpshooter', tier: 1, slot: 'attack', name: 'Power Draw', desc: 'Heavier draw shot for knocking bots toward hazards.', type: 'custom', use: 'rangerPower', cd: 650, tags: ['Ledges', 'Projectile'] });
  add('rn_wallpin', { cls: 'ranger', branch: 'sharpshooter', tier: 1, slot: 'e', name: 'Wall Pin', desc: 'Pin an enemy or crate against a wall, briefly freezing its momentum.', effect: { kind: 'wallPin' }, cd: 3100, tags: ['Walls', 'Crates'] });
  add('rn_pierce', { cls: 'ranger', branch: 'sharpshooter', tier: 2, slot: 'secondary', name: 'Piercing Arrow', desc: 'A narrow shot that pierces enemies and crates in a line.', effect: { kind: 'arrow', power: 1.35, pierce: 2 }, cd: 1200, tags: ['Crates', 'Projectile'] });
  add('rn_hunter', { cls: 'ranger', branch: 'sharpshooter', tier: 4, slot: 'passive', name: "Hunter's Mark", desc: 'Keystone: after a KO, your next shots and movement become snappier.', key: true, tags: ['Ledges'] });
  add('rn_snare', { cls: 'ranger', branch: 'trapper', tier: 1, slot: 'e', name: 'Snare Arrow', desc: 'Fire a tethering arrow that yanks the nearest foe or crate backward.', effect: { kind: 'pull', range: 240, all: 0, force: 7 }, cd: 3000, tags: ['Pull', 'Crates'] });
  add('rn_caltrops', { cls: 'ranger', branch: 'trapper', tier: 1, slot: 'secondary', name: 'Caltrops', desc: 'Scatter a low hazard that trips enemies and nudges crates.', effect: { kind: 'trap', trap: 'caltrops' }, cd: 2100, tags: ['Traps', 'Control'] });
  add('rn_springtrap', { cls: 'ranger', branch: 'trapper', tier: 2, slot: 'shift', name: 'Spring Trap', desc: 'Hop backward and leave a spring pad that launches enemies, allies, or boxes.', effect: { kind: 'springTrap' }, cd: 2200, tags: ['Traps', 'Launch', 'Crates'] });
  add('rn_barrelshot', { cls: 'ranger', branch: 'trapper', tier: 2, slot: 'e', name: 'Barrel Shot', desc: 'Shoot or spawn an explosive barrel, then use arrows to detonate it.', effect: { kind: 'barrelShot' }, cd: 3600, tags: ['Barrels', 'Projectile'] });
  add('rn_minevolley', { cls: 'ranger', branch: 'trapper', tier: 3, slot: 'q', name: 'Mine Volley', desc: 'Lob three spring mines that turn a route into a launch trap.', effect: { kind: 'mineVolley' }, cd: 9300, tags: ['Traps', 'Launch'] });
  add('rn_prepared', { cls: 'ranger', branch: 'trapper', tier: 4, slot: 'passive', name: 'Prepared Ground', desc: 'Keystone: traps last longer and trigger with stronger launch force.', key: true, tags: ['Traps'] });
  add('rn_markshot', { cls: 'ranger', branch: 'beastwarden', tier: 1, slot: 'attack', name: 'Mark Shot', desc: 'Draw shot marks enemies so allies shove them toward hazards.', type: 'attack', action: 'arrow', tags: ['Allies', 'Projectile'] });
  add('rn_decoy', { cls: 'ranger', branch: 'beastwarden', tier: 1, slot: 'e', name: 'Decoy Call', desc: 'Summon a fragile decoy ally that pulls aggro and blocks a lane.', effect: { kind: 'decoy' }, cd: 3900, tags: ['Allies', 'Walls'] });
  add('rn_packcmd', { cls: 'ranger', branch: 'beastwarden', tier: 2, slot: 'secondary', name: 'Pack Command', desc: 'Command nearby allies to surge forward and body-check enemies.', effect: { kind: 'packCommand' }, cd: 4200, tags: ['Allies', 'Push'] });
  add('rn_hunt', { cls: 'ranger', branch: 'beastwarden', tier: 3, slot: 'q', name: 'Hunt', desc: 'Mark the room: allies and arrows push all marked enemies toward ledges.', effect: { kind: 'hunt' }, cd: 9200, tags: ['Allies', 'Ledges'] });
  add('rn_packbond', { cls: 'ranger', branch: 'beastwarden', tier: 4, slot: 'passive', name: 'Pack Bond', desc: 'Keystone: your party becomes the build focus; KOs can spawn a temporary rogue ally.', key: true, tags: ['Allies'] });

  // V2 branch supplements and advanced variations. These are intentionally
  // data-driven: the first pass makes every planned build selectable/playable,
  // then each family can get deeper bespoke animation polish in the lab.
  add('kn_guardian_oath', { cls: 'knight', branch: 'bulwark', tier: 1, slot: 'passive', name: 'Guardian Oath', desc: 'Class mechanic: blocks and shield hits build Guard Plates that improve shield shoves.', key: true, tags: ['Block', 'Push'] });
  add('kn_shieldcut', { cls: 'knight', branch: 'bulwark', tier: 2, slot: 'attack', name: 'Shield-Cut', desc: 'Cut safely from behind the shield. Shorter reach, better protection and shove.', type: 'attack', action: 'slash', tags: ['Block', 'Weapon'] });
  add('kn_guardbreaker', { cls: 'knight', branch: 'bulwark', tier: 2, slot: 'attack', name: 'Guard Breaker', desc: 'Shield edge into sword thrust. Slower, but breaks guards and punts objects.', type: 'attack', action: 'shieldBash', tags: ['Block', 'Crates'] });
  add('kn_coverhop', { cls: 'knight', branch: 'bulwark', tier: 2, slot: 'shift', name: 'Cover Hop', desc: 'Hop backward while keeping the shield pointed forward, leaving a fading cover panel.', effect: { kind: 'coverHop' }, cd: 1500, tags: ['Block', 'Movement'] });
  add('kn_aegis', { cls: 'knight', branch: 'bulwark', tier: 5, slot: 'passive', name: 'Aegis Captain', desc: 'Advanced variation: shield walls, allies, and cover points link into team protection.', key: true, prereqAll: ['kn_wall', 'kn_guardstep'], tags: ['Allies', 'Block'] });
  add('kn_linkedcover', { cls: 'knight', branch: 'bulwark', tier: 5, slot: 'e', name: 'Linked Cover', desc: 'Place a linked shield panel. Nearby crates, walls, and allies reduce incoming force.', effect: { kind: 'aegisLink' }, cd: 3200, prereq: 'kn_aegis', tags: ['Allies', 'Walls', 'Crates'] });
  add('kn_intercept', { cls: 'knight', branch: 'bulwark', tier: 5, slot: 'shift', name: 'Intercept Step', desc: 'Step into the lane between an ally/cover point and the closest threat.', effect: { kind: 'intercept' }, cd: 1900, prereq: 'kn_aegis', tags: ['Allies', 'Movement'] });
  add('kn_captainsrally', { cls: 'knight', branch: 'bulwark', tier: 5, slot: 'q', name: "Captain's Rally", desc: 'A smaller Rally Dome that follows the party and shoves enemies away from allies.', effect: { kind: 'rallyDome', follow: 1 }, cd: 9800, prereq: 'kn_aegis', tags: ['Allies', 'Block', 'Push'] });
  add('kn_lastline', { cls: 'knight', branch: 'bulwark', tier: 5, slot: 'passive', name: 'Last Line', desc: 'Keystone: broken cover releases a shove pulse and grants Resolve.', key: true, prereq: ['kn_linkedcover', 'kn_intercept', 'kn_captainsrally'], tags: ['Allies', 'Push'] });

  add('kn_reprisaledge', { cls: 'knight', branch: 'avenger', tier: 2, slot: 'attack', name: 'Reprisal Edge', desc: 'A slow heavy counter slash that hits harder shortly after taking/blocking pressure.', type: 'attack', action: 'crush', tags: ['Counter', 'Weapon'] });
  add('kn_ironpivot', { cls: 'knight', branch: 'avenger', tier: 2, slot: 'shift', name: 'Iron Pivot', desc: 'Quick defensive turn with guard active, useful when enemies cross over.', effect: { kind: 'ironPivot' }, cd: 1250, tags: ['Counter', 'Block'] });
  add('kn_storedshock', { cls: 'knight', branch: 'avenger', tier: 3, slot: 'e', name: 'Stored Shockwave', desc: 'Release stored blocked force as a floor wave that detonates objects.', effect: { kind: 'debtPulse', force: 24, range: 180 }, cd: 3300, tags: ['Counter', 'Shockwave', 'Barrels'] });
  add('kn_mirrorguard', { cls: 'knight', branch: 'avenger', tier: 3, slot: 'e', name: 'Mirror Guard', desc: 'Brief reflective guard. Projectiles and melee pressure rebound sideways.', effect: { kind: 'mirrorGuard' }, cd: 2900, tags: ['Counter', 'Block', 'Projectile'] });
  add('kn_unbroken', { cls: 'knight', branch: 'avenger', tier: 5, slot: 'passive', name: 'Unbroken Vow', desc: 'Keystone: high Vengeance can prevent a lethal hit and pulse enemies away.', key: true, prereq: ['kn_vengeance', 'kn_punish'], tags: ['Counter', 'Block'] });
  add('kn_vowbreaker', { cls: 'knight', branch: 'avenger', tier: 5, slot: 'passive', name: 'Vowbreaker', desc: 'Advanced variation: mark Pain Debt, then cash it out through terrain shock.', key: true, prereqAll: ['kn_counterguard', 'kn_punish', 'kn_crush'], tags: ['Counter', 'Walls'] });
  add('kn_debtmark', { cls: 'knight', branch: 'avenger', tier: 5, slot: 'passive', name: 'Debt Mark', desc: 'Perfect blocks and heavy hits mark enemies for delayed terrain punishment.', key: true, prereq: 'kn_vowbreaker', tags: ['Counter', 'Mark'] });
  add('kn_sentence', { cls: 'knight', branch: 'avenger', tier: 5, slot: 'attack', name: 'Sentence Slam', desc: 'Ground slam that cashes Pain Debt on enemies near terrain or objects.', type: 'attack', action: 'crush', prereq: 'kn_vowbreaker', tags: ['Counter', 'Walls'] });
  add('kn_trialpulse', { cls: 'knight', branch: 'avenger', tier: 5, slot: 'e', name: 'Trial Pulse', desc: 'Short pulse that detonates debt-marked targets and barrels in front.', effect: { kind: 'debtPulse', force: 34, range: 230 }, cd: 3300, prereq: 'kn_vowbreaker', tags: ['Counter', 'Barrels'] });
  add('kn_noescape', { cls: 'knight', branch: 'avenger', tier: 5, slot: 'passive', name: 'No Escape', desc: 'Keystone: launched or dragged debt-marked enemies keep their mark longer.', key: true, prereq: ['kn_debtmark', 'kn_sentence', 'kn_trialpulse'], tags: ['Counter', 'Ledges'] });

  add('kn_impact', { cls: 'knight', branch: 'earthbreaker', tier: 1, slot: 'passive', name: 'Impact Rhythm', desc: 'Class mechanic: heavy hits build Impact and shove objects harder.', key: true, tags: ['Crates', 'Barrels'] });
  add('kn_groundsplitter', { cls: 'knight', branch: 'earthbreaker', tier: 2, slot: 'attack', name: 'Ground Splitter', desc: 'Low sword slam that sends a short crack through enemies and small objects.', effect: { kind: 'groundSplitter' }, cd: 900, tags: ['Shockwave', 'Crates'] });
  add('kn_shoulderdrive', { cls: 'knight', branch: 'earthbreaker', tier: 2, slot: 'shift', name: 'Shoulder Drive', desc: 'Heavy shoulder step that pushes through clutter and barrels.', type: 'move', action: 'shoulder', cd: 1500, tags: ['Movement', 'Crates'] });
  add('kn_faultplate', { cls: 'knight', branch: 'earthbreaker', tier: 3, slot: 'e', name: 'Fault Plate', desc: 'Kick up a short floor lip that trips chargers and becomes temporary terrain.', effect: { kind: 'faultPlate' }, cd: 3300, tags: ['Walls', 'Crates'] });
  add('kn_siege', { cls: 'knight', branch: 'earthbreaker', tier: 5, slot: 'passive', name: 'Siege Knight', desc: 'Advanced variation: turn crates, barriers, and shield walls into moving siege objects.', key: true, prereqAll: ['kn_wall', 'kn_cratebreaker'], tags: ['Crates', 'Block'] });
  add('kn_siegepush', { cls: 'knight', branch: 'earthbreaker', tier: 5, slot: 'attack', name: 'Siege Push', desc: 'Attack behind the nearest object to shove it forward as moving cover.', effect: { kind: 'siegePush' }, cd: 900, prereq: 'kn_siege', tags: ['Crates', 'Push'] });
  add('kn_lockbarricade', { cls: 'knight', branch: 'earthbreaker', tier: 5, slot: 'e', name: 'Lock Barricade', desc: 'Harden a crate or shield wall into temporary terrain.', effect: { kind: 'lockBarricade' }, cd: 3400, prereq: 'kn_siege', tags: ['Crates', 'Walls'] });
  add('kn_rampbreak', { cls: 'knight', branch: 'earthbreaker', tier: 5, slot: 'shift', name: 'Ramp Break', desc: 'Heavy step that climbs/pushes through small obstacles while moving objects.', effect: { kind: 'rampBreak' }, cd: 1700, prereq: 'kn_siege', tags: ['Movement', 'Crates'] });
  add('kn_castlecrusher', { cls: 'knight', branch: 'earthbreaker', tier: 5, slot: 'passive', name: 'Castle Crusher', desc: 'Keystone: destroying a siege object creates a wide debris blast.', key: true, prereq: ['kn_siegepush', 'kn_lockbarricade', 'kn_rampbreak'], tags: ['Crates', 'Shockwave'] });

  add('rg_tempo', { cls: 'rogue', branch: 'duelist', tier: 1, slot: 'passive', name: 'Duelist Tempo', desc: 'Class mechanic: alternating knife hits build Tempo for faster burst windows.', key: true, tags: ['Burst'] });
  add('rg_crosscut', { cls: 'rogue', branch: 'duelist', tier: 2, slot: 'attack', name: 'Cross-Cut', desc: 'Wider X-shaped dual slash that pushes small objects sideways.', type: 'attack', action: 'dualSlash', tags: ['Burst', 'Crates'] });
  add('rg_dueliststep', { cls: 'rogue', branch: 'duelist', tier: 2, slot: 'shift', name: 'Duelist Step', desc: 'Tiny low-cooldown feint step that keeps you close without overshooting.', type: 'move', action: 'backstep', cd: 760, tags: ['Movement', 'Burst'] });
  add('rg_parryflick', { cls: 'rogue', branch: 'duelist', tier: 3, slot: 'e', name: 'Parry Flick', desc: 'Brief knife parry that redirects nearby projectiles and grants burst timing.', effect: { kind: 'parryFlick' }, cd: 2600, tags: ['Counter', 'Projectile'] });
  add('rg_perfectrhythm', { cls: 'rogue', branch: 'duelist', tier: 4, slot: 'passive', name: 'Perfect Rhythm', desc: 'Keystone: alternating hands lowers Shift/E recovery and keeps Tempo longer.', key: true, tags: ['Burst', 'Movement'] });
  add('rg_redline', { cls: 'rogue', branch: 'duelist', tier: 5, slot: 'passive', name: 'Redline Duelist', desc: 'Advanced variation: full Tempo opens a risky close-range burst window.', key: true, prereqAll: ['rg_stab', 'rg_dodgecut'], tags: ['Burst'] });
  add('rg_redentry', { cls: 'rogue', branch: 'duelist', tier: 5, slot: 'passive', name: 'Redline Entry', desc: 'Entering full Tempo primes the first hit to slow enemy recovery.', key: true, prereq: 'rg_redline', tags: ['Burst'] });
  add('rg_heartbeat', { cls: 'rogue', branch: 'duelist', tier: 5, slot: 'attack', name: 'Heartbeat Stabs', desc: 'Three extremely quick alternating stabs, then forced recovery.', type: 'attack', action: 'rogueStab', prereq: 'rg_redline', tags: ['Burst'] });
  add('rg_slipcounter', { cls: 'rogue', branch: 'duelist', tier: 5, slot: 'shift', name: 'Slip Counter', desc: 'Slip through danger and cut once during the movement.', effect: { kind: 'moveStrike', move: 'slide', range: 88, force: 22 }, cd: 1350, prereq: 'rg_redline', tags: ['Counter', 'Movement'] });
  add('rg_finishingbeat', { cls: 'rogue', branch: 'duelist', tier: 5, slot: 'passive', name: 'Finishing Beat', desc: 'Keystone: the final Redline hit executes weak enemies or launches heavier ones.', key: true, prereq: ['rg_heartbeat', 'rg_slipcounter'], tags: ['Burst', 'Ledges'] });

  add('rg_trickknives', { cls: 'rogue', branch: 'saboteur', tier: 1, slot: 'passive', name: 'Trick Knives', desc: 'Class mechanic: thrown knives stick briefly and become trap anchors before pickup.', key: true, tags: ['Projectile', 'Traps'] });
  add('rg_trapcut', { cls: 'rogue', branch: 'saboteur', tier: 2, slot: 'attack', name: 'Trap Cut', desc: 'Slash toward a stuck knife to prime it as a small route trap.', type: 'attack', action: 'dualSlash', tags: ['Traps', 'Weapon'] });
  add('rg_wirevault', { cls: 'rogue', branch: 'saboteur', tier: 2, slot: 'shift', name: 'Wire Vault', desc: 'Vault over a stuck knife or crate, recovering ammo while crossing clutter.', effect: { kind: 'wireVault' }, cd: 1500, tags: ['Movement', 'Crates'] });
  add('rg_barrelneedle', { cls: 'rogue', branch: 'saboteur', tier: 3, slot: 'e', name: 'Barrel Needle', desc: 'Throw a low-damage knife that arms barrels and cracked crates for chain reactions.', effect: { kind: 'barrelNeedle' }, cd: 3000, tags: ['Barrels', 'Projectile'] });
  add('rg_ghost', { cls: 'rogue', branch: 'saboteur', tier: 5, slot: 'passive', name: 'Ghost Saboteur', desc: 'Advanced variation: knife recovery leaves temporary ghost knives and trap echoes.', key: true, prereqAll: ['rg_tripwire', 'rg_smoke', 'rg_ricochet'], tags: ['Traps', 'Movement'] });
  add('rg_ghostpickup', { cls: 'rogue', branch: 'saboteur', tier: 5, slot: 'passive', name: 'Ghost Pickup', desc: 'Picking up a thrown knife leaves a short-lived ghost knife at the pickup spot.', key: true, prereq: 'rg_ghost', tags: ['Traps'] });
  add('rg_phantomwire', { cls: 'rogue', branch: 'saboteur', tier: 5, slot: 'e', name: 'Phantom Wire', desc: 'Connect real and ghost knives into a temporary tripwire network.', effect: { kind: 'ghostNetwork' }, cd: 3200, prereq: 'rg_ghost', tags: ['Traps', 'Walls'] });
  add('rg_vanishslide', { cls: 'rogue', branch: 'saboteur', tier: 5, slot: 'shift', name: 'Vanish Slide', desc: 'Slide through a ghost knife to detonate smoke and refund movement recovery.', effect: { kind: 'smokeSlide', ghost: 1 }, cd: 1300, prereq: 'rg_ghost', tags: ['Movement', 'Traps'] });
  add('rg_murderboard', { cls: 'rogue', branch: 'saboteur', tier: 5, slot: 'passive', name: 'Murder Board', desc: 'Keystone: real and ghost knives form a visible network that marks the first target hit.', key: true, prereq: ['rg_phantomwire', 'rg_vanishslide'], tags: ['Traps', 'Mark'] });

  add('rg_flow', { cls: 'rogue', branch: 'acrobat', tier: 1, slot: 'passive', name: 'Flow State', desc: 'Class mechanic: movement attacks and double-jump proximity build Flow/Tempo.', key: true, tags: ['Movement', 'Burst'] });
  add('rg_slideslash', { cls: 'rogue', branch: 'acrobat', tier: 2, slot: 'attack', name: 'Slide Slash', desc: 'Attack while low to trip enemies instead of launching them.', type: 'attack', action: 'legSweep', tags: ['Movement', 'Control'] });
  add('rg_vaultstab', { cls: 'rogue', branch: 'acrobat', tier: 2, slot: 'attack', name: 'Vault Stab', desc: 'A downward aerial knife stab that rewards platform drops.', type: 'attack', action: 'vaultKick', tags: ['Movement', 'Launch'] });
  add('rg_lowroll', { cls: 'rogue', branch: 'acrobat', tier: 2, slot: 'shift', name: 'Low Roll', desc: 'Short shoulder roll ending crouched, safer under high attacks.', type: 'move', action: 'slide', cd: 980, tags: ['Movement'] });
  add('rg_legsweep', { cls: 'rogue', branch: 'acrobat', tier: 3, slot: 'e', name: 'Leg Sweep', desc: 'Close sweep that knocks enemies low and changes their collision posture briefly.', type: 'attack', action: 'legSweep', cd: 2600, tags: ['Control', 'Movement'] });
  add('rg_skyblade', { cls: 'rogue', branch: 'acrobat', tier: 5, slot: 'passive', name: 'Skyblade Acrobat', desc: 'Advanced variation: aerial Flow turns wall kicks, vaults, and flips into air combos.', key: true, prereqAll: ['rg_wallkick', 'rg_airspiral'], tags: ['Movement', 'Launch'] });
  add('rg_tuckedflip', { cls: 'rogue', branch: 'acrobat', tier: 5, slot: 'passive', name: 'Tucked Flip', desc: 'Double jump gains a more intentional tuck and builds aerial Flow near enemies.', key: true, prereq: 'rg_skyblade', tags: ['Movement'] });
  add('rg_heelrebound', { cls: 'rogue', branch: 'acrobat', tier: 5, slot: 'shift', name: 'Heel Rebound', desc: 'Kick off an enemy, wall, or large crate for a diagonal rebound.', effect: { kind: 'heelRebound' }, cd: 1350, prereq: 'rg_skyblade', tags: ['Movement', 'Crates'] });
  add('rg_divingneedle', { cls: 'rogue', branch: 'acrobat', tier: 5, slot: 'attack', name: 'Diving Needle', desc: 'Air attack becomes a downward stab that pins briefly on landing impact.', type: 'attack', action: 'rogueStab', prereq: 'rg_skyblade', tags: ['Movement', 'Ledges'] });
  add('rg_spirallanding', { cls: 'rogue', branch: 'acrobat', tier: 5, slot: 'passive', name: 'Spiral Landing', desc: 'Keystone: Air Spiral ends in a controlled landing slash near the ground.', key: true, prereq: ['rg_heelrebound', 'rg_divingneedle'], tags: ['Movement', 'Burst'] });

  add('ln_sweepbutt', { cls: 'lancer', branch: 'phalanx', tier: 2, slot: 'attack', name: 'Sweeping Butt', desc: 'Short rear-end sweep that covers the Lancer close blind spot.', type: 'attack', action: 'lanceSwing', tags: ['Reach', 'Control'] });
  add('ln_plantpivot', { cls: 'lancer', branch: 'phalanx', tier: 2, slot: 'shift', name: 'Plant Pivot', desc: 'Plant the lance and rotate quickly without giving up the lane.', type: 'move', action: 'brace', cd: 1200, tags: ['Reach', 'Movement'] });
  add('ln_anchorstake', { cls: 'lancer', branch: 'phalanx', tier: 3, slot: 'e', name: 'Anchor Stake', desc: 'Stake a target or crate, then tug it toward the lance line.', effect: { kind: 'tetherLine', range: 185, pull: 24 }, cd: 2900, tags: ['Pull', 'Crates'] });
  add('ln_pike', { cls: 'lancer', branch: 'phalanx', tier: 5, slot: 'passive', name: 'Pike Captain', desc: 'Advanced variation: bracing paints command lanes that deny enemy crossings.', key: true, prereqAll: ['ln_spearwall', 'ln_pin'], tags: ['Reach', 'Allies'] });
  add('ln_holdline', { cls: 'lancer', branch: 'phalanx', tier: 5, slot: 'passive', name: 'Hold The Line', desc: 'Bracing creates a visible Command Lane in the lance direction.', key: true, prereq: 'ln_pike', tags: ['Reach', 'Walls'] });
  add('ln_orderedthrust', { cls: 'lancer', branch: 'phalanx', tier: 5, slot: 'attack', name: 'Ordered Thrust', desc: 'Thrusting down a Command Lane extends reach and pin force.', type: 'attack', action: 'braceThrust', prereq: 'ln_pike', tags: ['Reach', 'Walls'] });
  add('ln_formationstep', { cls: 'lancer', branch: 'phalanx', tier: 5, slot: 'shift', name: 'Formation Step', desc: 'Move along or rotate the lane while preserving Brace.', type: 'move', action: 'brace', cd: 1500, prereq: 'ln_pike', tags: ['Movement', 'Reach'] });
  add('ln_nopassage', { cls: 'lancer', branch: 'phalanx', tier: 5, slot: 'passive', name: 'No Passage', desc: 'Keystone: enemies crossing the command lane trigger weak ghost-lance pokes.', key: true, prereq: ['ln_orderedthrust', 'ln_formationstep'], tags: ['Reach', 'Control'] });

  add('ln_commit', { cls: 'lancer', branch: 'dragoon', tier: 1, slot: 'passive', name: 'Charge Commitment', desc: 'Class mechanic: charges lock direction and reward clean lane choice.', key: true, tags: ['Ledges', 'Reach'] });
  add('ln_breakthrust', { cls: 'lancer', branch: 'dragoon', tier: 2, slot: 'attack', name: 'Break Thrust', desc: 'Shorter armor-piercing thrust that cracks objects directly ahead.', type: 'attack', action: 'braceThrust', tags: ['Crates', 'Reach'] });
  add('ln_breakerrun', { cls: 'lancer', branch: 'dragoon', tier: 3, slot: 'e', name: 'Breaker Run', desc: 'Prime the next charge to smash crates/barriers and trigger barrels at the end.', effect: { kind: 'breakerRun' }, cd: 2600, tags: ['Crates', 'Barrels'] });
  add('ln_meteor', { cls: 'lancer', branch: 'dragoon', tier: 5, slot: 'passive', name: 'Meteor Dragoon', desc: 'Advanced variation: charge power scales with straight runway before impact.', key: true, prereqAll: ['ln_charge', 'ln_carry'], tags: ['Ledges', 'Movement'] });
  add('ln_runway', { cls: 'lancer', branch: 'dragoon', tier: 5, slot: 'passive', name: 'Runway Read', desc: 'Aim preview and charge force care about clear distance before impact.', key: true, prereq: 'ln_meteor', tags: ['Ledges'] });
  add('ln_overrun', { cls: 'lancer', branch: 'dragoon', tier: 5, slot: 'shift', name: 'Overrun', desc: 'A longer charge that can punch through multiple bodies if the lane is clear.', type: 'attack', action: 'lanceCharge', cd: 2100, prereq: 'ln_meteor', tags: ['Ledges', 'Crates'] });
  add('ln_wallbreaker', { cls: 'lancer', branch: 'dragoon', tier: 5, slot: 'e', name: 'Wallbreaker', desc: 'Next committed charge creates debris and extra object impact at endpoint.', effect: { kind: 'breakerRun', big: 1 }, cd: 3200, prereq: 'ln_meteor', tags: ['Crates', 'Walls'] });
  add('ln_fallingstar', { cls: 'lancer', branch: 'dragoon', tier: 5, slot: 'passive', name: 'Falling Star', desc: 'Keystone: charging from high ground adds downward slam force.', key: true, prereq: ['ln_overrun', 'ln_wallbreaker'], tags: ['Ledges', 'Launch'] });

  add('ln_hookpoint', { cls: 'lancer', branch: 'harpooner', tier: 1, slot: 'passive', name: 'Hook Point', desc: 'Class mechanic: some lance hits attach short-lived tethers.', key: true, tags: ['Pull', 'Reach'] });
  add('ln_chainsweep', { cls: 'lancer', branch: 'harpooner', tier: 2, slot: 'attack', name: 'Chain Sweep', desc: 'Low chain/lance sweep that drags nearby enemies sideways.', type: 'attack', action: 'lanceSwing', tags: ['Pull', 'Control'] });
  add('ln_anchorwalk', { cls: 'lancer', branch: 'harpooner', tier: 2, slot: 'shift', name: 'Anchor Walk', desc: 'Slow braced walk that preserves tether tension.', type: 'move', action: 'brace', cd: 1700, tags: ['Pull', 'Movement'] });
  add('ln_anchorpull', { cls: 'lancer', branch: 'harpooner', tier: 3, slot: 'e', name: 'Anchor Pull', desc: 'Pull tethered or nearby targets toward an anchor point in front.', effect: { kind: 'pull', range: 320, all: 1, force: 9.4 }, cd: 3300, tags: ['Pull', 'Crates'] });
  add('ln_warden', { cls: 'lancer', branch: 'harpooner', tier: 5, slot: 'passive', name: 'Chain Warden', desc: 'Advanced variation: persistent anchors create reusable pull networks.', key: true, prereqAll: ['ln_chain', 'ln_reel'], tags: ['Pull', 'Walls'] });
  add('ln_wardenanchor', { cls: 'lancer', branch: 'harpooner', tier: 5, slot: 'e', name: 'Warden Anchor', desc: 'Place a persistent chain anchor on terrain or objects.', effect: { kind: 'wardenAnchor' }, cd: 2900, prereq: 'ln_warden', tags: ['Pull', 'Walls'] });
  add('ln_crosstether', { cls: 'lancer', branch: 'harpooner', tier: 5, slot: 'attack', name: 'Cross-Tether', desc: 'Hooked targets can be attached to the nearest anchor instead of only the Lancer.', effect: { kind: 'tetherLine', range: 210, pull: 30, anchor: 1 }, cd: 750, prereq: 'ln_warden', tags: ['Pull', 'Crates'] });
  add('ln_winchstep', { cls: 'lancer', branch: 'harpooner', tier: 5, slot: 'shift', name: 'Winch Step', desc: 'Pull yourself toward an anchor or pull lighter anchored objects toward you.', effect: { kind: 'wardenPull' }, cd: 1900, prereq: 'ln_warden', tags: ['Pull', 'Movement'] });
  add('ln_dragnet', { cls: 'lancer', branch: 'harpooner', tier: 5, slot: 'passive', name: 'Dragnet', desc: 'Keystone: two anchors form a slowing line that can yank crossing enemies.', key: true, prereq: ['ln_wardenanchor', 'ln_winchstep'], tags: ['Pull', 'Walls'] });

  add('mg_motes', { cls: 'mage', branch: 'graviturge', tier: 1, slot: 'passive', name: 'Gravity Motes', desc: 'Class mechanic: gravity casts create motes that strengthen pull and lift.', key: true, tags: ['Gravity'] });
  add('mg_massbolt', { cls: 'mage', branch: 'graviturge', tier: 2, slot: 'attack', name: 'Mass Shard', desc: 'Throw a denser piece of lifted debris. It hits harder, tumbles through crates, and feeds Gravity Core resonance.', effect: { kind: 'gravityDebris', power: 1.28, core: 0.42 }, cd: 240, tags: ['Gravity', 'Projectile', 'Crates'] });
  add('mg_orbitbolt', { cls: 'mage', branch: 'graviturge', tier: 2, slot: 'attack', name: 'Orbit Shard', desc: 'Throw debris from your orbit; if a Gravity Core exists, the shard launches from the core and bends around it.', effect: { kind: 'gravityDebris', power: 1.08, orbit: 1, core: 0.52 }, cd: 220, tags: ['Gravity', 'Projectile', 'Crates'] });
  add('mg_floatstep', { cls: 'mage', branch: 'graviturge', tier: 2, slot: 'shift', name: 'Float Step', desc: 'Short controlled hover drift that can cross gaps while aiming.', type: 'move', action: 'airDash', cd: 1700, tags: ['Movement', 'Gravity'] });
  add('mg_brake', { cls: 'mage', branch: 'graviturge', tier: 2, slot: 'shift', name: 'Gravity Brake', desc: 'Brake your own momentum while enemies and objects continue sliding past.', effect: { kind: 'gravityBrake' }, cd: 1500, tags: ['Gravity', 'Movement'] });
  add('mg_orbitalcast', { cls: 'mage', branch: 'graviturge', tier: 5, slot: 'attack', name: 'Orbital Debris', desc: 'Gravity Core hurls heavy orbiting debris and nudges itself along your aim line.', effect: { kind: 'gravityDebris', power: 1.18, orbit: 1, shoveCore: 1, core: 0.72 }, cd: 205, prereq: 'mg_eventhorizon', tags: ['Gravity', 'Projectile', 'Crates'] });
  add('mg_corestep', { cls: 'mage', branch: 'graviturge', tier: 5, slot: 'shift', name: 'Core Step', desc: 'Hover near the Gravity Core in a controlled orbit instead of a straight dash.', effect: { kind: 'coreStep' }, cd: 1600, prereq: 'mg_eventhorizon', tags: ['Gravity', 'Movement'] });

  add('mg_staticcharge', { cls: 'mage', branch: 'stormcaller', tier: 1, slot: 'passive', name: 'Static Charge', desc: 'Class mechanic: airborne casts and grouped hits build lightning Charge.', key: true, tags: ['Projectile', 'Movement'] });
  add('mg_arcspear', { cls: 'mage', branch: 'stormcaller', tier: 2, slot: 'attack', name: 'Arc Spear', desc: 'Thin precise lightning spear. Less area, higher direct shove.', effect: { kind: 'bolt', power: 1.45, wind: 1 }, cd: 240, tags: ['Projectile'] });
  add('mg_downburst', { cls: 'mage', branch: 'stormcaller', tier: 2, slot: 'shift', name: 'Downburst', desc: 'Drop out of hover and pop enemies/objects outward on landing.', effect: { kind: 'downburst' }, cd: 1800, tags: ['Movement', 'Crates'] });
  add('mg_staticfield', { cls: 'mage', branch: 'stormcaller', tier: 3, slot: 'e', name: 'Static Field', desc: 'Small crackling field that slows enemies and primes chain effects.', effect: { kind: 'staticField' }, cd: 3200, tags: ['Field', 'Projectile'] });
  add('mg_stormdancer', { cls: 'mage', branch: 'stormcaller', tier: 5, slot: 'passive', name: 'Storm Dancer', desc: 'Advanced variation: cast while drifting, then discharge instability on landing.', key: true, prereqAll: ['mg_gust', 'mg_chain'], tags: ['Movement', 'Projectile'] });
  add('mg_aircasting', { cls: 'mage', branch: 'stormcaller', tier: 5, slot: 'passive', name: 'Air Casting', desc: 'Cast during hover at reduced speed; each air cast builds instability.', key: true, prereq: 'mg_stormdancer', tags: ['Movement'] });
  add('mg_windweave', { cls: 'mage', branch: 'stormcaller', tier: 5, slot: 'shift', name: 'Wind Weave', desc: 'After casting, Shift follows a curved gust path through platforms and objects.', effect: { kind: 'gustDash', weave: 1 }, cd: 1550, prereq: 'mg_stormdancer', tags: ['Movement', 'Crates'] });
  add('mg_lightningstep', { cls: 'mage', branch: 'stormcaller', tier: 5, slot: 'e', name: 'Lightning Step', desc: 'Chain Spark pulls the Mage slightly along the first chain direction.', effect: { kind: 'chainStep', jumps: 4 }, cd: 3200, prereq: 'mg_stormdancer', tags: ['Movement', 'Projectile'] });
  add('mg_stormrhythm', { cls: 'mage', branch: 'stormcaller', tier: 5, slot: 'passive', name: 'Storm Rhythm', desc: 'Keystone: alternating air cast and ground discharge grants Overcharge.', key: true, prereq: ['mg_windweave', 'mg_lightningstep'], tags: ['Movement', 'Projectile'] });

  add('mg_riftmarks', { cls: 'mage', branch: 'riftweaver', tier: 1, slot: 'passive', name: 'Rift Marks', desc: 'Class mechanic: staff hits and phase moves leave short-lived marks.', key: true, tags: ['Movement', 'Walls'] });
  add('mg_echodrift', { cls: 'mage', branch: 'riftweaver', tier: 2, slot: 'shift', name: 'Echo Drift', desc: 'Slow sideways drift that leaves a decoy echo for a moment.', effect: { kind: 'echoDrift' }, cd: 1600, tags: ['Movement', 'Allies'] });
  add('mg_riftsnare', { cls: 'mage', branch: 'riftweaver', tier: 3, slot: 'e', name: 'Rift Snare', desc: 'Small portal loop that slows and redirects enemies/projectiles inward.', effect: { kind: 'riftSnare' }, cd: 3300, tags: ['Pull', 'Walls'] });
  add('mg_architect', { cls: 'mage', branch: 'riftweaver', tier: 5, slot: 'passive', name: 'Portal Architect', desc: 'Advanced variation: maintain linked portal endpoints for shots and movement.', key: true, prereqAll: ['mg_portal', 'mg_swap'], tags: ['Walls', 'Movement'] });
  add('mg_portalpair', { cls: 'mage', branch: 'riftweaver', tier: 5, slot: 'e', name: 'Portal Pair', desc: 'Place or update linked portal endpoints for projectile and body routing.', effect: { kind: 'portalPair' }, cd: 2800, prereq: 'mg_architect', tags: ['Walls', 'Projectile'] });
  add('mg_lensshot', { cls: 'mage', branch: 'riftweaver', tier: 5, slot: 'attack', name: 'Lens Shot', desc: 'Projectile bends through the portal pair with speed and angle correction.', effect: { kind: 'portalShot', lens: 1 }, cd: 220, prereq: 'mg_architect', tags: ['Walls', 'Projectile'] });
  add('mg_doorstep', { cls: 'mage', branch: 'riftweaver', tier: 5, slot: 'shift', name: 'Doorstep', desc: 'Step through your portal pair safely and refund a little Focus.', effect: { kind: 'doorstep' }, cd: 1650, prereq: 'mg_architect', tags: ['Walls', 'Movement'] });
  add('mg_grandcollapse', { cls: 'mage', branch: 'riftweaver', tier: 5, slot: 'q', name: 'Grand Collapse', desc: 'Rift Collapse pulls through portal exits instead of only toward the cursor.', effect: { kind: 'riftCollapse', portal: 1 }, cd: 9800, prereq: 'mg_architect', tags: ['Pull', 'Walls'] });

  add('rn_aim', { cls: 'ranger', branch: 'sharpshooter', tier: 1, slot: 'passive', name: 'Aim Discipline', desc: 'Class mechanic: holding draw steadily builds Focus for precision effects.', key: true, tags: ['Projectile'] });
  add('rn_quickdraw', { cls: 'ranger', branch: 'sharpshooter', tier: 2, slot: 'attack', name: 'Quick Draw', desc: 'Faster low-damage shot that interrupts and refunds a bit of draw time.', type: 'attack', action: 'arrow', tags: ['Projectile'] });
  add('rn_highroll', { cls: 'ranger', branch: 'sharpshooter', tier: 2, slot: 'shift', name: 'High-Ground Roll', desc: 'Roll into a crouched stance. Landing high primes the next shot.', type: 'move', action: 'backstep', cd: 1350, tags: ['Movement', 'Ledges'] });
  add('rn_deadeye', { cls: 'ranger', branch: 'sharpshooter', tier: 5, slot: 'passive', name: 'Deadeye', desc: 'Advanced variation: full draw reveals weak points on enemies and objects.', key: true, prereqAll: ['rn_power', 'rn_wallpin'], tags: ['Projectile', 'Mark'] });
  add('rn_weakread', { cls: 'ranger', branch: 'sharpshooter', tier: 5, slot: 'passive', name: 'Weak Point Read', desc: 'Steady full draw marks a weak point for precision follow-up.', key: true, prereq: 'rn_deadeye', tags: ['Mark'] });
  add('rn_heartshot', { cls: 'ranger', branch: 'sharpshooter', tier: 5, slot: 'attack', name: 'Heart Shot', desc: 'Power shot that cracks weak points into heavy stagger and ring-out force.', effect: { kind: 'weakShot' }, cd: 900, prereq: 'rn_deadeye', tags: ['Projectile', 'Ledges'] });
  add('rn_threadneedle', { cls: 'ranger', branch: 'sharpshooter', tier: 5, slot: 'e', name: 'Thread The Needle', desc: 'Piercing line that can hit multiple weak points if aligned.', effect: { kind: 'arrow', power: 1.55, pierce: 4 }, cd: 3000, prereq: 'rn_deadeye', tags: ['Projectile', 'Crates'] });
  add('rn_stillness', { cls: 'ranger', branch: 'sharpshooter', tier: 5, slot: 'passive', name: 'Stillness Pays', desc: 'Keystone: steady shots preserve Focus and reveal weak points faster.', key: true, prereq: ['rn_heartshot', 'rn_threadneedle'], tags: ['Projectile'] });

  add('rn_triggershot', { cls: 'ranger', branch: 'trapper', tier: 2, slot: 'attack', name: 'Trigger Shot', desc: 'Low-damage shot that remotely activates traps and armed barrels.', effect: { kind: 'triggerShot' }, cd: 520, tags: ['Traps', 'Barrels'] });
  add('rn_traproll', { cls: 'ranger', branch: 'trapper', tier: 2, slot: 'shift', name: 'Trap Roll', desc: 'Short roll that drops caltrops behind you.', effect: { kind: 'trapRoll' }, cd: 1500, tags: ['Traps', 'Movement'] });
  add('rn_grapplestep', { cls: 'ranger', branch: 'trapper', tier: 2, slot: 'shift', name: 'Grapple Step', desc: 'Fire a line to a wall or crate and pull yourself a short distance.', effect: { kind: 'grappleStep' }, cd: 1700, tags: ['Movement', 'Crates'] });
  add('rn_routemaster', { cls: 'ranger', branch: 'trapper', tier: 4, slot: 'passive', name: 'Route Master', desc: 'Keystone: first enemy to trigger a trap becomes marked for stronger shot knockback.', key: true, tags: ['Traps', 'Mark'] });
  add('rn_engineer', { cls: 'ranger', branch: 'trapper', tier: 5, slot: 'passive', name: 'Field Engineer', desc: 'Advanced variation: traps become a physical kit with reclaim and remote-trigger economy.', key: true, prereqAll: ['rn_springtrap', 'rn_caltrops'], tags: ['Traps', 'Crates'] });
  add('rn_trapkit', { cls: 'ranger', branch: 'trapper', tier: 5, slot: 'passive', name: 'Trap Kit', desc: 'Active traps are limited, visible, and reclaimable.', key: true, prereq: 'rn_engineer', tags: ['Traps'] });
  add('rn_remotetrigger', { cls: 'ranger', branch: 'trapper', tier: 5, slot: 'attack', name: 'Remote Trigger', desc: 'Trigger any owned trap or armed barrel in line of sight.', effect: { kind: 'triggerShot', remote: 1 }, cd: 650, prereq: 'rn_engineer', tags: ['Traps', 'Barrels'] });
  add('rn_reinforcedspring', { cls: 'ranger', branch: 'trapper', tier: 5, slot: 'e', name: 'Reinforced Spring', desc: 'Place an aimed spring that launches heavier enemies and objects.', effect: { kind: 'springTrap', strong: 1 }, cd: 3000, prereq: 'rn_engineer', tags: ['Traps', 'Launch'] });
  add('rn_worksite', { cls: 'ranger', branch: 'trapper', tier: 5, slot: 'passive', name: 'Worksite', desc: 'Keystone: standing near two owned traps grants Focus and faster trap arming.', key: true, prereq: ['rn_remotetrigger', 'rn_reinforcedspring'], tags: ['Traps'] });

  add('rn_huntmark', { cls: 'ranger', branch: 'beastwarden', tier: 1, slot: 'passive', name: 'Hunt Mark', desc: 'Class mechanic: full-draw shots mark prey for allies and decoys.', key: true, tags: ['Allies', 'Mark'] });
  add('rn_covershot', { cls: 'ranger', branch: 'beastwarden', tier: 2, slot: 'attack', name: 'Cover Shot', desc: 'Shot near an ally or decoy causes them to pressure in that direction.', effect: { kind: 'coverShot' }, cd: 650, tags: ['Allies', 'Projectile'] });
  add('rn_packstep', { cls: 'ranger', branch: 'beastwarden', tier: 2, slot: 'shift', name: 'Pack Step', desc: 'Backstep and leave a temporary decoy pressure point at your old position.', effect: { kind: 'packStep' }, cd: 1600, tags: ['Allies', 'Movement'] });
  add('rn_rallyroll', { cls: 'ranger', branch: 'beastwarden', tier: 2, slot: 'shift', name: 'Rally Roll', desc: 'Roll toward ally/decoy pressure and regain Focus nearby.', type: 'move', action: 'backstep', cd: 1350, tags: ['Allies', 'Movement'] });
  add('rn_huntmaster', { cls: 'ranger', branch: 'beastwarden', tier: 5, slot: 'passive', name: 'Huntmaster', desc: 'Advanced variation: issue simple Pack Orders to allies and decoys.', key: true, prereqAll: ['rn_decoy', 'rn_packcmd'], tags: ['Allies', 'Mark'] });
  add('rn_packorders', { cls: 'ranger', branch: 'beastwarden', tier: 5, slot: 'passive', name: 'Pack Orders', desc: 'Marked targets unlock pressure, hold, shove, and bait orders.', key: true, prereq: 'rn_huntmaster', tags: ['Allies'] });
  add('rn_baitdecoy', { cls: 'ranger', branch: 'beastwarden', tier: 5, slot: 'e', name: 'Bait Decoy', desc: 'Decoy kites enemies toward a chosen point, then fades.', effect: { kind: 'baitDecoy' }, cd: 3900, prereq: 'rn_huntmaster', tags: ['Allies', 'Traps'] });
  add('rn_coordpush', { cls: 'ranger', branch: 'beastwarden', tier: 5, slot: 'q', name: 'Coordinated Push', desc: 'All allies/decoys shove the marked target in the aimed direction.', effect: { kind: 'packCommand', force: 1.35 }, cd: 8600, prereq: 'rn_huntmaster', tags: ['Allies', 'Push'] });
  add('rn_alphasignal', { cls: 'ranger', branch: 'beastwarden', tier: 5, slot: 'passive', name: 'Alpha Signal', desc: 'Keystone: Q marks a priority target and command KOs refresh one order.', key: true, prereq: ['rn_baitdecoy', 'rn_coordpush'], tags: ['Allies', 'Mark'] });

  // Neutral physics keystones
  add('momentum', { cls: 'neutral', branch: 'physics', tier: 2, slot: 'passive', name: 'Momentum', desc: 'Keystone: your hits launch enemies harder toward hazards.', key: true, tags: ['Ledges', 'Push'] });
  add('executioner', { cls: 'neutral', branch: 'physics', tier: 2, slot: 'passive', name: 'Executioner', desc: 'Keystone: damaged enemies are easier to finish with burst abilities.', key: true, tags: ['Burst'] });
  add('ricochet_key', { cls: 'neutral', branch: 'physics', tier: 3, slot: 'passive', name: 'Ricochet', desc: 'Keystone: arrows, knives, and bolts bounce once off walls or crates.', key: true, tags: ['Walls', 'Crates'] });
  add('heavy_objects', { cls: 'neutral', branch: 'physics', tier: 3, slot: 'passive', name: 'Heavy Objects', desc: 'Keystone: crates and barrels you hit move slower but strike much harder.', key: true, tags: ['Crates', 'Barrels'] });
  add('hazard_sense', { cls: 'neutral', branch: 'physics', tier: 3, slot: 'passive', name: 'Hazard Sense', desc: 'Keystone: enemies near ledges or barrels take extra knockback from your abilities.', key: true, tags: ['Ledges', 'Barrels'] });

  return A;
})();
const PLAYTEST_BRANCH_PATCHES = {
  rg_tempo: { branch: 'bladeslinger', name: 'Knife Tempo', desc: 'Class mechanic: clean throws, recalls, and pickups build Tempo for faster knife volleys.', tags: ['Projectile', 'Burst'] },
  rg_crosscut: { branch: 'acrobat', name: 'Cross-Step Cut', desc: 'A quick crossing slash used after slides, jumps, or vaults to keep movement offense flowing.', tags: ['Movement', 'Burst', 'Crates'] },
  rg_dueliststep: { branch: 'nightshade', name: 'Shadow Step', desc: 'A tiny evasive step that preserves smoke/invisibility windows without forcing close parry timing.', tags: ['Movement', 'Stealth'] },
  rg_parryflick: { branch: 'bladeslinger', name: 'Knife Ward', desc: 'Fan your knives outward to deflect nearby projectiles and set up a safer throwing lane.', tags: ['Projectile', 'Control'] },
  rg_perfectrhythm: { branch: 'acrobat', name: 'Flow Rhythm', desc: 'Keystone: alternating slide, jump, and knife hits lowers Shift/E recovery and keeps Flow longer.', tags: ['Movement', 'Burst'] },
  rg_redline: { branch: 'acrobat', name: 'Redline Acrobat', desc: 'Advanced variation: full Flow opens a risky burst window after slides, vaults, and aerial attacks.', tags: ['Movement', 'Burst'] },
  rg_redentry: { branch: 'acrobat', name: 'Redline Entry', desc: 'Entering full Flow primes the first movement attack to slow enemy recovery.', tags: ['Movement', 'Burst'] },
  rg_heartbeat: { branch: 'acrobat', name: 'Heartbeat Stabs', desc: 'Three extremely quick alternating stabs after a movement entry, then forced recovery.', tags: ['Movement', 'Burst'] },
  rg_slipcounter: { branch: 'acrobat', name: 'Slip Cut', desc: 'Slip through danger and cut once during the movement without relying on parry timing.', tags: ['Movement', 'Control'] },
  rg_finishingbeat: { branch: 'acrobat', name: 'Finishing Beat', desc: 'Keystone: the final Redline hit executes weak enemies or launches heavier ones.', tags: ['Movement', 'Ledges'] },
  rg_trickknives: { branch: 'bladeslinger', name: 'Trick Knives', desc: 'Class mechanic: thrown knives stick briefly and become recall, trap, or pickup anchors.', tags: ['Projectile', 'Traps'] },
  rg_trapcut: { branch: 'bladeslinger', name: 'Anchor Cut', desc: 'Slash toward a stuck knife to prime it as a route trap and keep the ranged knife loop alive.', tags: ['Projectile', 'Traps', 'Weapon'] },
  rg_wirevault: { branch: 'acrobat', name: 'Wire Vault', desc: 'Vault over a stuck knife or crate, recovering ammo while crossing clutter.', tags: ['Movement', 'Crates', 'Projectile'] },
  rg_barrelneedle: { branch: 'bladeslinger', name: 'Barrel Needle', desc: 'Throw a low-damage knife that arms barrels and cracked crates for chain reactions.', tags: ['Barrels', 'Projectile'] },
  rg_ghost: { branch: 'nightshade', name: 'Ghost Knives', desc: 'Advanced variation: knife recovery leaves temporary ghost knives and smoke-trap echoes.', tags: ['Stealth', 'Traps'] },
  rg_ghostpickup: { branch: 'nightshade', name: 'Ghost Pickup', desc: 'Picking up a thrown knife leaves a short-lived ghost knife at the pickup spot.', tags: ['Stealth', 'Traps'] },
  rg_phantomwire: { branch: 'nightshade', name: 'Phantom Wire', desc: 'Connect real and ghost knives into a temporary tripwire network inside smoke routes.', tags: ['Stealth', 'Traps', 'Walls'] },
  rg_vanishslide: { branch: 'nightshade', name: 'Vanish Slide', desc: 'Slide through a ghost knife to detonate smoke and refund movement recovery.', tags: ['Movement', 'Stealth', 'Traps'] },
  rg_murderboard: { branch: 'nightshade', name: 'Murder Board', desc: 'Keystone: real and ghost knives form a visible network that marks the first target hit from stealth.', tags: ['Stealth', 'Traps', 'Mark'] },
};
for (const [id, patch] of Object.entries(PLAYTEST_BRANCH_PATCHES)) {
  if (ABILITIES[id]) Object.assign(ABILITIES[id], patch);
}
for (const spec of Object.values(ABILITIES)) {
  if (spec.cls === 'mage' && (spec.branch === 'stormcaller' || spec.branch === 'riftweaver')) {
    spec.draft = false;
    spec.deferred = true;
  }
}
const CLASS_LOADOUT = {
  knight: { attack: 'kn_slash', secondary: 'kn_guard', shift: 'kn_step', e: 'kn_bash', q: 'kn_rally', passive: null },
  rogue: { attack: 'rg_throw', secondary: 'rg_dual', shift: 'rg_slide', e: 'rg_fan', q: 'rg_storm', passive: null },
  lancer: { attack: 'ln_thrust', secondary: 'ln_charge', shift: 'ln_brace', e: 'ln_anchor', q: 'ln_breaker', passive: null },
  mage: { attack: 'mg_bolt', secondary: 'mg_bloom', shift: 'mg_dash', e: 'mg_updraft', q: 'mg_singularity', passive: null },
  ranger: { attack: 'rn_arrow', secondary: 'rn_volley', shift: 'rn_backstep', e: 'rn_kickshot', q: 'rn_arrowstorm', passive: null },
};
const LAB_BUILDS = {
  knight: [
    { id: 'base', name: 'Base Knight', note: 'Starting kit for checking sword, shield, and hitbox basics.', loadout: {} },
    { id: 'guardian', name: 'Guardian', note: 'Safe space: shield wall, guard step, rally dome, Bulwark.', loadout: { shift: 'kn_guardstep', e: 'kn_wall', q: 'kn_dome', passive: 'kn_bulwark' } },
    { id: 'aegis', name: 'Aegis Captain', note: 'Advanced Bulwark: linked cover, intercept step, and party protection.', loadout: { attack: 'kn_shieldcut', secondary: 'kn_guard', shift: 'kn_intercept', e: 'kn_linkedcover', q: 'kn_captainsrally', passive: 'kn_aegis' } },
    { id: 'avenger', name: 'Avenger', note: 'Counter pressure: riposte, vengeance guard, quake, Vengeance.', loadout: { attack: 'kn_riposte', secondary: 'kn_counterguard', shift: 'kn_counterlunge', e: 'kn_punish', q: 'kn_dome', passive: 'kn_vengeance' } },
    { id: 'vowbreaker', name: 'Vowbreaker', note: 'Advanced Avenger: pivot guard, mirror guard, and debt shock pulses.', loadout: { attack: 'kn_reprisaledge', secondary: 'kn_mirrorguard', shift: 'kn_ironpivot', e: 'kn_trialpulse', q: 'kn_dome', passive: 'kn_vowbreaker' } },
    { id: 'earthbreaker', name: 'Earthbreaker', note: 'Object impact: crush, crate breaker, stomp, faultline.', loadout: { attack: 'kn_crush', secondary: 'kn_cratebreaker', shift: 'kn_step', e: 'kn_stomp', q: 'kn_faultline', passive: 'kn_aftershock' } },
    { id: 'siege', name: 'Siege Knight', note: 'Advanced Earthbreaker: shove objects, lock barricades, and break through clutter.', loadout: { attack: 'kn_siegepush', secondary: 'kn_cratebreaker', shift: 'kn_rampbreak', e: 'kn_lockbarricade', q: 'kn_faultline', passive: 'kn_siege' } },
  ],
  rogue: [
    { id: 'base', name: 'Base Rogue', note: 'Starting kit for fast knife throws, slide, ammo recovery, and close-range backup slashes.', loadout: {} },
    { id: 'bladeslinger', name: 'Bladeslinger', note: 'Knife throwing: fast main toss, ricochet, dense fan knives, blade recall, and a tracking blade barrage.', loadout: { attack: 'rg_throw', secondary: 'rg_ricochet', shift: 'rg_slide', e: 'rg_fan', q: 'rg_storm', passive: 'rg_trapmaster' } },
    { id: 'acrobat', name: 'Acrobat', note: 'Movement offense: sweep, wall kick, vault toss, air spiral.', loadout: { attack: 'rg_sweep', secondary: 'rg_throw', shift: 'rg_wallkick', e: 'rg_vaulttoss', q: 'rg_airspiral', passive: 'rg_bloodrush' } },
    { id: 'skyblade', name: 'Skyblade Acrobat', note: 'Advanced Acrobat: heel rebound, diving stabs, and air spiral landings.', loadout: { attack: 'rg_divingneedle', secondary: 'rg_throw', shift: 'rg_heelrebound', e: 'rg_vaulttoss', q: 'rg_airspiral', passive: 'rg_skyblade' } },
    { id: 'nightshade', name: 'Nightshade', note: 'Smoke/poison stealth: poison knife, smoke slide, smoke bomb, venom cloud.', loadout: { attack: 'rg_stab', secondary: 'rg_poisonknife', shift: 'rg_smoke', e: 'rg_smokebomb', q: 'rg_venomcloud', passive: 'rg_nightshade' } },
  ],
  lancer: [
    { id: 'base', name: 'Base Lancer', note: 'Starting kit for pure forward stab, charge lock, and long hitbox checks.', loadout: {} },
    { id: 'phalanx', name: 'Phalanx', note: 'Dangerous space: spear wall, pinning thrust, fortress line.', loadout: { attack: 'ln_pin', secondary: 'ln_charge', shift: 'ln_brace', e: 'ln_spearwall', q: 'ln_fortress', passive: 'ln_ironstance' } },
    { id: 'pike', name: 'Pike Captain', note: 'Advanced Phalanx: close blind-spot sweep, command-lane brace, and anchor stake.', loadout: { attack: 'ln_orderedthrust', secondary: 'ln_charge', shift: 'ln_formationstep', e: 'ln_anchorstake', q: 'ln_fortress', passive: 'ln_pike' } },
    { id: 'dragoon', name: 'Dragoon', note: 'Committed charge: skewer, vault pin, impale carry, Momentum Lance.', loadout: { attack: 'ln_skewer', secondary: 'ln_carry', shift: 'ln_charge', e: 'ln_vault', q: 'ln_breaker', passive: 'ln_momentum' } },
    { id: 'meteor', name: 'Meteor Dragoon', note: 'Advanced Dragoon: committed overrun, wallbreaker, and straight-lane charge payoff.', loadout: { attack: 'ln_breakthrust', secondary: 'ln_overrun', shift: 'ln_charge', e: 'ln_wallbreaker', q: 'ln_breaker', passive: 'ln_meteor' } },
    { id: 'harpooner', name: 'Harpooner', note: 'Tether control: hook thrust, chain lance, reel step, Maw.', loadout: { attack: 'ln_hookthrust', secondary: 'ln_chain', shift: 'ln_reel', e: 'ln_chain', q: 'ln_maw', passive: 'ln_tethermaster' } },
    { id: 'warden', name: 'Chain Warden', note: 'Advanced Harpooner: persistent anchors, cross-tethers, and winch movement.', loadout: { attack: 'ln_crosstether', secondary: 'ln_chain', shift: 'ln_winchstep', e: 'ln_wardenanchor', q: 'ln_maw', passive: 'ln_warden' } },
  ],
  mage: [
    { id: 'base', name: 'Base Mage', note: 'Starting Graviturge kit: hover, debris throw, Gravity Bloom, Mass Slam, and Black Hole.', loadout: {} },
    { id: 'graviturge', name: 'Graviturge Core', note: 'Damage gravity caster: Mass Shards, Gravity Well, hover drift, Mass Slam, and Black Hole.', loadout: { attack: 'mg_massbolt', secondary: 'mg_gravitywell', shift: 'mg_floatstep', e: 'mg_updraft', q: 'mg_singularity', passive: 'mg_motes' } },
    { id: 'event', name: 'Event Horizon', note: 'Advanced Graviturge: persistent Gravity Core, orbital debris, Core Step, and True Horizon black-hole collapse.', loadout: { attack: 'mg_orbitalcast', secondary: 'mg_gravitywell', shift: 'mg_corestep', e: 'mg_gravitycore', q: 'mg_truehorizon', passive: 'mg_eventhorizon' } },
    { id: 'pyromancer', name: 'Pyromancer', note: 'Physical fire: firebolt, flame breath, ignition burst, Dragon Breath, and spreading floor fire.', loadout: { attack: 'mg_firebolt', secondary: 'mg_flamebreath', shift: 'mg_dash', e: 'mg_ignite', q: 'mg_inferno', passive: 'mg_pyromancy' } },
    { id: 'spiritbinder', name: 'Spiritbinder', note: 'Necromancer prototype: spirit bolts, Bind Spirit, Soul Flare, and Grave Call allies.', loadout: { attack: 'mg_spiritbolt', secondary: 'mg_bindspirit', shift: 'mg_dash', e: 'mg_soulflare', q: 'mg_gravecall', passive: 'mg_spiritbinder' } },
  ],
  ranger: [
    { id: 'base', name: 'Base Ranger', note: 'Starting kit for draw/release, quiver, trajectory, and reload checks.', loadout: {} },
    { id: 'sharpshooter', name: 'Sharpshooter', note: 'Precision: power draw, wall pin, piercing arrow, Arrow Storm.', loadout: { attack: 'rn_power', secondary: 'rn_pierce', shift: 'rn_backstep', e: 'rn_wallpin', q: 'rn_arrowstorm', passive: 'rn_hunter' } },
    { id: 'deadeye', name: 'Deadeye', note: 'Advanced Sharpshooter: weak-point heart shots and thread-the-needle pierce.', loadout: { attack: 'rn_heartshot', secondary: 'rn_pierce', shift: 'rn_highroll', e: 'rn_threadneedle', q: 'rn_arrowstorm', passive: 'rn_deadeye' } },
    { id: 'trapper', name: 'Trapper', note: 'Prepared routes: caltrops, snare, spring trap, barrel shot, mine volley.', loadout: { attack: 'rn_arrow', secondary: 'rn_caltrops', shift: 'rn_springtrap', e: 'rn_barrelshot', q: 'rn_minevolley', passive: 'rn_prepared' } },
    { id: 'engineer', name: 'Field Engineer', note: 'Advanced Trapper: trigger shots, trap rolls, remote barrel/trap activation.', loadout: { attack: 'rn_remotetrigger', secondary: 'rn_caltrops', shift: 'rn_traproll', e: 'rn_reinforcedspring', q: 'rn_minevolley', passive: 'rn_engineer' } },
    { id: 'beastwarden', name: 'Beastwarden', note: 'Party pressure: mark shot, decoy, pack command, Hunt.', loadout: { attack: 'rn_markshot', secondary: 'rn_packcmd', shift: 'rn_backstep', e: 'rn_decoy', q: 'rn_hunt', passive: 'rn_packbond' } },
    { id: 'huntmaster', name: 'Huntmaster', note: 'Advanced Beastwarden: cover shots, pack steps, bait decoys, and coordinated pushes.', loadout: { attack: 'rn_covershot', secondary: 'rn_packcmd', shift: 'rn_packstep', e: 'rn_baitdecoy', q: 'rn_coordpush', passive: 'rn_huntmaster' } },
  ],
};
const TREE_NODES = ABILITIES;

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
  dualSlash: { kind: 'melee', strike: 0.40, hitstop: 14, impulse: 3.8, tags: ['blade', 'fast'],
    phases: { anticipation: [0.00, 0.16], active: [0.22, 0.56], recovery: [0.56, 1.00] },
    sweep: [-0.10, -0.05, 0.00, 0.05] },
  rogueStab: { kind: 'melee', strike: 0.39, hitstop: 13, impulse: 4.2, tags: ['blade', 'fast', 'stab'],
    phases: { anticipation: [0.00, 0.18], active: [0.27, 0.52], recovery: [0.52, 1.00] },
    sweep: [-0.07, 0.00, 0.07] },
  legSweep: { kind: 'melee', strike: 0.38, hitstop: 17, impulse: 4.2, tags: ['low', 'control'] },
  shieldBash: { kind: 'melee', strike: 0.38, hitstop: 24, impulse: 6.5, tags: ['guard', 'bash'] },
  shieldGuard: { kind: 'guard', strike: 0.08, hitstop: 0, impulse: 0, tags: ['guard', 'block'],
    phases: { anticipation: [0.00, 0.18], active: [0.18, 0.88], recovery: [0.88, 1.00] } },
  lanceSwing: { kind: 'melee', strike: 0.50, hitstop: 34, impulse: 6.8, tags: ['reach', 'heavy', 'swing'],
    phases: { anticipation: [0.00, 0.34], active: [0.40, 0.68], recovery: [0.68, 1.00] },
    sweep: [-0.18, -0.08, 0.00, 0.08, 0.16] },
  braceThrust: { kind: 'melee', strike: 0.54, hitstop: 34, impulse: 10.5, tags: ['reach', 'heavy', 'stab'],
    phases: { anticipation: [0.00, 0.40], active: [0.48, 0.70], recovery: [0.70, 1.00] },
    sweep: [-0.06, -0.02, 0.00, 0.05] },
  lanceCharge: { kind: 'melee', strike: 0.42, hitstop: 38, impulse: 9.0, tags: ['reach', 'heavy', 'stab', 'charge'],
    phases: { anticipation: [0.00, 0.20], active: [0.22, 0.88], recovery: [0.88, 1.00] },
    sweep: [-0.08, -0.02, 0.00, 0.06, 0.14, 0.24, 0.34] },
  crush: { kind: 'melee', strike: 0.50, hitstop: 42, impulse: 5.0, tags: ['heavy', 'impact'] },
  staffSweep: { kind: 'melee', strike: 0.50, hitstop: 26, impulse: 5.5, tags: ['staff', 'arc'] },
  vaultKick: { kind: 'melee', strike: 0.50, hitstop: 24, impulse: 7.0, tags: ['air', 'kick'] },
  throw: { kind: 'projectile', strike: 0.46, hitstop: 0, impulse: 0, tags: ['projectile', 'ammo'],
    phases: { anticipation: [0.00, 0.28], active: [0.40, 0.50], recovery: [0.50, 1.00] } },
  arrow: { kind: 'projectile', strike: 0.24, hitstop: 0, impulse: 0, tags: ['projectile'],
    phases: { anticipation: [0.00, 0.16], active: [0.21, 0.30], recovery: [0.30, 1.00] } },
  volley: { kind: 'projectile', strike: 0.32, hitstop: 0, impulse: 0, tags: ['projectile', 'burst'] },
  cast: { kind: 'projectile', strike: 0.38, hitstop: 0, impulse: 0, tags: ['magic'] },
  arcaneBloom: { kind: 'projectile', strike: 0.42, hitstop: 0, impulse: 0, tags: ['magic', 'gravity', 'area'] },
  pyroFirebolt: { kind: 'visual', strike: 0.20, hitstop: 0, impulse: 0, dur: 230, durScale: 1, tags: ['fire', 'staff', 'projectile'],
    phases: { anticipation: [0.00, 0.16], active: [0.16, 0.34], recovery: [0.34, 1.00] } },
  pyroIgnite: { kind: 'visual', strike: 0.34, hitstop: 0, impulse: 0, dur: 500, durScale: 1, tags: ['fire', 'staff', 'throw'],
    phases: { anticipation: [0.00, 0.34], active: [0.34, 0.50], recovery: [0.50, 1.00] } },
  pyroBreath: { kind: 'visual', strike: 0.10, hitstop: 0, impulse: 0, dur: 760, durScale: 1, tags: ['fire', 'staff', 'channel'],
    phases: { anticipation: [0.00, 0.12], active: [0.12, 0.88], recovery: [0.88, 1.00] } },
  pyroDragon: { kind: 'visual', strike: 0.06, hitstop: 0, impulse: 0, dur: 1350, durScale: 1, tags: ['fire', 'staff', 'ultimate', 'channel'],
    phases: { anticipation: [0.00, 0.10], active: [0.10, 0.94], recovery: [0.94, 1.00] } },
  pyroGroundFlow: { kind: 'visual', strike: 0.18, hitstop: 0, impulse: 0, dur: 560, durScale: 1, tags: ['fire', 'staff', 'ground'],
    phases: { anticipation: [0.00, 0.22], active: [0.22, 0.76], recovery: [0.76, 1.00] } },
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
function isPyroVisualAttack(type) {
  return type === 'pyroFirebolt' || type === 'pyroIgnite' || type === 'pyroBreath' ||
    type === 'pyroDragon' || type === 'pyroGroundFlow';
}

// ---------- levels (world coords, y down) ----------
const G = 470;
function lvl(data) {
  // derive width/height from contents
  let w = 0, h = 0;
  for (const p of data.platforms) { w = Math.max(w, p.x + p.w); h = Math.max(h, p.y + p.h); }
  if (data.flag) w = Math.max(w, data.flag.x + 80);
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
const ARENA_LEVEL = lvl({
  spawn: { x: 190, y: G },
  platforms: [
    { x: 0, y: G + 70, w: 2600, h: 110 },
    { x: 0, y: G, w: 390, h: 180 },
    { x: 390, y: G + 28, w: 250, h: 152 },
    { x: 640, y: G - 18, w: 250, h: 198 },
    { x: 730, y: G - 126, w: 38, h: 108 },
    { x: 890, y: G - 52, w: 260, h: 232 },
    { x: 1150, y: G - 20, w: 330, h: 200 },
    { x: 1480, y: G + 18, w: 260, h: 162 },
    { x: 1688, y: G - 190, w: 40, h: 104 },
    { x: 1740, y: G - 86, w: 250, h: 266 },
    { x: 1990, y: G - 18, w: 250, h: 198 },
    { x: 2240, y: G + 32, w: 360, h: 148 },
    { x: 2380, y: G - 74, w: 44, h: 106 },
    { x: 505, y: G - 118, w: 215, h: 12, oneWay: true },
    { x: 1038, y: G - 164, w: 240, h: 12, oneWay: true },
    { x: 1238, y: G - 242, w: 190, h: 12, oneWay: true },
    { x: 1510, y: G - 132, w: 200, h: 12, oneWay: true },
    { x: 2028, y: G - 126, w: 230, h: 12, oneWay: true },
    { x: 0, y: G - 150, w: 42, h: 330 },
    { x: 2558, y: G - 150, w: 42, h: 330 },
  ],
  coins: [],
  boxes: [
    { x: 318, y: G - 64, w: 66, h: 64, m: 2.3 },
    { x: 520, y: G - 18, w: 34, h: 34, m: 1.2, kind: 'barrel' },
    { x: 786, y: G - 92, w: 78, h: 72, m: 2.9 },
    { x: 1308, y: G - 92, w: 86, h: 72, m: 3.2 },
    { x: 1460, y: G - 60, w: 54, h: 18, m: 2.0, kind: 'spring' },
    { x: 1590, y: G - 38, w: 70, h: 56, m: 2.6 },
    { x: 1850, y: G - 120, w: 34, h: 34, m: 1.2, kind: 'barrel' },
    { x: 2100, y: G - 92, w: 82, h: 74, m: 3.1 },
  ],
  dummies: [],
  enemySpawns: [
    { x: 560, y: G + 28, min: 430, max: 680 },
    { x: 835, y: G - 18, min: 660, max: 930 },
    { x: 1160, y: G - 164, min: 1040, max: 1280 },
    { x: 1390, y: G - 20, min: 1160, max: 1510 },
    { x: 1600, y: G - 132, min: 1515, max: 1710 },
    { x: 1830, y: G - 86, min: 1745, max: 1985 },
    { x: 2110, y: G - 126, min: 2030, max: 2255 },
    { x: 2140, y: G - 18, min: 2010, max: 2390 },
  ],
});

PUBLIC.start = function (root, api) {
  const view = api.makeCanvas(root);
  const ctx = view.ctx;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const arenaMode = !query.has('classic');
  const levels = arenaMode ? [ARENA_LEVEL] : LEVELS;
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
  hud.className = 'hud sr-hud';
  hud.style.display = 'none';
  hud.innerHTML = `<span>WAVE <b id="sr-lvl">1</b></span>
    <span>BOT <b id="sr-lvls">0</b></span>
    <span>ALLY <b id="sr-party">0</b></span>
    <span>KO <b id="sr-coins" style="color:#b8860b">0</b></span>
    <span id="sr-ammo" style="display:none"><span id="sr-ammo-icon">🔪</span> <b id="sr-knives">0</b></span>
    <span id="sr-cool" style="display:none">SKILL <b id="sr-cool-val">READY</b></span>
    <span>⏱ <b id="sr-time">0.0</b></span>`;
  root.appendChild(hud);
  hud.innerHTML = `<span class="sr-classchip" id="sr-classchip">Knight</span>
    <span><span id="sr-mode-label">W</span><b id="sr-lvl">1</b></span>
    <span><b id="sr-lvls">0</b> <span id="sr-foe-label">foes</span></span>
    <span><b id="sr-party">0</b> <span id="sr-party-label">allies</span></span>
    <span><span id="sr-score-label">KO</span> <b id="sr-coins">0</b></span>
    <span class="sr-resourcechip" id="sr-ammo" style="display:none"><span id="sr-ammo-icon">🔪</span> <b id="sr-knives">0</b> <small id="sr-ammo-detail"></small></span>
    <span class="sr-resourcechip" id="sr-cool" style="display:none">SKILL <b id="sr-cool-val">READY</b></span>`;

  const helpBtn = document.createElement('button');
  helpBtn.className = 'sr-helpbtn';
  helpBtn.type = 'button';
  helpBtn.textContent = '?';
  helpBtn.setAttribute('aria-label', 'Current abilities');
  helpBtn.style.display = 'none';
  root.appendChild(helpBtn);

  const labPanel = document.createElement('div');
  labPanel.className = 'sr-labpanel';
  labPanel.style.display = 'none';
  root.appendChild(labPanel);

  const style = document.createElement('style');
  style.textContent = `
    .sr-touch{--sr-btn:clamp(52px,11vw,68px);--sr-gap:clamp(8px,2.2vw,14px);
      position:absolute;bottom:max(18px,env(safe-area-inset-bottom));z-index:30;display:flex;gap:var(--sr-gap);
      opacity:.58;touch-action:none}
    .sr-left{left:max(12px,env(safe-area-inset-left))}
    .sr-right{right:max(12px,env(safe-area-inset-right));justify-content:flex-end}
    .sr-btn{width:var(--sr-btn);height:var(--sr-btn);border-radius:50%;border:2.5px solid rgba(22,22,22,.55);
      background:rgba(255,255,255,.54);color:#161616;font-size:clamp(21px,5vw,28px);font-weight:900;display:flex;
      align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;box-shadow:0 4px 16px rgba(0,0,0,.10)}
    .sr-btn:active{background:rgba(22,22,22,.82);color:#fff;transform:scale(.96)}
    @media (hover:hover) and (pointer:fine){ .sr-touch{opacity:.34} }
    @media (max-width:700px){
      .sr-right{width:calc(var(--sr-btn) * 3 + var(--sr-gap) * 2);flex-wrap:wrap}
      .sr-left{bottom:max(24px,env(safe-area-inset-bottom))}
      .hud{top:max(8px,env(safe-area-inset-top));gap:10px;font-size:clamp(12px,3.4vw,16px);flex-wrap:wrap;padding:0 66px}
    }
    @media (max-width:380px){.sr-right{width:calc(var(--sr-btn) * 2 + var(--sr-gap))}.hud{padding:0 58px;gap:8px}}
    .sr-kicker{font-size:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#ff9f6e}
    .sr-title{font-size:clamp(34px,7vw,58px);line-height:.95;letter-spacing:.5px}
    .sr-menu-copy{max-width:620px;color:#d9e4f5;opacity:.86;font-size:clamp(13px,2.4vw,16px);line-height:1.45}
    .sr-classes{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:660px}
    .sr-class{cursor:pointer;width:126px;min-height:128px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
      padding:14px 10px;border-radius:8px;background:linear-gradient(180deg,rgba(23,28,46,.88),rgba(10,13,26,.92));border:2px solid var(--cc);
      color:#eaf2ff;transition:transform .12s,box-shadow .2s,border-color .2s}
    .sr-class:hover{transform:translateY(-3px);box-shadow:0 0 20px color-mix(in srgb,var(--cc) 62%,transparent)}
    .sr-class:active{transform:translateY(-1px) scale(.98)}
    .sr-class b{font-size:17px;letter-spacing:.5px}
    .sr-class small{opacity:.72;font-size:11.5px;line-height:1.3}
    @media (max-width:520px){.sr-classes{gap:8px}.sr-class{width:calc(50vw - 34px);min-height:112px;padding:11px 8px}.sr-menu-copy{display:none}}
    .sr-hud{top:calc(54px + env(safe-area-inset-top));left:50%;right:auto;transform:translateX(-50%);
      display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.72);
      color:#141414;text-shadow:none;box-shadow:0 8px 24px rgba(0,0,0,.12);font-size:clamp(12px,2.4vw,15px);white-space:nowrap}
    .sr-hud b{font-weight:900}.sr-classchip{color:#111;font-weight:900}
    .sr-resourcechip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;
      background:rgba(17,20,32,.09);border:1px solid rgba(17,20,32,.08)}
    .sr-resourcechip small{font-size:10px;font-weight:800;letter-spacing:.01em;opacity:.72}
    .sr-helpbtn{position:absolute;top:calc(56px + env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:42;
      width:30px;height:30px;border-radius:50%;border:1px solid rgba(20,20,20,.38);background:rgba(255,255,255,.76);
      color:#161616;font:900 15px/1 system-ui;box-shadow:0 6px 18px rgba(0,0,0,.12)}
    .sr-abilitybar{left:50%;right:auto;transform:translateX(-50%);bottom:max(12px,env(safe-area-inset-bottom));
      display:flex;gap:7px;opacity:.96;padding:6px;border-radius:16px;background:rgba(10,12,20,.52);
      border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(7px)}
    .sr-abilitybar .sr-btn{position:relative;width:72px;height:56px;border-radius:11px;border:1px solid rgba(255,255,255,.26);
      background:rgba(255,255,255,.78);overflow:hidden;color:#171717;font-size:12px;box-shadow:0 5px 18px rgba(0,0,0,.12);
      flex-direction:column;gap:1px;padding:4px 3px}
    .sr-abilitybar .sr-btn.ready{border-color:rgba(255,159,110,.85);box-shadow:0 0 18px rgba(255,159,110,.25)}
    .sr-abilitybar .sr-btn.queued{border-color:rgba(156,255,94,.96);box-shadow:0 0 20px rgba(156,255,94,.42);background:rgba(226,255,206,.86)}
    .sr-abilitybar .sr-btn.locked{opacity:.48;filter:saturate(.55)}
    .sr-cdfill{position:absolute;left:0;right:0;bottom:0;height:100%;transform:scaleY(0);transform-origin:bottom;
      background:rgba(0,0,0,.34);pointer-events:none}
    .sr-key,.sr-name,.sr-extra{position:relative;z-index:1;display:block;text-align:center;line-height:1.05}
    .sr-key{font-size:9px;font-weight:900;opacity:.62}.sr-name{max-width:100%;font-size:11px;font-weight:900;white-space:normal}
    .sr-extra{font-style:normal;font-size:9px;opacity:.67;min-height:10px}
    .sr-passivechip{width:92px;height:56px;border-radius:11px;border:1px solid rgba(255,212,94,.36);
      background:rgba(12,14,24,.76);color:#f7f0d2;display:flex;flex-direction:column;justify-content:center;gap:1px;
      padding:4px 6px;box-sizing:border-box;box-shadow:0 5px 18px rgba(0,0,0,.12)}
    .sr-passivechip span,.sr-passivechip em{font-size:8px;font-weight:900;line-height:1.05;text-transform:uppercase;opacity:.66;font-style:normal}
    .sr-passivechip b{font-size:10px;line-height:1.08;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sr-abilitybar .sr-btn:active{background:rgba(255,159,110,.78);color:#111}
    .sr-draft{display:flex;flex-direction:column;gap:9px;width:min(520px,90vw)}
    .sr-pick,.sr-help-row{text-align:left;border:1px solid rgba(255,159,110,.38);border-radius:10px;background:rgba(14,18,32,.78);
      color:#eaf2ff;padding:10px 12px}
    .sr-pick{cursor:pointer}.sr-pick:hover,.sr-pick:focus{background:rgba(255,159,110,.16);border-color:#ff9f6e;outline:none}
    .sr-pick .slot,.sr-help-row .slot{float:right;color:#ffcf8a;font-size:10px;font-weight:900;letter-spacing:.08em}
    .sr-pick b,.sr-help-row b{display:block;margin-bottom:3px}.sr-pick small,.sr-help-row small{display:block;opacity:.72;line-height:1.32}
    .sr-tags{display:block;margin-top:5px;color:#8fe6ff;font-style:normal;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .sr-help-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
    .sr-help-meta span{font-size:10px;font-weight:900;color:#f7f0d2;border:1px solid rgba(255,255,255,.14);
      border-radius:999px;padding:3px 7px;background:rgba(255,255,255,.06)}
    .sr-help-list{display:flex;flex-direction:column;gap:8px;width:min(560px,90vw);max-height:min(62vh,520px);overflow:auto}
    .sr-help-row.passive{border-color:rgba(255,212,94,.5)}
    .sr-mode-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:8px}
    .sr-lab-open{border:1px solid rgba(143,230,255,.45);background:rgba(143,230,255,.12);color:#dff8ff}
    .sr-lab-grid{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:680px;margin-top:2px}
    .sr-lab-class{cursor:pointer;border:1px solid var(--cc);border-radius:8px;background:rgba(9,12,23,.78);color:#eaf2ff;
      padding:8px 10px;font-weight:900;min-width:94px}
    .sr-labpanel{position:absolute;left:max(12px,env(safe-area-inset-left));top:calc(96px + env(safe-area-inset-top));z-index:38;
      width:min(330px,calc(100vw - 24px));padding:10px;border:1px solid rgba(255,255,255,.24);border-radius:12px;
      background:rgba(8,11,22,.72);backdrop-filter:blur(9px);color:#eaf2ff;box-shadow:0 12px 32px rgba(0,0,0,.24)}
    .sr-labpanel.collapsed{width:auto;padding:6px;border-radius:999px;background:rgba(8,11,22,.58)}
    .sr-labpanel b{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#8fe6ff;margin-bottom:6px}
    .sr-labhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
    .sr-labhead b{margin-bottom:0}.sr-labcollapse{min-height:26px!important;border-radius:999px!important;padding:3px 8px!important;font-size:10px!important}
    .sr-labrow{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px}
    .sr-labpanel select,.sr-labpanel button{min-height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.22);
      background:rgba(255,255,255,.10);color:#eaf2ff;font:800 12px system-ui;padding:5px 8px}
    .sr-labpanel button{cursor:pointer}.sr-labpanel button:hover{border-color:#8fe6ff;background:rgba(143,230,255,.16)}
    .sr-labpanel button.active{border-color:#9cff5e;background:rgba(156,255,94,.18);color:#f3ffe9;box-shadow:0 0 14px rgba(156,255,94,.18)}
    .sr-labpanel option{background:#101525;color:#eaf2ff}
    .sr-labnote{font-size:11px;line-height:1.28;color:#d9e4f5;opacity:.82;margin:5px 0 8px}
    .sr-labtests{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin:0 0 8px}
    .sr-labslot{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:4px 3px}
    .sr-labslot span{font-size:10px;font-weight:950;color:#8fe6ff}.sr-labslot small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;opacity:.78}
    .sr-labtools{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    @media (max-width:760px){
      .sr-hud{top:calc(52px + env(safe-area-inset-top));max-width:calc(100vw - 92px);overflow:hidden;gap:7px;font-size:12px}
      .sr-helpbtn{top:calc(52px + env(safe-area-inset-top));width:28px;height:28px}
      .sr-labpanel{top:calc(86px + env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));width:min(280px,calc(100vw - 16px));
        padding:8px;max-height:38vh;overflow:auto}
      .sr-labrow{grid-template-columns:1fr}.sr-labtests{grid-template-columns:repeat(3,1fr)}.sr-labtools{grid-template-columns:repeat(2,1fr)}
      .sr-abilitybar{left:auto;right:max(8px,env(safe-area-inset-right));transform:none;max-width:calc(100vw - 112px);
        justify-content:flex-end;flex-wrap:wrap;gap:5px;padding:5px}
      .sr-abilitybar .sr-btn{width:54px;height:48px;border-radius:10px}
      .sr-passivechip{width:82px;height:48px;border-radius:10px}
      .sr-name{font-size:9px}.sr-key{font-size:8px}.sr-extra{font-size:8px}
      .sr-left{bottom:max(18px,env(safe-area-inset-bottom));opacity:.72}
    }`;
  root.appendChild(style);

  function mkBtn(cls, label) {
    const b = document.createElement('div');
    b.className = 'sr-btn'; b.textContent = label;
    cls.appendChild(b);
    return b;
  }
  const padL = document.createElement('div'); padL.className = 'sr-touch sr-left';
  const padR = document.createElement('div'); padR.className = 'sr-touch sr-right sr-abilitybar';
  const btnLeft = mkBtn(padL, '◀'), btnRight = mkBtn(padL, '▶');
  const btnMain = mkBtn(padR, '⚔'), btnAlt = mkBtn(padR, '✦'), btnMove = mkBtn(padR, '↯'), btnJump = mkBtn(padR, '⤒');
  const btnSkillE = mkBtn(padR, 'E'), btnSkillQ = mkBtn(padR, 'Q');
  const passiveChip = document.createElement('div');
  passiveChip.className = 'sr-passivechip';
  passiveChip.innerHTML = '<span>BRANCH</span><b>Base</b><em>no keystone</em>';
  padR.appendChild(passiveChip);
  const abilityButtons = { attack: btnMain, secondary: btnAlt, shift: btnMove, jump: btnJump, e: btnSkillE, q: btnSkillQ };
  function setupAbilityButton(btn, slot, key) {
    btn.classList.add('sr-ability');
    btn.dataset.slot = slot;
    btn.innerHTML = `<i class="sr-cdfill"></i><span class="sr-key">${key}</span><b class="sr-name">${key}</b><em class="sr-extra"></em>`;
  }
  setupAbilityButton(btnMain, 'attack', 'ATK');
  setupAbilityButton(btnAlt, 'secondary', 'ALT');
  setupAbilityButton(btnMove, 'shift', 'SHIFT');
  setupAbilityButton(btnJump, 'jump', 'JUMP');
  setupAbilityButton(btnSkillE, 'e', 'E');
  setupAbilityButton(btnSkillQ, 'q', 'Q');
  root.appendChild(padL); root.appendChild(padR);
  padL.style.display = padR.style.display = 'none';

  // ---------- input ----------
  const input = { left: false, right: false, down: false, jumpHeld: false, jumpHold: 0 };
  const pointer = { x: 0, y: 0, active: false };   // cursor, sets the attack direction
  let jumpBuf = 0;
  const press = (held) => {
    if (held && player && state === 'playing' && cls.id === 'rogue' && !player.grounded && player.coyote <= 0 && !player.rogueAirJump) {
      startRogueAirFlip(player);
      jumpBuf = 0; input.jumpHeld = true; input.jumpHold = 0;
      return;
    }
    if (held) { jumpBuf = BUFFER; input.jumpHeld = true; input.jumpHold = 0; }
    else { input.jumpHeld = false; input.jumpHold = 0; }
  };
  function aimedAngle() {
    const shX = player.x, shY = player.y - 77;
    const tx = pointer.active ? pointer.x + cam.x : shX + player.facing * 60;
    const ty = pointer.active ? pointer.y + cam.y : shY;
    return Math.atan2(ty - shY, tx - shX);
  }
  function aimedDistance(fallback) {
    const shX = player.x, shY = player.y - 76;
    if (!pointer.active) return fallback;
    return Math.hypot(pointer.x + cam.x - shX, pointer.y + cam.y - shY);
  }
  function isRangerShot(type) {
    return type === 'arrow' || type === 'volley';
  }
  function rangerAmmoCost(type) {
    return type === 'volley' ? 3 : 1;
  }
  function rangerNockAmount(act) {
    return clamp(((act && act.draw && act.draw.t) || 0) / RANGER_NOCK_TIME, 0, 1);
  }
  function rangerDrawPull(act) {
    const d = act && act.draw;
    if (!d || !d.active) return 0;
    return ease(clamp((d.t - RANGER_NOCK_TIME) / Math.max(1, RANGER_DRAW_MAX - RANGER_NOCK_TIME), 0, 1));
  }
  function rangerDrawPower(act) {
    return rangerDrawPull(act);
  }
  function rangerReloadAmount(act) {
    const d = act && act.draw;
    return d && d.reload > 0 ? clamp(1 - d.reload / RANGER_RELOAD_TIME, 0, 1) : 1;
  }
  function cooldownBag(act) {
    if (!act.cooldowns) act.cooldowns = {};
    return act.cooldowns;
  }
  function actionCooldown(type) {
    return ACTION_COOLDOWN[type] || 900;
  }
  function cooldownLeft(type) {
    return player ? (cooldownBag(player)[type] || 0) : 0;
  }
  function cooldownReady(type) {
    return cooldownLeft(type) <= 0;
  }
  function spendCooldown(type, ms) {
    if (!player || !type) return;
    const bag = cooldownBag(player);
    bag[type] = Math.max(bag[type] || 0, ms == null ? actionCooldown(type) : ms);
    syncLegacyCooldowns(player);
    if (player.team === 'hero') syncHud();
  }
  function canUseAttackCooldown(type) {
    return cooldownReady(type);
  }
  function spendAttackCooldown(type) {
    spendCooldown(type, actionCooldown(type));
  }
  function slotKey(slot) {
    return `slot:${slot}`;
  }
  function slotCooldown(slot) {
    const byClass = cls && SLOT_COOLDOWN[cls.id];
    return byClass && byClass[slot] || SLOT_COOLDOWN[slot] || 3000;
  }
  function slotUnlocked(slot) {
    if (!player || player.team !== 'hero') return true;
    if (labMode) return true;
    return !arenaMode || (arenaWave || 1) >= (SLOT_UNLOCK_WAVE[slot] || 1);
  }
  function slotStateText(slot) {
    const label = slot === 'shift' ? 'S' : slot.toUpperCase();
    if (!slotUnlocked(slot)) return `${label}@${SLOT_UNLOCK_WAVE[slot] || 1}`;
    const t = cooldownLeft(slotKey(slot));
    return `${label}:${t > 0 ? (t / 1000).toFixed(1) : 'RDY'}`;
  }
  function baseLoadout(id) {
    return Object.assign({}, CLASS_LOADOUT[id] || CLASS_LOADOUT.knight);
  }
  function baseRunBuild(id) {
    return {
      loadout: baseLoadout(id),
      picked: [],
      branchPoints: {},
      softBranch: null,
      lastDraft: null,
    };
  }
  function ability(id) {
    return id && ABILITIES[id] ? Object.assign({ id }, ABILITIES[id]) : null;
  }
  function equipped(slot) {
    return ability(loadout && loadout[slot]);
  }
  function branchInfo(classId, branchId) {
    const tree = CLASS_TREES[classId] && CLASS_TREES[classId].branches;
    return tree && tree[branchId] || null;
  }
  function branchName(spec) {
    if (!spec) return '';
    if (spec.cls === 'neutral') return 'Physics';
    const info = branchInfo(spec.cls, spec.branch);
    return info ? info.name : spec.branch || '';
  }
  function tagsText(spec) {
    return spec && spec.tags && spec.tags.length ? spec.tags.join(' / ') : '';
  }
  function currentDraftTier() {
    const w = arenaWave || 1;
    if (w <= 2) return 1;
    if (w <= 4) return 2;
    if (w <= 6) return 3;
    if (w <= 8) return 4;
    return 5;
  }
  function tierUnlocked(spec) {
    if (!spec) return false;
    if (spec.unlockWave && (arenaWave || 1) < spec.unlockWave) return false;
    return (spec.tier || 1) <= currentDraftTier();
  }
  function nodePicked(id) {
    return !!(runBuild && runBuild.picked && runBuild.picked.includes(id));
  }
  function prereqMet(spec) {
    if (!spec) return false;
    if (spec.prereqAll) {
      const all = Array.isArray(spec.prereqAll) ? spec.prereqAll : [spec.prereqAll];
      if (!all.every(nodePicked)) return false;
    }
    if (!spec.prereq) return true;
    const list = Array.isArray(spec.prereq) ? spec.prereq : [spec.prereq];
    return list.some(nodePicked);
  }
  function branchScore(branch) {
    return runBuild && runBuild.branchPoints && runBuild.branchPoints[branch] || 0;
  }
  function recomputeSoftBranch() {
    if (!runBuild) return null;
    let best = null, bestScore = 0;
    for (const [branch, score] of Object.entries(runBuild.branchPoints || {})) {
      if (score > bestScore) { best = branch; bestScore = score; }
    }
    runBuild.softBranch = bestScore >= 2 ? best : null;
    return runBuild.softBranch;
  }
  function slotAlreadyOffered(ids, spec) {
    return ids.some(id => ability(id).slot === spec.slot);
  }
  function canDraftNode(id) {
    const a = ability(id);
    if (!a || !a.draft || !tierUnlocked(a) || !prereqMet(a)) return false;
    if (a.cls !== cls.id && a.cls !== 'neutral') return false;
    if (a.cls === cls.id && a.branch && !branchInfo(a.cls, a.branch)) return false;
    if (nodePicked(id)) return false;
    if (a.slot === 'passive') return loadout.passive !== id;
    return loadout[a.slot] !== id;
  }
  function hasPassive(id) {
    return !!(loadout && loadout.passive === id && player && player.team === 'hero');
  }
  function hasRunNode(id) {
    return hasPassive(id) || nodePicked(id);
  }
  function rogueFlipConfig(act) {
    const heroRogue = act && act.team === 'hero';
    const advanced = heroRogue && (hasRunNode('rg_skyblade') || hasRunNode('rg_tuckedflip'));
    const tucked = advanced || heroRogue && hasRunNode('rg_bloodrush');
    const flowy = heroRogue && (hasRunNode('rg_flow') || hasRunNode('rg_skyblade') || hasRunNode('rg_tuckedflip'));
    return {
      dur: advanced ? 650 : tucked ? 600 : 560,
      vx: advanced ? 2.25 : tucked ? 2.05 : 1.85,
      burst: advanced ? 15 : tucked ? 13 : 12,
      tuck: advanced ? 1.45 : tucked ? 1.28 : 1.12,
      curl: advanced ? 1.35 : tucked ? 1.20 : 1.06,
      flowRadius: advanced ? 128 : flowy ? 112 : 0,
      flowGain: advanced ? 2 : flowy ? 1 : 0,
      flowSpark: advanced ? 14 : 10,
    };
  }
  function startRogueAirFlip(act, opts) {
    if (!act) return false;
    const cfg = rogueFlipConfig(act);
    const dir = act.facing || 1;
    act.rogueAirJump = true;
    act.vy = JUMP * 0.78;
    act.vx += dir * cfg.vx;
    act.flip = {
      active: true, t: 0, dur: cfg.dur, dir,
      tuck: cfg.tuck, curl: cfg.curl,
      flowRadius: cfg.flowRadius, flowGain: cfg.flowGain, flowSpark: cfg.flowSpark, flowHit: false,
      lastTrail: -1,
    };
    act.anim.squash = -0.35;
    const burstScale = opts && opts.burstScale || 1;
    burst(act.x - dir * 4, act.y - 34, cls.color, cfg.burst * burstScale, 2.8 + (cfg.tuck - 1) * 0.8);
    return true;
  }
  function grantRogueFlipFlow(act) {
    if (!act || !act.flip || !act.flip.active || act.flip.flowHit || !act.flip.flowGain || act.team !== 'hero') return;
    const radius = act.flip.flowRadius || 0;
    if (radius <= 0) return;
    const foes = targetActorsForPlayer();
    let nearest = null;
    let best = radius;
    for (const foe of foes) {
      if (!foe || foe.hp <= 0) continue;
      const dx = foe.x - act.x;
      const dy = (foe.y - 38) - (act.y - 44);
      const d = Math.hypot(dx, dy);
      if (d < best) { best = d; nearest = foe; }
    }
    if (!nearest) return;
    act.flip.flowHit = true;
    if (cls.id === 'rogue') {
      act.rogueBurst = Math.min(ROGUE_BURST_MAX, (act.rogueBurst || 0) + act.flip.flowGain);
      act.rogueBurstRegen = 0;
    }
    burst(nearest.x, nearest.y - 42, '#ffffff', act.flip.flowSpark || 10, 2.6);
    burst(act.x, act.y - 36, cls.color, 9 + act.flip.flowGain * 2, 2.2);
    addShake(1.1, 70);
    syncHud();
  }
  function abilityCooldown(slot) {
    const spec = equipped(slot);
    return (spec && spec.cd) || slotCooldown(slot);
  }
  function actionName(type) {
    const fallback = {
      slash: 'Slash', crush: 'Crush', dualSlash: 'Twin Slash', rogueStab: 'Stab', legSweep: 'Sweep',
      throw: 'Knife Toss', shieldGuard: 'Guard', shieldBash: 'Bash', braceThrust: 'Thrust',
      lanceCharge: 'Charge', cast: 'Bolt', arcaneBloom: 'Bloom', arrow: 'Shot', volley: 'Volley',
      shieldStep: 'Step', shoulder: 'Shoulder', slide: 'Slide', airDash: 'Air Dash', brace: 'Brace',
      backstep: 'Backstep', vault: 'Vault', quake: 'Quake', staffSweep: 'Staff',
    };
    return fallback[type] || type || 'Ready';
  }
  function syncLegacyCooldowns(act) {
    if (!act) return;
    const c = cooldownBag(act), cdef = act.cls || cls || {};
    act.attackCd = Math.max(c[cdef.main] || 0, c.dualSlash || 0, c.rogueStab || 0, c.legSweep || 0, c.arrow || 0, c.cast || 0, c.braceThrust || 0, c.slash || 0);
    act.abilityCd = Math.max(c[cdef.alt] || 0, c[slotKey('e')] || 0, c[slotKey('q')] || 0);
    act.moveCd = Math.max(c[cdef.move] || 0, c[slotKey('shift')] || 0);
  }
  function isRogueKnifeAttack(type) {
    return type === 'dualSlash' || type === 'rogueStab' || type === 'legSweep';
  }
  function canRogueAttack(type) {
    if (cls.id !== 'rogue') return true;
    if (type === 'throw') return player.knifeAmmo > 0;
    if (!isRogueKnifeAttack(type)) return true;
    if (player.knifeAmmo <= 0) return false;
    if (type === 'dualSlash' && player.knifeAmmo < 2) return false;
    return (player.rogueBurst || 0) > 0;
  }
  function spendRogueBurst(type) {
    if (cls.id !== 'rogue' || !isRogueKnifeAttack(type)) return;
    player.rogueBurst = Math.max(0, (player.rogueBurst || 0) - 1);
    player.rogueBurstRegen = 0;
  }
  function horizontalAimFromFacing(dir) {
    return dir >= 0 ? 0 : Math.PI;
  }
  function lanceChargeAim(opts) {
    let dir = player.facing || 1;
    if (opts && opts.aim != null) dir = Math.cos(opts.aim) >= 0 ? 1 : -1;
    else if (pointer.active) dir = (pointer.x + cam.x) >= player.x ? 1 : -1;
    return horizontalAimFromFacing(dir);
  }
  function startRangerDraw(type) {
    if (!player || state !== 'playing' || cls.id !== 'ranger' || !isRangerShot(type)) return false;
    if (player.anim.atkActive || player.draw.active) return false;
    if (!canUseAttackCooldown(type)) return false;
    if (player.arrowAmmo < rangerAmmoCost(type)) return false;
    player.draw.active = true; player.draw.type = type; player.draw.t = 0; player.draw.reload = 0; player.draw.aim = aimedAngle(); player.draw.lastType = type;
    player.anim.aimShown = player.draw.aim; player.anim.aimShownV = 0;
    player.facing = Math.cos(player.draw.aim) >= 0 ? 1 : -1;
    return true;
  }
  function releaseRangerDraw() {
    if (!player || cls.id !== 'ranger' || !player.draw.active) return false;
    const d = player.draw;
    const shotType = d.type || 'arrow';
    const aim = d.aim;
    const power = 0.48 + rangerDrawPower(player) * 0.92;
    player.draw.active = false; player.draw.type = null; player.draw.t = 0; player.draw.aim = aim; player.draw.reload = RANGER_RELOAD_TIME; player.draw.lastType = shotType;
    return triggerAttack(shotType, { aim, drawPower: power, fromDraw: true });
  }
  function startVisualAttack(type, ang, opts) {
    if (!player || state !== 'playing' || !type) return false;
    const a = player.anim;
    if (!a || a.atkActive) return false;
    opts = opts || {};
    a.atkAim = ang != null ? ang : aimedAngle();
    player.facing = Math.cos(a.atkAim) >= 0 ? 1 : -1;
    a.aimShown = a.atkAim;
    a.aimShownV = 0;
    a.action = startAttackAction(type);
    a.atkActive = true;
    a.atkType = type;
    a.atkT = 0;
    a.atkDur = a.action.dur;
    a.atkPhase = 'anticipation';
    a.struck = false;
    a.struck2 = false;
    a.visualOnly = true;
    a.visualKind = opts.kind || type;
    a.drawPower = 1;
    a.atkRange = opts.range || 0;
    a.atkVar = (Math.random() * 64) | 0;
    return true;
  }
  function triggerAttack(type, opts) {
    if (!player || state !== 'playing' || !type) return false;
    const a = player.anim;
    if (cls.id === 'rogue' && !(opts && opts.queued)) player.queuedAttack = null;
    if (player.draw && player.draw.active && !(opts && opts.fromDraw)) return false;
    if (a.atkActive) return false;           // one swing at a time
    if (!(opts && opts.fromDraw) && !canUseAttackCooldown(type)) return false;
    if (!canRogueAttack(type)) return false;
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
    if (cls.id === 'ranger' && isRangerShot(type)) {
      const cost = rangerAmmoCost(type);
      if (player.arrowAmmo < cost) return false;
      player.arrowAmmo -= cost;
      player.arrowRegen = 0;
      syncHud();
    }
    if (type === 'lanceCharge') {
      a.atkAim = lanceChargeAim(opts);
      player.facing = Math.cos(a.atkAim) >= 0 ? 1 : -1;
    } else if (opts && opts.aim != null) {
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
    a.visualOnly = false;
    a.visualKind = null;
    a.drawPower = opts && opts.drawPower != null ? opts.drawPower : (cls.id === 'ranger' && isRangerShot(type) ? 0.82 : 1);
    a.atkRange = opts && opts.range != null ? opts.range : type === 'arcaneBloom' ? clamp(aimedDistance(500), 130, 560) : 0;
    a.atkVar = (Math.random() * 64) | 0;     // vary the swing so motions aren't identical
    if (isLancerAttack(type)) player.vx *= 0.18;
    spendAttackCooldown(type);
    spendRogueBurst(type);
    // rogue dual-wield: one tap = one hand, alternating slashes and stabs.
    if (cls.id === 'rogue' && (type === 'dualSlash' || type === 'rogueStab')) {
      a.rogueHand = player.knifeAmmo > 1 ? (a.rogueHandNext | 0) : 0;
      a.rogueHandNext = a.rogueHand ? 0 : 1;
    }
    // knight slash combo: chain taps cycle diagonal -> horizontal -> overhead
    if (type === 'slash') {
      const nowMs = performance.now();
      a.slashFlavor = (nowMs - (a.comboAt || 0) < 850) ? ((a.slashFlavor | 0) + 1) % 3 : 0;
      a.comboAt = nowMs;
    }
    return true;
  }
  function startClassMove(type) {
    if (!player || state !== 'playing' || !type || player.move.active) return false;
    if (cls.id === 'rogue' && type === cls.move) type = 'slide';
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
    } else if (type === 'slide') {
      player.vx = player.facing * 9.0;
      player.vy = Math.min(player.vy, 1.0);
      burst(player.x - player.facing * 12, player.y - 9, cls.color, 10, 2.8);
      if (player.team === 'hero') syncHud();
    }
    return true;
  }
  function triggerMove() {
    if (!player || state !== 'playing' || !cls.move || player.move.active) return false;
    const spec = player.team === 'hero' ? equipped('shift') : null;
    let type = spec && spec.action || cls.move;
    if (cls.id === 'rogue') type = 'slide';
    if (!cooldownReady(type)) return false;
    const ok = startClassMove(type);
    if (ok) spendCooldown(type, actionCooldown(type));
    return ok;
  }
  function aimedPoint(maxRange) {
    const shX = player.x, shY = player.y - 76;
    const ang = aimedAngle();
    const dist = clamp(aimedDistance(maxRange), 70, maxRange || 320);
    return { x: shX + Math.cos(ang) * dist, y: shY + Math.sin(ang) * dist, ang, dist };
  }
  function abilityAimCue(ang) {
    player.anim.aimTarget = ang;
    player.anim.aimShown = ang;
    player.facing = Math.cos(ang) >= 0 ? 1 : -1;
  }
  function knifeSpreadOffsets(count, spread) {
    count = Math.max(0, count | 0);
    if (count <= 1) return count === 1 ? [0] : [];
    const out = [];
    for (let i = 0; i < count; i++) out.push(lerp(-spread, spread, i / (count - 1)));
    return out;
  }
  function spawnKnifeSpread(ang, count, opts) {
    opts = opts || {};
    const spread = opts.spread != null ? opts.spread : (opts.tight ? 0.20 : 0.34);
    const offsets = knifeSpreadOffsets(count, spread);
    for (const off of offsets) spawnDagger(ang + off, Object.assign({}, opts, { fan: true }));
    return offsets.length;
  }
  function useRogueFanKnives(ang) {
    const maxFan = hasPassive('rg_trapmaster') ? 6 : 5;
    const count = Math.min(player.knifeAmmo || 0, maxFan);
    if (count <= 0) return false;
    player.knifeAmmo -= count;
    player.knifeRegen = 0;
    spawnKnifeSpread(ang, count, { hit: 13, speed: 31.5, bounce: hasPassive('rg_trapmaster') ? 1 : 0 });
    burst(player.x + Math.cos(ang) * 24, player.y - 72 + Math.sin(ang) * 24, cls.color, 16, 3.4);
    if (count >= 5) spawnShockwaveRing(player.x + Math.cos(ang) * 54, player.y - 72 + Math.sin(ang) * 32, 92, cls.color, { life: 260, width: 3.4, fill: 0.05, rough: 0.070 });
    return true;
  }
  function useBladeBarrage(ang) {
    if (!startVisualAttack('throw', ang, { kind: 'bladeBarrage' })) return false;
    const total = hasPassive('rg_trapmaster') ? 24 : 20;
    const cx = player.x;
    const cy = player.y - 58;
    for (let i = 0; i < total; i++) {
      const ring = i % 2;
      const a = ang + Math.PI + (i / total) * Math.PI * 2 + rand(-0.10, 0.10);
      const rx = 42 + ring * 23 + rand(-4, 8);
      const ry = 24 + ring * 15 + rand(-3, 7);
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      const launch = a + rand(-0.75, 0.75);
      spawnDagger(launch, {
        x, y,
        speed: rand(0.5, 1.5),
        hit: 8.8,
        homing: true,
        summoned: true,
        noDrop: true,
        arm: 150 + i * 22,
        phase: a,
        stagger: 540,
        life: 2100 + i * 18,
        color: cls.color,
        quiet: true,
      });
      if (i < 16) spawnBladeRecallTrail(cx + rand(-8, 8), cy + rand(-7, 7), x, y, { life: 340, phase: i * 0.38, accent: cls.color });
      particles.push({
        x, y,
        vx: Math.cos(a) * rand(0.3, 1.0),
        vy: Math.sin(a) * rand(0.2, 0.8) - 0.15,
        life: rand(260, 520),
        max: 520,
        color: Math.random() < 0.45 ? '#ffffff' : cls.color,
        r: rand(1.1, 2.8),
      });
    }
    burst(cx, cy, cls.color, 28, 4.6);
    burst(cx, cy, '#ffffff', 10, 2.8);
    spawnShockwaveRing(cx, cy, 138, cls.color, { life: 420, width: 4.4, fill: 0.08, rough: 0.060 });
    addShake(2.4, 130);
    return true;
  }
  function useBladeStorm() {
    const cx = player.x, cy = player.y - 46;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      hitBoxesSegment(cx, cy, cx + Math.cos(a) * 98, cy + Math.sin(a) * 62, Math.cos(a), Math.sin(a) * 0.35, 18, 12);
    }
    burst(cx, cy, cls.color, 38, 5.4);
    burst(cx, cy, '#ffffff', 16, 3.4);
    addShake(3.4, 130);
    return true;
  }
  function spawnAirSpiralRead(cx, cy, dir) {
    const count = 18;
    const spin = dir >= 0 ? 1 : -1;
    for (let i = 0; i <= count; i++) {
      const a = spin * (i / count * Math.PI * 2 + 0.28);
      const squash = 0.60 + Math.sin(i * 0.7) * 0.05;
      slashTrail.push({
        x: cx + Math.cos(a) * (82 + Math.sin(i * 0.9) * 6),
        y: cy + Math.sin(a) * (56 * squash),
        life: 280,
        c: cls.trail,
      });
      if (i % 3 === 0) particles.push({
        x: cx + Math.cos(a) * 74,
        y: cy + Math.sin(a) * 44,
        vx: Math.cos(a) * rand(0.7, 1.8),
        vy: Math.sin(a) * rand(0.35, 1.2) - 0.3,
        life: rand(180, 340),
        max: 340,
        color: Math.random() < 0.35 ? '#ffffff' : cls.color,
        r: rand(1.3, 3.2),
      });
    }
    while (slashTrail.length > 70) slashTrail.shift();
    spawnShockwaveRing(cx, cy, 136, cls.color, { life: 500, width: 5.8, fill: 0.08, rough: 0.060 });
  }
  function useKnightRally() {
    activateShieldGuard();
    if (allies) for (const a of allies) if (!a.dead && Math.hypot(a.x - player.x, a.y - player.y) < 430) {
      a.shieldGuard = Math.max(a.shieldGuard || 0, KNIGHT_SHIELD_TIME * 0.85);
      a.shieldFlash = Math.max(a.shieldFlash || 0, 220);
      burst(a.x + a.facing * 18, a.y - 42, a.cls.color, 12, 2.6);
      burst(a.x + a.facing * 22, a.y - 46, '#dcecff', 8, 2.0);
    }
    burst(player.x, player.y - 46, '#dcecff', 24, 3.4);
    return true;
  }
  function useLancerAnchor() {
    const f = player.facing || 1;
    player.vx *= 0.08;
    hitBoxesSegment(player.x + f * 12, player.y - 62, player.x + f * 154, player.y - 62, f, -0.05, 32, 15);
    hitBoxesSegment(player.x + f * 18, player.y - 34, player.x + f * 118, player.y - 18, f, -0.12, 20, 12);
    burst(player.x + f * 82, player.y - 58, cls.color, 22, 4.2);
    addShake(3.2, 120);
    return true;
  }
  function useMageSingularity() {
    const p = aimedPoint(620);
    spawnBlackHole(p.x, p.y, player.team, cls.color, { r: 265, life: 2200, pullPower: 1.15 });
    return true;
  }
  function useRangerPowerShot(ang) {
    if (player.arrowAmmo <= 0) return false;
    player.arrowAmmo--;
    player.arrowRegen = 0;
    spawnArrow(ang, 1.85, { pierce: 1, powerShot: true });
    burst(player.x + Math.cos(ang) * 36, player.y - 72 + Math.sin(ang) * 36, cls.color, 14, 3.2);
    return true;
  }
  function useRangerArrowStorm(ang) {
    const cost = Math.min(player.arrowAmmo || 0, 3);
    if (cost <= 0) return false;
    player.arrowAmmo -= cost;
    player.arrowRegen = 0;
    for (const off of [-0.30, -0.15, 0, 0.15, 0.30]) spawnArrow(ang + off, 1.18, { storm: true });
    burst(player.x + Math.cos(ang) * 40, player.y - 70 + Math.sin(ang) * 40, cls.color, 24, 4.2);
    return true;
  }
  function targetActorsForPlayer() {
    if (!player) return [];
    return player.team === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : (fighters || []).filter(e => e && !e.dead);
  }
  function nearestTarget(range, frontOnly) {
    let best = null, bd = range || 260;
    const dir = player.facing || 1;
    for (const t of targetActorsForPlayer()) {
      const dx = t.x - player.x, dy = (t.y - 42) - (player.y - 44), d = Math.hypot(dx, dy);
      if (frontOnly && Math.sign(dx || dir) !== dir) continue;
      if (d < bd) { best = t; bd = d; }
    }
    return best;
  }
  function nearestKnifeHomingTarget(b) {
    let best = null, bd = b.seekRange || 760;
    const add = (x, y, actor) => {
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = { x, y, actor }; }
    };
    if ((b.team || 'hero') === 'enemy') {
      for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t)) add(t.x, t.y - 44, t);
    } else {
      if (fighters) for (const e of fighters) if (e && !e.dead) add(e.x, e.y - 44, e);
      if (dummies) for (const d of dummies) if (d && d.pts) add(d.pts.chest.x, d.pts.chest.y, d);
    }
    return best;
  }
  function updateHomingDagger(b) {
    b.age = (b.age || 0) + STEP;
    if (b.arm > 0) {
      b.arm -= STEP;
      const orbit = (runTime || 0) * 0.018 + (b.phase || 0);
      b.vx = lerp(b.vx, Math.cos(orbit) * 0.95, 0.18);
      b.vy = lerp(b.vy, Math.sin(orbit) * 0.58 - 0.06, 0.18);
      b.angle = orbit + Math.PI * 0.5;
      if (Math.random() < 0.58) particles.push({
        x: b.x + rand(-2, 2),
        y: b.y + rand(-2, 2),
        vx: rand(-0.18, 0.18),
        vy: rand(-0.26, 0.16),
        life: rand(150, 280),
        max: 280,
        color: Math.random() < 0.45 ? '#ffffff' : b.color,
        r: rand(0.8, 1.8),
      });
      return;
    }
    const tgt = nearestKnifeHomingTarget(b);
    if (tgt) {
      const dx = tgt.x - b.x, dy = tgt.y - b.y, d = Math.hypot(dx, dy) || 1;
      const spd = b.seekSpeed || 24;
      b.vx = lerp(b.vx, dx / d * spd, 0.14);
      b.vy = lerp(b.vy, dy / d * spd, 0.14);
    } else {
      b.vy += 0.06;
      b.vx *= 0.995;
    }
    b.angle = Math.atan2(b.vy, b.vx);
    if (Math.random() < 0.78) particles.push({
      x: b.x - b.vx * rand(0.10, 0.32) + rand(-1.8, 1.8),
      y: b.y - b.vy * rand(0.10, 0.32) + rand(-1.8, 1.8),
      vx: -b.vx * rand(0.008, 0.020) + rand(-0.20, 0.20),
      vy: -b.vy * rand(0.008, 0.020) + rand(-0.20, 0.20),
      life: rand(150, 320),
      max: 320,
      color: Math.random() < 0.36 ? '#ffffff' : b.color,
      r: rand(0.8, 2.2),
    });
  }
  function pointAhead(dist) {
    const f = player.facing || 1;
    const x = player.x + f * dist;
    const y = surfaceYFor(player, x, 240, 160) || player.y;
    return { x, y, f };
  }
  function spawnAbilityBox(kind, x, bottom, opts) {
    opts = opts || {};
    const box = makeBoxSpec({
      kind,
      x: x - (opts.w || 44) / 2,
      bottom,
      w: opts.w || 44,
      h: opts.h || 44,
      m: opts.m || (kind === 'barrier' ? 9 : kind === 'barrel' ? 1.2 : 2),
      life: opts.life || 0,
      team: player ? player.team : 'hero',
    });
    boxes.push(box);
    burst(x, bottom - (opts.h || 44) / 2, opts.color || cls.color, 14, 3.2);
    return box;
  }
  function pullActorsAndBoxes(ang, opts) {
    opts = opts || {};
    const p = aimedPoint(opts.range || 280);
    const all = !!opts.all;
    const targets = targetActorsForPlayer().filter(t => Math.hypot(t.x - p.x, (t.y - 42) - p.y) < (opts.range || 280));
    const chosen = all ? targets : targets.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 1);
    const pullMul = hasPassive('ln_tethermaster') ? 1.22 : 1;
    for (const t of chosen) {
      const dx = p.x - t.x, dy = p.y - (t.y - 42), d = Math.hypot(dx, dy) || 1;
      t.vx += (dx / d) * (opts.force || 7) * pullMul;
      t.vy += (dy / d) * (opts.force || 7) * 0.32 - 1.6;
      t.grounded = false;
      t.flash = Math.max(t.flash || 0, 180);
      if (t.brain) t.brain.stagger = Math.max(t.brain.stagger || 0, 220);
    }
    const boxRange = opts.range || 280;
    if (all || hasPassive('ln_tethermaster')) for (const b of boxes) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, d = Math.hypot(cx - p.x, cy - p.y) || 1;
      if (d < boxRange) pushBox(b, (p.x - cx) / d, (p.y - cy) / d, (opts.force || 7) * 2.1);
    }
    burst(p.x, p.y, cls.color, all ? 30 : 18, 4.4);
    addShake(all ? 3.5 : 1.8, 120);
    return chosen.length > 0 || all;
  }
  function chainLightning(ang, jumps) {
    let from = { x: player.x, y: player.y - 70 };
    const seen = new Set();
    let hitAny = false;
    for (let i = 0; i < (jumps || 4); i++) {
      let best = null, bd = 210;
      for (const t of targetActorsForPlayer()) {
        if (seen.has(t)) continue;
        const d = Math.hypot(t.x - from.x, (t.y - 42) - from.y);
        if (d < bd) { best = t; bd = d; }
      }
      for (const b of boxes) {
        if (seen.has(b)) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, d = Math.hypot(cx - from.x, cy - from.y);
        if (d < bd) { best = b; bd = d; }
      }
      if (!best) break;
      const tx = best.cls ? best.x : best.x + best.w / 2, ty = best.cls ? best.y - 42 : best.y + best.h / 2;
      rememberDebugSegment('ability', from.x, from.y, tx, ty, 8, '#8fe6ff', 300);
      burst(tx, ty, '#8fe6ff', 12, 4.5);
      if (best.cls) hurtFighter(best, Math.sign(tx - from.x) || player.facing, -0.35, 13, tx, ty);
      else pushBox(best, Math.sign(tx - from.x) || player.facing, -0.45, 16);
      seen.add(best); from = { x: tx, y: ty }; hitAny = true;
    }
    if (hitAny) addShake(2.4, 120);
    return hitAny;
  }
  function nearestBoxFrom(x, y, range, frontOnly) {
    let best = null, bd = range || 180;
    const f = player ? player.facing || 1 : 1;
    for (const b of boxes || []) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (frontOnly && Math.sign(cx - player.x || f) !== f) continue;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bd) { best = b; bd = d; }
    }
    return best;
  }
  function nearestBoxAhead(range) {
    return nearestBoxFrom(player.x + (player.facing || 1) * 48, player.y - 34, range || 180, true);
  }
  function reflectNearbyProjectiles(x, y, radius, color) {
    let any = false;
    for (const p of projectiles || []) {
      if (!p || p.team === player.team) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > radius) continue;
      const nx = (p.x - x) / (d || 1), ny = (p.y - y) / (d || 1);
      const sp = Math.max(16, Math.hypot(p.vx, p.vy) * 1.08);
      p.vx = nx * sp; p.vy = ny * sp; p.team = player.team; p.color = color || cls.color; p.bounce = Math.max(p.bounce || 0, 1);
      burst(p.x, p.y, '#ffffff', 10, 2.8);
      any = true;
    }
    return any;
  }
  function triggerObjectsOnLine(ax, ay, bx, by, radius, force, remote) {
    let any = false;
    for (const b of boxes || []) {
      const close = remote ? Math.hypot(b.x + b.w / 2 - bx, b.y + b.h / 2 - by) < radius : segAabbDist(ax, ay, bx, by, b) <= radius;
      if (!close) continue;
      if (b.kind === 'barrel') explodeBox(b, force || 18);
      else if (b.kind === 'spring') triggerSpringBox(b, null, force || 16);
      else pushBox(b, Math.sign(b.x + b.w / 2 - ax) || player.facing, -0.35, force || 16);
      any = true;
    }
    return any;
  }
  function spawnWardenAnchor(x, y, color) {
    const bottom = surfaceYFor(player, x, 260, 210) || y + 42;
    const a = { x, y: bottom - 42, bottom, life: 12000, max: 12000, team: player.team, color: color || cls.color };
    anchors = anchors || [];
    anchors.push(a);
    if (anchors.length > 3) anchors.shift();
    burst(a.x, a.y, '#ffffff', 12, 3.0);
    burst(a.x, a.y, a.color, 22, 3.8);
    return a;
  }
  function nearestAnchor(range) {
    let best = null, bd = range || 620;
    for (const a of anchors || []) {
      if (!a || a.team !== player.team) continue;
      const d = Math.hypot(a.x - player.x, a.y - (player.y - 42));
      if (d < bd) { best = a; bd = d; }
    }
    return best;
  }
  function placePortalPair(target) {
    const start = { x: player.x, y: player.y - 62, life: 13000, max: 13000, team: player.team, color: cls.color };
    const end = { x: target.x, y: target.y, life: 13000, max: 13000, team: player.team, color: '#8fe6ff' };
    portals = [start, end];
    rememberDebugSegment('ability', start.x, start.y, end.x, end.y, 8, cls.color, 520);
    burst(start.x, start.y, cls.color, 20, 3.8);
    burst(end.x, end.y, '#8fe6ff', 24, 4.2);
    return true;
  }
  function nearestPortalPairExit() {
    if (!portals || portals.length < 2) return null;
    const a = portals[0], b = portals[1];
    const da = Math.hypot(player.x - a.x, (player.y - 48) - a.y);
    const db = Math.hypot(player.x - b.x, (player.y - 48) - b.y);
    return da < db ? b : a;
  }
  function spawnPressureDecoy(x, y, opts) {
    opts = opts || {};
    if (!allies) allies = [];
    const a = makeFighter(opts.cls || 'rogue', x, y, { team: 'ally', hp: opts.hp || 2, min: x - 110, max: x + 110, facing: opts.facing || player.facing });
    a.brain.alert = 9999; a.brain.party = true; a.decoy = true; a.marked = opts.marked || 0;
    allies.push(a);
    burst(x, y - 42, opts.color || cls.color, 16, 3.2);
    return a;
  }
  function mageSpiritLoadoutActive() {
    if (!hero || !hero.cls || hero.cls.id !== 'mage' || !loadout) return false;
    return loadout.passive === 'mg_spiritbinder' || ['attack', 'secondary', 'e', 'q'].some(slot => {
      const id = loadout[slot];
      const spec = ability(id);
      return spec && spec.branch === 'spiritbinder';
    });
  }
  function mageGraviturgeLoadoutActive() {
    if (!player || !cls || cls.id !== 'mage') return false;
    if (player.team === 'enemy') return true;
    if (!loadout) return true;
    let gravity = 0, other = 0;
    for (const slot of ['attack', 'secondary', 'e', 'q', 'passive']) {
      const spec = ability(loadout[slot]);
      if (!spec || spec.cls !== 'mage' || !spec.branch) continue;
      if (spec.branch === 'graviturge') gravity++;
      else other++;
    }
    return gravity > 0 && gravity >= other;
  }
  function gravityDebrisMax() {
    return MAGE_DEBRIS_MAX + (hasPassive('mg_eventhorizon') ? 1 : 0);
  }
  function spiritClassFromSource(source) {
    const id = source && String(source);
    return CLASSES.some(c => c.id === id) ? id : 'rogue';
  }
  function spiritColorFromSource(source, fallback) {
    const c = CLASSES.find(k => k.id === spiritClassFromSource(source));
    return (c && c.color) || fallback || '#b48cff';
  }
  function soulParticle(x, y, vx, vy, opts) {
    opts = opts || {};
    addParticle({
      kind: 'soul',
      x, y, vx, vy,
      life: opts.life || rand(300, 760),
      max: opts.max || opts.life || 760,
      color: opts.color || '#b48cff',
      r: opts.r || rand(1.2, 2.9),
      drag: opts.drag || 0.976,
      lift: opts.lift == null ? rand(0.014, 0.040) : opts.lift,
      sway: opts.sway == null ? rand(0.006, 0.026) : opts.sway,
      seed: rand(0, Math.PI * 2),
      alpha: opts.alpha || 0.82,
      tail: opts.tail || rand(6, 17),
    });
  }
  function emitSoulWisp(ax, ay, bx, by, opts) {
    opts = opts || {};
    const count = opts.count || 10;
    const color = opts.color || '#b48cff';
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const px = -ny, py = nx;
    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 1 : i / (count - 1);
      const curl = Math.sin(t * Math.PI) * rand(-18, 18);
      const x = lerp(ax, bx, t) + px * curl + rand(-3, 3);
      const y = lerp(ay, by, t) + py * curl - Math.sin(t * Math.PI) * rand(8, 24) + rand(-3, 3);
      soulParticle(x, y, nx * rand(0.4, 1.7) + px * rand(-0.28, 0.28), ny * rand(0.35, 1.25) - rand(0.05, 0.65), {
        color: Math.random() < 0.28 ? '#f5efff' : color,
        life: rand(opts.lifeMin || 260, opts.lifeMax || 720),
        r: rand(opts.rMin || 1.1, opts.rMax || 3.0),
        tail: rand(8, 22),
      });
    }
  }
  function spiritRemnantSortByDistance(list, x, y) {
    return list.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  }
  function grantSpiritCharge(x, y, amount) {
    if (!hero || !mageSpiritLoadoutActive()) return false;
    hero.spiritCharges = clamp((hero.spiritCharges || 0) + Math.max(1, Math.round(amount || 1)), 0, 6);
    emitSoulWisp(x, y, hero.x, hero.y - 60, { count: 12, color: '#b48cff', lifeMin: 280, lifeMax: 660 });
    for (let i = 0; i < 5; i++) soulParticle(x + rand(-5, 5), y + rand(-4, 4), rand(-0.45, 0.45), rand(-1.25, -0.20), { color: '#f5efff', life: rand(260, 520), r: rand(1.1, 2.0) });
    syncHud();
    return true;
  }
  function spawnSpiritRemnant(x, y, opts) {
    if (!hero || !mageSpiritLoadoutActive()) return null;
    opts = opts || {};
    if (!spiritRemnants) spiritRemnants = [];
    const groundY = opts.groundY || surfaceYFor(hero, x, 520, 180) || y + 42;
    const source = spiritClassFromSource(opts.source || opts.cls);
    const color = opts.color || spiritColorFromSource(source, '#b48cff');
    const remnant = {
      x, y, groundY,
      vx: opts.vx || rand(-0.32, 0.32),
      vy: opts.vy || rand(-0.50, -0.14),
      age: 0,
      life: opts.life || 14000,
      max: opts.life || 14000,
      color,
      source,
      commandX: null,
      commandY: null,
      shepherd: 0,
      lashCd: rand(220, 520),
    };
    spiritRemnants.push(remnant);
    if (spiritRemnants.length > 10) spiritRemnants.shift();
    emitSoulWisp(x, y + 20, x, y - 16, { count: 16, color, lifeMin: 360, lifeMax: 880 });
    if (hero) emitSoulWisp(x, y, hero.x, hero.y - 60, { count: 7, color, lifeMin: 260, lifeMax: 620 });
    return remnant;
  }
  function nearestSpiritRemnant(range) {
    if (!player || !spiritRemnants || !spiritRemnants.length) return null;
    const px = player.x, py = player.y - 48;
    let best = null, bd = range || 240;
    for (const r of spiritRemnants) {
      const d = Math.hypot(r.x - px, r.y - py);
      if (d < bd) { best = r; bd = d; }
    }
    return best;
  }
  function consumeSpiritRemnant(r) {
    if (!r || !spiritRemnants) return false;
    const i = spiritRemnants.indexOf(r);
    if (i >= 0) spiritRemnants.splice(i, 1);
    emitSoulWisp(r.x, r.y, player.x, player.y - 58, { count: 18, color: r.color || '#b48cff', lifeMin: 300, lifeMax: 760 });
    rememberDebugSegment('ability', player.x, player.y - 58, r.x, r.y, 8, r.color || '#b48cff', 420);
    return true;
  }
  function spawnSpiritAlly(x, y, opts) {
    opts = opts || {};
    if (!allies) allies = [];
    const source = spiritClassFromSource(opts.cls || opts.source);
    const color = opts.color || spiritColorFromSource(source, '#b48cff');
    const groundY = surfaceYFor(hero || player, x, 300, 180) || y;
    const a = makeFighter(source, x, groundY, {
      team: 'ally',
      hp: opts.hp || 2,
      min: x - 130,
      max: x + 130,
      facing: opts.facing || (hero ? hero.facing : player.facing),
    });
    a.cls = Object.assign({}, a.cls, { color });
    a.brain.alert = 9999;
    a.brain.party = true;
    a.brain.aggroRange = Math.max(a.brain.aggroRange || 0, 760);
    a.brain.atkCd = 0;
    a.brain.moveCd = 0;
    a.brain.pauseT = 0;
    a.spirit = true;
    a.spiritSource = source;
    a.spiritLife = opts.life || 8500;
    a.spiritMaxLife = a.spiritLife;
    a.spiritCommandCd = opts.commandCd || 260;
    allies.push(a);
    emitSoulWisp(opts.fromX == null ? x : opts.fromX, opts.fromY == null ? groundY - 58 : opts.fromY, x, groundY - 50, {
      count: 24,
      color,
      lifeMin: 360,
      lifeMax: 900,
    });
    for (let i = 0; i < 10; i++) soulParticle(x + rand(-12, 12), groundY - rand(40, 82), rand(-0.45, 0.45), rand(-1.1, -0.12), { color: Math.random() < 0.28 ? '#f5efff' : color, life: rand(300, 680) });
    syncHud();
    return a;
  }
  function spiritCommandTarget(range) {
    const caster = hero || player;
    if (!caster) return null;
    let best = null, bd = range || 560;
    const consider = (target, x, y, type) => {
      const d = Math.hypot(x - caster.x, y - (caster.y - 44));
      if (d < bd) { best = { target, x, y, type }; bd = d; }
    };
    if (fighters) for (const e of fighters) if (e && !e.dead) consider(e, e.x, e.y - 44, 'fighter');
    if (dummies) for (const d of dummies) {
      if (!d || d.defeated) continue;
      const p = d.pts && (d.pts.chest || d.pts.head);
      if (p) consider(d, p.x, p.y, 'dummy');
    }
    return best;
  }
  function commandSpiritAlly(a, opts) {
    if (!a || a.dead) return false;
    opts = opts || {};
    const target = opts.target || spiritCommandTarget(opts.range || 620);
    const fallback = pointAhead(opts.fallback || 210);
    const tx = target ? target.x : fallback.x;
    const ty = target ? target.y : fallback.y - 46;
    const dx = tx - a.x, dy = ty - (a.y - 44), d = Math.hypot(dx, dy) || 1;
    a.spiritCommand = {
      life: opts.life || 1120,
      max: opts.life || 1120,
      x: tx,
      y: ty,
      target: target && target.target,
      type: target && target.type || 'point',
      force: opts.force || 14,
      hit: false,
    };
    a.facing = dx >= 0 ? 1 : -1;
    a.vx += (dx / d) * (opts.dash || 5.6);
    a.vy = Math.min(a.vy, (dy / d) * 2.2 - 2.4);
    a.spiritCommandCd = Math.max(a.spiritCommandCd || 0, opts.afterCd || 680);
    if (a.brain) { a.brain.alert = 9999; a.brain.stagger = Math.max(a.brain.stagger || 0, 90); }
    rememberDebugSegment('ability', a.x, a.y - 46, tx, ty, 8, '#b48cff', 520);
    emitSoulWisp(a.x, a.y - 48, tx, ty, { count: 9, color: a.cls && a.cls.color || '#b48cff', lifeMin: 240, lifeMax: 620 });
    return true;
  }
  function commandSpiritAllies(opts) {
    const list = livingAllies().filter(a => a.spirit);
    if (!list.length) return 0;
    const target = opts && opts.target || spiritCommandTarget(opts && opts.range || 650);
    let count = 0;
    for (const a of list) if (commandSpiritAlly(a, Object.assign({}, opts || {}, { target }))) count++;
    return count;
  }
  function bindSpiritAlly() {
    const remnant = nearestSpiritRemnant(340);
    if (remnant) {
      consumeSpiritRemnant(remnant);
      const ally = spawnSpiritAlly(remnant.x, remnant.groundY || remnant.y + 42, {
        hp: 2.25,
        life: 10800,
        facing: player.facing,
        color: remnant.color,
        source: remnant.source,
        fromX: player.x,
        fromY: player.y - 58,
      });
      commandSpiritAlly(ally, { force: 15, dash: 6.2, life: 980, range: 720 });
      syncHud();
      return true;
    }
    const charges = player.spiritCharges || 0;
    if (charges <= 0) {
      emitSoulWisp(player.x - player.facing * 12, player.y - 52, player.x + player.facing * 96, player.y - 58, { count: 8, color: '#b48cff', lifeMin: 240, lifeMax: 480 });
      addShake(1.4, 70);
      return false;
    }
    const p = pointAhead(72);
    player.spiritCharges--;
    const ally = spawnSpiritAlly(p.x, p.y, { hp: 1.45, life: 6900, facing: player.facing, source: 'rogue', fromX: player.x, fromY: player.y - 58 });
    commandSpiritAlly(ally, { force: 12, dash: 5.4, life: 820, range: 620 });
    syncHud();
    return true;
  }
  function soulFlare() {
    const x = player.x, y = player.y - 44;
    const target = spiritCommandTarget(760);
    const tx = target ? target.x : x + player.facing * 260;
    const ty = target ? target.y : y - 8;
    if ((player.spiritCharges || 0) > 0) player.spiritCharges--;
    const commanded = commandSpiritAllies({ target, force: 16, dash: 6.8, life: 1050, range: 760 });
    emitSoulWisp(x, y, tx, ty, { count: 24, color: '#b48cff', lifeMin: 300, lifeMax: 760 });
    if (spiritRemnants && spiritRemnants.length) {
      for (const r of spiritRemnants) {
        const d = Math.hypot(r.x - x, r.y - y);
        if (d > 560) continue;
        r.commandX = tx;
        r.commandY = ty;
        r.shepherd = Math.max(r.shepherd || 0, 1200);
        r.lashCd = Math.min(r.lashCd || 0, 120);
        emitSoulWisp(r.x, r.y, tx, ty, { count: 8, color: r.color || '#b48cff', lifeMin: 260, lifeMax: 620 });
      }
    }
    if (!commanded && target) {
      if (target.type === 'fighter' && target.target && !target.target.dead) hurtFighter(target.target, Math.sign(tx - x) || player.facing, -0.16, 8, tx, ty);
      else if (target.type === 'dummy' && target.target && !target.target.defeated) hurtDummy(target.target, Math.sign(tx - x) || player.facing, -0.18, 7, tx, ty);
    }
    pushBoxesRadial(tx, ty, 12, 92, player.team);
    addShake(3.0, 120);
    syncHud();
    return true;
  }
  function graveCall() {
    const charges = player.spiritCharges || 0;
    const nearby = spiritRemnants && spiritRemnants.length ? spiritRemnantSortByDistance(spiritRemnants, player.x, player.y - 54).filter(r => Math.hypot(r.x - player.x, r.y - (player.y - 54)) < 720) : [];
    const remnantCount = Math.min(nearby.length, 5);
    const chargeCount = Math.max(0, Math.min(charges, 5 - remnantCount));
    const count = remnantCount + chargeCount;
    if (count <= 0) {
      emitSoulWisp(player.x - player.facing * 18, player.y - 56, player.x + player.facing * 130, player.y - 66, { count: 12, color: '#b48cff', lifeMin: 260, lifeMax: 540 });
      addShake(1.8, 80);
      return false;
    }
    const spawned = [];
    for (let i = 0; i < remnantCount; i++) {
      const r = nearby[i];
      consumeSpiritRemnant(r);
      spawned.push(spawnSpiritAlly(r.x, r.groundY || r.y + 42, {
        hp: 2.15,
        life: 11600,
        facing: player.facing,
        color: r.color,
        source: r.source,
        fromX: player.x,
        fromY: player.y - 62,
      }));
    }
    for (let i = 0; i < chargeCount; i++) {
      const off = (i - (chargeCount - 1) / 2) * 42;
      const p = pointAhead(78 + off);
      spawned.push(spawnSpiritAlly(p.x, p.y, { hp: 1.55, life: 7600, facing: player.facing, source: 'rogue', fromX: player.x, fromY: player.y - 62 }));
    }
    const target = spiritCommandTarget(720);
    for (const a of spawned) commandSpiritAlly(a, { target, force: 17, dash: 6.9, life: 1260, fallback: 250 });
    player.spiritCharges = Math.max(0, charges - chargeCount);
    emitSoulWisp(player.x, player.y - 62, target ? target.x : player.x + player.facing * 300, target ? target.y : player.y - 76, { count: 30, color: '#b48cff', lifeMin: 360, lifeMax: 900 });
    addShake(5.4, 180);
    syncHud();
    return true;
  }
  function updateSpiritCommand(a, dtStep) {
    const cmd = a && a.spiritCommand;
    if (!cmd) return;
    cmd.life -= dtStep;
    const targetGone = cmd.type === 'fighter' && (!cmd.target || cmd.target.dead) || cmd.type === 'dummy' && (!cmd.target || cmd.target.defeated);
    if (targetGone || cmd.life <= 0) { a.spiritCommand = null; return; }
    if (cmd.target) {
      if (cmd.type === 'fighter') { cmd.x = cmd.target.x; cmd.y = cmd.target.y - 44; }
      else if (cmd.target.pts) {
        const p = cmd.target.pts.chest || cmd.target.pts.head;
        if (p) { cmd.x = p.x; cmd.y = p.y; }
      }
    }
    const sx = a.x, sy = a.y - 44;
    const dx = cmd.x - sx, dy = cmd.y - sy, d = Math.hypot(dx, dy) || 1;
    const fade = clamp(cmd.life / Math.max(1, cmd.max || cmd.life), 0, 1);
    a.facing = dx >= 0 ? 1 : -1;
    a.vx += (dx / d) * (0.34 + fade * 0.24);
    a.vy += (dy / d) * 0.12 - 0.03;
    if (Math.random() < 0.46) soulParticle(
      lerp(sx, cmd.x, rand(0.16, 0.84)),
      lerp(sy, cmd.y, rand(0.16, 0.84)) + rand(-8, 8),
      rand(-0.25, 0.25),
      rand(-0.65, 0.02),
      {
        color: Math.random() < 0.35 ? '#f5efff' : (a.cls && a.cls.color || '#b48cff'),
        life: rand(180, 380),
        r: rand(1.0, 2.5),
      }
    );
    if (!cmd.hit && d < 46) {
      const nx = dx / d || a.facing || 1, ny = dy / d || -0.15;
      if (cmd.type === 'fighter' && cmd.target && !cmd.target.dead) hurtFighter(cmd.target, nx, ny - 0.18, cmd.force || 14, cmd.x, cmd.y);
      else if (cmd.type === 'dummy' && cmd.target && !cmd.target.defeated) hurtDummy(cmd.target, nx, ny - 0.18, (cmd.force || 14) * 0.92, cmd.x, cmd.y);
      else radialActorPulse(cmd.x, cmd.y, 62, (cmd.force || 14) * 0.7, a.team || 'hero', '#b48cff');
      pushBoxesRadial(cmd.x, cmd.y, (cmd.force || 14) * 0.55, 82, a.team || 'hero');
      emitSoulWisp(sx, sy, cmd.x, cmd.y, { count: 16, color: a.cls && a.cls.color || '#b48cff', lifeMin: 240, lifeMax: 650 });
      for (let i = 0; i < 7; i++) soulParticle(cmd.x + rand(-6, 6), cmd.y + rand(-6, 6), nx * rand(0.3, 1.4) + rand(-0.35, 0.35), rand(-1.2, -0.08), { color: Math.random() < 0.32 ? '#f5efff' : (a.cls && a.cls.color || '#b48cff') });
      cmd.hit = true;
      cmd.life = Math.min(cmd.life, 220);
      addShake(2.2, 100);
    }
  }
  function updateSpiritRemnants(dtStep) {
    if (!spiritRemnants || !spiritRemnants.length) return;
    for (let i = spiritRemnants.length - 1; i >= 0; i--) {
      const r = spiritRemnants[i];
      r.age += dtStep;
      r.life -= dtStep;
      if (r.life <= 0 || !mageSpiritLoadoutActive()) {
        spiritRemnants.splice(i, 1);
        continue;
      }
      r.shepherd = Math.max(0, (r.shepherd || 0) - dtStep);
      r.lashCd = Math.max(0, (r.lashCd || 0) - dtStep);
      const caster = hero || player;
      const hoverY = (r.groundY || r.y + 42) - 54 + Math.sin((runTime || 0) * 0.003 + r.x * 0.01) * 5;
      let tx = r.x + Math.sin((runTime || 0) * 0.0018 + r.age * 0.002) * 12;
      let ty = hoverY;
      if (caster) {
        const dCaster = Math.hypot(caster.x - r.x, (caster.y - 58) - r.y);
        if (r.shepherd > 0 && r.commandX != null) {
          tx = lerp(caster.x, r.commandX, 0.72);
          ty = lerp(caster.y - 58, r.commandY, 0.72) - 10;
        } else if (dCaster < 430) {
          const orbit = (i % 5 - 2) * 22;
          tx = caster.x - caster.facing * 52 + orbit;
          ty = caster.y - 68 + Math.sin((runTime || 0) * 0.004 + i) * 13;
        }
      }
      r.vx += (tx - r.x) * 0.0021;
      r.vy += (ty - r.y) * 0.0024;
      r.vx *= 0.955;
      r.vy *= 0.955;
      r.x += r.vx * (dtStep / STEP);
      r.y += r.vy * (dtStep / STEP);
      if (r.shepherd > 0 && r.commandX != null && r.lashCd <= 0) {
        const dTarget = Math.hypot(r.commandX - r.x, r.commandY - r.y);
        if (dTarget < 82) {
          const target = spiritCommandTarget(820);
          const nx = (r.commandX - r.x) / Math.max(1, dTarget);
          const ny = (r.commandY - r.y) / Math.max(1, dTarget);
          if (target && target.type === 'fighter' && target.target && !target.target.dead) hurtFighter(target.target, nx || 0, (ny || 0) - 0.16, 7.2, r.commandX, r.commandY);
          else if (target && target.type === 'dummy' && target.target && !target.target.defeated) hurtDummy(target.target, nx || 0, (ny || 0) - 0.16, 6.5, r.commandX, r.commandY);
          pushBoxesRadial(r.commandX, r.commandY, 6.0, 62, hero && hero.team || 'hero');
          emitSoulWisp(r.x, r.y, r.commandX, r.commandY, { count: 9, color: r.color || '#b48cff', lifeMin: 180, lifeMax: 480 });
          r.lashCd = 640;
        }
      }
      if (Math.random() < 0.34) {
        const a = rand(0, Math.PI * 2), rr = rand(2, 20);
        soulParticle(r.x + Math.cos(a) * rr * 0.45, r.y + Math.sin(a) * rr * 0.68, Math.cos(a) * rand(-0.10, 0.16), rand(-0.56, 0.02), {
          color: Math.random() < 0.32 ? '#f5efff' : r.color,
          life: rand(180, 420),
          r: rand(0.9, 2.2),
        });
      }
    }
  }
  function smokeCloudColor(poison, bright) {
    if (poison) {
      if (bright) return Math.random() < 0.45 ? '#d7ffba' : '#9cff5e';
      return Math.random() < 0.50 ? '#9cff5e' : Math.random() < 0.58 ? '#748b72' : '#cfe0f6';
    }
    if (bright) return Math.random() < 0.44 ? '#ffffff' : '#d8e4f0';
    return Math.random() < 0.36 ? '#d8e4f0' : Math.random() < 0.62 ? '#7d8796' : '#4d5665';
  }
  function emitSmokeCloudBurst(x, y, r, poison, opts) {
    opts = opts || {};
    const count = opts.count || (poison ? 112 : 86);
    const force = opts.force || (poison ? 2.9 : 2.35);
    const baseVx = opts.vx || 0;
    const baseVy = opts.vy || 0;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const edge = Math.pow(Math.random(), 0.42);
      const rr = r * rand(0.02, 0.44);
      const sx = x + Math.cos(a) * rr;
      const sy = y + Math.sin(a) * rr * 0.34 + rand(-8, 9);
      const s = rand(force * 0.26, force * (0.88 + edge * 0.44));
      smokeParticle(sx, sy,
        baseVx + Math.cos(a) * s + rand(-0.25, 0.25),
        baseVy + Math.sin(a) * s * 0.34 - rand(0.18, poison ? 0.82 : 1.05), {
          color: smokeCloudColor(poison, i % 7 === 0),
          life: rand(poison ? 920 : 760, poison ? 1900 : 1540),
          r: rand(poison ? 7.0 : 8.0, poison ? 20.5 : 24.0),
          alpha: rand(poison ? 0.28 : 0.24, poison ? 0.58 : 0.48),
          grow: rand(0.040, 0.095),
          drag: rand(0.982, 0.992),
          buoy: poison ? rand(0.004, 0.020) : rand(0.012, 0.036),
          swirl: rand(0.010, 0.034),
        });
    }
  }
  function spawnSmokeZone(x, y, team, opts) {
    opts = opts || {};
    if (!smokeZones) smokeZones = [];
    const life = opts.life || 1150;
    const targetR = opts.r || 128;
    smokeZones.push({
      x, y,
      team: team || 'hero',
      r: opts.startR || Math.max(28, targetR * 0.34),
      targetR,
      life,
      max: life,
      age: 0,
      tick: 80,
      poison: !!opts.poison,
      color: opts.color || (opts.poison ? '#9cff5e' : '#cfe0f6'),
      hiddenBoost: opts.hiddenBoost || (opts.poison ? 220 : 160),
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      thickness: opts.thickness || (opts.poison ? 1.18 : 1.0),
      phase: rand(0, Math.PI * 2),
    });
    if (smokeZones.length > 10) smokeZones.shift();
  }
  function actorInSmokeZone(act, z) {
    if (!act || act.dead) return false;
    return Math.hypot(act.x - z.x, (act.y - 38) - z.y) < z.r;
  }
  function updateSmokeZones(dtStep) {
    if (!smokeZones || !smokeZones.length) return;
    for (let i = smokeZones.length - 1; i >= 0; i--) {
      const z = smokeZones[i];
      z.life -= dtStep;
      z.tick -= dtStep;
      if (z.life <= 0) { smokeZones.splice(i, 1); continue; }
      const driftScale = clamp(dtStep / 16.67, 0.35, 2.4);
      z.age = (z.age || 0) + dtStep;
      z.r = lerp(z.r || z.targetR, z.targetR || z.r || 120, 1 - Math.pow(0.94, driftScale));
      z.x += (z.vx || 0) * driftScale;
      z.y += (z.vy || 0) * driftScale;
      z.vx = (z.vx || 0) * Math.pow(0.986, driftScale) + Math.sin((runTime || 0) * 0.0017 + z.phase) * 0.010 * driftScale;
      z.vy = (z.vy || 0) * Math.pow(0.988, driftScale) - (z.poison ? 0.0025 : 0.0060) * driftScale;
      const fade = clamp(z.life / z.max, 0, 1);
      const density = (z.poison ? 2.7 : 2.0) * (z.thickness || 1) * (0.28 + fade * 0.92) * driftScale;
      const puffCount = Math.floor(density) + (Math.random() < density % 1 ? 1 : 0);
      for (let j = 0; j < puffCount; j++) {
        const a = rand(0, Math.PI * 2), rr = Math.pow(Math.random(), 0.62) * z.r;
        const edge = rr / Math.max(1, z.r);
        smokeParticle(
          z.x + Math.cos(a) * rr,
          z.y + Math.sin(a) * rr * (z.poison ? 0.38 : 0.44),
          (z.vx || 0) * 0.38 + Math.cos(a) * rand(0.02, 0.25) * (0.5 + edge),
          (z.vy || 0) * 0.30 + rand(z.poison ? -0.18 : -0.34, 0.10), {
            color: smokeCloudColor(z.poison, Math.random() < 0.16),
            life: rand(z.poison ? 520 : 440, z.poison ? 1180 : 980),
            r: rand(z.poison ? 5.6 : 6.2, z.poison ? 15.8 : 18.5) * (z.thickness || 1),
            alpha: rand(z.poison ? 0.20 : 0.16, z.poison ? 0.44 : 0.34) * (0.6 + fade * 0.7),
            grow: rand(0.030, 0.080),
            drag: rand(0.984, 0.994),
            buoy: z.poison ? rand(0.002, 0.014) : rand(0.010, 0.032),
            swirl: rand(0.008, 0.030),
          });
      }
      if ((z.team || 'hero') === 'hero' && player && actorInSmokeZone(player, z)) {
        player.hidden = Math.max(player.hidden || 0, z.hiddenBoost + fade * 180);
      }
      if (z.tick <= 0) {
        z.tick = z.poison ? 190 : 260;
        const targets = (z.team || 'hero') === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : (fighters || []);
        for (const t of targets) {
          if (!actorInSmokeZone(t, z)) continue;
          const blind = z.poison ? 760 : hasPassive('rg_nightshade') ? 620 : 440;
          t.smokeBlind = Math.max(t.smokeBlind || 0, blind);
          t.smokeBlindMax = Math.max(t.smokeBlindMax || 0, blind);
          if (t.brain) {
            t.brain.stagger = Math.max(t.brain.stagger || 0, z.poison ? 220 : 140);
            t.brain.alert = Math.max(t.brain.alert || 0, hasPassive('rg_nightshade') ? 520 : 300);
            t.brain.atkCd = Math.max(t.brain.atkCd || 0, z.poison ? 260 : 180);
          }
          if (z.poison) t.poisoned = Math.max(t.poisoned || 0, 1300);
        }
        if ((z.team || 'hero') === 'hero' && dummies) for (const d of dummies) {
          const p = d.pts && (d.pts.chest || d.pts.head);
          if (p && Math.hypot(p.x - z.x, p.y - z.y) < z.r) d.flash = Math.max(d.flash || 0, z.poison ? 170 : 90);
        }
      }
    }
  }
  function updateAbilityMarkers(dtStep) {
    if (anchors && anchors.length) {
      for (let i = anchors.length - 1; i >= 0; i--) {
        anchors[i].life -= dtStep;
        if (anchors[i].life <= 0) anchors.splice(i, 1);
      }
    }
    if (portals && portals.length) {
      for (let i = portals.length - 1; i >= 0; i--) {
        portals[i].life -= dtStep;
        if (portals[i].life <= 0) portals.splice(i, 1);
      }
      if (portals.length < 2) portals = [];
    }
  }
  function useEffectAbility(spec, slot, ang) {
    const e = spec.effect || {};
    const f = player.facing || 1;
    if (e.kind === 'coverHop') {
      startClassMove('backstep');
      activateShieldGuard();
      const p = pointAhead(42);
      spawnAbilityBox('barrier', p.x, p.y, { w: 34, h: 70, life: 1700, m: 9, color: '#dcecff' });
      hitBoxesSegment(player.x + f * 8, player.y - 42, player.x + f * 92, player.y - 44, f, -0.08, 14, 13);
      return true;
    }
    if (e.kind === 'aegisLink') {
      const p = pointAhead(76);
      spawnAbilityBox('barrier', p.x, p.y, { w: 52, h: 92, life: 5600, m: 12, color: '#7fb6ff' });
      activateShieldGuard();
      for (const a of livingAllies()) {
        if (Math.hypot(a.x - player.x, a.y - player.y) < 360) {
          a.shieldGuard = Math.max(a.shieldGuard || 0, 1800);
          a.shieldFlash = Math.max(a.shieldFlash || 0, 260);
          burst(a.x, a.y - 42, '#dcecff', 10, 2.4);
        }
      }
      pushBoxesRadial(player.x + f * 48, player.y - 44, 16, 130, player.team);
      return true;
    }
    if (e.kind === 'intercept') {
      const ally = livingAllies().sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
      const threat = nearestTarget(460, false);
      if (ally && threat) {
        const dir = Math.sign(threat.x - ally.x) || f;
        player.x = ally.x + dir * 42;
        player.y = ally.y;
        player.facing = dir;
        player.vx = dir * 5.2;
      } else startClassMove('shieldStep');
      activateShieldGuard();
      hitBoxesSegment(player.x + player.facing * 12, player.y - 48, player.x + player.facing * 112, player.y - 48, player.facing, -0.18, 20, 16);
      return true;
    }
    if (e.kind === 'ironPivot') {
      abilityAimCue(ang);
      activateShieldGuard();
      player.vx *= 0.25;
      hitBoxesSegment(player.x - f * 70, player.y - 48, player.x + f * 86, player.y - 48, f, -0.18, 17, 15);
      return true;
    }
    if (e.kind === 'debtPulse') {
      const range = e.range || 190, force = e.force || 25;
      for (let i = 0; i < 3; i++) {
        const y = player.y - 22 - i * 15;
        hitBoxesSegment(player.x + f * 10, y, player.x + f * range, y - i * 5, f, -0.45, force - i * 3, 15 + i * 2);
      }
      triggerObjectsOnLine(player.x, player.y - 44, player.x + f * range, player.y - 54, 22, force + 6);
      burst(player.x + f * Math.min(range, 150), player.y - 44, '#dcecff', 28, 4.8);
      addShake(4.6, 150);
      return true;
    }
    if (e.kind === 'mirrorGuard') {
      activateShieldGuard();
      reflectNearbyProjectiles(player.x + f * 18, player.y - 48, 150, '#dcecff');
      hitBoxesSegment(player.x - f * 36, player.y - 44, player.x + f * 92, player.y - 44, -f, -0.1, 13, 16);
      burst(player.x + f * 18, player.y - 48, '#ffffff', 18, 3.6);
      return true;
    }
    if (e.kind === 'groundSplitter') {
      triggerAttack('crush', { aim: ang });
      for (let i = 0; i < 4; i++) {
        const sx = player.x + f * (24 + i * 36);
        hitBoxesSegment(sx, player.y - 18, sx + f * 38, player.y - 20, f, -0.72, 21, 13);
      }
      addShake(3.8, 120);
      return true;
    }
    if (e.kind === 'faultPlate') {
      const p = pointAhead(76);
      spawnAbilityBox('barrier', p.x, p.y, { w: 94, h: 24, life: 3600, m: 11, color: '#9eb0c4' });
      hitBoxesSegment(player.x + f * 18, player.y - 24, player.x + f * 118, player.y - 28, f, -0.62, 17, 15);
      return true;
    }
    if (e.kind === 'siegePush') {
      const b = nearestBoxAhead(180);
      if (b) {
        pushBox(b, f, -0.18, 40);
        rememberDebugSegment('ability', player.x, player.y - 44, b.x + b.w / 2, b.y + b.h / 2, 10, cls.color, 280);
        hitBoxesSegment(b.x + b.w / 2, b.y + b.h / 2, b.x + b.w / 2 + f * 122, b.y + b.h / 2 - 8, f, -0.18, 20, 16);
      } else hitBoxesSegment(player.x + f * 16, player.y - 42, player.x + f * 124, player.y - 44, f, -0.2, 21, 15);
      return true;
    }
    if (e.kind === 'lockBarricade') {
      const b = nearestBoxAhead(210);
      if (b) {
        b.kind = 'barrier'; b.life = Math.max(b.life || 0, 5200); b.m = Math.max(b.m || 1, 11);
        b.w = Math.max(b.w, 54); b.h = Math.max(b.h, 58);
        burst(b.x + b.w / 2, b.y + b.h / 2, '#7fb6ff', 24, 3.8);
      } else {
        const p = pointAhead(72);
        spawnAbilityBox('barrier', p.x, p.y, { w: 58, h: 76, life: 4600, m: 11, color: '#7fb6ff' });
      }
      activateShieldGuard();
      return true;
    }
    if (e.kind === 'rampBreak') {
      startClassMove('shoulder');
      player.vy = Math.min(player.vy, -2.4);
      hitBoxesSegment(player.x + f * 10, player.y - 34, player.x + f * 128, player.y - 32, f, -0.36, 28, 18);
      return true;
    }
    if (e.kind === 'parryFlick') {
      player.rogueBurst = Math.min(ROGUE_BURST_MAX, (player.rogueBurst || 0) + 1);
      reflectNearbyProjectiles(player.x + f * 12, player.y - 56, 132, cls.color);
      hitBoxesSegment(player.x + f * 8, player.y - 54, player.x + f * 76, player.y - 58, f, -0.45, 15, 10);
      burst(player.x + f * 24, player.y - 58, '#ffffff', 12, 2.8);
      return true;
    }
    if (e.kind === 'wireVault') {
      startClassMove('vault');
      let best = -1, bd = 150;
      for (let i = 0; i < droppedKnives.length; i++) {
        const k = droppedKnives[i], d = Math.hypot(k.x - player.x, k.y - (player.y - 34));
        if (d < bd) { best = i; bd = d; }
      }
      if (best >= 0) {
        droppedKnives.splice(best, 1);
        player.knifeAmmo = Math.min(ROGUE_MAX_KNIVES, (player.knifeAmmo || 0) + 1);
      }
      hitBoxesSegment(player.x, player.y - 44, player.x + f * 86, player.y - 70, f, -0.8, 17, 12);
      return true;
    }
    if (e.kind === 'barrelNeedle') {
      if (player.knifeAmmo <= 0) return false;
      player.knifeAmmo--; player.knifeRegen = 0;
      spawnDagger(ang, { explosive: 1, bounce: 1 });
      const o = { x: player.x, y: player.y - 78 };
      triggerObjectsOnLine(o.x, o.y, o.x + Math.cos(ang) * 360, o.y + Math.sin(ang) * 360, 18, 16);
      return true;
    }
    if (e.kind === 'ghostNetwork') {
      const pts = droppedKnives.slice(0, 3).map(k => ({ x: k.x, y: k.y }));
      if (pts.length < 2) {
        const p1 = pointAhead(70), p2 = pointAhead(150);
        pts.push({ x: p1.x, y: p1.y - 10 }, { x: p2.x, y: p2.y - 10 });
      }
      for (let i = 0; i < pts.length - 1; i++) {
        rememberDebugSegment('ability', pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, 9, cls.color, 1200);
        spawnAbilityBox('spring', (pts[i].x + pts[i + 1].x) / 2, Math.max(pts[i].y, pts[i + 1].y) + 10, { w: Math.min(120, Math.abs(pts[i + 1].x - pts[i].x) + 32), h: 16, life: 3600, color: cls.color });
      }
      return true;
    }
    if (e.kind === 'heelRebound') {
      startClassMove('vault');
      player.vx = -f * 5.8; player.vy = Math.min(player.vy, -9.2); player.grounded = false;
      hitBoxesSegment(player.x + f * 8, player.y - 34, player.x + f * 86, player.y - 58, -f, -0.85, 20, 14);
      return true;
    }
    if (e.kind === 'breakerRun') {
      triggerAttack('lanceCharge', { aim: horizontalAimFromFacing(f) });
      player.vx = f * (e.big ? 13.2 : 10.8);
      const force = e.big ? 46 : 34;
      hitBoxesSegment(player.x + f * 18, player.y - 62, player.x + f * 210, player.y - 62, f, -0.08, force, 15);
      triggerObjectsOnLine(player.x, player.y - 62, player.x + f * 260, player.y - 62, 24, force);
      return true;
    }
    if (e.kind === 'wardenAnchor') {
      const p = aimedPoint(360);
      spawnWardenAnchor(p.x, p.y, cls.color);
      return true;
    }
    if (e.kind === 'wardenPull') {
      const a = nearestAnchor(680);
      if (!a) return pullActorsAndBoxes(ang, { range: 300, all: 1, force: 8.5 });
      const dx = a.x - player.x, dy = a.y - (player.y - 44), d = Math.hypot(dx, dy) || 1;
      player.vx += (dx / d) * 8.8;
      player.vy += (dy / d) * 4.4 - 2.4;
      for (const t of targetActorsForPlayer()) {
        const td = Math.hypot(t.x - a.x, (t.y - 42) - a.y);
        if (td < 300) {
          const nx = (a.x - t.x) / (td || 1), ny = (a.y - (t.y - 42)) / (td || 1);
          if (player.team === 'enemy') hurtEnemyTarget(t, nx, ny, 12, t.x, t.y - 42);
          else hurtFighter(t, nx, ny, 12, t.x, t.y - 42);
        }
      }
      for (const b of boxes) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, bd = Math.hypot(cx - a.x, cy - a.y);
        if (bd < 320) pushBox(b, (a.x - cx) / (bd || 1), (a.y - cy) / (bd || 1), 18);
      }
      rememberDebugSegment('ability', player.x, player.y - 44, a.x, a.y, 8, cls.color, 420);
      return true;
    }
    if (e.kind === 'gravityDebris') {
      if (!startVisualAttack('cast', ang, { range: e.range || 520, kind: 'gravityDebris' })) return false;
      spawnGravityDebrisShot(ang, e);
      return true;
    }
    if (e.kind === 'massSlam') {
      if (!startVisualAttack('cast', ang, { range: e.range || 380, kind: 'massSlam' })) return false;
      useMassSlam(e);
      return true;
    }
    if (e.kind === 'blackHole') {
      if (!startVisualAttack('arcaneBloom', ang, { range: e.range || 620, kind: 'blackHole' })) return false;
      const p = aimedPoint(e.range || 620);
      spawnBlackHole(p.x, p.y, player.team, cls.color, e);
      return true;
    }
    if (e.kind === 'orbitalBolt') {
      if (!gravityCore) { spawnBolt(ang, 1.22, { wind: 1, bounce: hasPassive('ricochet_key') ? 1 : 0 }); return true; }
      const p = aimedPoint(520);
      const a = Math.atan2(p.y - gravityCore.y, p.x - gravityCore.x);
      const spd = 25;
      projectiles.push({ kind: 'bolt', team: player.team, x: gravityCore.x + Math.cos(a) * 18, y: gravityCore.y + Math.sin(a) * 18, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 1050, color: cls.color, r: 11, hit: 16, sparkle: 3, bounce: hasPassive('ricochet_key') ? 1 : 0, wind: 1 });
      if (e.shoveCore) { gravityCore.vx += Math.cos(ang) * 0.9; gravityCore.vy += Math.sin(ang) * 0.55; }
      chargeGravityCore(e.shoveCore ? 0.72 : 0.45, player.x, player.y - 70);
      rememberDebugSegment('ability', player.x, player.y - 70, gravityCore.x, gravityCore.y, 8, cls.color, 260);
      burst(gravityCore.x, gravityCore.y, cls.color, 18, 3.6);
      return true;
    }
    if (e.kind === 'gravityBrake') {
      player.vx *= 0.16; player.vy *= 0.34;
      player.hoverTargetY = player.y - 58;
      spawnGravityField(player.x, player.y - 52, player.team, cls.color, { r: 118, life: 950 });
      return true;
    }
    if (e.kind === 'coreStep') {
      if (!gravityCore) return startClassMove('airDash');
      const rel = Math.atan2(player.y - 60 - gravityCore.y, player.x - gravityCore.x) + f * 0.95;
      const tx = gravityCore.x + Math.cos(rel) * (gravityCore.r * 0.58);
      const ty = gravityCore.y + Math.sin(rel) * (gravityCore.r * 0.35);
      player.vx += (tx - player.x) * 0.12;
      player.vy += (ty - (player.y - 48)) * 0.08 - 1.6;
      player.grounded = false;
      rememberDebugSegment('ability', player.x, player.y - 48, tx, ty, 7, cls.color, 360);
      return true;
    }
    if (e.kind === 'downburst') {
      player.hoverTargetY = null;
      player.vy = Math.max(player.vy, 8.8);
      pushBoxesRadial(player.x, player.y - 20, 23, 142, player.team);
      hitBoxesSegment(player.x - 64, player.y - 16, player.x + 64, player.y - 16, 0, 1, 19, 16);
      burst(player.x, player.y - 20, '#8fe6ff', 24, 4.4);
      return true;
    }
    if (e.kind === 'staticField') {
      const p = aimedPoint(380);
      spawnGravityField(p.x, p.y, player.team, '#8fe6ff', { r: 126, life: 1850 });
      chainLightning(ang, 3);
      return true;
    }
    if (e.kind === 'chainStep') {
      chainLightning(ang, e.jumps || 4);
      player.vx += Math.cos(ang) * 4.2;
      player.vy += Math.sin(ang) * 1.8 - 1.0;
      return true;
    }
    if (e.kind === 'echoDrift') {
      const ox = player.x, oy = player.y;
      startClassMove('airDash');
      spawnPressureDecoy(ox, oy, { cls: 'mage', hp: 1, color: '#b48cff', facing: f });
      return true;
    }
    if (e.kind === 'riftSnare') {
      const p = aimedPoint(390);
      spawnGravityField(p.x, p.y, player.team, '#b48cff', { r: 132, life: 2100 });
      pullActorsAndBoxes(ang, { range: 240, all: 1, force: 6.2 });
      return true;
    }
    if (e.kind === 'portalPair') {
      return placePortalPair(aimedPoint(460));
    }
    if (e.kind === 'doorstep') {
      const exit = nearestPortalPairExit();
      if (!exit) return startClassMove('airDash');
      burst(player.x, player.y - 48, cls.color, 18, 3.4);
      player.x = exit.x + f * 20;
      player.y = (surfaceYFor(player, exit.x, 240, 180) || exit.y + 52);
      player.vx = f * 5.8; player.vy = Math.min(player.vy, -2.2);
      burst(player.x, player.y - 48, '#8fe6ff', 22, 3.8);
      return true;
    }
    if (e.kind === 'weakShot') {
      if (player.arrowAmmo <= 0) return false;
      player.arrowAmmo--; player.arrowRegen = 0;
      spawnArrow(ang, 1.92, { pierce: 1, powerShot: true, pin: 1, bounce: hasPassive('ricochet_key') ? 1 : 0 });
      return true;
    }
    if (e.kind === 'triggerShot') {
      if (player.arrowAmmo <= 0) return false;
      player.arrowAmmo--; player.arrowRegen = 0;
      spawnArrow(ang, e.remote ? 0.92 : 1.05, { powerShot: false, pierce: 0 });
      const o = arrowOrigin(ang), ex = o.x + Math.cos(ang) * 560, ey = o.y + Math.sin(ang) * 560;
      triggerObjectsOnLine(o.x, o.y, ex, ey, e.remote ? 260 : 22, e.remote ? 26 : 15, !!e.remote);
      return true;
    }
    if (e.kind === 'trapRoll') {
      startClassMove('backstep');
      const p = pointAhead(-42);
      spawnAbilityBox('spring', p.x, p.y, { w: 76, h: 16, life: hasPassive('rn_prepared') ? 10000 : 6200, color: '#8fe6ff' });
      return true;
    }
    if (e.kind === 'grappleStep') {
      const p = aimedPoint(340);
      const dx = p.x - player.x, dy = p.y - (player.y - 44), d = Math.hypot(dx, dy) || 1;
      player.vx += (dx / d) * 8.4;
      player.vy += (dy / d) * 4.5 - 2.0;
      player.grounded = false;
      rememberDebugSegment('ability', player.x, player.y - 44, p.x, p.y, 6, '#8fe6ff', 360);
      return true;
    }
    if (e.kind === 'coverShot') {
      if (player.arrowAmmo <= 0) return false;
      player.arrowAmmo--; player.arrowRegen = 0;
      spawnArrow(ang, 1.14, { powerShot: true, bounce: hasPassive('ricochet_key') ? 1 : 0 });
      const squad = livingAllies();
      if (!squad.length) spawnPressureDecoy(player.x - f * 42, player.y, { cls: 'knight', hp: 1, color: '#53d4ff', facing: f });
      for (const a of livingAllies()) {
        a.facing = Math.cos(ang) >= 0 ? 1 : -1;
        a.vx += a.facing * 4.8;
        hitBoxesSegment(a.x, a.y - 42, a.x + a.facing * 84, a.y - 42, a.facing, -0.15, 13, 15);
      }
      return true;
    }
    if (e.kind === 'packStep') {
      const ox = player.x, oy = player.y;
      startClassMove('backstep');
      spawnPressureDecoy(ox, oy, { cls: 'rogue', hp: 1, color: '#53d4ff', facing: f });
      return true;
    }
    if (e.kind === 'baitDecoy') {
      const p = aimedPoint(360);
      const y = surfaceYFor(player, p.x, 260, 210) || p.y + 44;
      const a = spawnPressureDecoy(p.x, y, { cls: 'ranger', hp: 2, color: '#53d4ff', facing: -f, marked: 3000 });
      a.brain.patrolMin = p.x - 90; a.brain.patrolMax = p.x + 90;
      spawnAbilityBox('spring', p.x - f * 48, y, { w: 58, h: 16, life: 4800, color: '#8fe6ff' });
      return true;
    }
    if (e.kind === 'line') {
      hitBoxesSegment(player.x + f * 8, player.y - 54, player.x + f * (e.range || 110), player.y - 54 + (e.drop || 0), f, e.y || -0.15, e.force || 20, e.radius || 12);
      return true;
    }
    if (e.kind === 'radial') {
      pushBoxesRadial(player.x + f * 10, player.y - 30, e.force || 24, e.radius || 118, player.team);
      return true;
    }
    if (e.kind === 'barrier') {
      const p = pointAhead(58);
      spawnAbilityBox('barrier', p.x, p.y, { w: e.w || 42, h: e.h || 78, life: e.life || 5200, m: 10, color: '#5ea0ff' });
      activateShieldGuard();
      return true;
    }
    if (e.kind === 'rallyDome') {
      useKnightRally();
      pushBoxesRadial(player.x, player.y - 42, 24, 170, player.team);
      return true;
    }
    if (e.kind === 'faultline' || e.kind === 'fortressLine') {
      const y = player.y - (e.kind === 'faultline' ? 24 : 56);
      const rows = e.kind === 'faultline' ? 5 : 3;
      for (let i = 0; i < rows; i++) {
        const ax = player.x + f * (20 + i * 54);
        hitBoxesSegment(ax, y + i * 3, ax + f * 62, y + i * 3, f, e.kind === 'faultline' ? -0.8 : -0.15, e.kind === 'faultline' ? 28 : 20, e.kind === 'faultline' ? 18 : 13);
      }
      burst(player.x + f * 130, y, cls.color, 30, 5.2);
      addShake(e.kind === 'faultline' ? 6.0 : 3.8, 170);
      return true;
    }
    if (e.kind === 'moveStrike') {
      startClassMove(e.move || 'slide');
      hitBoxesSegment(player.x, player.y - 34, player.x + f * (e.range || 80), player.y - 36, f, -0.25, e.force || 16, 13);
      return true;
    }
    if (e.kind === 'backstab') {
      const t = nearestTarget(210, true);
      if (!t) return false;
      player.x = t.x - Math.sign(t.facing || -f) * 34;
      player.y = t.y;
      player.facing = t.x >= player.x ? 1 : -1;
      hitBoxesSegment(player.x, player.y - 52, t.x, t.y - 44, Math.sign(t.x - player.x) || f, -0.15, 24, 13);
      return true;
    }
    if (e.kind === 'knife' || e.kind === 'knifeFan') {
      const wanted = e.kind === 'knifeFan' ? (e.count || (e.explosive ? 6 : 5)) : (e.count || 1);
      const count = e.kind === 'knifeFan' ? Math.min(player.knifeAmmo || 0, wanted + (hasPassive('rg_trapmaster') ? 1 : 0), ROGUE_MAX_KNIVES) : Math.min(player.knifeAmmo || 0, wanted);
      if (player.knifeAmmo < count || count <= 0) return false;
      player.knifeAmmo -= count; player.knifeRegen = 0;
      spawnKnifeSpread(ang, count, {
        tight: !!e.tight,
        spread: e.spread,
        bounce: e.bounce || hasPassive('rg_trapmaster') || hasPassive('ricochet_key') ? 1 : 0,
        explosive: e.explosive,
        poison: e.poison,
        hit: e.hit || (e.explosive ? 17 : 13),
        speed: e.tight ? 33 : 31,
      });
      return true;
    }
    if (e.kind === 'bladeRecall') {
      if (!droppedKnives || !droppedKnives.length) return false;
      let recalled = 0;
      for (let i = droppedKnives.length - 1; i >= 0; i--) {
        const k = droppedKnives[i];
        const tx = player.x, ty = player.y - 34;
        rememberDebugSegment('ability', k.x, k.y, tx, ty, 7, '#cfd6df', 320);
        spawnBladeRecallTrail(k.x, k.y, tx, ty, { phase: recalled * 0.8, accent: cls.color });
        for (let s = 1; s <= 4; s++) {
          const u = s / 5;
          particles.push({
            x: lerp(k.x, tx, u) + rand(-5, 5),
            y: lerp(k.y, ty, u) + rand(-4, 4),
            vx: (tx - k.x) * 0.002 + rand(-0.18, 0.18),
            vy: (ty - k.y) * 0.002 + rand(-0.18, 0.18),
            life: rand(190, 330),
            max: 330,
            color: Math.random() < 0.38 ? cls.color : '#cfd6df',
            r: rand(1, 2.6),
          });
        }
        hitBoxesSegment(k.x, k.y, tx, ty, Math.sign(tx - k.x) || player.facing, -0.12, 15, 8);
        if (player.knifeAmmo < ROGUE_MAX_KNIVES) player.knifeAmmo++;
        burst(k.x, k.y, '#cfd6df', 10, 2.6);
        droppedKnives.splice(i, 1);
        recalled++;
      }
      player.knifeRegen = 0;
      burst(player.x, player.y - 34, cls.color, 12 + recalled * 3, 3.1);
      syncHud();
      return recalled > 0;
    }
    if (e.kind === 'trap') {
      const p = pointAhead(64);
      spawnAbilityBox(e.trap === 'tripwire' || e.trap === 'caltrops' ? 'spring' : 'spring', p.x, p.y, { w: e.trap === 'caltrops' ? 74 : 62, h: 16, life: hasPassive('rn_prepared') ? 10000 : 7000, color: '#8fe6ff' });
      return true;
    }
    if (e.kind === 'smokeSlide') {
      startClassMove('slide');
      pushBoxesRadial(player.x, player.y - 34, 14, 96, player.team);
      player.hidden = Math.max(player.hidden || 0, hasPassive('rg_nightshade') || e.hidden ? 1500 : 760);
      spawnSmokeZone(player.x - f * 18, player.y - 34, player.team, {
        r: hasPassive('rg_nightshade') ? 112 : 86,
        life: hasPassive('rg_nightshade') ? 1120 : 760,
        hiddenBoost: hasPassive('rg_nightshade') ? 260 : 150,
      });
      for (const t of targetActorsForPlayer()) if (Math.hypot(t.x - player.x, (t.y - 42) - (player.y - 34)) < 120) {
        t.brain.stagger = Math.max(t.brain.stagger || 0, hasPassive('rg_nightshade') ? 420 : 260);
      }
      burst(player.x, player.y - 34, '#cfe0f6', 34, 3.2);
      return true;
    }
    if (e.kind === 'smokeBomb') {
      return spawnSmokeBombProjectile(ang, e);
    }
    if (e.kind === 'vaultStrike' || e.kind === 'vaultToss') {
      startClassMove('vault');
      player.vy = Math.min(player.vy, -8.4);
      const t = nearestTarget(96, true);
      if (t) hurtFighter(t, f, e.kind === 'vaultToss' ? -0.8 : -1.2, 22, t.x, t.y - 44);
      return true;
    }
    if (e.kind === 'airSpiral') {
      player.vy = Math.min(player.vy, -8.8); player.grounded = false;
      const cx = player.x, cy = player.y - 54;
      useBladeStorm();
      spawnAirSpiralRead(cx, cy, player.facing || f);
      pushBoxesRadial(cx, cy, 20, 128, player.team);
      return true;
    }
    if (e.kind === 'spearWall') {
      const p = pointAhead(82);
      spawnAbilityBox('barrier', p.x, p.y, { w: 34, h: 96, life: 4200, m: 8, color: '#ffd45e' });
      hitBoxesSegment(player.x + f * 16, player.y - 62, player.x + f * 162, player.y - 62, f, -0.05, 22, 13);
      return true;
    }
    if (e.kind === 'impaleCarry') {
      player.vx = f * 9.8;
      hitBoxesSegment(player.x + f * 12, player.y - 62, player.x + f * 178, player.y - 62, f, -0.12, 38, 14);
      return true;
    }
    if (e.kind === 'tetherLine') {
      hitBoxesSegment(player.x + f * 16, player.y - 62, player.x + f * (e.range || 150), player.y - 62, -f, -0.2, e.pull || 16, 12);
      return true;
    }
    if (e.kind === 'pull' || e.kind === 'reelStep') {
      if (e.kind === 'reelStep') player.vx = -f * 4.8;
      return pullActorsAndBoxes(ang, e);
    }
    if (e.kind === 'field') {
      const p = aimedPoint(e.range || 380);
      spawnGravityField(p.x, p.y, player.team, cls.color, { r: e.r || 160, life: e.life || 2400 });
      return true;
    }
    if (e.kind === 'gravityCore') {
      const p = aimedPoint(e.range || 460);
      spawnGravityCore(p.x, p.y, player.team, cls.color, e);
      return true;
    }
    if (e.kind === 'trueHorizon') {
      collapseGravityCore(ang);
      return true;
    }
    if (e.kind === 'resonancePulse') {
      const src = gravityCore || { x: player.x + f * 18, y: player.y - 42, r: 142, color: cls.color, team: player.team };
      const charge = gravityCore ? clamp(src.resonance || 0, 0, src.resonanceMax || 5) : 0;
      const r = gravityCore ? src.r + 72 + charge * 24 : 142;
      const force = gravityCore ? 30 + charge * 6.5 : 22;
      const boxForce = gravityCore ? 26 + charge * 5.4 : 19;
      burst(src.x, src.y, '#ffffff', 28, 5.2);
      burst(src.x, src.y, src.color || cls.color, 46 + charge * 9, 6.2 + charge * 0.35);
      const rings = gravityCore ? 1 + Math.floor(charge) : 1;
      for (let n = 0; n < rings; n++) {
        spawnShockwaveRing(src.x, src.y, Math.max(76, r - n * 24), src.color || cls.color, {
          life: gravityCore ? 560 + n * 44 : 390,
          width: gravityCore ? 7.2 - n * 0.45 : 5,
          fill: gravityCore ? 0.14 : 0.08,
          rough: 0.070,
        });
      }
      radialActorPulse(src.x, src.y, r, force, player.team, src.color || cls.color);
      pushBoxesRadial(src.x, src.y, boxForce, r, player.team);
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI * 2 / 16;
        rememberDebugSegment('ability', src.x, src.y, src.x + Math.cos(a) * r, src.y + Math.sin(a) * r * 0.55, 5, src.color || cls.color, 260);
      }
      if (gravityCore) {
        src.resonance = 0;
        src.resonancePulse = 860;
      }
      addShake(gravityCore ? 6.4 + charge * 0.45 : 4.2, 170);
      return true;
    }
    if (e.kind === 'firebolt') {
      if (!startVisualAttack('pyroFirebolt', ang, { range: e.range || 420 })) return false;
      spawnFirebolt(ang, e.power || 1, e);
      return true;
    }
    if (e.kind === 'flameBreath') {
      if (!startVisualAttack('pyroBreath', ang, { range: e.range || 286 })) return false;
      return startPyroBreath(ang, e);
    }
    if (e.kind === 'dragonBreath') {
      if (!startVisualAttack('pyroDragon', ang, { range: e.range || 760 })) return false;
      return startPyroBreath(ang, Object.assign({}, e, { dragon: true, spread: true, color: '#ff5a20' }));
    }
    if (e.kind === 'groundFireFlow') {
      if (!startVisualAttack('pyroGroundFlow', ang, { range: e.range || 320 })) return false;
      return startGroundFireFlow(ang, e);
    }
    if (e.kind === 'fireZone') {
      if (!startVisualAttack('pyroGroundFlow', ang, { range: e.range || 420 })) return false;
      const p = aimedPoint(e.range || 420);
      pyroStaffFlare(ang, 1.15);
      spawnFireZone(p.x, p.y, player.team, e);
      return true;
    }
    if (e.kind === 'fireBurst') {
      if (!startVisualAttack('pyroIgnite', ang, { range: e.range || 520 })) return false;
      spawnIgnitionOrb(ang, e);
      return true;
    }
    if (e.kind === 'inferno') {
      if (!startVisualAttack('pyroDragon', ang, { range: e.range || 760 })) return false;
      return startPyroBreath(ang, Object.assign({}, e, { dragon: true, spread: true, color: '#ff5a20' }));
    }
    if (e.kind === 'spiritBolt') { spawnSpiritBolt(ang); return true; }
    if (e.kind === 'bindSpirit') return bindSpiritAlly();
    if (e.kind === 'soulFlare') return soulFlare();
    if (e.kind === 'graveCall') return graveCall();
    if (e.kind === 'bolt') { spawnBolt(ang, e.power || 1.15, { wind: e.wind, bounce: hasPassive('ricochet_key') ? 1 : 0 }); return true; }
    if (e.kind === 'gustDash') {
      startClassMove('airDash');
      pushBoxesRadial(player.x - f * 22, player.y - 44, 18, 112, player.team);
      return true;
    }
    if (e.kind === 'chain') return chainLightning(ang, e.jumps || 4);
    if (e.kind === 'tempest') {
      const p = aimedPoint(460);
      spawnGravityField(p.x, p.y, player.team, '#8fe6ff', { r: 190, life: 3000, ultimate: true });
      chainLightning(ang, 5);
      return true;
    }
    if (e.kind === 'swap') {
      const t = nearestTarget(260, true);
      let target = t;
      if (!target) target = boxes.find(b => Math.hypot(b.x + b.w / 2 - player.x, b.y + b.h / 2 - (player.y - 40)) < 220);
      if (!target) return false;
      const ox = player.x, oy = player.y;
      if (target.cls) { player.x = target.x; player.y = target.y; target.x = ox + f * 46; target.y = oy; hurtFighter(target, f, -0.8, 12, target.x, target.y - 40); }
      else { player.x = target.x + target.w / 2; player.y = target.y + target.h; target.x = ox; target.y = oy - target.h; pushBox(target, f, -0.7, 18); }
      burst(player.x, player.y - 42, cls.color, 24, 4.4);
      return true;
    }
    if (e.kind === 'portalShot') { spawnBolt(ang, 1.05, { portal: 1, bounce: hasPassive('ricochet_key') ? 1 : 0 }); return true; }
    if (e.kind === 'riftCollapse') {
      const p = aimedPoint(520);
      spawnGravityField(p.x, p.y, player.team, cls.color, { r: 182, life: 1900, ultimate: true });
      pullActorsAndBoxes(ang, { range: 360, all: 1, force: 9.2 });
      return true;
    }
    if (e.kind === 'arrow') {
      if (player.arrowAmmo <= 0) return false;
      player.arrowAmmo--; player.arrowRegen = 0;
      spawnArrow(ang, e.power || 1.35, { pierce: e.pierce || 0, powerShot: true, bounce: hasPassive('ricochet_key') ? 1 : 0 });
      return true;
    }
    if (e.kind === 'wallPin') {
      spawnArrow(ang, 1.45, { pierce: 0, powerShot: true, pin: 1 });
      return true;
    }
    if (e.kind === 'springTrap') {
      startClassMove('backstep');
      const p = pointAhead(-36);
      spawnAbilityBox('spring', p.x, p.y, { w: 62, h: 16, life: hasPassive('rn_prepared') ? 10000 : 7000, color: '#8fe6ff' });
      return true;
    }
    if (e.kind === 'barrelShot') {
      const p = pointAhead(110);
      const b = spawnAbilityBox('barrel', p.x, p.y, { w: 36, h: 36, life: 9500, color: '#ff9f6e' });
      pushBox(b, f, -0.25, 8);
      spawnArrow(ang, 1.05, { pierce: 0, powerShot: true });
      return true;
    }
    if (e.kind === 'mineVolley') {
      for (const off of [-60, 0, 60]) {
        const p = pointAhead(120 + off);
        spawnAbilityBox('spring', p.x, p.y, { w: 50, h: 16, life: hasPassive('rn_prepared') ? 11000 : 7600, color: '#8fe6ff' });
      }
      return true;
    }
    if (e.kind === 'decoy') {
      if (!allies) allies = [];
      const p = pointAhead(72);
      const a = makeFighter('knight', p.x, p.y, { team: 'ally', hp: 2, min: p.x - 80, max: p.x + 80, facing: f });
      a.brain.alert = 9999; a.brain.party = true; a.decoy = true; allies.push(a);
      return true;
    }
    if (e.kind === 'packCommand') {
      if (!allies || !allies.length) return false;
      for (const a of livingAllies()) {
        a.vx += (a.facing || f) * 5.5;
        hitBoxesSegment(a.x, a.y - 42, a.x + (a.facing || f) * 76, a.y - 42, a.facing || f, -0.2, 16, 16);
      }
      return true;
    }
    if (e.kind === 'hunt') {
      for (const t of targetActorsForPlayer()) { t.marked = 4200; hurtFighter(t, Math.sign(t.x - player.x) || f, -0.35, 10, t.x, t.y - 44); }
      if (allies) for (const a of livingAllies()) a.brain.alert = 9999;
      useRangerArrowStorm(ang);
      return true;
    }
    return false;
  }
  function runLoadoutAbility(spec, slot, ang) {
    if (!spec) return false;
    if (player && player.team === 'hero' && ang != null) abilityAimCue(ang);
    if (spec.effect) return useEffectAbility(spec, slot, ang);
    if (spec.type === 'move') return startClassMove(spec.action);
    if (spec.type === 'attack') return triggerAttack(spec.action, { aim: spec.action === 'lanceCharge' ? lanceChargeAim({ aim: ang }) : ang });
    if (spec.use === 'knightRally') return useKnightRally();
    if (spec.use === 'rogueFan') return useRogueFanKnives(ang);
    if (spec.use === 'bladeBarrage') return useBladeBarrage(ang);
    if (spec.use === 'bladeStorm') return useBladeStorm();
    if (spec.use === 'lancerAnchor') return useLancerAnchor();
    if (spec.use === 'mageSigil') { spawnMageSigil(ang); return true; }
    if (spec.use === 'mageSingularity') return useMageSingularity();
    if (spec.use === 'rangerPower') return useRangerPowerShot(ang);
    if (spec.use === 'rangerStorm') return useRangerArrowStorm(ang);
    return false;
  }
  function triggerSlotAbility(slot) {
    if (!player || state !== 'playing' || !slot) return false;
    if (!slotUnlocked(slot)) {
      burst(player.x, player.y - 54, '#ffffff', 5, 1.5);
      syncHud();
      return false;
    }
    const key = slotKey(slot);
    if (!cooldownReady(key)) return false;
    const ang = aimedAngle();
    abilityAimCue(ang);
    const spec = equipped(slot);
    let ok = runLoadoutAbility(spec, slot, ang);
    if (ok) spendCooldown(key, abilityCooldown(slot));
    syncHud();
    return ok;
  }
  function rogueSlideComboReady() {
    return !!(cls.id === 'rogue' && player && player.move && player.move.active && player.move.type === 'slide');
  }
  function rogueMainAttackType() {
    if (!player || player.knifeAmmo <= 0) return null;
    if (rogueSlideComboReady()) return 'legSweep';
    if (player.intent.down) return 'legSweep';
    if (player.knifeAmmo < 2) return 'rogueStab';
    const i = player && player.anim ? (player.anim.rogueComboNext || 0) : 0;
    return i === 2 || i === 4 ? 'rogueStab' : 'dualSlash';
  }
  function queueRogueAttack(type, slot) {
    if (cls.id !== 'rogue' || !player || !player.anim || !player.anim.atkActive || !type) return false;
    const canQueueKnife = isRogueKnifeAttack(type) || type === 'throw';
    if ((slot === 'attack' || slot === 'secondary') && !canQueueKnife) return false;
    if (!canRogueAttack(type)) return false;
    player.queuedAttack = { type, slot, at: performance.now() };
    player.queuedFlash = { slot, at: performance.now() };
    burst(player.x + player.facing * 18, player.y - 48, cls.color, 5, 1.6);
    syncHud();
    return true;
  }
  function consumeQueuedRogueAttack() {
    if (cls.id !== 'rogue' || !player || !player.queuedAttack) return false;
    const q = player.queuedAttack;
    player.queuedAttack = null;
    if (performance.now() - q.at > ROGUE_QUEUE_MS) return false;
    if (q.slot === 'attack') {
      const type = q.type || rogueMainAttackType();
      if (!type) return false;
      const ok = triggerAttack(type, { queued: true });
      if (ok && isRogueKnifeAttack(type) && type !== 'legSweep') player.anim.rogueComboNext = ((player.anim.rogueComboNext || 0) + 1) % 5;
      return ok;
    }
    if (q.slot === 'secondary') return triggerAttack(q.type || cls.alt, { queued: true });
    return false;
  }
  function runClickSlotAbility(spec, slot, fallbackCd) {
    if (!spec || !(spec.type === 'custom' || spec.effect)) return null;
    if (!cooldownReady(spec.id)) return false;
    const ok = runLoadoutAbility(spec, slot, aimedAngle());
    if (ok) spendCooldown(spec.id, spec.cd || fallbackCd);
    syncHud();
    return ok;
  }
  function mainAttack() {
    const spec = equipped('attack');
    if (cls.id === 'rogue' && player && player.anim && player.anim.atkActive) {
      const queued = spec && spec.action === 'rogueCombo' ? rogueMainAttackType() : spec && spec.action || rogueMainAttackType();
      return queueRogueAttack(queued, 'attack');
    }
    const slotted = runClickSlotAbility(spec, 'attack', 650);
    if (slotted !== null) return slotted;
    if (cls.id === 'ranger' && (!spec || spec.type === 'attack')) return startRangerDraw(spec && spec.action || 'arrow');
    const type = spec && spec.action === 'rogueCombo' ? rogueMainAttackType() : cls.id === 'rogue' ? (spec && spec.action || rogueMainAttackType()) : (spec && spec.action || cls.main);
    if (!type) return false;
    const ok = triggerAttack(type);
    if (ok && cls.id === 'rogue' && isRogueKnifeAttack(type) && type !== 'legSweep') player.anim.rogueComboNext = ((player.anim.rogueComboNext || 0) + 1) % 5;
    return ok;
  }
  function altAttack() {
    const spec = equipped('secondary');
    if (cls.id === 'rogue' && player && player.anim && player.anim.atkActive) {
      return queueRogueAttack(spec && spec.action || cls.alt, 'secondary');
    }
    const slotted = runClickSlotAbility(spec, 'secondary', 900);
    if (slotted !== null) return slotted;
    if (cls.id === 'ranger' && (!spec || spec.type === 'attack')) return startRangerDraw(spec && spec.action || cls.alt || 'volley');
    return triggerAttack(spec && spec.action || cls.alt);
  }
  function releaseMainAttack() {
    if (cls.id === 'ranger') return releaseRangerDraw();
    return false;
  }
  function releaseAltAttack() {
    if (cls.id === 'ranger') return releaseRangerDraw();
    return false;
  }
  api.on(view.canvas, 'mousemove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; });
  api.on(view.canvas, 'mousedown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; e.preventDefault();
    if (e.button === 2) altAttack(); else mainAttack();
  });
  api.on(window, 'mouseup', e => {
    if (e.button === 2) releaseAltAttack(); else releaseMainAttack();
  });
  api.on(view.canvas, 'contextmenu', e => e.preventDefault());

  api.on(window, 'keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'f2' || k === ';') { debug.enabled = !debug.enabled; exposeDebugApi(); e.preventDefault(); return; }
    if (k === 'h' || k === '?' || k === '/') { if (state === 'help') closeHelp(); else openHelp(); e.preventDefault(); return; }
    if (k === 'arrowleft' || k === 'a') input.left = true;
    else if (k === 'arrowright' || k === 'd') input.right = true;
    else if (k === 'arrowdown' || k === 's') input.down = true;
    else if (k === 'arrowup' || k === 'w' || k === ' ') { if (!e.repeat) press(true); e.preventDefault(); }
    else if (k === 'j') { if (!e.repeat) mainAttack(); }
    else if (k === 'l') { if (!e.repeat) altAttack(); }
    else if (k === 'k') { if (!e.repeat) triggerSlotAbility('shift'); }
    else if (k === 'shift') { if (!e.repeat) triggerSlotAbility('shift'); }
    else if (k === 'e') { if (!e.repeat) triggerSlotAbility('e'); }
    else if (k === 'q') { if (!e.repeat) triggerSlotAbility('q'); }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  });
  api.on(window, 'keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = false;
    else if (k === 'arrowright' || k === 'd') input.right = false;
    else if (k === 'arrowdown' || k === 's') input.down = false;
    else if (k === 'arrowup' || k === 'w' || k === ' ') press(false);
    else if (k === 'j') releaseMainAttack();
    else if (k === 'l') releaseAltAttack();
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
  api.on(btnMain, 'pointerup', e => { e.preventDefault(); releaseMainAttack(); });
  api.on(btnMain, 'pointerleave', e => { e.preventDefault(); releaseMainAttack(); });
  api.on(btnMain, 'pointercancel', e => { e.preventDefault(); releaseMainAttack(); });
  api.on(btnAlt, 'pointerdown', e => { e.preventDefault(); altAttack(); });
  api.on(btnAlt, 'pointerup', e => { e.preventDefault(); releaseAltAttack(); });
  api.on(btnAlt, 'pointerleave', e => { e.preventDefault(); releaseAltAttack(); });
  api.on(btnAlt, 'pointercancel', e => { e.preventDefault(); releaseAltAttack(); });
  api.on(btnMove, 'pointerdown', e => { e.preventDefault(); triggerSlotAbility('shift'); });
  api.on(btnSkillE, 'pointerdown', e => { e.preventDefault(); triggerSlotAbility('e'); });
  api.on(btnSkillQ, 'pointerdown', e => { e.preventDefault(); triggerSlotAbility('q'); });

  // ---------- game state ----------
  let state, li, player, hero, cam, coinsLeft, totalCoins, arenaKills, arenaWave, arenaNextWave, arenaBanner, runTime, deaths, particles, flagWave, slashTrail, bladeRecallTrails, projectiles, gravityFields, fireZones, flameBreaths, smokeZones, shockwaves, spiritRemnants, droppedKnives, boxes, dummies, fighters, allies;
  let loadout = null, runBuild = null, prevState = null, arenaDraftChoices = null, gravityCore = null, anchors = [], portals = [];
  let labMode = false, labBuildId = 'base', labCollapsed = false;
  let debugExposeAt = 0;
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
      grounded: false, coyote: 0, jumpCut: false, airTime: 0, rogueAirJump: false, invuln: 0,
      knifeAmmo: ROGUE_MAX_KNIVES, knifeRegen: 0, arrowAmmo: RANGER_MAX_ARROWS, arrowRegen: 0,
      rogueBurst: ROGUE_BURST_MAX, rogueBurstRegen: 0, queuedAttack: null, queuedFlash: null,
      cooldowns: {}, attackCd: 0, abilityCd: 0, moveCd: 0,
      shieldGuard: 0, shieldFlash: 0, forceCrouch: false, venge: 0, hunterHaste: 0,
      hidden: 0, poisoned: 0, burned: 0, burnedMax: 0, smokeBlind: 0, smokeBlindMax: 0, spiritCharges: 0,
      gravityDebris: MAGE_DEBRIS_MAX, gravityDebrisRegen: 0, gravityDebrisSpin: 0,
      hoverTargetY: null,
      draw: { active: false, type: null, t: 0, aim: 0, reload: 0, lastType: 'arrow' },
      move: { active: false, type: null, t: 0, dur: 0, struck: false, phase: 'idle', spec: DEFAULT_MOTION },
      flip: { active: false, t: 0, dur: 0, dir: 1 },
      anim: { phase: 0, lean: 0, leanV: 0, squash: 0, air: 0, atkActive: false, atkType: null, atkT: 0,
              struck: false, struck2: false, headLag: 0, headLagV: 0, aimShown: 0, aimShownV: 0, aimTarget: 0, atkAim: 0, lastFacing: 0, fly: 0, _dt: 0.016,
              atkVar: 0, rogueHand: 0, rogueHandNext: 0, rogueComboNext: 0, drawPower: 1, atkDur: 320, atkPhase: 'idle', action: null,
              bhx: null, bhy: null, bhxV: 0, bhyV: 0, whx: null, why: null, whxV: 0, whyV: 0,
              shAng: 0, shAngV: 0, elAng: 0, elAngV: 0, blAng: 0, blAngV: 0 },
    };
  }
  function makeBoxSpec(spec) {
    if (Array.isArray(spec)) {
      const w = spec[2] || 44, h = spec[3] || w, m = spec[4] || 1.6;
      return { x: spec[0], y: spec[1] + 30 - h, w, h, vx: 0, vy: 0, angle: 0, va: 0, m, kind: 'crate' };
    }
    const w = spec.w || 44, h = spec.h || w;
    const y = spec.y == null ? (spec.bottom == null ? G : spec.bottom) - h : spec.y;
    return {
      x: spec.x || 0, y, w, h,
      vx: spec.vx || 0, vy: spec.vy || 0, angle: spec.angle || 0, va: spec.va || 0,
      m: spec.m || 1.6, kind: spec.kind || 'crate', life: spec.life || 0,
      armed: spec.armed == null ? 1 : spec.armed, team: spec.team || 'neutral',
      heat: spec.heat || 0, heatFlash: 0,
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
    bladeRecallTrails = [];
    projectiles = [];
    gravityFields = [];
    fireZones = [];
    flameBreaths = [];
    smokeZones = [];
    shockwaves = [];
    spiritRemnants = [];
    gravityCore = null;
    anchors = [];
    portals = [];
    droppedKnives = [];
    boxes = (L.boxes || []).map(makeBoxSpec);
    dummies = (L.dummies || [[L.spawn.x + 210, L.spawn.y]]).map(p => makeDummy(p[0], p[1]));
    fighters = [];
    allies = [];
    flagWave = 0; freeze = 0;
    if (!keepRun) { arenaKills = 0; arenaWave = 1; arenaNextWave = 0; arenaBanner = 1150; runTime = 0; deaths = 0; }
    if (arenaMode && !labMode) { spawnArenaWave(arenaWave || 1); spawnParty(); }
    else {
      // Legacy/debug path: full class fighters from the old side-scroller layouts.
      fighters = (L.enemies || []).map(e => {
        const s = Array.isArray(e) ? { x: e[0], y: e[1], min: e[2], max: e[3], hp: e[4] } : e;
        return makeFighter(s.cls || 'knight', s.x, s.y, { min: s.min, max: s.max, hp: s.hp, facing: s.facing });
      });
    }
    centerCam(true);
    syncHud();
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function addShake(power, dur) {
    shakeP = Math.max(shakeP, power);
    shakeT = Math.max(shakeT, dur);
  }
  function terrainYAt(x) {
    const L = levels[li];
    let y = Infinity;
    for (const p of L.platforms) if (x >= p.x - 10 && x <= p.x + p.w + 10) y = Math.min(y, p.y);
    return y === Infinity ? L.spawn.y : y;
  }
  function arenaLineup(wave) {
    if (wave <= 1) return ['knight', 'rogue'];
    if (wave === 2) return ['ranger', 'mage'];
    if (wave === 3) return ['lancer', 'rogue', 'ranger'];
    const roster = ['knight', 'rogue', 'lancer', 'ranger', 'mage'];
    const n = clamp(2 + Math.floor(wave / 2), 3, 5);
    const out = [];
    for (let i = 0; i < n; i++) out.push(roster[(wave + i * 2) % roster.length]);
    return out;
  }
  function spawnArenaWave(wave) {
    const L = levels[li], slots = L.enemySpawns || [];
    const lineup = arenaLineup(wave);
    fighters = [];
    for (let i = 0; i < lineup.length; i++) {
      const slot = slots[(i * 2 + wave) % Math.max(1, slots.length)] || { x: L.spawn.x + 360 + i * 180 };
      const y = slot.y == null ? terrainYAt(slot.x) : slot.y;
      const e = makeFighter(lineup[i], slot.x, y, {
        min: slot.min == null ? slot.x - 180 : slot.min,
        max: slot.max == null ? slot.x + 180 : slot.max,
        hp: enemyDefaultHp(lineup[i]) + Math.floor(Math.max(0, wave - 3) / 3),
        facing: slot.x > L.spawn.x ? -1 : 1,
      });
      e.brain.alert = 2400;
      e.brain.pauseT = 0;
      e.brain.wave = wave;
      fighters.push(e);
    }
    arenaWave = wave;
    arenaNextWave = 0;
    arenaBanner = 1250;
    burst(L.spawn.x + 180, L.spawn.y - 38, '#ff9f6e', 18, 3.2);
    syncHud();
  }
  function partyLineup() {
    const table = {
      knight: ['ranger', 'mage'],
      rogue: ['knight', 'ranger'],
      lancer: ['mage', 'rogue'],
      mage: ['knight', 'rogue'],
      ranger: ['knight', 'lancer'],
    };
    return table[cls.id] || ['knight', 'ranger'];
  }
  function spawnParty() {
    if (!arenaMode) return;
    const L = levels[li], ids = partyLineup();
    allies = [];
    for (let i = 0; i < ids.length; i++) {
      const x = L.spawn.x + 58 + i * 46;
      const y = terrainYAt(x);
      const a = makeFighter(ids[i], x, y, {
        team: 'ally',
        hp: Math.max(2, enemyDefaultHp(ids[i]) - 1),
        min: L.spawn.x - 120,
        max: L.spawn.x + 420,
        facing: 1,
      });
      a.brain.alert = 9999;
      a.brain.party = true;
      allies.push(a);
    }
    syncHud();
  }
  function updateArena(dtStep) {
    if (!arenaMode || labMode || state !== 'playing') return;
    arenaBanner = Math.max(0, (arenaBanner || 0) - dtStep);
    if (fighters && fighters.length > 0) { arenaNextWave = 0; return; }
    arenaNextWave = arenaNextWave || ARENA_WAVE_DELAY;
    arenaNextWave -= dtStep;
    if (arenaNextWave <= 0) openArenaDraft();
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
  function spawnShockwaveRing(x, y, r, color, opts) {
    opts = opts || {};
    if (!shockwaves) shockwaves = [];
    shockwaves.push({
      x, y,
      r: Math.max(24, r || 120),
      color: color || '#ff77d2',
      life: opts.life || 420,
      max: opts.life || 420,
      width: opts.width || 5,
      yScale: opts.yScale == null ? 1 : opts.yScale,
      fill: opts.fill == null ? 0.10 : opts.fill,
      phase: opts.phase || rand(0, Math.PI * 2),
      rough: opts.rough == null ? 0.045 : opts.rough,
    });
    if (shockwaves.length > 12) shockwaves.shift();
  }
  function spawnBladeRecallTrail(ax, ay, bx, by, opts) {
    opts = opts || {};
    if (!bladeRecallTrails) bladeRecallTrails = [];
    bladeRecallTrails.push({
      ax, ay, bx, by,
      color: opts.color || '#cfd6df',
      accent: opts.accent || cls.color || '#9cff5e',
      life: opts.life || 430,
      max: opts.life || 430,
      phase: opts.phase || 0,
    });
    if (bladeRecallTrails.length > 16) bladeRecallTrails.shift();
  }

  function syncHudLegacy() {
    if (player && player.team !== 'hero') return;   // AI actions never touch the human HUD
    document.getElementById('sr-lvl').textContent = arenaMode ? (arenaWave || 1) : li + 1;
    document.getElementById('sr-lvls').textContent = arenaMode ? (fighters ? fighters.length : 0) : levels.length;
    const party = document.getElementById('sr-party');
    if (party) party.textContent = arenaMode && allies ? livingAllies().length : 0;
    const got = totalCoins - coinsLeft.filter(c => !c.got).length;
    document.getElementById('sr-coins').textContent = arenaMode ? (arenaKills || 0) : got;
    document.getElementById('sr-time').textContent = (runTime / 1000).toFixed(1);
    const ammo = document.getElementById('sr-ammo');
    if (ammo) {
      const hasAmmo = (cls.id === 'rogue' || cls.id === 'ranger') && state === 'playing';
      ammo.style.display = hasAmmo ? 'inline' : 'none';
      const icon = document.getElementById('sr-ammo-icon');
      if (icon) icon.textContent = cls.id === 'ranger' ? '🏹' : '🔪';
      document.getElementById('sr-knives').textContent = player
        ? (cls.id === 'ranger' ? player.arrowAmmo : player.knifeAmmo)
        : (cls.id === 'ranger' ? RANGER_MAX_ARROWS : ROGUE_MAX_KNIVES);
    }
    const cool = document.getElementById('sr-cool'), coolVal = document.getElementById('sr-cool-val');
    if (cool && coolVal) {
      const show = player && state === 'playing';
      cool.style.display = show ? 'inline' : 'none';
      if (show && cls.id === 'rogue') {
        const atk = equipped('attack');
        if ((atk && atk.action || cls.main) === 'throw') {
          cool.firstChild.nodeValue = 'KNIVES ';
          coolVal.textContent = `${player.knifeAmmo || 0}/${ROGUE_MAX_KNIVES} ${slotStateText('e')} ${slotStateText('shift')} ${slotStateText('q')}`;
        } else {
          cool.firstChild.nodeValue = 'BURST ';
          coolVal.textContent = `${player.rogueBurst || 0}/${ROGUE_BURST_MAX} ${slotStateText('e')} ${slotStateText('shift')} ${slotStateText('q')}`;
        }
      } else if (show) {
        cool.firstChild.nodeValue = 'SKILL ';
        coolVal.textContent = `${slotStateText('e')} ${slotStateText('shift')} ${slotStateText('q')}`;
      }
    }
  }

  function countRecoverableRogueKnives() {
    if (!droppedKnives || !droppedKnives.length) return 0;
    let count = 0;
    for (const k of droppedKnives) if (k && k.grounded) count++;
    return count;
  }
  function nearestRecoverableRogueKnifeDist() {
    if (!player || !droppedKnives || !droppedKnives.length) return Infinity;
    let best = Infinity;
    for (const k of droppedKnives) {
      if (!k || !k.grounded) continue;
      best = Math.min(best, Math.hypot(k.x - player.x, k.y - (player.y - 25)));
    }
    return best;
  }
  function rogueAmmoDetailText() {
    if (!player || cls.id !== 'rogue') return '';
    const recoverable = countRecoverableRogueKnives();
    if (recoverable > 0 && player.knifeAmmo < ROGUE_MAX_KNIVES) {
      const dist = nearestRecoverableRogueKnifeDist();
      if (dist < 34) return 'pickup now';
      if (dist < 96) return 'pickup nearby';
      return `${recoverable} down`;
    }
    if (player.knifeAmmo >= ROGUE_MAX_KNIVES) return 'full';
    const left = Math.max(0, ROGUE_REGEN - (player.knifeRegen || 0));
    return `regen ${(left / 1000).toFixed(1)}s`;
  }
  function rangerAmmoDetailText() {
    if (!player || cls.id !== 'ranger') return '';
    if (player.arrowAmmo >= RANGER_MAX_ARROWS) return 'full';
    const left = Math.max(0, RANGER_REGEN - (player.arrowRegen || 0));
    return `regen ${(left / 1000).toFixed(1)}s`;
  }

  function cooldownForUi(slot) {
    if (!player || slot === 'jump') return { left: 0, max: 1, locked: false };
    if (slot === 'attack') {
      const spec = equipped('attack');
      if (spec && (spec.type === 'custom' || spec.effect)) return { left: cooldownLeft(spec.id), max: spec.cd || 650, locked: false };
      const type = spec && spec.action === 'rogueCombo' ? rogueMainAttackType() : spec && spec.action || cls.main;
      const left = player.anim && player.anim.atkActive ? Math.max(0, 1 - player.anim.atkT) * (player.anim.atkDur || 320) : cooldownLeft(type);
      return { left, max: Math.max(actionCooldown(type), player.anim && player.anim.atkDur || 1), locked: false };
    }
    if (slot === 'secondary') {
      const spec = equipped('secondary'), type = spec && spec.action || cls.alt;
      if (spec && (spec.type === 'custom' || spec.effect)) return { left: cooldownLeft(spec.id), max: spec.cd || 900, locked: false };
      return { left: cooldownLeft(type), max: actionCooldown(type), locked: false };
    }
    if (!slotUnlocked(slot)) return { left: 1, max: 1, locked: true };
    const key = slotKey(slot);
    return { left: cooldownLeft(key), max: abilityCooldown(slot), locked: false };
  }
  function cooldownRuntimeText(cd) {
    if (!cd || cd.locked || cd.left <= 80) return '';
    const secs = cd.left / 1000;
    return secs >= 10 ? `${Math.ceil(secs)}s` : `${secs.toFixed(1)}s`;
  }
  function helpCooldownText(slot, spec) {
    if (slot === 'passive') return 'Passive';
    if (slot === 'jump') return cls && cls.id === 'mage' && mageGraviturgeLoadoutActive() ? 'Tap jump / hold float' : 'Movement';
    if (!spec) return '';
    let ms = spec.cd;
    if (slot === 'attack' && !(spec.type === 'custom' || spec.effect)) {
      const type = spec.action === 'rogueCombo' ? rogueMainAttackType() : spec.action || cls.main;
      ms = actionCooldown(type);
    } else if (slot === 'secondary' && !(spec.type === 'custom' || spec.effect)) {
      ms = actionCooldown(spec.action || cls.alt);
    } else if (!ms) {
      ms = abilityCooldown(slot);
    }
    if (!ms || ms < 420) return 'Fast';
    const secs = ms / 1000;
    return `${secs >= 10 ? Math.round(secs) : secs.toFixed(1)}s CD`;
  }
  function branchShort(spec) {
    const name = branchName(spec);
    return name ? name.toLowerCase() : '';
  }
  function abilityExtra(slot, spec, cd) {
    if (!player || state !== 'playing') return '';
    const cdText = cooldownRuntimeText(cd);
    if (cdText) return cdText;
    if (isQueuedRogueSlot(slot)) return 'queued';
    if (slot === 'attack' && rogueSlideComboReady()) return 'slide sweep';
    if (slot === 'attack' && cls.id === 'rogue') {
      const action = spec && spec.action || cls.main;
      return action === 'throw' || (spec && spec.branch === 'bladeslinger')
        ? `${player.knifeAmmo || 0}/${ROGUE_MAX_KNIVES} knives`
        : `${player.rogueBurst || 0}/${ROGUE_BURST_MAX} burst`;
    }
    if ((slot === 'attack' || slot === 'secondary' || slot === 'e' || slot === 'q') && cls.id === 'ranger') return `${player.arrowAmmo}/${RANGER_MAX_ARROWS} arrows`;
    if ((slot === 'secondary' || slot === 'e' || slot === 'q') && cls.id === 'rogue') return `${player.knifeAmmo}/${ROGUE_MAX_KNIVES} knives`;
    if (cls.id === 'mage' && mageSpiritLoadoutActive() && (slot === 'attack' || slot === 'secondary' || slot === 'e' || slot === 'q')) return `${player.spiritCharges || 0}/6 spirit`;
    if (cls.id === 'mage' && mageGraviturgeLoadoutActive() && (slot === 'attack' || slot === 'secondary' || slot === 'e' || slot === 'q')) return `${player.gravityDebris || 0}/${gravityDebrisMax()} debris`;
    if (cls.id === 'mage' && magePyroLoadoutActive() && (slot === 'attack' || slot === 'secondary' || slot === 'e' || slot === 'q')) return pyroStatusText();
    if (slot === 'passive') return spec ? 'keystone' : '';
    return branchShort(spec);
  }
  function isQueuedRogueSlot(slot) {
    if (cls.id !== 'rogue' || !player) return false;
    if (player.queuedAttack && player.queuedAttack.slot === slot) return true;
    return !!(player.queuedFlash && player.queuedFlash.slot === slot && performance.now() - player.queuedFlash.at < ROGUE_QUEUE_FLASH_MS);
  }
  function syncAbilityBar() {
    for (const slot of ['attack', 'secondary', 'shift', 'e', 'q']) {
      const btn = abilityButtons[slot], spec = equipped(slot), cd = cooldownForUi(slot);
      if (!btn) continue;
      const queued = isQueuedRogueSlot(slot);
      const name = cd.locked ? `Wave ${SLOT_UNLOCK_WAVE[slot]}` : (spec ? spec.name : actionName(cls[slot] || slot));
      const fill = cd.locked ? 1 : clamp(cd.left / Math.max(1, cd.max), 0, 1);
      const key = btn.querySelector('.sr-key'), nm = btn.querySelector('.sr-name'), ex = btn.querySelector('.sr-extra'), fi = btn.querySelector('.sr-cdfill');
      if (key) key.textContent = SLOT_LABEL[slot];
      if (nm) nm.textContent = name;
      if (ex) ex.textContent = cd.locked ? 'locked' : abilityExtra(slot, spec, cd);
      if (fi) fi.style.transform = `scaleY(${fill})`;
      btn.classList.toggle('ready', !cd.locked && fill <= 0.001);
      btn.classList.toggle('queued', queued);
      btn.classList.toggle('locked', !!cd.locked);
      btn.style.borderColor = queued ? '' : cls && cls.color ? cls.color + '99' : '';
    }
    const jump = abilityButtons.jump;
    if (jump) {
      jump.classList.toggle('ready', !!(player && (player.grounded || player.coyote > 0 || cls.id === 'rogue' && !player.rogueAirJump)));
      jump.classList.remove('locked');
      const nm = jump.querySelector('.sr-name'), ex = jump.querySelector('.sr-extra'), fi = jump.querySelector('.sr-cdfill');
      if (nm) nm.textContent = 'Jump';
      if (ex) ex.textContent = cls.id === 'mage' && mageGraviturgeLoadoutActive() ? 'hold float' : cls.id === 'rogue' ? 'air flip' : '';
      if (fi) fi.style.transform = 'scaleY(0)';
      jump.style.borderColor = cls && cls.color ? cls.color + '99' : '';
    }
    if (passiveChip) {
      const pass = equipped('passive');
      const branch = runBuild && runBuild.softBranch ? branchInfo(cls.id, runBuild.softBranch) : pass ? branchInfo(pass.cls, pass.branch) : null;
      const title = branch ? branch.name : cls ? cls.name : 'Base';
      const detail = pass ? pass.name : 'draft path';
      passiveChip.innerHTML = `<span>BRANCH</span><b>${html(title)}</b><em>${html(detail)}</em>`;
      passiveChip.style.borderColor = cls && cls.color ? cls.color + '88' : '';
    }
  }
  function syncHud() {
    if (player && player.team !== 'hero') return;
    const chip = document.getElementById('sr-classchip');
    if (chip) {
      chip.textContent = cls.name;
      chip.style.color = cls.color;
    }
    const modeLabel = document.getElementById('sr-mode-label');
    const foeLabel = document.getElementById('sr-foe-label');
    const partyLabel = document.getElementById('sr-party-label');
    const scoreLabel = document.getElementById('sr-score-label');
    if (modeLabel) modeLabel.textContent = labMode ? '' : 'W';
    if (foeLabel) foeLabel.textContent = labMode ? 'targets' : 'foes';
    if (partyLabel) partyLabel.textContent = labMode ? 'objects' : 'allies';
    if (scoreLabel) scoreLabel.textContent = labMode ? 'tests' : 'KO';
    const lvl = document.getElementById('sr-lvl'), bots = document.getElementById('sr-lvls');
    if (lvl) lvl.textContent = labMode ? 'LAB' : arenaMode ? (arenaWave || 1) : li + 1;
    if (bots) bots.textContent = labMode ? ((fighters ? fighters.length : 0) + (dummies ? dummies.length : 0)) : arenaMode ? (fighters ? fighters.length : 0) : levels.length;
    const party = document.getElementById('sr-party');
    if (party) party.textContent = labMode ? (boxes ? boxes.length : 0) : arenaMode && allies ? livingAllies().length : 0;
    const got = totalCoins - coinsLeft.filter(c => !c.got).length;
    const ko = document.getElementById('sr-coins');
    if (ko) ko.textContent = arenaMode ? (arenaKills || 0) : got;
    const ammo = document.getElementById('sr-ammo');
    if (ammo) {
      const hasSpirits = cls.id === 'mage' && player && mageSpiritLoadoutActive();
      const hasGravityDebris = cls.id === 'mage' && player && mageGraviturgeLoadoutActive();
      const hasAmmo = state === 'playing' && (cls.id === 'rogue' || cls.id === 'ranger');
      ammo.style.display = (hasAmmo || hasSpirits || hasGravityDebris) ? 'inline-flex' : 'none';
      const icon = document.getElementById('sr-ammo-icon');
      const val = document.getElementById('sr-knives');
      const detail = document.getElementById('sr-ammo-detail');
      if (icon) icon.textContent = cls.id === 'ranger' ? '🏹' : '🔪';
      if (val) val.textContent = player
        ? (cls.id === 'ranger' ? `${player.arrowAmmo}/${RANGER_MAX_ARROWS}` : `${player.knifeAmmo}/${ROGUE_MAX_KNIVES}`)
        : (cls.id === 'ranger' ? `${RANGER_MAX_ARROWS}/${RANGER_MAX_ARROWS}` : `${ROGUE_MAX_KNIVES}/${ROGUE_MAX_KNIVES}`);
      if (detail) detail.textContent = cls.id === 'rogue' ? rogueAmmoDetailText() : rangerAmmoDetailText();
      if (!hasAmmo && !hasSpirits && !hasGravityDebris) {
        if (icon) icon.textContent = '';
        if (val) val.textContent = '';
        if (detail) detail.textContent = '';
      }
    }
    if (ammo && cls.id === 'mage' && player && mageSpiritLoadoutActive()) {
      const icon = document.getElementById('sr-ammo-icon');
      const val = document.getElementById('sr-knives');
      const detail = document.getElementById('sr-ammo-detail');
      if (icon) icon.textContent = 'SP';
      if (val) val.textContent = `${player.spiritCharges || 0}/6`;
      if (detail) detail.textContent = 'charges from KOs';
    }
    if (ammo && cls.id === 'mage' && player && mageGraviturgeLoadoutActive()) {
      const icon = document.getElementById('sr-ammo-icon');
      const val = document.getElementById('sr-knives');
      const detail = document.getElementById('sr-ammo-detail');
      if (icon) icon.textContent = 'GR';
      if (val) val.textContent = `${player.gravityDebris || 0}/${gravityDebrisMax()}`;
      if (detail) detail.textContent = 'orbiting debris';
    }
    const cool = document.getElementById('sr-cool');
    const coolVal = document.getElementById('sr-cool-val');
    if (cool && coolVal) {
      cool.style.display = 'none';
      coolVal.textContent = '';
    }
    syncAbilityBar();
  }

  function setPlayUi(on) {
    hud.style.display = on ? 'flex' : 'none';
    padL.style.display = padR.style.display = on ? 'flex' : 'none';
    helpBtn.style.display = on ? 'block' : 'none';
    labPanel.style.display = on && labMode ? 'block' : 'none';
  }

  function html(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function openHelp() {
    if (!player || state !== 'playing') return;
    prevState = state;
    state = 'help';
    ov.classList.remove('hidden');
    const rows = HELP_SLOTS.map(slot => {
      const spec = equipped(slot), locked = slot !== 'attack' && slot !== 'secondary' && slot !== 'passive' && !slotUnlocked(slot);
      const name = locked ? `Unlocks at wave ${SLOT_UNLOCK_WAVE[slot] || 1}` : spec ? spec.name : 'No keystone yet';
      const desc = locked ? 'Clear more waves to open this slot.' : spec ? spec.desc : 'Draft a keystone between waves to change your rules.';
      const metaBits = [];
      if (spec) metaBits.push(branchName(spec));
      if (!locked) metaBits.push(helpCooldownText(slot, spec));
      if (spec && tagsText(spec)) metaBits.push(tagsText(spec));
      const meta = metaBits.filter(Boolean).map(bit => `<span>${html(bit)}</span>`).join('');
      return `<div class="sr-help-row${slot === 'passive' ? ' passive' : ''}">
        <span class="slot">${SLOT_LABEL[slot]} · ${SLOT_KEY[slot]}</span>
        <b>${html(name)}</b><small>${html(desc)}</small>${meta ? `<em class="sr-help-meta">${meta}</em>` : ''}
      </div>`;
    }).join('');
    const branch = runBuild && runBuild.softBranch ? branchInfo(cls.id, runBuild.softBranch) : null;
    ov.innerHTML = `<h2>${html(cls.name)} loadout</h2>
      <p class="msg">${branch ? `Leaning ${html(branch.name)}: ${html(branch.desc)}` : 'Draft two picks from one path to lean into that subclass.'}</p>
      <div class="sr-help-list">${rows}</div>
      <button class="btn alt" data-act="resume">RESUME</button>`;
  }
  function closeHelp() {
    if (state !== 'help') return;
    state = prevState || 'playing';
    ov.classList.add('hidden');
    prevState = null;
  }
  function shuffledIds(ids) {
    return ids.slice().sort(() => Math.random() - 0.5);
  }
  function pickDraftCandidate(candidates, usedSlots, preferBranch) {
    const scored = shuffledIds(candidates).map(id => {
      const a = ability(id);
      let score = 0;
      if (preferBranch && a.branch === preferBranch) score += 80;
      score += Math.min(30, branchScore(a.branch) * 9);
      score += (a.tier || 1) * 2;
      if (a.slot === 'passive') score += 5;
      return { id, score: score + Math.random() * 12 };
    }).sort((a, b) => b.score - a.score);
    for (const item of scored) {
      const a = ability(item.id);
      if (!usedSlots[a.slot]) { usedSlots[a.slot] = true; return item.id; }
    }
    return null;
  }
  function draftPool() {
    if (!loadout || !cls || !runBuild) return [];
    recomputeSoftBranch();
    const all = Object.keys(ABILITIES).filter(canDraftNode);
    const usedSlots = {};
    const out = [];
    const addPick = id => {
      if (!id || out.includes(id)) return false;
      const a = ability(id);
      if (slotAlreadyOffered(out, a)) return false;
      out.push(id); usedSlots[a.slot] = true; return true;
    };
    if (runBuild.softBranch) {
      const favored = all.filter(id => ability(id).cls === cls.id && ability(id).branch === runBuild.softBranch);
      const hybrid = all.filter(id => ability(id).cls === 'neutral' || ability(id).branch !== runBuild.softBranch);
      addPick(pickDraftCandidate(favored, usedSlots, runBuild.softBranch));
      addPick(pickDraftCandidate(favored.filter(id => !out.includes(id)), usedSlots, runBuild.softBranch));
      addPick(pickDraftCandidate(hybrid, usedSlots, null));
    } else {
      const branches = Object.keys(CLASS_TREES[cls.id] && CLASS_TREES[cls.id].branches || {});
      for (const branch of shuffledIds(branches)) {
        addPick(pickDraftCandidate(all.filter(id => ability(id).cls === cls.id && ability(id).branch === branch), usedSlots, branch));
        if (out.length >= 3) break;
      }
      if (out.length < 3) addPick(pickDraftCandidate(all.filter(id => ability(id).cls === 'neutral'), usedSlots, null));
    }
    for (const id of shuffledIds(all)) {
      if (out.length >= 3) break;
      addPick(id);
    }
    return out.slice(0, 3);
  }
  function openArenaDraft() {
    if (!arenaMode || state !== 'playing') return false;
    arenaDraftChoices = draftPool();
    if (!arenaDraftChoices.length) { spawnArenaWave((arenaWave || 1) + 1); return true; }
    state = 'draft';
    setPlayUi(false);
    ov.classList.remove('hidden');
    const cards = arenaDraftChoices.map(id => {
      const a = ability(id);
      return `<button class="sr-pick" data-pick="${id}">
        <span class="slot">${SLOT_LABEL[a.slot]} - ${html(branchName(a))}</span>
        <b>${html(a.name)}</b><small>${html(a.desc)}</small>
        <em class="sr-tags">${html(tagsText(a))}</em>
      </button>`;
    }).join('');
    const branch = runBuild && runBuild.softBranch ? branchInfo(cls.id, runBuild.softBranch) : null;
    ov.innerHTML = `<h2>Wave ${arenaWave || 1} cleared</h2>
      <p class="msg">${branch ? `Soft-locked toward ${html(branch.name)}. Two choices now favor that path, with one hybrid/object option.` : 'Draft one branch. Two picks in a path leans the run toward that subclass.'}</p>
      <div class="sr-draft">${cards}</div>`;
    return true;
  }
  function pickDraft(id) {
    const spec = ability(id);
    if (!spec || state !== 'draft') return;
    loadout[spec.slot] = id;
    if (runBuild) {
      runBuild.loadout = loadout;
      runBuild.picked.push(id);
      if (spec.cls === cls.id && spec.branch) {
        runBuild.branchPoints[spec.branch] = (runBuild.branchPoints[spec.branch] || 0) + 1;
        recomputeSoftBranch();
      }
      runBuild.lastDraft = id;
    }
    arenaDraftChoices = null;
    ov.classList.add('hidden');
    setPlayUi(true);
    state = 'playing';
    spawnArenaWave((arenaWave || 1) + 1);
    syncHud();
  }

  function labBuildsFor(classId) {
    return LAB_BUILDS[classId] || [{ id: 'base', name: 'Base', note: 'Starting kit.', loadout: {} }];
  }
  function currentLabPreset() {
    const list = labBuildsFor(cls.id);
    return list.find(b => b.id === labBuildId) || list[0];
  }
  function runBuildFromPreset(classId, preset) {
    const b = baseRunBuild(classId);
    const patch = preset && preset.loadout || {};
    Object.assign(b.loadout, patch);
    b.picked = Object.values(patch).filter(Boolean);
    for (const id of b.picked) {
      const spec = ability(id);
      if (spec && spec.cls === classId && spec.branch) b.branchPoints[spec.branch] = (b.branchPoints[spec.branch] || 0) + 1;
    }
    let best = null, bestScore = 0;
    for (const [branch, score] of Object.entries(b.branchPoints)) if (score > bestScore) { best = branch; bestScore = score; }
    b.softBranch = best || null;
    b.lastDraft = preset && preset.id || null;
    return b;
  }
  function applyLabBuild(buildId) {
    const list = labBuildsFor(cls.id);
    const preset = list.find(b => b.id === buildId) || list[0];
    labBuildId = preset.id;
    runBuild = runBuildFromPreset(cls.id, preset);
    loadout = runBuild.loadout;
    if (player) refillLabResources();
    renderLabPanel();
    if (player && coinsLeft) syncHud();
    exposeDebugApi();
  }
  function refillLabResources() {
    if (!player) return;
    player.knifeAmmo = ROGUE_MAX_KNIVES;
    player.knifeRegen = 0;
    player.arrowAmmo = RANGER_MAX_ARROWS;
    player.arrowRegen = 0;
    player.rogueBurst = ROGUE_BURST_MAX;
    player.rogueBurstRegen = 0;
    player.cooldowns = {};
    player.attackCd = player.abilityCd = player.moveCd = 0;
    player.shieldGuard = 0;
    player.invuln = 0;
    player.draw = { active: false, type: null, t: 0, aim: 0, reload: 0, lastType: 'arrow' };
    syncLegacyCooldowns(player);
    syncHud();
  }
  function setupLabScene() {
    if (!player) return;
    const L = levels[li];
    arenaWave = 0;
    arenaNextWave = 0;
    arenaBanner = 0;
    arenaKills = 0;
    runTime = 0;
    coinsLeft = [];
    totalCoins = 0;
    fighters = [];
    allies = [];
    gravityFields = [];
    gravityCore = null;
    anchors = [];
    portals = [];
    projectiles = [];
    slashTrail = [];
    droppedKnives = [];
    particles = [];
    const sx = 360;
    player.x = sx;
    player.y = terrainYAt(sx);
    player.vx = player.vy = 0;
    player.facing = 1;
    player.grounded = false;
    boxes = [
      makeBoxSpec({ x: sx + 210, y: terrainYAt(sx + 210) - 54, w: 58, h: 54, m: 2.1, kind: 'crate' }),
      makeBoxSpec({ x: sx + 310, y: terrainYAt(sx + 310) - 34, w: 34, h: 34, m: 1.2, kind: 'barrel' }),
      makeBoxSpec({ x: sx + 410, y: terrainYAt(sx + 410) - 16, w: 70, h: 16, m: 2.0, kind: 'spring' }),
    ];
    dummies = [
      makeDummy(sx + 150, terrainYAt(sx + 150), { hp: 99 }),
      makeDummy(sx + 520, terrainYAt(sx + 520), { kind: 'enemy', hp: 8, patrolMin: sx + 460, patrolMax: sx + 610 }),
    ];
    cam = { x: Math.max(0, player.x - view.w * 0.30), y: 0 };
    refillLabResources();
    burst(player.x, player.y - 44, '#8fe6ff', 22, 3.6);
  }
  function resetLabScene() {
    loadLevel(0, false);
    setupLabScene();
    renderLabPanel();
    exposeDebugApi();
  }
  function spawnLabDummy(kind) {
    if (!player) return;
    const x = player.x + player.facing * (kind === 'enemy' ? 280 : 190);
    const y = terrainYAt(x);
    dummies.push(makeDummy(x, y, { kind: kind === 'enemy' ? 'enemy' : 'dummy', hp: kind === 'enemy' ? 8 : 99, patrolMin: x - 90, patrolMax: x + 90 }));
    burst(x, y - 42, kind === 'enemy' ? '#ff5a5a' : '#8fe6ff', 18, 3.0);
    syncHud();
  }
  function spawnLabBot() {
    if (!player) return;
    const roster = CLASSES.filter(c => c.id !== cls.id);
    const id = roster[Math.floor(Math.random() * roster.length)].id;
    const x = player.x + player.facing * 360, y = terrainYAt(x);
    const e = makeFighter(id, x, y, { hp: enemyDefaultHp(id) + 2, min: x - 130, max: x + 130, facing: -player.facing });
    e.brain.alert = 9999;
    fighters.push(e);
    burst(x, y - 46, e.cls.color, 22, 3.4);
    syncHud();
  }
  function spawnLabObject(kind) {
    if (!player) return;
    const x = player.x + player.facing * (kind === 'spring' ? 190 : 155);
    const y = terrainYAt(x);
    const spec = kind === 'barrel'
      ? { x: x - 17, y: y - 34, w: 34, h: 34, m: 1.2, kind }
      : kind === 'spring'
        ? { x: x - 35, y: y - 16, w: 70, h: 16, m: 2.0, kind }
        : { x: x - 28, y: y - 54, w: 56, h: 54, m: 2.0, kind: 'crate' };
    boxes.push(makeBoxSpec(spec));
    burst(x, y - (spec.h || 44) / 2, kind === 'barrel' ? '#ff9f6e' : kind === 'spring' ? '#8fe6ff' : '#caa15a', 18, 3.0);
    syncHud();
  }
  function compactAbilityName(name) {
    name = name || 'Ready';
    return name.length > 13 ? html(name.slice(0, 12)) + '&hellip;' : html(name);
  }
  function labSlotButton(slot) {
    const spec = equipped(slot);
    const name = slot === 'jump' ? (cls.id === 'rogue' ? 'Air Flip' : 'Jump') : spec ? spec.name : actionName(cls[slot] || slot);
    return `<button class="sr-labslot" data-lab-slot="${slot}" title="${html(name)}">
      <span>${SLOT_LABEL[slot]}</span><small>${compactAbilityName(name)}</small>
    </button>`;
  }
  function spawnLabDroppedKnife() {
    if (!player || cls.id !== 'rogue') return false;
    const x = player.x + player.facing * 92;
    const y = Math.min(player.y - 18, terrainYAt(x) - 6);
    droppedKnives.push({ x, y, vx: 0, vy: 0, angle: player.facing * 0.18, grounded: true, life: 9000, age: 0 });
    burst(x, y, '#cfd6df', 10, 1.8);
    syncHud();
    return true;
  }
  function setupLabPyroChain() {
    if (!player || cls.id !== 'mage' || !magePyroLoadoutActive()) return false;
    const f = player.facing || 1;
    const x1 = player.x + f * 175;
    const x2 = player.x + f * 285;
    const y1 = terrainYAt(x1);
    const y2 = terrainYAt(x2);
    const d = makeDummy(x1, y1, { hp: 99 });
    dummies.push(d);
    markBurnDummy(d, 3600, '#ff6b32');
    fighters = fighters || [];
    const e = makeFighter('rogue', x2 + f * 30, y2, { hp: 10, min: x2 - 70, max: x2 + 90, facing: -f });
    e.brain.alert = 9999;
    fighters.push(e);
    markBurnActor(e, 3600, '#ff6b32');
    const barrel = makeBoxSpec({ x: x2 - 18, y: y2 - 34, w: 36, h: 36, m: 1.2, kind: 'barrel', heat: 76, heatFlash: 260 });
    boxes.push(barrel);
    spawnFireZone(x1 + f * 70, terrainYAt(x1 + f * 70) - 4, player.team, { r: 116, life: 2100, openingFlare: 1 });
    pyroLink(player.x, player.y - 68, x1, y1 - 44, '#ff6b32', 460);
    pyroLink(player.x, player.y - 68, x2 + f * 30, y2 - 44, '#ff6b32', 460);
    refillLabResources();
    syncHud();
    return true;
  }
  function spawnLabHotBarrel() {
    if (!player || cls.id !== 'mage' || !magePyroLoadoutActive()) return false;
    const f = player.facing || 1;
    const x = player.x + f * 165;
    const y = terrainYAt(x);
    const b = makeBoxSpec({ x: x - 18, y: y - 36, w: 36, h: 36, m: 1.2, kind: 'barrel', heat: 88, heatFlash: 320 });
    boxes.push(b);
    burst(x, y - 18, '#ffd45e', 20, 4.0);
    pyroLink(player.x, player.y - 68, x, y - 18, '#ffd45e', 420);
    syncHud();
    return true;
  }
  function testLabJump() {
    if (!labMode || state !== 'playing' || !player) return false;
    refillLabResources();
    jumpBuf = 0;
    input.jumpHeld = false;
    input.jumpHold = 0;
    player.grounded = false;
    player.coyote = 0;
    player.jumpCut = false;
    player.y -= cls.id === 'rogue' ? 14 : 4;
    if (cls.id === 'rogue') {
      startRogueAirFlip(player, { burstScale: 1.12 });
    } else {
      player.vy = JUMP;
      player.anim.squash = -0.5;
      burst(player.x, player.y - 12, cls.color, 8, 2.4);
    }
    syncHud();
    return true;
  }
  function testLabSlot(slot) {
    if (!labMode || state !== 'playing' || !player) return false;
    if (slot === 'jump') return testLabJump();
    refillLabResources();
    const wasPointerActive = pointer.active;
    pointer.active = false;
    let ok = false;
    if (slot === 'attack') ok = mainAttack();
    else if (slot === 'secondary') ok = altAttack();
    else ok = triggerSlotAbility(slot);
    if (cls.id === 'ranger' && player.draw && player.draw.active) {
      player.draw.t = Math.max(player.draw.t || 0, RANGER_DRAW_MAX);
      ok = releaseRangerDraw() || ok;
    }
    pointer.active = wasPointerActive;
    syncHud();
    return ok;
  }
  function renderLabPanel() {
    if (!labMode) { labPanel.style.display = 'none'; return; }
    labPanel.classList.toggle('collapsed', labCollapsed);
    if (labCollapsed) {
      labPanel.innerHTML = '<button data-lab-act="collapse" class="sr-labcollapse">Ability Lab</button>';
      labPanel.style.display = state === 'playing' || state === 'help' ? 'block' : 'none';
      return;
    }
    const builds = labBuildsFor(cls.id);
    const preset = currentLabPreset();
    const classOpts = CLASSES.map(c => `<option value="${c.id}"${c.id === cls.id ? ' selected' : ''}>${html(c.name)}</option>`).join('');
    const buildOpts = builds.map(b => `<option value="${b.id}"${b.id === labBuildId ? ' selected' : ''}>${html(b.name)}</option>`).join('');
    const testButtons = ['attack', 'secondary', 'shift', 'jump', 'e', 'q'].map(labSlotButton).join('');
    const rogueTools = cls.id === 'rogue' ? `<button data-lab-act="knife">Drop Knife</button>` : '';
    const pyroTools = cls.id === 'mage' && magePyroLoadoutActive() ? `<button data-lab-act="pyrochain">Pyro Setup</button><button data-lab-act="hotbarrel">Hot Barrel</button>` : '';
    const spiritTools = cls.id === 'mage' && mageSpiritLoadoutActive() ? `<button data-lab-act="spirit">Spirit</button>` : '';
    labPanel.innerHTML = `<div class="sr-labhead"><b>Ability Lab</b><button data-lab-act="collapse" class="sr-labcollapse">Hide</button></div>
      <div class="sr-labrow">
        <select data-lab-select="class" aria-label="Class">${classOpts}</select>
        <select data-lab-select="build" aria-label="Build">${buildOpts}</select>
      </div>
      <div class="sr-labnote">${html(preset.note || 'Test this build against controlled targets and objects.')}</div>
      <div class="sr-labtests" aria-label="Test current abilities">${testButtons}</div>
      <div class="sr-labtools">
        <button data-lab-act="reset">Reset</button>
        <button data-lab-act="cooldowns">Ready</button>
        <button data-lab-act="dummy">Dummy</button>
        <button data-lab-act="enemy">Enemy</button>
        <button data-lab-act="bot">Bot</button>
        <button data-lab-act="crate">Crate</button>
        <button data-lab-act="barrel">Barrel</button>
        <button data-lab-act="spring">Spring</button>
        ${rogueTools}
        ${pyroTools}
        ${spiritTools}
        <button data-lab-act="debug" class="${debug.enabled ? 'active' : ''}">Hitboxes</button>
        <button data-lab-act="menu">Menu</button>
      </div>`;
    labPanel.style.display = state === 'playing' || state === 'help' ? 'block' : 'none';
  }
  function startLab(clsId, buildId) {
    labMode = true;
    labCollapsed = false;
    if (clsId) cls = CLASSES.find(c => c.id === clsId) || cls;
    labBuildId = buildId || 'base';
    applyLabBuild(labBuildId);
    state = 'playing';
    ov.classList.add('hidden');
    setPlayUi(true);
    loadLevel(0, false);
    applyLabBuild(labBuildId);
    setupLabScene();
    renderLabPanel();
    exposeDebugApi();
  }

  function showMenu() {
    labMode = false;
    labCollapsed = false;
    state = 'menu';
    setPlayUi(false);
    ov.classList.remove('hidden');
    const cards = CLASSES.map(c => `
      <button class="sr-class" data-cls="${c.id}" style="--cc:${c.color}">
        <span style="font-size:30px">${c.emoji}</span>
        <b style="color:${c.color}">${c.name}</b>
        <small>${c.blurb}</small>
      </button>`).join('');
    const labCards = CLASSES.map(c => `<button class="sr-lab-class" data-lab-cls="${c.id}" style="--cc:${c.color}">${html(c.name)} Lab</button>`).join('');
    ov.innerHTML = `<div class="sr-kicker">Wave Fighter</div>
      <h2 class="sr-title">Stick Arena</h2>
      <p class="msg sr-menu-copy">Choose a fighter and control the arena with movement, timing, and class resources.</p>
      <div class="sr-classes">${cards}</div>
      <div class="sr-mode-actions"><button class="btn alt sr-lab-open" data-lab-cls="${cls.id}">OPEN ABILITY LAB</button></div>
      <div class="sr-lab-grid">${labCards}</div>`;
    loadLevel(0, false);
    exposeDebugApi();
  }
  function play(clsId) {
    labMode = false;
    if (clsId) cls = CLASSES.find(c => c.id === clsId) || cls;
    runBuild = baseRunBuild(cls.id);
    loadout = runBuild.loadout;
    arenaDraftChoices = null;
    state = 'playing';
    ov.classList.add('hidden');
    setPlayUi(true);
    loadLevel(0, false);
    exposeDebugApi();
  }
  function validClassId(id) {
    return CLASSES.some(c => c.id === id) ? id : null;
  }
  function validLabBuildId(classId, buildId) {
    const builds = labBuildsFor(classId);
    return builds.some(b => b.id === buildId) ? buildId : (builds[0] && builds[0].id || 'base');
  }
  function startFromQuery() {
    const labClass = validClassId(query.get('lab') || query.get('stickLab') || query.get('labClass'));
    if (labClass) {
      startLab(labClass, validLabBuildId(labClass, query.get('build') || query.get('labBuild')));
      return;
    }
    const playClass = validClassId(query.get('class') || query.get('cls') || query.get('fighter'));
    if (playClass && (query.has('play') || query.has('arena'))) {
      play(playClass);
      return;
    }
    showMenu();
  }
  function nextLevel() {
    if (li + 1 < levels.length) {
      burst(player.x, player.y - PH / 2, '#ffd45e', 30, 6);
      loadLevel(li + 1, true);
    } else win();
  }
  function win() {
    state = 'win';
    setPlayUi(false);
    const timeBonus = Math.max(0, 6000 - Math.floor(runTime / 1000) * 25);
    const score = (arenaKills || 0) * 100 + timeBonus;
    const isBest = api.setBest('stickrun', score);
    ov.classList.remove('hidden');
    ov.innerHTML = `<h2>Arena run complete</h2>
      <div class="stat-row">
        <div class="stat"><span class="v">${score}</span><span class="l">Score</span></div>
        <div class="stat"><span class="v">${arenaKills || 0}</span><span class="l">KOs</span></div>
        <div class="stat"><span class="v">${(runTime / 1000).toFixed(1)}s</span><span class="l">Time</span></div>
      </div>
      ${isBest ? '<div class="new-best">★ NEW BEST! ★</div>' : '<div style="height:20px"></div>'}
      <button class="btn" data-act="play" style="background:#ff9f6e;box-shadow:0 0 22px rgba(255,159,110,.5)">PLAY AGAIN ↻</button>`;
  }
  ov.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act === 'resume') { closeHelp(); return; }
    const labCard = e.target.closest && e.target.closest('[data-lab-cls]');
    if (labCard) { startLab(labCard.dataset.labCls); return; }
    const card = e.target.closest && e.target.closest('[data-cls]');
    if (card) { play(card.dataset.cls); return; }
    const pick = e.target.closest && e.target.closest('[data-pick]');
    if (pick) { pickDraft(pick.dataset.pick); return; }
    if (act === 'play') play();   // win-screen: replay same class
  });
  labPanel.addEventListener('change', e => {
    const kind = e.target.dataset && e.target.dataset.labSelect;
    if (!kind) return;
    if (kind === 'class') startLab(e.target.value, 'base');
    if (kind === 'build') applyLabBuild(e.target.value);
  });
  labPanel.addEventListener('click', e => {
    const slotBtn = e.target.closest && e.target.closest('[data-lab-slot]');
    if (slotBtn) { testLabSlot(slotBtn.dataset.labSlot); exposeDebugApi(); return; }
    const act = e.target.dataset && e.target.dataset.labAct;
    if (!act) return;
    if (act === 'collapse') { labCollapsed = !labCollapsed; renderLabPanel(); }
    else if (act === 'reset') resetLabScene();
    else if (act === 'cooldowns') refillLabResources();
    else if (act === 'dummy') spawnLabDummy('dummy');
    else if (act === 'enemy') spawnLabDummy('enemy');
    else if (act === 'bot') spawnLabBot();
    else if (act === 'crate') spawnLabObject('crate');
    else if (act === 'barrel') spawnLabObject('barrel');
    else if (act === 'spring') spawnLabObject('spring');
    else if (act === 'knife') spawnLabDroppedKnife();
    else if (act === 'pyrochain') setupLabPyroChain();
    else if (act === 'hotbarrel') spawnLabHotBarrel();
    else if (act === 'spirit') {
      const source = ['rogue', 'knight', 'lancer', 'ranger'][(Math.floor((runTime || 0) / 900) % 4)];
      spawnSpiritRemnant(player.x + player.facing * 86, player.y - 56, { groundY: player.y, source });
      grantSpiritCharge(player.x, player.y - 58, 1);
    }
    else if (act === 'debug') {
      debug.enabled = !debug.enabled;
      exposeDebugApi();
      renderLabPanel();
    }
    else if (act === 'menu') { showMenu(); return; }
    if (labMode) exposeDebugApi();
  });
  api.on(helpBtn, 'click', () => { if (state === 'help') closeHelp(); else openHelp(); });

  // ---------- particles ----------
  const PARTICLE_SOFT_LIMIT = 1450;
  function addParticle(pt) {
    if (!particles) return;
    if (particles.length > PARTICLE_SOFT_LIMIT) particles.splice(0, particles.length - PARTICLE_SOFT_LIMIT);
    particles.push(pt);
  }
  function flameParticle(x, y, vx, vy, opts) {
    opts = opts || {};
    addParticle({
      kind: 'flame',
      x, y, vx, vy,
      life: opts.life || rand(210, 520),
      max: opts.max || opts.life || 520,
      color: opts.color || (Math.random() < 0.44 ? '#ffd45e' : '#ff6b32'),
      r: opts.r || rand(2.4, 7.2),
      grow: opts.grow == null ? rand(0.016, 0.055) : opts.grow,
      drag: opts.drag || 0.958,
      buoy: opts.buoy == null ? rand(0.018, 0.052) : opts.buoy,
      swirl: opts.swirl == null ? rand(0.010, 0.040) : opts.swirl,
      seed: rand(0, Math.PI * 2),
      alpha: opts.alpha || 0.92,
    });
  }
  function smokeParticle(x, y, vx, vy, opts) {
    opts = opts || {};
    addParticle({
      kind: 'smoke',
      x, y, vx, vy,
      life: opts.life || rand(520, 1180),
      max: opts.max || opts.life || 1180,
      color: opts.color || (Math.random() < 0.55 ? '#6b6470' : '#2b2530'),
      r: opts.r || rand(5.2, 13.5),
      grow: opts.grow == null ? rand(0.025, 0.075) : opts.grow,
      drag: opts.drag || 0.982,
      buoy: opts.buoy == null ? rand(0.010, 0.034) : opts.buoy,
      swirl: opts.swirl == null ? rand(0.004, 0.020) : opts.swirl,
      seed: rand(0, Math.PI * 2),
      alpha: opts.alpha || 0.36,
    });
  }
  function emberParticle(x, y, vx, vy, opts) {
    opts = opts || {};
    addParticle({
      kind: 'ember',
      x, y, vx, vy,
      life: opts.life || rand(260, 760),
      max: opts.max || opts.life || 760,
      color: opts.color || (Math.random() < 0.45 ? '#ffd45e' : '#ff8a2a'),
      r: opts.r || rand(1.1, 2.6),
      drag: opts.drag || 0.988,
      gravity: opts.gravity == null ? 0.035 : opts.gravity,
      seed: rand(0, Math.PI * 2),
      alpha: opts.alpha || 0.88,
    });
  }
  function emitFlameJet(x, y, ang, count, opts) {
    opts = opts || {};
    const spread = opts.spread == null ? 0.24 : opts.spread;
    const base = opts.speed || 5.8;
    for (let i = 0; i < count; i++) {
      const a = ang + rand(-spread, spread);
      const s = rand(base * 0.45, base * 1.22);
      const ox = Math.cos(a) * rand(0, opts.length || 24);
      const oy = Math.sin(a) * rand(0, opts.length || 24);
      flameParticle(x + ox, y + oy, Math.cos(a) * s + rand(-0.45, 0.45), Math.sin(a) * s * 0.62 + rand(-0.55, 0.25), opts);
    }
  }
  function emitSmokePuff(x, y, ang, count, opts) {
    opts = opts || {};
    const spread = opts.spread == null ? 0.46 : opts.spread;
    const base = opts.speed || 1.8;
    for (let i = 0; i < count; i++) {
      const a = ang + rand(-spread, spread);
      const s = rand(base * 0.28, base * 1.15);
      smokeParticle(x + rand(-6, 6), y + rand(-5, 5), Math.cos(a) * s + rand(-0.22, 0.22), Math.sin(a) * s * 0.45 + rand(-0.34, 0.16), opts);
    }
  }
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(.3, 1) * spd;
      addParticle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: rand(300, 650), max: 650, color, r: rand(1.5, 3.5) });
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
      drop: Math.max(down * 17, slide * 34, sweep * 22, shoulder * 5),
      lean: -act.facing * (down * 0.16 + slide * 0.94 + sweep * 0.42) + act.facing * shoulder * 0.16,
      w: PW + slide * 36 + sweep * 18 + shoulder * 8,
      h: PH - Math.max(down * 15, slide * 31, sweep * 20),
      ox: act.facing * (slide * 13 + sweep * 7 + shoulder * 4),
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
  function isOneWay(p) { return !!(p && p.oneWay); }
  function canActorLandOnOneWay(act, p, prevFeetY) {
    const b = actorBox(act);
    return isOneWay(p) && act.vy >= 0 && prevFeetY <= p.y + 6 &&
      b.x + b.w > p.x + 4 && b.x < p.x + p.w - 4 && act.y >= p.y - 1 && act.y <= p.y + p.h + 18;
  }
  function canBoxLandOnOneWay(b, p, prevBottom) {
    return isOneWay(p) && b.vy >= 0 && prevBottom <= p.y + 6 &&
      b.x + b.w > p.x + 4 && b.x < p.x + p.w - 4 && b.y + b.h >= p.y - 1 && b.y + b.h <= p.y + p.h + 18;
  }
  function solidHitsBox(r) {
    const L = levels[li];
    for (const p of L.platforms) if (!isOneWay(p) && hit(r, p)) return true;
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
  function pointInAabb(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
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
    for (let bi = boxes.length - 1; bi >= 0; bi--) {
      const b = boxes[bi];
      if (b.dead) { boxes.splice(bi, 1); continue; }
      if (b.life > 0) { b.life -= STEP; if (b.life <= 0) { boxes.splice(bi, 1); continue; } }
      if (b.springCd > 0) b.springCd = Math.max(0, b.springCd - STEP);
      if (b.heat > 0) b.heat = Math.max(0, b.heat - STEP * 0.018);
      if (b.heatFlash > 0) b.heatFlash = Math.max(0, b.heatFlash - STEP);
      b.vy = Math.min(b.vy + 0.55, 16);
      // horizontal
      b.x += b.vx;
      for (const p of L.platforms) if (!isOneWay(p) && hit(b, p)) { b.x = b.vx > 0 ? p.x - b.w : p.x + p.w; b.vx *= -0.25; b.va += b.vx * 0.01; }
      for (const o of boxes) if (o !== b && hit(b, o)) { b.x = b.x < o.x ? o.x - b.w : o.x + o.w; const t = b.vx; b.vx = o.vx * 0.4; o.vx = t * 0.4; }
      // vertical
      let onG = false;
      const prevBottom = b.y + b.h;
      b.y += b.vy;
      for (const p of L.platforms) if (hit(b, p)) {
        if (isOneWay(p)) {
          if (canBoxLandOnOneWay(b, p, prevBottom)) { b.y = p.y - b.h; onG = true; b.vy = b.vy > 4 ? -b.vy * 0.22 : 0; }
          continue;
        }
        if (b.vy > 0) { b.y = p.y - b.h; onG = true; b.vy = b.vy > 4 ? -b.vy * 0.22 : 0; }
        else if (b.vy < 0) { b.y = p.y + p.h; b.vy = 0; }
      }
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
      if (b.kind === 'spring') {
        const actors = [hero].concat(fighters || [], allies || []).filter(Boolean);
        for (const act of actors) {
          if (!act.dead && act.vy >= 0 && Math.abs(act.x - (b.x + b.w / 2)) < b.w / 2 + 16 && Math.abs(act.y - b.y) < 18) triggerSpringBox(b, act, 15);
        }
      }
      if (b.y > L.h + 300) {
        if (b.life > 0 || b.kind === 'barrier' || b.kind === 'spring') { boxes.splice(bi, 1); continue; }
        b.y = -40; b.x = L.spawn.x + 200; b.vy = b.vx = b.va = 0; b.angle = 0; b.heat = 0; b.heatFlash = 0;
      }
    }
  }
  // apply an impulse to one crate (force scaled by its mass), with a tumble
  function pushBox(b, dx, dy, force) {
    if (!b || b.dead) return;
    if (b.kind === 'barrier') force *= 0.35;
    if (hasPassive('heavy_objects') && (b.kind === 'crate' || b.kind === 'barrel')) force *= 1.18;
    if (hasPassive('rg_trapmaster') && b.kind === 'barrel') force *= 1.22;
    const f = force / b.m;
    b.vx += dx * f; b.vy += dy * f - 2 / b.m;
    b.va += dx * 0.05 + (Math.random() - 0.5) * 0.22;     // torque -> tumble
    b.va = clamp(b.va, -0.6, 0.6);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (b.kind === 'barrel' && force > 13) { explodeBox(b, force); return; }
    if (b.kind === 'spring' && force > 10) triggerSpringBox(b, null, force);
    burst(cx, cy, b.kind === 'barrel' ? '#ff9f6e' : b.kind === 'spring' ? '#8fe6ff' : '#caa15a', 8, 3);
  }
  function explodeBox(b, force) {
    if (!b || b.dead) return;
    b.dead = true;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const boom = (force || 18) * (hasPassive('rg_trapmaster') || hasPassive('heavy_objects') ? 1.25 : 1);
    burst(cx, cy, '#ff5a36', 44, 7.2);
    burst(cx, cy, '#ffd45e', 28, 5.4);
    burst(cx, cy, '#ffffff', 16, 3.6);
    addShake(6.8, 190);
    pushBoxesRadial(cx, cy, boom, 178, b.team === 'enemy' ? 'enemy' : 'hero');
  }
  function triggerSpringBox(b, act, force) {
    if (!b || b.dead || b.springCd > 0) return;
    b.springCd = hasPassive('rn_prepared') ? 260 : 420;
    const lift = (force || 13) * (hasPassive('rn_prepared') ? 1.28 : 1);
    b.vy = Math.min(b.vy, -2.0);
    b.va += 0.18;
    burst(b.x + b.w / 2, b.y, '#8fe6ff', 18, 4.2);
    if (act && !act.dead) {
      act.vy = Math.min(act.vy, -7.5 - lift * 0.18);
      act.vx += (act.x < b.x + b.w / 2 ? -1 : 1) * 1.2;
      act.grounded = false;
      if (act.anim) act.anim.squash = -0.45;
    }
  }
  function livingAllies() {
    return allies ? allies.filter(a => a && !a.dead) : [];
  }
  function enemyAttackTargets() {
    const out = [];
    if (hero) out.push(hero);
    if (allies) for (const a of allies) if (!a.dead) out.push(a);
    return out;
  }
  function hurtEnemyTarget(act, nx, ny, force, hx, hy) {
    if (!act) return;
    if (act === hero) hurtHero(nx, ny, force, hx, hy);
    else hurtFighter(act, nx, ny, force, hx, hy);
  }
  function actorCanBeHitByEnemy(act) {
    return act && !act.dead && (act !== hero || !(hero.invuln > 0));
  }
  // attacks shove nearby crates
  function hitBoxes(ix, iy, dx, dy, force) {
    for (const b of boxes) if (Math.hypot(b.x + b.w / 2 - ix, b.y + b.h / 2 - iy) < 52) pushBox(b, dx, dy, force);
    if (player.team === 'enemy') {
      for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t) && segHitActor(ix, iy, ix, iy, 32, t)) hurtEnemyTarget(t, dx, dy, force, ix, iy);
    } else {
      if (dummies) for (const d of dummies) { const n = dummyNearest(d, ix, iy); if (n.p && n.d < 42) hurtDummy(d, dx, dy, force, ix, iy); }
      if (fighters) for (const e of fighters.slice()) { const h = segHitActor(ix, iy, ix, iy, 32, e); if (h) hurtFighter(e, dx, dy, force, h.x, h.y); }
    }
  }
  function hitBoxesSegment(ax, ay, bx, by, dx, dy, force, radius) {
    const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy) || 1;
    const nx = dx == null ? sx / sl : dx, ny = dy == null ? sy / sl : dy;
    const rr = radius || 10;
    rememberDebugSegment('ability', ax, ay, bx, by, rr, '#ffb020', 220);
    for (const b of boxes) {
      if (segAabbDist(ax, ay, bx, by, b) <= rr) pushBox(b, nx, ny, force);
    }
    if (player.team === 'enemy') {
      for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t)) {
        const h = segHitActor(ax, ay, bx, by, rr, t);
        if (h) hurtEnemyTarget(t, nx, ny, force, h.x, h.y);
      }
    } else {
      hitDummiesSegment(ax, ay, bx, by, nx, ny, force, rr);
      if (fighters) for (const e of fighters.slice()) { const h = segHitActor(ax, ay, bx, by, rr, e); if (h) hurtFighter(e, nx, ny, force, h.x, h.y); }
    }
  }
  function projectileHitsBox(p, ax, ay, b) {
    return segAabbDist(ax, ay, p.x, p.y, b) <= projectileRadius(p);
  }
  function projectileRadius(p) {
    return p.kind === 'dagger' ? (p.summoned ? 5.4 : p.fan ? 5.0 : 4.5) : p.kind === 'arrow' ? (p.powerShot ? 6.5 : 4.8) : p.kind === 'gravitySeed' ? 10 : p.kind === 'gravityDebris' ? (p.r || 12) : p.kind === 'firebolt' ? 10 : p.kind === 'ignitionOrb' ? 14 : p.kind === 'smokeBomb' ? (p.poison ? 11 : 9) : p.kind === 'spiritBolt' ? 9 : p.r || 8;
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
  function actorAttackBodyOffset(act) {
    const a = act && act.anim;
    if (!a || !a.atkActive) return { x: 0, y: 0, lean: 0 };
    return withActor(act, () => attackBodyOffset(a.atkType, clamp(a.atkT, 0, 1), act.facing));
  }
  function actorCapsules(act) {
    const S = act.cls.style, post = actorPosture(act), hov = (act.anim.fly || 0) * (S.hover || 0);
    const body = actorAttackBodyOffset(act);
    const baseY = act.y - hov, hip = { x: act.x - act.facing * post.slide * 7 + body.x, y: baseY - S.hipH + post.drop + body.y };
    const lean = (act.anim.lean || 0) + post.lean + body.lean;
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
  function segAabbDist(ax, ay, bx, by, r) {
    if (pointInAabb(ax, ay, r) || pointInAabb(bx, by, r)) return 0;
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    const edges = [
      [x1, y1, x2, y1], [x2, y1, x2, y2],
      [x2, y2, x1, y2], [x1, y2, x1, y1],
    ];
    let best = Math.min(pointAabbDist(ax, ay, r), pointAabbDist(bx, by, r));
    for (const e of edges) {
      const d = segSegDist(ax, ay, bx, by, e[0], e[1], e[2], e[3]);
      if (d === 0) return 0;
      best = Math.min(best, d);
    }
    return best;
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
      for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t)) {
        const d = Math.hypot(t.x - x, (t.y - 40) - y);
        if (d < radius + 20) hurtEnemyTarget(t, (t.x - x) / (d || 1), ((t.y - 40) - y) / (d || 1), force * (1 - d / (radius + 20)), t.x, t.y - 30);
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
  function dummyPointRadius(k) {
    if (k === 'head') return DUMMY.headR;
    if (k === 'chest') return 7;
    if (k === 'hip') return 6;
    if (k === 'kneeL' || k === 'kneeR') return 4;
    if (k === 'elbowL' || k === 'elbowR') return 3;
    return 2.5;
  }
  function ragdollFloorYAt(x, y, k, prevY) {
    const L = levels[li];
    let floor = Infinity;
    const r = dummyPointRadius(k);
    const oldY = prevY == null ? y : prevY;
    const top = Math.min(oldY, y) - r - 8, bottom = y + 760;
    for (const p of L.platforms) {
      const floorY = p.y - r;
      const fromAbove = oldY <= floorY + 10 || y <= floorY + 10;
      if (fromAbove && x >= p.x - 10 && x <= p.x + p.w + 10 && p.y >= top && p.y <= bottom) floor = Math.min(floor, p.y);
    }
    for (const b of boxes) {
      const floorY = b.y - r;
      const fromAbove = oldY <= floorY + 10 || y <= floorY + 10;
      if (fromAbove && x >= b.x - 8 && x <= b.x + b.w + 8 && b.y >= top && b.y <= bottom) floor = Math.min(floor, b.y);
    }
    return (floor === Infinity ? L.h - 8 : floor) - r;
  }
  function makeDummy(x, y, opts) {
    opts = opts || {};
    const pts = {};
    for (const k in DUMMY_REST) {
      const wx = x + DUMMY_REST[k][0], wy = y + DUMMY_REST[k][1];
      pts[k] = { x: wx, y: wy, px: wx, py: wy, pin: k === 'footL' || k === 'footR' };
    }
    const bones = DUMMY_BONES.map(([a, b]) => [a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y)]);
    return {
      baseX: x, baseY: y, homeX: x, pts, bones, flash: 0, burned: 0, burnedMax: 0,
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
      d.burned = Math.max(0, (d.burned || 0) - dt);
      if (d.burned <= 0) d.burnedMax = 0;
      if ((d.burned || 0) > 0 && !d.defeated) {
        d.burnTick = Math.max(0, (d.burnTick || 0) - dt);
        const p = d.pts.chest;
        if (p && Math.random() < 0.16) particles.push({
          x: p.x + rand(-14, 14),
          y: p.y + rand(-10, 18),
          vx: rand(-0.35, 0.35),
          vy: rand(-1.1, -0.2),
          life: rand(170, 340),
          max: 340,
          color: Math.random() < 0.45 ? '#ffd45e' : '#ff6b32',
          r: rand(1.2, 3.0),
        });
        if (d.kind === 'enemy' && d.burnTick <= 0) {
          d.burnTick = 520;
          hurtDummy(d, 0, -0.12, 4.2, p.x, p.y);
        }
      }
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
      const m = d.defeated ? 0 : DUMMY_MUSCLE[k];
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
        const floorY = d.defeated ? ragdollFloorYAt(p.x, p.y, k, p.py) : groundY;
        if (p.pin) { p.x = d.baseX + DUMMY_REST[k][0]; p.y = groundY; }
        else if (p.y > floorY) {
          if (d.defeated) {
            const vy = p.y - p.py;
            p.y = floorY;
            p.py = p.y + Math.max(0, vy) * 0.22;
            p.px = p.x + (p.x - p.px) * 0.10;
          } else { p.y = groundY; p.px = p.x + (p.x - p.px) * 0.4; }
        }   // floor + a little slide/bounce friction
      }
    }
  }
  function dummyNearest(d, x, y) {
    let best = null, bd = Infinity;
    for (const k in d.pts) { const p = d.pts[k]; if (p.pin) continue; const dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p; } }
    return { p: best, d: bd };
  }
  // apply an impulse AT a point on the body (displacing a verlet node = giving it velocity)
  function pointInHeroSmoke(x, y) {
    return !!(smokeZones && smokeZones.some(z => (z.team || 'hero') === 'hero' && Math.hypot(x - z.x, y - z.y) < z.r));
  }
  function rogueStealthPassiveActive() {
    return hasPassive('rg_assassinate') || hasPassive('rg_nightshade');
  }
  function rogueStealthWindowAt(x, y, target) {
    if (!player || player.team !== 'hero' || cls.id !== 'rogue' || !rogueStealthPassiveActive()) return false;
    return (player.hidden || 0) > 0 || pointInHeroSmoke(player.x, player.y - 38) || pointInHeroSmoke(x, y) || !!(target && (target.poisoned || 0) > 0);
  }
  function rogueAssassinateMultiplier(target, hx, hy) {
    if (!player || player.team !== 'hero' || cls.id !== 'rogue' || !rogueStealthPassiveActive()) return 1;
    const wounded = target && target.maxHp && target.hp < target.maxHp * 0.55;
    const stealth = rogueStealthWindowAt(hx == null ? player.x : hx, hy == null ? player.y - 44 : hy, target);
    if (stealth && wounded) return 1.52;
    if (stealth) return 1.28;
    return wounded ? 1.34 : 1;
  }
  function hurtDummy(d, nx, ny, force, hx, hy) {
    const stealthMult = rogueStealthWindowAt(hx, hy, d) ? 1.24 : 1;
    const k = clamp(force * stealthMult, 4, 44);
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
    if (stealthMult > 1) {
      burst(hx, hy, '#cfe0f6', 12, 2.6);
      burst(hx, hy, '#9cff5e', 7, 2.2);
    }
    if (d.kind === 'enemy' && !d.defeated) {
      d.hp -= Math.max(0.5, k / 16);
      if (d.hp <= 0) {
        d.defeated = true;
        d.flash = 650;
        d.attackCd = 9999;
        for (const foot of ['footL', 'footR']) d.pts[foot].pin = false;
        spawnSpiritRemnant(hx, hy, { groundY: d.baseY, source: 'dummy' });
        grantSpiritCharge(hx, hy, 1);
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
    const burnFade = clamp((d.burned || 0) / Math.max(1, d.burnedMax || d.burned || 1), 0, 1);
    const enemy = d.kind === 'enemy';
    const ink = d.defeated ? '#6a6360' : hot > 0.02 ? '#a9544b' : INK;
    const accent = enemy && !d.defeated ? actorTeamAccent({ team: 'enemy' }) : null;
    const fL = P('footL'), fR = P('footR'), midX = (fL.x + fR.x) / 2, baseY = Math.max(fL.y, fR.y);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!enemy || !d.defeated) {
      ctx.fillStyle = '#5a4d3d';
      ctx.beginPath(); ctx.moveTo(midX - 17, baseY + 3); ctx.lineTo(midX + 17, baseY + 3);
      ctx.lineTo(midX + 9, baseY - 7); ctx.lineTo(midX - 9, baseY - 7); ctx.closePath(); ctx.fill();
    }
    if (accent) {
      ctx.save();
      ctx.translate(midX, baseY);
      drawTeamGroundMarker(accent, d.dir || 1);
      ctx.restore();
    }
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    for (const [a, j, b, w] of DUMMY_LIMBS) { const pa = P(a), pj = P(j), pb = P(b); seg(pa.x, pa.y, pj.x, pj.y, pb.x, pb.y, w); }
    const hip = P('hip'), chest = P('chest'), head = P('head');
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();   // torso
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(chest.x, chest.y); ctx.lineTo(head.x, head.y); ctx.stroke(); // neck
    ctx.beginPath(); ctx.arc(head.x, head.y, DUMMY.headR, 0, Math.PI * 2); ctx.fill();
    if (accent) drawTeamBodyMarker(accent, hip.x, hip.y, chest.x, chest.y, head.x, head.y, DUMMY.headR, d.dir || 1);
    const tx = lerp(hip.x, chest.x, 0.55), ty = lerp(hip.y, chest.y, 0.55);
    ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.fillStyle = '#e7e0d2'; ctx.fill();
    ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fillStyle = enemy ? '#ff5a5a' : hot > 0.02 ? '#ff5436' : '#c2452f'; ctx.fill();
    if (burnFade > 0.02) drawBurnCue(tx, ty - 8, burnFade, enemy ? 1.08 : 0.96);
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
    e.cls = cdef; e.team = opts.team || 'enemy';
    e.intent = { left: false, right: false, down: false, jumpHeld: false, jumpHold: 0, jump: false };
    e.facing = opts.facing || (Math.random() < 0.5 ? -1 : 1);
    e.flash = 0; e.dead = false; e._moveAmt = 0;
    e.maxHp = opts.hp || enemyDefaultHp(clsId); e.hp = e.maxHp;
    e.patrolMin = opts.min == null ? x - 120 : opts.min;
    e.patrolMax = opts.max == null ? x + 120 : opts.max;
    e.brain = {
      dir: e.facing, atkCd: rand(300, 900), moveCd: rand(200, 700), stagger: 0, alert: 0, retreat: 0,
      jumpCd: rand(0, 300), airJumpCd: rand(120, 420), combo: 0, aggroRange: enemyAggro(clsId), tgt: null, pauseT: rand(0, 800),
    };
    return e;
  }
  function chooseCombatTarget(e) {
    let best = null, bd = Infinity;
    const pool = e.team === 'ally' ? (fighters || []) : enemyAttackTargets();
    for (const t of pool) {
      if (!t || t.dead || t === e) continue;
      const d = Math.hypot(t.x - e.x, (t.y - 44) - (e.y - 44));
      if ((t.hidden || 0) > 0 && d > 86) continue;
      if ((e.smokeBlind || 0) > 0 && d > lerp(82, 178, 1 - clamp((e.smokeBlind || 0) / Math.max(1, e.smokeBlindMax || 620), 0, 1))) continue;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function followHeroAlly(e) {
    if (!hero) return;
    const idx = Math.max(0, livingAllies().indexOf(e));
    const goalX = hero.x - hero.facing * (58 + idx * 36);
    const dx = goalX - e.x;
    if (Math.abs(dx) > 48) pressToward(e, dx > 0 ? 1 : -1);
    if (e.grounded && hero.y < e.y - 32) e.intent.jump = true;
    if (e.cls.fly) e.intent.jumpHeld = hero.y < e.y + 12;
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
    const b = actorBox(e), cur = surfaceYFor(e, e.x, 72, 18);
    const near = surfaceYFor(e, e.x + dir * 42, 100, 68);
    const far = surfaceYFor(e, e.x + dir * 96, 170, 110);
    const lower = surfaceYFor(e, e.x + dir * 126, 270, 120);
    const probe = { x: dir > 0 ? b.x + b.w : b.x - 7, y: b.y + 9, w: 7, h: Math.max(16, b.h - 18) };
    return {
      blocked: solidProbe(probe),
      cur, near, far, lower,
      gap: cur !== null && near === null && far !== null && Math.abs(far - cur) < 94,
      ledge: cur !== null && near === null && far === null && lower === null,
      safeDrop: cur !== null && near === null && lower !== null && lower > cur && lower - cur < 180,
      stepUp: cur !== null && near !== null && near < cur - 12,
      drop: cur !== null && near !== null && near > cur + 34,
    };
  }
  function navScore(e, nav, dir, desiredDir, dy) {
    let score = dir === desiredDir ? 24 : -4;
    if (nav.ledge) score -= 120;
    if (nav.blocked) score -= e.grounded ? 12 : 30;
    if (nav.stepUp && dy < 30) score += 12;
    if (nav.gap || nav.safeDrop) score += 8;
    if (nav.drop && dy > 18) score += 7;
    return score;
  }
  function chooseFighterRoute(e, n) {
    if (!e.grounded) return n.face;
    const direct = n.nav || fighterNavProbe(e, n.face);
    if (!direct.ledge && !direct.blocked) return n.face;
    const alt = fighterNavProbe(e, -n.face);
    return navScore(e, alt, -n.face, n.face, n.dy) > navScore(e, direct, n.face, n.face, n.dy) ? -n.face : n.face;
  }
  // movement intent helpers (leashed so enemies don't wander off their platform)
  function pressToward(e, dir) {
    const it = e.intent, lo = e.patrolMin - 80, hi = e.patrolMax + 80;
    const nav = e.grounded ? fighterNavProbe(e, dir) : null;
    if (nav && nav.ledge && !nav.safeDrop) return false;
    if (nav && e.grounded && (nav.blocked || nav.stepUp || nav.gap)) {
      it.jump = true;
      e.brain.jumpCd = Math.max(e.brain.jumpCd || 0, nav.gap ? 380 : 260);
    }
    if (dir > 0 && e.x < hi) it.right = true; else if (dir < 0 && e.x > lo) it.left = true;
    return it.left || it.right;
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
      const target = n.target || hero;
      it.jumpHeld = b.alert > 0 && (n.dy < 90 || n.adx < 330 || e.y > target.y + 24);
      return;
    }
    if (e.grounded && b.jumpCd <= 0) {
      const chaseUp = n.dy < -30 && n.adx < 280;
      const surfaceLift = nav.cur !== null && nav.near !== null && nav.near < nav.cur - 8;
      const chaseDrop = n.dy > 32 && (nav.drop || nav.safeDrop);
      if (chaseUp || chaseDrop || nav.blocked || nav.stepUp || nav.gap || surfaceLift) {
        it.jump = true;
        b.jumpCd = nav.gap ? 520 : 360;
      }
    } else if (e.cls.id === 'rogue' && !e.rogueAirJump && e.airTime > 8 && b.airJumpCd <= 0) {
      const followUp = n.dy < -22 && n.adx < 260;
      const saveGap = Math.abs(e.vx) > 1.1 && n.dy < 36 && n.adx < 260;
      if (followUp || saveGap) {
        it.jump = true;                          // Rogue enemy spends its double-jump to follow upward or clear gaps
        b.airJumpCd = 720;
      }
    }
  }
  // per-class engagement: how each archetype fights. `n` = {adx, face, aim, dy}.
  const ENEMY_BRAINS = {
    knight(e, n) {                               // press in, trade blows, shield up close
      const b = e.brain;
      const target = b.target || hero;
      if (target && target.anim && target.anim.atkActive && n.adx < 112 && b.moveCd <= 0) {
        triggerAttack('shieldGuard', { aim: n.aim });
        b.moveCd = rand(1150, 1700); b.atkCd = Math.max(b.atkCd, 360);
        return;
      }
      if (n.adx > 60) {
        pressToward(e, n.route);
        if ((n.adx < 175 || n.nav.blocked || n.nav.stepUp) && b.moveCd <= 0) { triggerMove(); b.moveCd = rand(1050, 1750); }
      } else if (b.atkCd <= 0) {
        const bash = n.adx < 44 || b.combo++ % 4 === 2;
        triggerAttack(bash ? 'shieldBash' : 'slash', { aim: n.aim });
        b.atkCd = bash ? 760 : rand(540, 820);
      }
    },
    rogue(e, n) {                                // hit-and-run: dart in, combo, dagger poke, peel off
      const b = e.brain;
      if (b.retreat > 0) { pressToward(e, -n.face); return; }
      if (n.adx > 48) {
        pressToward(e, n.route);
        if (n.adx > 160 && e.knifeAmmo > 0 && b.atkCd <= 0) { triggerAttack('throw', { aim: n.aim }); b.atkCd = rand(520, 820); }
        else if (n.adx < 190 && b.moveCd <= 0) { triggerMove(); b.moveCd = rand(700, 1180); }
      } else if (b.atkCd <= 0) {
        const type = e.knifeAmmo <= 0 ? null
          : (b.combo % 4 === 3 || n.dy > 16) ? 'legSweep'
            : e.knifeAmmo < 2 || (b.combo % 3 === 2) ? 'rogueStab' : 'dualSlash';
        if (!type) return;
        e.intent.down = type === 'legSweep';
        triggerAttack(type, { aim: n.aim });
        b.combo++; b.atkCd = rand(230, 360);
        if (b.combo % 3 === 0) b.retreat = rand(420, 720);
      }
    },
    lancer(e, n) {                               // spacing control: hold the hero at spear tip, charge gaps
      const b = e.brain;
      if (n.adx > 104) {
        pressToward(e, n.route);
        if (n.adx < 300 && b.moveCd <= 0) { triggerAttack('lanceCharge', { aim: n.aim }); b.atkCd = 1000; b.moveCd = rand(1350, 2200); }
      } else if (n.adx < 58) { pressToward(e, -n.face); }   // too close — back to range
      else if (b.atkCd <= 0) { triggerAttack('braceThrust', { aim: n.aim }); b.atkCd = rand(900, 1300); }
    },
    mage(e, n) {                                 // floats and kites, raining bolts; blooms up close
      const b = e.brain;
      const target = b.target || hero;
      e.intent.jumpHeld = n.adx < 390 || n.dy < 100 || e.y > target.y + 18;
      if (n.adx < 185) { pressToward(e, -n.face); if (n.adx < 135 && b.moveCd <= 0) { triggerMove(); b.moveCd = rand(1050, 1700); } }
      else if (n.adx > 310) pressToward(e, n.route);
      if (b.atkCd <= 0) {
        const close = n.adx < 165 || Math.abs(n.dy) < 44 && n.adx < 210 && b.combo++ % 3 === 2;
        triggerAttack(close ? 'arcaneBloom' : 'cast', { aim: n.aim, range: clamp(Math.hypot(n.dx, n.dy), 130, 540) });
        b.atkCd = close ? 1050 : rand(560, 850);
      }
    },
    ranger(e, n) {                               // skirmisher: keep range, arrow/volley, backstep when crowded
      const b = e.brain;
      if (n.adx < 170) { pressToward(e, -n.face); if ((n.adx < 140 || n.nav.blocked) && b.moveCd <= 0) { triggerMove(); b.moveCd = rand(680, 1180); } }
      else if (n.adx > 300) pressToward(e, n.route);
      if (b.atkCd <= 0) {
        const t = (e.arrowAmmo >= 3 && (n.adx < 260 || b.combo++ % 4 === 3)) ? 'volley' : 'arrow';
        triggerAttack(t, { aim: n.aim, drawPower: rand(0.75, 1.15) });
        b.atkCd = t === 'volley' ? 950 : rand(440, 700);
      }
    },
  };
  function thinkFighter(e, dt) {                 // sets intent + triggers abilities (player === e)
    const b = e.brain, it = e.intent;
    b.atkCd = Math.max(0, b.atkCd - dt); b.moveCd = Math.max(0, b.moveCd - dt); b.airJumpCd = Math.max(0, b.airJumpCd - dt);
    b.jumpCd = Math.max(0, b.jumpCd - dt);
    b.stagger = Math.max(0, b.stagger - dt); b.alert = Math.max(0, b.alert - dt); b.retreat = Math.max(0, b.retreat - dt);
    it.left = it.right = it.down = it.jumpHeld = it.jump = false;
    const target = chooseCombatTarget(e);
    b.target = target;
    if (!target) {
      if (e.team === 'ally') followHeroAlly(e);
      else patrolFighter(e);
      return;
    }
    if (b.stagger > 0) return;                   // reeling from a hit — drop guard, no input
    const atkLocked = e.anim.atkActive || (e.move && e.move.active);
    const dx = target.x - e.x, adx = Math.abs(dx), face = dx >= 0 ? 1 : -1;
    const dy = target.y - e.y;
    if (e.team === 'ally' || arenaMode || adx < b.aggroRange && Math.abs(target.y - e.y) < 180) b.alert = 1800;
    if (!atkLocked) e.facing = face;
    e.anim.aimTarget = Math.atan2((target.y - 44) - (e.y - 77), target.x - e.x);
    if (b.alert <= 0) { patrolFighter(e); return; }
    if (atkLocked) {
      if (e.cls.fly) it.jumpHeld = true;          // casters keep hovering while committed to a spell
      return;
    }
    const nav = fighterNavProbe(e, face);
    const route = chooseFighterRoute(e, { dx, adx, dy, face, aim: e.anim.aimTarget, nav });
    const ctxNav = { dx, adx, dy, face, route, aim: e.anim.aimTarget, nav, target };
    planFighterMobility(e, ctxNav);
    (ENEMY_BRAINS[e.cls.id] || ENEMY_BRAINS.knight)(e, ctxNav);
  }
  // trimmed locomotion/collision for an AI actor (player === e during this call)
  function stepActor(dtStep) {
    const p = player, L = levels[li], it = p.intent;
    const acc = p.grounded ? RUN_ACC : AIR_ACC;
    tickJumpHold(p, dtStep);
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
      updateMageHoverVelocity(dtStep);
    } else {
      p.hoverTargetY = null;
      if (it.jump && cls.id === 'rogue' && !p.grounded && p.coyote <= 0 && !p.rogueAirJump) {
        startRogueAirFlip(p, { burstScale: 0.7 });
      } else if (it.jump && (p.grounded || p.coyote > 0)) {
        p.vy = JUMP; p.grounded = false; p.coyote = 0; p.jumpCut = false; p.anim.squash = -0.5;
      }
      p.vy = Math.min(p.vy + GRA * g, TERMINAL * g);
    }
    p.x += p.vx;
    for (const pl of L.platforms) if (!isOneWay(pl) && hit(box(), pl)) { if (mageHoverStepOver(pl)) continue; resolveActorSide(p, pl); p.vx = 0; }
    for (const bx of boxes) if (hit(box(), bx)) {
      if (mageHoverStepOver(bx)) continue;
      const b = box();
      if (p.vx > 0) { bx.x = b.x + b.w; bx.vx = Math.max(bx.vx, (p.vx * 0.85 + 0.6) / bx.m); p.vx *= 0.5; }
      else if (p.vx < 0) { bx.x = b.x - bx.w; bx.vx = Math.min(bx.vx, (p.vx * 0.85 - 0.6) / bx.m); p.vx *= 0.5; }
    }
    const prevFeetY = p.y;
    p.y += p.vy; p.grounded = false;
    for (const pl of L.platforms) if (hit(box(), pl)) {
      if (isOneWay(pl)) {
        if (canActorLandOnOneWay(p, pl, prevFeetY)) {
          if (p.vy > 6) p.anim.squash = clamp(p.vy / TERMINAL, 0, 1) * 0.9;
          p.y = pl.y; p.grounded = true; p.vy = 0;
        }
        continue;
      }
      if (p.vy > 0) { p.y = pl.y; p.grounded = true; }
      else if (p.vy < 0) p.y = pl.y + pl.h + actorHeight(p);
      if (p.vy > 6) p.anim.squash = clamp(p.vy / TERMINAL, 0, 1) * 0.9;
      p.vy = 0;
    }
    for (const bx of boxes) if (hit(box(), bx)) { if (p.vy > 0 && (p.y - p.vy) <= bx.y + 8) { p.y = bx.y; p.grounded = true; p.vy = 0; } else if (p.vy < 0 && (p.y - actorHeight(p) - p.vy) >= bx.y + bx.h - 8) { p.y = bx.y + bx.h + actorHeight(p); p.vy = 0; bx.vy += 1; } }
    if (cls.fly && mageHovering()) settleMageHover();
    if (p.grounded) { p.coyote = COYOTE; p.airTime = 0; if (p.flip && p.flip.active) p.flip = { active: false, t: 0, dur: 0, dir: p.facing }; }
    else { if (p.coyote > 0) p.coyote--; p.airTime++; }
    updateActorResources(dtStep);
  }
  function updateFighters(dtStep) {
    if (!fighters || !fighters.length || state !== 'playing') return;
    const L = levels[li];
    for (let i = fighters.length - 1; i >= 0; i--) {
      const e = fighters[i];
      if (e.dead) { fighters.splice(i, 1); continue; }
      e.flash = Math.max(0, e.flash - dtStep);
      withActor(e, () => { thinkFighter(e, dtStep); stepActor(dtStep); });
      if (e.y - PH > L.h + 180) {
        burst(e.x, e.y, '#ff5a5a', 12, 3);
        fighters.splice(i, 1);
        if (arenaMode) { arenaKills++; syncHud(); }
      }
    }
  }
  function updateAllies(dtStep) {
    if (!allies || !allies.length || state !== 'playing') return;
    const L = levels[li];
    for (let i = allies.length - 1; i >= 0; i--) {
      const a = allies[i];
      if (a.dead) { allies.splice(i, 1); syncHud(); continue; }
      if (a.spiritLife != null) {
        if (!a.spiritMaxLife) a.spiritMaxLife = a.spiritLife || 1;
        a.spiritLife -= dtStep;
        if (a.spiritLife <= 0) {
          emitSoulWisp(a.x, a.y - 46, hero ? hero.x : a.x + (a.facing || 1) * 44, hero ? hero.y - 58 : a.y - 74, { count: 16, color: a.cls && a.cls.color || '#b48cff', lifeMin: 260, lifeMax: 620 });
          for (let j = 0; j < 6; j++) soulParticle(a.x + rand(-12, 12), a.y - rand(36, 78), rand(-0.34, 0.34), rand(-0.85, -0.06), { color: Math.random() < 0.35 ? '#f5efff' : (a.cls && a.cls.color || '#b48cff'), life: rand(260, 560) });
          allies.splice(i, 1);
          syncHud();
          continue;
        }
        if (a.spirit && Math.random() < 0.18) {
          const fade = clamp(a.spiritLife / Math.max(1, a.spiritMaxLife || a.spiritLife), 0, 1);
          soulParticle(a.x + rand(-16, 16), a.y - rand(38, 86), rand(-0.25, 0.25), rand(-0.90, -0.10), {
            life: rand(260, 520),
            color: Math.random() < 0.35 ? '#f5efff' : a.cls.color,
            r: rand(1.0, 2.5) * (0.75 + fade * 0.45),
          });
        }
      }
      if (a.spirit) {
        a.spiritCommandCd = Math.max(0, (a.spiritCommandCd || 0) - dtStep);
        if (!a.spiritCommand && a.spiritCommandCd <= 0) {
          const target = spiritCommandTarget(760);
          if (target) {
            commandSpiritAlly(a, { target, force: 12.5, dash: 5.4, life: 880, range: 760, afterCd: rand(980, 1480) });
          } else a.spiritCommandCd = 420;
        }
      }
      a.flash = Math.max(0, a.flash - dtStep);
      withActor(a, () => { thinkFighter(a, dtStep); updateSpiritCommand(a, dtStep); stepActor(dtStep); });
      if (a.y - PH > L.h + 180) {
        burst(a.x, Math.min(a.y, L.h), a.cls.color, 10, 2.8);
        allies.splice(i, 1);
        syncHud();
      }
    }
  }
  function animateFighters(dt) {
    if (!fighters) return;
    for (const e of fighters) e._moveAmt = withActor(e, () => animate(dt));
  }
  function animateAllies(dt) {
    if (!allies) return;
    for (const a of allies) a._moveAmt = withActor(a, () => animate(dt));
  }
  function drawSmokeDisruptedCue(e) {
    const blind = e && (e.smokeBlind || 0);
    if (blind <= 0) return;
    const max = Math.max(1, e.smokeBlindMax || 620);
    const fade = clamp(blind / max, 0, 1);
    const now = performance.now();
    const hover = ((e.anim && e.anim.fly) || 0) * ((e.cls && e.cls.style && e.cls.style.hover) || 0);
    const x = e.x, y = e.y - e.cls.style.hipH - 64 - hover;
    const tint = (e.poisoned || 0) > 0 ? '#9cff5e' : '#cfe0f6';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.35 + fade * 1.25;
    for (let i = 0; i < 2; i++) {
      const phase = now * 0.005 + i * Math.PI + e.x * 0.01;
      ctx.globalAlpha = (0.18 + fade * 0.34) * (1 - i * 0.22);
      ctx.beginPath();
      const sx = x - 16 + i * 4;
      const sy = y - 12 + i * 9;
      ctx.moveTo(sx, sy);
      for (let k = 1; k <= 5; k++) {
        const u = k / 5;
        ctx.lineTo(sx + u * (32 + i * 9), sy + Math.sin(phase + u * Math.PI * 2.1) * (3.0 + i * 0.8));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.24 + fade * 0.48;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.35 + fade * 1.0;
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 10);
    ctx.lineTo(x + 13, y + 5);
    ctx.stroke();
    ctx.globalAlpha = 0.18 + fade * 0.36;
    ctx.strokeStyle = tint;
    ctx.beginPath();
    ctx.arc(x, y - 2, 3.5 + fade * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  function drawBurnCue(x, y, fade, scale) {
    fade = clamp(fade || 0, 0, 1);
    if (fade <= 0.02) return;
    scale = scale || 1;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.011 + x * 0.03);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.18 + fade * 0.22;
    ctx.fillStyle = '#ff6b32';
    traceWobblyCirclePath(x, y + 14 * scale, (12 + pulse * 3) * scale, { phase: now * 0.002 + x, rough: 0.18, steps: 16 });
    ctx.fill();
    ctx.globalAlpha = 0.30 + fade * 0.34;
    ctx.strokeStyle = '#ffd45e';
    ctx.lineWidth = (1.4 + fade * 1.2) * scale;
    ctx.setLineDash([7, 8]);
    ctx.lineDashOffset = -now * 0.038;
    traceWobblyCirclePath(x, y + 4 * scale, (23 + pulse * 6) * scale, { phase: now * 0.003 + y, rough: 0.12, steps: 34 });
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 5; i++) {
      const a = now * 0.004 + i * Math.PI * 2 / 5 + x * 0.01;
      ctx.globalAlpha = (0.16 + fade * 0.28) * (0.55 + 0.45 * Math.sin(now * 0.007 + i));
      ctx.strokeStyle = i % 2 ? '#ff6b32' : '#ffd45e';
      ctx.lineWidth = 1.1 * scale;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 10 * scale, y + Math.sin(a) * 8 * scale);
      ctx.lineTo(x + Math.cos(a) * 24 * scale, y - 18 * scale + Math.sin(a) * 14 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawActorBurnCue(e) {
    const fade = clamp((e && e.burned || 0) / Math.max(1, e && (e.burnedMax || e.burned) || 1), 0, 1);
    if (fade <= 0.02 || !e || !e.cls) return;
    const hover = ((e.anim && e.anim.fly) || 0) * ((e.cls.style && e.cls.style.hover) || 0);
    drawBurnCue(e.x, e.y - e.cls.style.hipH - 46 - hover, fade, e.cls.id === 'lancer' ? 1.08 : 1);
  }
  function drawHiddenSilhouette(hipX, hipY, shX, shY, headCX, headCY, fade, f) {
    if (fade <= 0.02) return;
    const now = performance.now();
    const night = hasPassive('rg_nightshade');
    const tint = night ? '#9cff5e' : '#cfe0f6';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.16 + fade * 0.30;
    ctx.strokeStyle = tint;
    ctx.lineWidth = 4.2;
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = -now * 0.045;
    ctx.beginPath();
    ctx.moveTo(hipX - f * 9, hipY + 1);
    ctx.quadraticCurveTo((hipX + shX) * 0.5 - f * 17, (hipY + shY) * 0.5 - 4, shX - f * 8, shY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(headCX - f * 7, headCY, 15 + fade * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.10 + fade * 0.26;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = now * 0.005 + i * Math.PI * 2 / 3;
      const cx = (hipX + shX) * 0.5 + Math.cos(a) * (10 + i * 2);
      const cy = (hipY + shY) * 0.5 + Math.sin(a) * (10 + i * 2);
      traceWobblyCirclePath(cx, cy, 18 + i * 5, { phase: a + now * 0.001, rough: 0.16, steps: 18 });
      ctx.stroke();
    }
    ctx.restore();
  }
  function actorTeamAccent(act) {
    if (!act) return null;
    if (act.team === 'hero') return { role: 'hero', color: '#35d9ff', glow: '#e9fbff', alpha: 0.84, core: 5.8, ground: 1.0 };
    if (act.team === 'ally') {
      if (act.spirit) return { role: 'spirit', color: '#b48cff', glow: '#f5efff', alpha: 0.76, core: 5.3, ground: 0.82 };
      if (act.decoy) return { role: 'decoy', color: '#9cff5e', glow: '#f1ffe6', alpha: 0.72, core: 5.0, ground: 0.78 };
      return { role: 'ally', color: '#53d4ff', glow: '#eefbff', alpha: 0.70, core: 5.1, ground: 0.76 };
    }
    if (act.team === 'enemy') return { role: 'enemy', color: '#ff744d', glow: '#ffe0d4', alpha: 0.72, core: 4.9, ground: 0.68 };
    return null;
  }
  function drawTeamGroundMarker(accent, f) {
    if (!accent) return;
    const pulse = 0.72 + 0.28 * Math.sin(performance.now() * 0.004 + (player.x || 0) * 0.02);
    const w = accent.role === 'hero' ? 26 : accent.role === 'enemy' ? 22 : 23;
    const y = 5.5;
    const parentAlpha = ctx.globalAlpha;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = parentAlpha * accent.alpha * accent.ground * (accent.role === 'hero' ? 0.82 + pulse * 0.18 : 0.78);
    ctx.strokeStyle = accent.color;
    ctx.lineWidth = accent.role === 'hero' ? 2.4 : 2.0;
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.quadraticCurveTo(-w * 0.78, y + 5, -w * 0.36, y + 6);
    ctx.moveTo(w, y);
    ctx.quadraticCurveTo(w * 0.78, y + 5, w * 0.36, y + 6);
    if (accent.role === 'hero') {
      ctx.moveTo(-4, y + 7);
      ctx.lineTo(0, y + 10);
      ctx.lineTo(4, y + 7);
    } else if (accent.role === 'enemy') {
      ctx.moveTo(f * 4, y + 8);
      ctx.lineTo(f * 12, y + 3);
    }
    ctx.stroke();
    ctx.restore();
  }
  function drawTeamBodyMarker(accent, hipX, hipY, shX, shY, headCX, headCY, headR, f) {
    if (!accent) return;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + (player.x || 0) * 0.03);
    const cx = lerp(hipX, shX, 0.58);
    const cy = lerp(hipY, shY, 0.58);
    const parentAlpha = ctx.globalAlpha;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = parentAlpha * accent.alpha;
    ctx.fillStyle = accent.color;
    ctx.strokeStyle = accent.glow;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(cx, cy, accent.core + pulse * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = parentAlpha * accent.alpha * 0.92;
    ctx.stroke();
    ctx.globalAlpha = parentAlpha * (accent.role === 'hero' ? 0.72 : 0.50);
    ctx.strokeStyle = accent.color;
    ctx.lineWidth = accent.role === 'hero' ? 2.1 : 1.8;
    if (accent.role === 'hero') {
      const y = headCY - headR - 9;
      ctx.beginPath();
      ctx.moveTo(headCX - 7, y);
      ctx.lineTo(headCX, y - 5 - pulse * 2);
      ctx.lineTo(headCX + 7, y);
      ctx.stroke();
    } else if (accent.role === 'enemy') {
      const y = headCY - headR - 2;
      ctx.beginPath();
      ctx.moveTo(headCX - f * 4, y);
      ctx.lineTo(headCX + f * 7, y - 5);
      ctx.lineTo(headCX + f * 13, y - 2);
      ctx.stroke();
    } else if (accent.role === 'spirit') {
      const y = headCY - headR - 8;
      ctx.beginPath();
      ctx.moveTo(headCX, y - 4 - pulse * 2);
      ctx.quadraticCurveTo(headCX + 5, y + 1, headCX, y + 7);
      ctx.quadraticCurveTo(headCX - 5, y + 1, headCX, y - 4 - pulse * 2);
      ctx.stroke();
    } else {
      const y = headCY - headR - 6;
      ctx.beginPath();
      ctx.moveTo(headCX - 6, y);
      ctx.lineTo(headCX + 6, y);
      ctx.moveTo(headCX, y - 6);
      ctx.lineTo(headCX, y + 6);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawFighters() {
    if (!fighters) return;
    for (const e of fighters) { withActor(e, () => drawStick(e._moveAmt || 0)); drawSmokeDisruptedCue(e); drawActorBurnCue(e); drawFighterHealth(e); }
  }
  function drawSpiritAllyAura(a) {
    if (!a || !a.spirit) return;
    const now = performance.now();
    const fade = clamp((a.spiritLife || 0) / Math.max(1, a.spiritMaxLife || a.spiritLife || 1), 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.007 + a.x * 0.02);
    const chestY = a.y - 62 - ((a.anim && a.anim.fly) || 0) * (a.cls.style.hover || 0);
    const color = a.cls && a.cls.color || '#b48cff';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (hero && mageSpiritLoadoutActive()) {
      const hx = hero.x, hy = hero.y - 58;
      const mx = (hx + a.x) * 0.5 + Math.sin(now * 0.004 + a.x) * 12;
      const my = (hy + chestY) * 0.5 - 18;
      ctx.setLineDash([7, 10]);
      ctx.lineDashOffset = -now * 0.035;
      ctx.globalAlpha = 0.12 + fade * 0.22;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(mx, my, a.x, chestY);
      ctx.stroke();
      ctx.globalAlpha = 0.20 + fade * 0.22;
      ctx.strokeStyle = '#f5efff';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(mx, my, a.x, chestY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (a.spiritCommand) {
      const cmd = a.spiritCommand;
      const cmdFade = clamp(cmd.life / Math.max(1, cmd.max || cmd.life), 0, 1);
      const mx = (a.x + cmd.x) * 0.5 + Math.sin(now * 0.009) * 10;
      const my = (chestY + cmd.y) * 0.5 - 24;
      ctx.globalAlpha = 0.18 + cmdFade * 0.42;
      ctx.strokeStyle = '#f5efff';
      ctx.lineWidth = 1.6 + pulse * 1.0;
      ctx.setLineDash([4, 7]);
      ctx.lineDashOffset = -now * 0.06;
      ctx.beginPath();
      ctx.moveTo(a.x, chestY);
      ctx.quadraticCurveTo(mx, my, cmd.x, cmd.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const dir = Math.atan2(cmd.y - chestY, cmd.x - a.x);
      const tx = Math.cos(dir), ty = Math.sin(dir), px = -ty, py = tx;
      ctx.globalAlpha = 0.18 + cmdFade * 0.32;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(cmd.x - tx * 20 + px * 4, cmd.y - ty * 20 + py * 4);
      ctx.quadraticCurveTo(cmd.x - tx * 8, cmd.y - ty * 8, cmd.x + tx * 10, cmd.y + ty * 10);
      ctx.moveTo(cmd.x - tx * 20 - px * 4, cmd.y - ty * 20 - py * 4);
      ctx.quadraticCurveTo(cmd.x - tx * 8, cmd.y - ty * 8, cmd.x + tx * 10, cmd.y + ty * 10);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const phase = now * (0.0035 + i * 0.0007) + a.x * 0.015 + i * 1.7;
      const ox = Math.sin(phase) * (9 + i * 3);
      ctx.globalAlpha = (0.16 + fade * 0.20) * (1 - i * 0.12);
      ctx.strokeStyle = i % 2 ? '#f5efff' : color;
      ctx.lineWidth = i % 2 ? 1.1 : 1.8;
      ctx.beginPath();
      ctx.moveTo(a.x + ox * 0.4, chestY + 26 - i * 3);
      ctx.quadraticCurveTo(a.x - ox * 0.25, chestY + 4 - pulse * 6, a.x + ox, chestY - 26 - i * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.34 + fade * 0.22;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x - 10, chestY + 5);
    ctx.quadraticCurveTo(a.x + Math.sin(now * 0.006 + a.x) * 8, chestY - 18, a.x + 10, chestY - 30);
    ctx.stroke();
    ctx.restore();
  }
  function drawAllies() {
    if (!allies) return;
    for (const a of allies) { drawSpiritAllyAura(a); withActor(a, () => drawStick(a._moveAmt || 0)); drawActorBurnCue(a); drawFighterHealth(a); }
  }
  function drawFighterHealth(e) {
    if (e.hp >= e.maxHp) return;
    const w = 30, x = e.x - w / 2, y = e.y - e.cls.style.hipH - 80 - (e.anim.fly || 0) * (e.cls.style.hover || 0);
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,0.32)'; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = e.cls.color; ctx.fillRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    ctx.restore();
  }
  function shieldBlocks(act, nx) {
    return act && act.cls && act.cls.id === 'knight' && (act.shieldGuard || 0) > 0 && (nx || 0) * act.facing < 0;
  }
  function nearHazardOrEdge(act) {
    if (!act) return false;
    const L = levels[li];
    const surface = surfaceYFor(act, act.x, 34, 80);
    const left = surfaceYFor(act, act.x - 72, 90, 80);
    const right = surfaceYFor(act, act.x + 72, 90, 80);
    if (surface !== null && (left === null || right === null)) return true;
    if (act.x < 90 || act.x > L.w - 90) return true;
    return boxes && boxes.some(b => b.kind === 'barrel' && Math.hypot(b.x + b.w / 2 - act.x, b.y + b.h / 2 - (act.y - 38)) < 150);
  }
  // hero hits a fighter: knockback + stagger + damage; death hands off to ragdoll
  function hurtFighter(e, nx, ny, force, hx, hy) {
    if (e.dead) return;
    const blocked = shieldBlocks(e, nx);
    let tunedForce = force;
    if (player && player.team === 'hero') {
      if (hasPassive('momentum')) tunedForce *= 1.22;
      if (hasPassive('hazard_sense') && nearHazardOrEdge(e)) tunedForce *= 1.22;
      if (hasPassive('ln_momentum') && cls.id === 'lancer' && player.anim && (player.anim.atkType === 'lanceCharge' || player.anim.atkType === 'braceThrust')) tunedForce *= nearHazardOrEdge(e) ? 1.38 : 1.16;
      if (hasPassive('executioner') && e.hp < e.maxHp * 0.45) tunedForce *= 1.28;
      const stealthMult = rogueAssassinateMultiplier(e, hx, hy);
      if (stealthMult > 1) {
        const sx = hx == null ? e.x : hx, sy = hy == null ? e.y - 44 : hy;
        tunedForce *= stealthMult;
        e.smokeBlind = Math.max(e.smokeBlind || 0, stealthMult > 1.4 ? 840 : 560);
        e.smokeBlindMax = Math.max(e.smokeBlindMax || 0, e.smokeBlind);
        burst(sx, sy, '#cfe0f6', 12, 2.8);
        burst(sx, sy, '#9cff5e', 8, 2.3);
      }
      if (hasPassive('ln_ironstance') && player.grounded && Math.abs(player.vx) < 0.35) tunedForce *= 1.32;
    }
    const k = clamp(tunedForce * (blocked ? 0.32 : 1), 4, 44);
    if (blocked) { e.shieldFlash = 180; burst(hx, hy, e.cls.color, 10, 2.2); addShake(1.4, 70); }
    e.vx += (nx || 0) * k * 0.55;
    e.vy = Math.min(e.vy + (ny || 0) * k * 0.25, -1.0 - k * 0.05);
    e.grounded = false; e.anim.squash = -0.3; e.flash = 180;
    e.brain.stagger = Math.max(e.brain.stagger, 200); e.brain.alert = 2200; e.brain.retreat = 0;
    e.hp -= blocked ? Math.max(0.15, k / 34) : Math.max(0.6, k / 14);
    burst(hx, hy, '#ffd089', Math.min(16, 6 + (k | 0)), 4); burst(hx, hy, '#d9534f', 7, 3);
    freeze = Math.max(freeze, Math.min(14, 5 + k * 0.22));
    if (e.hp <= 0) killFighter(e, nx || 0, ny || 0, k, hx, hy);
  }
  function fighterDeathGroundY(e) {
    const surface = surfaceYFor(e, e.x, 760, 180);
    if (surface !== null) return surface;
    const L = levels[li];
    let y = Infinity;
    for (const p of L.platforms) if (e.x > p.x - 18 && e.x < p.x + p.w + 18 && p.y >= e.y - 80) y = Math.min(y, p.y);
    return y === Infinity ? Math.min(L.h - 8, e.y + 180) : y;
  }
  function killFighter(e, nx, ny, force, hx, hy) {
    if (e.dead) return;
    e.dead = true;
    const groundY = fighterDeathGroundY(e);
    const d = makeDummy(e.x, e.y, { kind: e.team === 'enemy' ? 'enemy' : 'ally', hp: 0 });
    d.baseY = groundY; d.homeY = groundY;
    d.defeated = true; d.flash = 650; d.attackCd = 9999;
    for (const f of ['footL', 'footR']) d.pts[f].pin = false;
    for (const key in d.pts) {
      const p = d.pts[key];
      const spill = key === 'head' || key === 'handL' || key === 'handR' || key === 'footL' || key === 'footR' ? 1 : 0.45;
      p.x += rand(-2.4, 2.4) * spill;
      p.y += rand(-1.6, 1.6) * spill;
      p.px = p.x - e.vx - nx * rand(0.2, 0.9) * spill;
      p.py = p.y - e.vy - ny * rand(0.2, 0.9) * spill;
    }   // inherit momentum and break symmetry so corpses settle into heaps
    const near = dummyNearest(d, hx, hy), k = clamp(force, 4, 44);
    if (near.p) { near.p.x += nx * k * 0.7; near.p.y += ny * k * 0.7 - k * 0.2; }
    d.pts.chest.x += nx * k * 0.45; d.pts.head.x += nx * k * 0.55; d.pts.head.y -= k * 0.25;
    dummies.push(d);
    const list = e.team === 'ally' ? allies : fighters;
    const i = list ? list.indexOf(e) : -1; if (i >= 0) list.splice(i, 1);
    if (arenaMode && e.team === 'enemy') {
      arenaKills++;
      arenaBanner = Math.max(arenaBanner || 0, 420);
      if (hero && mageSpiritLoadoutActive()) {
        spawnSpiritRemnant(e.x, e.y - 44, { groundY, source: e.cls && e.cls.id || 'enemy' });
        grantSpiritCharge(e.x, e.y - 44, 1);
      }
      if (loadout && loadout.passive === 'rg_bloodrush' && hero) {
        cooldownBag(hero)[slotKey('shift')] = 0;
        hero.invuln = Math.max(hero.invuln || 0, 260);
      }
      if (loadout && loadout.passive === 'rn_hunter' && hero) {
        hero.hunterHaste = 2200;
        cooldownBag(hero).arrow = 0;
        cooldownBag(hero).volley = 0;
      }
      if (loadout && loadout.passive === 'rn_packbond' && hero && allies && allies.length < 4) {
        const a = makeFighter('rogue', e.x, fighterDeathGroundY(e), { team: 'ally', hp: 2, min: hero.x - 180, max: hero.x + 520, facing: hero.facing });
        a.brain.alert = 9999; a.brain.party = true; allies.push(a);
      }
      syncHud();
    }
    burst(hx, hy, '#ff5a5a', 26, 5.2); addShake(4.5, 150);
  }
  // an enemy attack lands on the hero: knock them back with brief i-frames
  function hurtHero(nx, ny, force, hx, hy) {
    if (!hero || (hero.invuln && hero.invuln > 0)) return;
    const blocked = shieldBlocks(hero, nx);
    const guardMul = blocked && loadout && loadout.passive === 'kn_bulwark' ? 0.18 : 0.30;
    const k = clamp(force * (blocked ? guardMul : 1), 4, 40), dir = (nx || 0) >= 0 ? 1 : -1;
    hero.invuln = blocked ? 240 : 640;
    if (blocked) { hero.shieldFlash = 180; burst(hx == null ? hero.x : hx, hy == null ? hero.y - 34 : hy, hero.cls.color, 12, 2.4); addShake(1.6, 80); }
    const sec = equipped('secondary');
    if (blocked && (hasPassive('kn_vengeance') || sec && sec.id === 'kn_counterguard')) hero.venge = Math.min(90, (hero.venge || 0) + k * (sec && sec.id === 'kn_counterguard' ? 1.35 : 1));
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
  function mageHoverSurface() {
    return hoverSurfaceY(player.x, MAGE_HOVER_HEIGHT + 150, MAGE_HOVER_STEP);
  }
  function smoothHoverTarget(surface, dtStep) {
    if (surface === null) { player.hoverTargetY = null; return null; }
    const target = surface - MAGE_HOVER_HEIGHT;
    const blend = 1 - Math.pow(0.015, (dtStep || STEP) / 1000);
    player.hoverTargetY = player.hoverTargetY == null ? target : lerp(player.hoverTargetY, target, blend);
    return player.hoverTargetY;
  }
  function updateMageHoverVelocity(dtStep) {
    const surface = mageHoverSurface();
    player.vy = Math.min(player.vy + GRA * 0.12, TERMINAL * 0.38);
    const targetY = smoothHoverTarget(surface, dtStep);
    if (targetY !== null) {
      player.vy += clamp((targetY - player.y) * 0.048, -0.82, 0.54);
      if (player.y > targetY - 2 && player.vy > 0) player.vy *= 0.52;
    } else {
      player.vy += clamp((-0.08 - player.vy) * 0.050, -0.20, 0.16);
    }
    player.vy = clamp(player.vy, -3.8, 3.1);
  }
  function settleMageHover() {
    const targetY = smoothHoverTarget(mageHoverSurface(), STEP);
    if (targetY !== null) {
      if (player.y > targetY + 2) { player.y = lerp(player.y, targetY, 0.22); player.vy = Math.min(player.vy, 0); }
      player.grounded = false;
      player.coyote = COYOTE;
    }
  }
  function mageHoverStepOver(solid) {
    return false;
  }
  function spawnDroppedKnife(x, y, angle, vx, vy) {
    droppedKnives.push({ x, y, vx: (vx || 0) * 0.12, vy: (vy || 0) * 0.12, angle, grounded: false, life: 9000, age: 0 });
  }
  function updateDroppedKnives(dt) {
    const L = levels[li];
    for (let i = droppedKnives.length - 1; i >= 0; i--) {
      const k = droppedKnives[i];
      k.age = (k.age || 0) + dt;
      k.life -= dt;
      if (!k.grounded) {
        k.vy = Math.min(k.vy + 0.45, 12);
        k.x += k.vx; k.y += k.vy;
        k.vx *= 0.98;
        for (const p of L.platforms) if (k.x > p.x && k.x < p.x + p.w && k.y > p.y - 3 && k.y < p.y + p.h) {
          k.y = p.y - 3; k.vx = k.vy = 0; k.grounded = true;
        }
      }
      const recoverable = k.grounded && cls.id === 'rogue' && player.knifeAmmo < ROGUE_MAX_KNIVES;
      if (recoverable) {
        const dx = player.x - k.x, dy = (player.y - 25) - k.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 92) {
          const pull = (1 - dist / 92) * 0.72;
          k.x += dx / dist * pull; k.y += dy / dist * pull;
          if (Math.random() < 0.22) particles.push({ x: k.x + rand(-3, 3), y: k.y + rand(-3, 3),
            vx: dx / dist * rand(0.18, 0.42), vy: dy / dist * rand(0.18, 0.42), life: rand(120, 220), max: 220, color: '#cfd6df', r: rand(1, 2.2) });
        }
      }
      if (recoverable && Math.hypot(k.x - player.x, k.y - (player.y - 25)) < 30) {
        player.knifeAmmo++;
        player.knifeRegen = 0;
        burst(k.x, k.y, '#cfd6df', 12, 2.8);
        burst(k.x, k.y, cls.color, 6, 2.1);
        syncHud();
        droppedKnives.splice(i, 1);
      } else if (k.life <= 0) droppedKnives.splice(i, 1);
    }
  }
  function updateRogueAmmo(dtStep) {
    if (cls.id !== 'rogue') return;
    if (player.knifeAmmo >= ROGUE_MAX_KNIVES) { player.knifeRegen = 0; return; }
    player.knifeRegen += dtStep || STEP;
    while (player.knifeRegen >= ROGUE_REGEN && player.knifeAmmo < ROGUE_MAX_KNIVES) {
      player.knifeRegen -= ROGUE_REGEN;
      player.knifeAmmo++;
      burst(player.x, player.y - 32, '#cfd6df', 5, 1.8);
    }
  }
  function updateRogueBurst(dtStep) {
    if (cls.id !== 'rogue') return;
    if (player.rogueBurst >= ROGUE_BURST_MAX) { player.rogueBurstRegen = 0; return; }
    player.rogueBurstRegen += dtStep || STEP;
    while (player.rogueBurstRegen >= ROGUE_BURST_REGEN && player.rogueBurst < ROGUE_BURST_MAX) {
      player.rogueBurstRegen -= ROGUE_BURST_REGEN;
      player.rogueBurst++;
      if (player.team !== 'enemy') burst(player.x, player.y - 42, cls.color, 5, 1.5);
    }
  }
  function updateRangerAmmo(dtStep) {
    if (cls.id !== 'ranger') return;
    if (player.arrowAmmo >= RANGER_MAX_ARROWS) { player.arrowRegen = 0; return; }
    player.arrowRegen += dtStep || STEP;
    while (player.arrowRegen >= RANGER_REGEN && player.arrowAmmo < RANGER_MAX_ARROWS) {
      player.arrowRegen -= RANGER_REGEN;
      player.arrowAmmo++;
      burst(player.x - player.facing * 10, player.y - 44, cls.color, 4, 1.4);
    }
  }
  function updateGravityDebris(dtStep) {
    if (cls.id !== 'mage') return;
    if (!mageGraviturgeLoadoutActive()) {
      if (player.team === 'hero') {
        player.gravityDebris = 0;
        player.gravityDebrisRegen = 0;
      }
      return;
    }
    const max = gravityDebrisMax();
    if (player.gravityDebris == null) player.gravityDebris = max;
    player.gravityDebris = clamp(player.gravityDebris, 0, max);
    player.gravityDebrisSpin = (player.gravityDebrisSpin || 0) + (dtStep || STEP) * 0.0042;
    if (player.gravityDebris >= max) player.gravityDebrisRegen = 0;
    else {
      player.gravityDebrisRegen = (player.gravityDebrisRegen || 0) + (dtStep || STEP);
      while (player.gravityDebrisRegen >= MAGE_DEBRIS_REGEN && player.gravityDebris < max) {
        player.gravityDebrisRegen -= MAGE_DEBRIS_REGEN;
        player.gravityDebris++;
        if (player.team !== 'enemy') burst(player.x, player.y - 68, '#8f7dff', 5, 1.8);
      }
    }
    const count = clamp(player.gravityDebris || 0, 0, max);
    if (count > 0 && Math.random() < 0.16) gravityParticle(player.x + rand(-28, 28), player.y - rand(42, 92), rand(-0.22, 0.22), rand(-0.38, 0.08), {
      life: rand(220, 420),
      color: Math.random() < 0.42 ? '#d9d4ff' : '#8f7dff',
      r: rand(1.0, 2.3),
    });
    if (player.team !== 'enemy' && boxes && (mageHovering() || count >= max)) {
      for (const b of boxes) {
        if (!b || b.dead) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const dx = player.x - cx, dy = (player.y - 48) - cy, d = Math.hypot(dx, dy) || 1;
        if (d > 168) continue;
        const u = (1 - d / 168) * (0.35 + count * 0.12);
        b.vx += (dx / d) * 0.015 * u;
        b.vy += (dy / d) * 0.010 * u - 0.018 * u;
        b.va += (dx / d) * 0.006 * u;
      }
    }
  }
  function updateActorResources(dtStep) {
    const cds = cooldownBag(player);
    for (const k in cds) {
      cds[k] = Math.max(0, (cds[k] || 0) - dtStep);
      if (cds[k] <= 0) delete cds[k];
    }
    syncLegacyCooldowns(player);
    player.shieldGuard = Math.max(0, (player.shieldGuard || 0) - dtStep);
    player.shieldFlash = Math.max(0, (player.shieldFlash || 0) - dtStep);
    player.hunterHaste = Math.max(0, (player.hunterHaste || 0) - dtStep);
    player.hidden = Math.max(0, (player.hidden || 0) - dtStep);
    player.poisoned = Math.max(0, (player.poisoned || 0) - dtStep);
    player.burned = Math.max(0, (player.burned || 0) - dtStep);
    if (player.burned <= 0) player.burnedMax = 0;
    player.smokeBlind = Math.max(0, (player.smokeBlind || 0) - dtStep);
    if (player.smokeBlind <= 0) player.smokeBlindMax = 0;
    if ((player.poisoned || 0) > 0) {
      player.poisonTick = Math.max(0, (player.poisonTick || 0) - dtStep);
      if (Math.random() < 0.10) particles.push({
        x: player.x + rand(-14, 14),
        y: player.y - rand(16, 62),
        vx: rand(-0.35, 0.35),
        vy: rand(-0.45, 0.05),
        life: rand(180, 320),
        max: 320,
        color: '#9cff5e',
        r: rand(1.1, 2.5),
      });
      if (player.team === 'enemy' && player.poisonTick <= 0) {
        player.poisonTick = 460;
        hurtFighter(player, 0, -0.1, 4, player.x, player.y - 44);
      }
    }
    if ((player.burned || 0) > 0) {
      player.burnTick = Math.max(0, (player.burnTick || 0) - dtStep);
      if (Math.random() < 0.14) particles.push({
        x: player.x + rand(-14, 14),
        y: player.y - rand(18, 70),
        vx: rand(-0.42, 0.42),
        vy: rand(-1.15, -0.18),
        life: rand(170, 340),
        max: 340,
        color: Math.random() < 0.45 ? '#ffd45e' : '#ff6b32',
        r: rand(1.2, 3.0),
      });
      if (player.team === 'enemy' && player.burnTick <= 0) {
        player.burnTick = 520;
        hurtFighter(player, 0, -0.12, 4.0, player.x, player.y - 44);
      }
    }
    if ((player.hidden || 0) > 0 && Math.random() < 0.18) {
      particles.push({
        x: player.x + rand(-18, 18),
        y: player.y - rand(12, 68),
        vx: rand(-0.45, 0.45),
        vy: rand(-0.55, 0.10),
        life: rand(180, 360),
        max: 360,
        color: '#cfe0f6',
        r: rand(1.4, 3.2),
      });
    }
    if ((player.shieldGuard || 0) > 0 && Math.random() < 0.12) {
      particles.push({
        x: player.x + player.facing * rand(17, 34),
        y: player.y - rand(24, 66),
        vx: player.facing * rand(0.12, 0.48),
        vy: rand(-0.55, 0.10),
        life: rand(180, 340),
        max: 340,
        color: Math.random() < 0.5 ? '#dcecff' : cls.color,
        r: rand(1.2, 2.6),
      });
    }
    if (player.draw) player.draw.reload = Math.max(0, (player.draw.reload || 0) - dtStep);
    if (player.draw && player.draw.active) {
      player.draw.t = Math.min(RANGER_DRAW_MAX, player.draw.t + dtStep);
      if (player.team === 'hero') player.draw.aim = aimedAngle();
      player.anim.aimTarget = player.draw.aim;
      player.facing = Math.cos(player.draw.aim) >= 0 ? 1 : -1;
    }
    updateRogueAmmo(dtStep);
    updateRogueBurst(dtStep);
    updateRangerAmmo(dtStep);
    updateGravityDebris(dtStep);
    syncHud();
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
    const it = player && player.intent;
    if (cls.id !== 'mage' || !mageGraviturgeLoadoutActive() || !it || !it.jumpHeld) return false;
    return player.team === 'enemy' || (it.jumpHold || 0) >= MAGE_HOVER_DELAY;
  }
  function tickJumpHold(act, dtStep) {
    const it = act && act.intent;
    if (!it) return;
    it.jumpHold = it.jumpHeld ? (it.jumpHold || 0) + (dtStep || STEP) : 0;
  }
  function maxV() {
    let m = MAXV * cls.speedMul;
    if (player && player.hunterHaste > 0) m *= 1.22;
    if (mageHovering()) m *= 0.68;
    if (activeMove('airDash')) m = Math.max(m, 8.6);
    if (activeMove('slide')) m = Math.max(m, 8.0);
    if (activeMove('shoulder')) m = Math.max(m, 7.2);
    if (activeMove('backstep')) m = Math.max(m, 6.8);
    if (player && actorPosture(player).down > 0) m *= 0.45;
    if (lancerAttackLocked()) m = player.anim.atkType === 'lanceCharge' ? Math.max(m, 10.8) : Math.min(m, 1.15);
    return m;
  }
  function updateClassMove() {
    const m = player.move;
    if (!m.active) return;
    m.t += STEP / m.dur;
    const t = clamp(m.t, 0, 1), bell = Math.sin(t * Math.PI);
    m.phase = timelinePhase(m.spec || DEFAULT_MOTION, t);
    if (m.type === 'slide') {
      player.vx = player.facing * (7.4 + 2.2 * (1 - t));
      player.vy = Math.min(player.vy, 1.5);
      if (Math.random() < 0.42) {
        particles.push({ x: player.x - player.facing * rand(16, 34), y: player.y - rand(2, 9),
          vx: -player.facing * rand(0.4, 1.6), vy: rand(-0.25, 0.35), life: rand(130, 260), max: 260, color: '#cfc6b6', r: rand(1.0, 2.4) });
      }
      if (!m.struck && t > 0.32) {
        m.struck = true;
        const b = actorBox(player), y = b.y + b.h - 7;
        hitBoxesSegment(player.x + player.facing * 4, y, player.x + player.facing * 82, y - 4, player.facing, -0.42, 16, 14);
        burst(player.x + player.facing * 38, y, cls.color, 12, 3.4);
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
    grantRogueFlipFlow(player);
    if (player.flip.t - (player.flip.lastTrail || -1) > 0.085) {
      player.flip.lastTrail = player.flip.t;
      slashTrail.push({
        x: player.x - player.flip.dir * (16 + Math.sin(player.flip.t * Math.PI) * 24),
        y: player.y - 48 - Math.sin(player.flip.t * Math.PI) * 18,
        life: 190,
        c: cls.trail,
      });
      if (slashTrail.length > 46) slashTrail.shift();
    }
    if (Math.random() < 0.38) particles.push({
      x: player.x - player.flip.dir * rand(8, 28),
      y: player.y - rand(38, 72),
      vx: -player.flip.dir * rand(0.35, 1.25),
      vy: rand(-0.45, 0.25),
      life: rand(130, 260),
      max: 260,
      color: cls.color,
      r: rand(0.8, 1.8),
    });
    if (player.flip.t >= 1) player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
  }
  function updateAttackMotion() {
    const a = player.anim;
    if (!a.atkActive || a.atkType !== 'lanceCharge') return;
    const t = clamp(a.atkT, 0, 1);
    const dir = Math.cos(a.atkAim) >= 0 ? 1 : -1;
    player.facing = dir;
    if (t < 0.18) player.vx *= 0.18;
    else if (t < 0.90) {
      const drive = ease(clamp((t - 0.18) / 0.14, 0, 1)) * (1 - ease(clamp((t - 0.78) / 0.12, 0, 1)) * 0.18);
      player.vx = dir * (6.4 + drive * 4.1);
    } else player.vx *= 0.54;
    if (t < 0.90) {
      if (Math.random() < 0.28) particles.push({ x: player.x - player.facing * rand(12, 28), y: player.y - rand(8, 34),
        vx: -player.facing * rand(0.3, 1.0), vy: rand(-0.25, 0.45), life: rand(120, 240), max: 240, color: cls.color, r: rand(1, 2.3) });
    }
  }

  function physics() {
    const L = levels[li];
    const acc = player.grounded ? RUN_ACC : AIR_ACC;
    const locked = lancerAttackLocked();
    tickJumpHold(player, STEP);
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
      updateMageHoverVelocity(STEP);
    } else {
      player.hoverTargetY = null;
      // jump (buffered + coyote)
      if (jumpBuf > 0 && (player.grounded || player.coyote > 0)) {
        player.vy = JUMP; player.grounded = false; player.coyote = 0; jumpBuf = 0; player.jumpCut = false;
        player.anim.squash = -0.5;            // stretch on takeoff
      }
      if (jumpBuf > 0) jumpBuf--;
      if (!input.jumpHeld && player.vy < 0 && !player.jumpCut) { player.vy *= CUT; player.jumpCut = true; }  // variable height
      player.vy = Math.min(player.vy + GRA * g, TERMINAL * g);
    }
    updateActorResources(STEP);

    updateBoxes();   // crates move under their own physics each step
    updateDummies(STEP);
    updateGravityFields(STEP);
    updateGravityCore(STEP);
    updateFireZones(STEP);
    updateFlameBreaths(STEP);
    updateAbilityMarkers(STEP);

    // integrate + collide (x then y) — against terrain, then crates
    player.x += player.vx;
    for (const p of L.platforms) if (!isOneWay(p) && hit(box(), p)) {
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
    const prevPlayerFeetY = player.y;
    player.y += player.vy;
    player.grounded = false;
    for (const p of L.platforms) if (hit(box(), p)) {
      if (isOneWay(p)) {
        if (canActorLandOnOneWay(player, p, prevPlayerFeetY)) {
          if (player.vy > 6) player.anim.squash = clamp(player.vy / TERMINAL, 0, 1) * 0.9;
          player.y = p.y; player.grounded = true; player.vy = 0;
        }
        continue;
      }
      if (player.vy > 0) { player.y = p.y; player.grounded = true; }
      else if (player.vy < 0) player.y = p.y + p.h + actorHeight(player);
      if (player.vy > 6) player.anim.squash = clamp(player.vy / TERMINAL, 0, 1) * 0.9; // squash on impact
      player.vy = 0;
    }
    for (const b of boxes) if (hit(box(), b)) {           // stand on / bonk crates
      if (player.vy > 0 && (player.y - player.vy) <= b.y + 8) { player.y = b.y; player.grounded = true; player.vy = 0; }
      else if (player.vy < 0 && (player.y - actorHeight(player) - player.vy) >= b.y + b.h - 8) { player.y = b.y + b.h + actorHeight(player); player.vy = 0; b.vy += 1; }
    }
    if (cls.fly && mageHovering()) settleMageHover();
    if (player.grounded) {
      player.coyote = COYOTE; player.jumpCut = false; player.airTime = 0; player.rogueAirJump = false;
      if (player.flip && player.flip.active) player.flip = { active: false, t: 0, dur: 0, dir: player.facing };
    }
    else { if (player.coyote > 0) player.coyote--; player.airTime++; }

    if (!arenaMode) {
      // legacy/classic pickup and flag objective
      for (const c of coinsLeft) if (!c.got && coinTouchesPlayer(c)) {
        c.got = true; burst(c.x, c.y, '#ffd45e', 12, 3.5); syncHud();
      }
      if (L.flag && Math.abs(player.x - L.flag.x) < 26 && Math.abs((player.y) - L.flag.y) < 90) { nextLevel(); return; }
    }

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
    player.queuedAttack = null;
    player.queuedFlash = null;
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
    if (cls.id === 'mage' && moveAmt < 0.12 && !a.atkActive && Math.random() < dt * 0.000075) {
      const pyroIdle = magePyroLoadoutActive();
      particles.push({
        x: player.x + rand(-18, 18),
        y: player.y - rand(mageHovering() ? 44 : 34, mageHovering() ? 86 : 72),
        vx: rand(-0.18, 0.18),
        vy: pyroIdle ? rand(-0.38, -0.05) : rand(-0.55, -0.08),
        life: pyroIdle ? rand(360, 680) : rand(420, 760),
        max: 760,
        color: pyroIdle ? (Math.random() < 0.58 ? '#ff6b32' : '#ffd45e') : (Math.random() < 0.5 ? '#ff77d2' : '#7ee7ff'),
        r: pyroIdle ? rand(0.9, 2.0) : rand(1.1, 2.4),
      });
    }
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
      if (a.atkT >= 1) {
        a.atkActive = false; a.atkT = 0; a.atkPhase = 'idle'; a.action = null;
        a.visualOnly = false; a.visualKind = null;
        consumeQueuedRogueAttack();
      }
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
    if (player.anim && player.anim.visualOnly) return;
    const atkNode = equipped('attack'), secNode = equipped('secondary');
    const vengeanceReady = byHero && player.venge > 0 && type !== 'shieldGuard' &&
      (hasPassive('kn_vengeance') || atkNode && atkNode.id === 'kn_riposte' || secNode && secNode.id === 'kn_counterguard');
    if (vengeanceReady) {
      const pow = clamp(player.venge, 8, 80);
      pushBoxesRadial(player.x + player.facing * 24, player.y - 42, 12 + pow * 0.28, 96 + pow, player.team);
      burst(player.x + player.facing * 32, player.y - 46, cls.color, 26, 4.8);
      burst(player.x + player.facing * 32, player.y - 46, '#ffffff', 12, 3.2);
      addShake(3.8 + pow * 0.025, 140);
      player.venge = 0;
    }
    if (byHero && hasPassive('mg_overcharge') && (type === 'cast' || type === 'arcaneBloom')) {
      player.spellCount = (player.spellCount || 0) + 1;
      if (player.spellCount % 4 === 0) chainLightning(ang, 3);
    }
    if (type === 'shieldGuard') { activateShieldGuard(); return; }
    if (type === 'cast') { spawnBolt(ang, 1.4); return; }
    if (type === 'arcaneBloom') { spawnGravitySeed(ang); return; }
    if (type === 'throw') {
      const ricochet = hasPassive('rg_trapmaster') || atkNode && atkNode.id === 'rg_ricochet' || secNode && secNode.id === 'rg_ricochet';
      spawnDagger(ang, { bounce: ricochet ? 1 : 0, hit: ricochet ? 15 : 14 });
      return;
    }
    if (type === 'arrow') { spawnArrow(ang, player.anim.drawPower || 1); return; }
    if (type === 'volley') { const p = player.anim.drawPower || 1; for (const d of [-0.13, 0, 0.13]) spawnArrow(ang + d, 0.84 * p); return; }
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
    if (byHero && hasPassive('kn_aftershock') && (heavy || type === 'crush' || type === 'quake')) {
      pushBoxesRadial(seg.bx, seg.by, 15, 92, player.team);
      burst(seg.bx, seg.by, '#ffd45e', 14, 3.4);
    }
  }
  function pyroBodyOffset(type, t, f) {
    const bell = Math.max(0, Math.sin(clamp(t, 0, 1) * Math.PI));
    if (type === 'pyroFirebolt') {
      const snap = ease(clamp(t / 0.22, 0, 1));
      return { x: f * (snap * 7 - bell * 1.5), y: -bell * 1.5, lean: f * (0.04 + snap * 0.10 - bell * 0.03) };
    }
    if (type === 'pyroIgnite') {
      const coil = ease(clamp(t / 0.28, 0, 1));
      const release = ease(clamp((t - 0.28) / 0.18, 0, 1));
      return { x: f * (-5 * coil + 13 * release), y: -5 * coil + 2 * release, lean: -f * 0.18 * coil + f * 0.28 * release };
    }
    if (type === 'pyroBreath') {
      const brace = ease(clamp(t / 0.20, 0, 1));
      return { x: f * (5 * brace - 2), y: 1.0 * brace, lean: f * (0.06 + 0.08 * brace + bell * 0.012) };
    }
    if (type === 'pyroDragon') {
      const brace = ease(clamp(t / 0.16, 0, 1));
      const rumble = Math.sin(t * Math.PI * 12) * 0.014;
      return { x: f * (10 * brace - 6), y: 2.2 * brace, lean: f * (0.12 + 0.12 * brace + rumble) };
    }
    if (type === 'pyroGroundFlow') {
      const pour = ease(clamp(t / 0.26, 0, 1));
      return { x: f * (4 + 5 * pour), y: 5 * pour, lean: f * (0.08 + 0.07 * pour) };
    }
    return { x: 0, y: 0, lean: 0 };
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
    if (type === 'shieldGuard') return { x: -f * bell * 2, y: bell * 2, lean: -f * (0.06 + bell * 0.10) };
    if (type === 'cast' || type === 'arcaneBloom') return { x: f * bell * 3, y: 0, lean: f * bell * 0.05 };
    if (isPyroVisualAttack(type)) return pyroBodyOffset(type, t, f);
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
      const back = type === 'braceThrust' ? -24 : -10;
      const reach = WLEN.lance + (type === 'lanceCharge' ? 16 : 6);
      const sx = ch.hx + Math.cos(lineAng) * back, sy = ch.hy + Math.sin(lineAng) * back;
      const tx = ch.hx + Math.cos(lineAng) * reach, ty = ch.hy + Math.sin(lineAng) * reach;
      const force = type === 'lanceCharge' ? 44 : 28;
      return { ax: sx, ay: sy, bx: tx, by: ty, dx: Math.cos(lineAng), dy: Math.sin(lineAng), force, r: type === 'lanceCharge' ? 12 : 11 };
    }
    const bx = ch.hx + Math.cos(bladeAng) * wl, by = ch.hy + Math.sin(bladeAng) * wl;
    let ax = ch.hx, ay = ch.hy;
    if (cls.weapon === 'lance') {
      const start = type === 'lanceSwing' ? -10 : 24;
      ax = ch.hx + Math.cos(bladeAng) * start;
      ay = ch.hy + Math.sin(bladeAng) * start;
    }
    const FORCE = { lanceSwing: 26, lanceCharge: 44, braceThrust: 28, rogueStab: 15, crush: 30, staffSweep: 17, stab: 18, lunge: 18 };
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
    let impact = null;
    const targetBest = new Map();
    for (const tt of ts) {
      const s = meleeSegment(type, ang, clamp(tt, 0, 1));
      if (!impact || Math.abs(tt - sp) < 0.001) impact = s;
      rememberDebugSegment('weapon', s.ax, s.ay, s.bx, s.by, s.r, '#ff405f', 260);
      for (const b of boxes) {
        if (crateSeen.has(b)) continue;
        if (segAabbDist(s.ax, s.ay, s.bx, s.by, b) <= s.r) { pushBox(b, s.dx, s.dy, s.force); crateSeen.add(b); }
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
      } else {
        for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t)) {
          const h = segHitActor(s.ax, s.ay, s.bx, s.by, s.r, t);
          if (h) {
            const dd = Math.hypot(h.x - t.x, h.y - (t.y - 44));
            const cur = targetBest.get(t);
            if (!cur || dd < cur.dd) targetBest.set(t, { dd, h, nx: s.dx, ny: s.dy, force: s.force });
          }
        }
      }
    }
    if (byHero) {
      for (const [d, h] of dBest) hurtDummy(d, h.nx, h.ny, h.force, h.p.x, h.p.y);
      for (const [e, h] of fBest) hurtFighter(e, h.nx, h.ny, h.force, h.h.x, h.h.y);
    } else {
      for (const [t, h] of targetBest) hurtEnemyTarget(t, h.nx, h.ny, h.force, h.h.x, h.h.y);
    }
    return impact;
  }
  // a fast, punchy magic bolt (size = power)
  function spawnBolt(ang, power, opts) {
    opts = opts || {};
    const shX = player.x, shY = player.y - 77, spd = 24;
    const mx = shX + Math.cos(ang) * 46, my = shY + Math.sin(ang) * 46;
    projectiles.push({ kind: 'bolt', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1020, color: cls.color, r: 9.5 * power, hit: 14 * power, sparkle: 3, bounce: opts.bounce || 0, portal: opts.portal || 0, wind: opts.wind || 0 });
    burst(mx, my, '#ffffff', 18, 5.2); burst(mx, my, cls.color, 26, 4.6);
  }
  function spendGravityDebris() {
    if (!player || cls.id !== 'mage' || !mageGraviturgeLoadoutActive()) return false;
    if ((player.gravityDebris || 0) <= 0) return false;
    player.gravityDebris--;
    player.gravityDebrisRegen = 0;
    if (player.team === 'hero') syncHud();
    return true;
  }
  function gravityStaffOrigin(ang) {
    const shX = player.x, shY = player.y - 76;
    return { x: shX + Math.cos(ang) * 42, y: shY + Math.sin(ang) * 34 };
  }
  function gravityParticle(x, y, vx, vy, opts) {
    opts = opts || {};
    particles.push({
      kind: 'gravity',
      x, y, vx, vy,
      life: opts.life || rand(220, 460),
      max: opts.max || opts.life || 460,
      color: opts.color || (Math.random() < 0.38 ? '#d9d4ff' : '#8f7dff'),
      r: opts.r || rand(1.0, 2.8),
      seed: opts.seed || rand(0, Math.PI * 2),
    });
  }
  function spawnGravityDebrisShot(ang, opts) {
    opts = opts || {};
    const spent = spendGravityDebris();
    const fromCore = opts.orbit && gravityCore;
    const aim = aimedPoint(opts.range || 560);
    let origin = gravityStaffOrigin(ang);
    if (fromCore) {
      const coreAng = Math.atan2(aim.y - gravityCore.y, aim.x - gravityCore.x);
      origin = { x: gravityCore.x + Math.cos(coreAng) * 22, y: gravityCore.y + Math.sin(coreAng) * 22 };
      ang = coreAng;
      chargeGravityCore(opts.core || 0.45, player.x, player.y - 70);
      if (opts.shoveCore) {
        gravityCore.vx += Math.cos(ang) * 0.9;
        gravityCore.vy += Math.sin(ang) * 0.50;
      }
    }
    const power = (opts.power || 1) * (spent ? 1.22 : 0.78);
    const spd = 22 + power * 3.8;
    const r = 8 + power * 4.2;
    projectiles.push({
      kind: 'gravityDebris',
      team: player.team,
      x: origin.x,
      y: origin.y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 1160,
      color: cls.color,
      r,
      hit: 15 + power * 8,
      angle: ang,
      spin: rand(-0.18, 0.18),
      gravity: true,
      heavy: spent,
      mass: power,
      sparkle: 2,
    });
    if (!fromCore) rememberDebugSegment('ability', player.x, player.y - 70, origin.x, origin.y, 8, cls.color, 260);
    for (let i = 0; i < (spent ? 18 : 11); i++) {
      const a = ang + Math.PI + rand(-0.62, 0.62);
      gravityParticle(origin.x + rand(-4, 4), origin.y + rand(-4, 4), Math.cos(a) * rand(0.45, 1.7), Math.sin(a) * rand(0.45, 1.7), {
        color: Math.random() < 0.5 ? '#d9d4ff' : cls.color,
        life: rand(180, 360),
        r: rand(1.0, spent ? 3.0 : 2.2),
      });
    }
    burst(origin.x, origin.y, spent ? '#d9d4ff' : cls.color, spent ? 13 : 8, spent ? 3.2 : 2.4);
  }
  function gravityDebrisImpact(x, y, team, color, hit, opts) {
    opts = opts || {};
    const heavy = !!opts.heavy;
    const radius = heavy ? 112 : 82;
    const force = heavy ? 17 : 11;
    burst(x, y, '#d9d4ff', heavy ? 18 : 10, heavy ? 4.2 : 3.1);
    burst(x, y, color || '#8f7dff', heavy ? 26 : 16, heavy ? 4.8 : 3.8);
    spawnShockwaveRing(x, y, radius, color || '#8f7dff', { life: heavy ? 330 : 240, width: heavy ? 4.2 : 3.1, fill: heavy ? 0.09 : 0.05, rough: heavy ? 0.070 : 0.055 });
    radialActorPulse(x, y, radius, force, team, color || '#8f7dff');
    pushBoxesRadial(x, y, heavy ? 20 : 13, radius, team);
    for (let i = 0; i < (heavy ? 24 : 14); i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.5, heavy ? 3.2 : 2.3);
      gravityParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp - rand(0.2, 1.1), {
        color: Math.random() < 0.30 ? '#ffffff' : color || '#8f7dff',
        life: rand(200, 520),
        r: rand(1.0, heavy ? 3.4 : 2.5),
      });
    }
    if (heavy) addShake(3.7, 110);
  }
  function smokeBombOrigin(ang) {
    const shX = player.x + player.facing * 9;
    const shY = player.y - 88;
    return { x: shX + Math.cos(ang) * 24, y: shY + Math.sin(ang) * 12 };
  }
  function spawnSmokeBombProjectile(ang, effect) {
    effect = effect || {};
    const poison = !!effect.poison;
    const maxRange = effect.range || (poison ? 520 : 440);
    const aim = aimedPoint(maxRange);
    const origin = smokeBombOrigin(ang);
    const dx = aim.x - origin.x, dy = aim.y - origin.y;
    const dist = clamp(Math.hypot(dx, dy) || 1, 86, maxRange);
    const throwAng = Math.atan2(dy, dx);
    if (!startVisualAttack('throw', throwAng, { kind: poison ? 'poisonBomb' : 'smokeBomb', range: dist })) return false;
    const spd = poison ? 16.0 : 17.4;
    const lift = clamp(dist / maxRange, 0.18, 1.05);
    projectiles.push({
      kind: 'smokeBomb',
      team: player.team,
      x: origin.x,
      y: origin.y,
      vx: Math.cos(throwAng) * spd,
      vy: Math.sin(throwAng) * spd - (1.1 + lift * 1.65),
      life: poison ? 1160 : 980,
      color: poison ? '#9cff5e' : '#cfe0f6',
      r: poison ? 11 : 9,
      hit: 0,
      angle: throwAng,
      spin: poison ? 0.16 : 0.20,
      range: dist,
      traveled: 0,
      poison,
      smokeRadius: effect.r || (poison ? 218 : 154),
      smokeLife: (effect.life || (poison ? 3000 : 1900)) + (hasPassive('rg_nightshade') ? 520 : 0),
      hiddenBoost: poison ? 300 : 210,
    });
    player.hidden = Math.max(player.hidden || 0, hasPassive('rg_nightshade') ? 620 : 340);
    emitSmokePuff(origin.x - Math.cos(throwAng) * 6, origin.y + 2, throwAng + Math.PI, poison ? 10 : 8, {
      color: smokeCloudColor(poison, false),
      speed: poison ? 1.5 : 1.35,
      life: poison ? 980 : 780,
      r: poison ? 8.2 : 9.5,
      alpha: poison ? 0.34 : 0.28,
      spread: 0.72,
    });
    burst(origin.x, origin.y, poison ? '#9cff5e' : '#d8e4f0', poison ? 8 : 6, 1.8);
    addShake(0.75, 70);
    return true;
  }
  function detonateSmokeBomb(b) {
    const poison = !!b.poison;
    const r = b.smokeRadius || (poison ? 208 : 148);
    const life = b.smokeLife || (poison ? 2850 : 1800);
    const vx = clamp((b.vx || 0) * 0.030, -0.42, 0.42);
    const vy = clamp((b.vy || 0) * 0.018 - (poison ? 0.02 : 0.08), -0.42, 0.28);
    spawnSmokeZone(b.x, b.y, b.team, {
      r,
      startR: r * 0.24,
      life,
      poison,
      hiddenBoost: b.hiddenBoost || (poison ? 280 : 190),
      vx,
      vy,
      thickness: poison ? 1.36 : 1.18,
    });
    emitSmokeCloudBurst(b.x, b.y, r, poison, {
      count: poison ? 138 : 104,
      force: poison ? 3.15 : 2.55,
      vx,
      vy,
    });
    radialActorPulse(b.x, b.y, r, poison ? 10 : 6, b.team, poison ? '#9cff5e' : '#cfe0f6', { poison: poison ? 2400 : 0 });
    pushBoxesRadial(b.x, b.y, poison ? 12 : 8, r, b.team);
    if (player && (b.team || 'hero') === (player.team || 'hero') && Math.hypot(player.x - b.x, (player.y - 40) - b.y) < r) {
      player.hidden = Math.max(player.hidden || 0, poison ? 1200 : 900);
    }
    burst(b.x, b.y, poison ? '#d7ffba' : '#ffffff', poison ? 18 : 12, poison ? 2.3 : 1.9);
    addShake(poison ? 3.1 : 2.2, 120);
  }
  function useMassSlam(opts) {
    opts = opts || {};
    const p = aimedPoint(opts.range || 380);
    const radius = opts.radius || 154;
    const force = opts.force || 28;
    rememberDebugSegment('ability', player.x, player.y - 68, p.x, p.y, 12, cls.color, 260);
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), rr = rand(0, radius * 0.88);
      gravityParticle(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr * 0.55 - rand(12, 42),
        -Math.cos(a) * rand(0.05, 0.5), rand(1.2, 4.0), {
          color: Math.random() < 0.26 ? '#ffffff' : cls.color,
          life: rand(180, 430),
          r: rand(1.2, 3.4),
        });
    }
    const targets = player.team === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
    for (const t of targets.slice()) {
      const dx = t.x - p.x, dy = (t.y - 42) - p.y, d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      const u = 1 - d / radius;
      t.vy += 5.2 * u;
      t.grounded = false;
      if (player.team === 'enemy') hurtEnemyTarget(t, dx / d * 0.28, 0.78, force * u, p.x, p.y);
      else hurtFighter(t, dx / d * 0.28, 0.78, force * u, p.x, p.y);
    }
    if (player.team !== 'enemy' && dummies) for (const d of dummies) {
      for (const k in d.pts) {
        const pt = d.pts[k];
        if (pt.pin) continue;
        const dx = pt.x - p.x, dy = pt.y - p.y, dist = Math.hypot(dx, dy) || 1;
        if (dist > radius) continue;
        const u = 1 - dist / radius;
        pt.y += 15 * u;
        pt.x += (dx / dist) * 5 * u;
      }
      d.flash = Math.max(d.flash || 0, 160);
    }
    for (const b of boxes || []) {
      if (!b || b.dead) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      if (d > radius + 28) continue;
      const u = 1 - Math.min(d, radius) / radius;
      pushBox(b, dx / d * 0.35, 0.95, (force * 0.78 + 8) * u);
      b.va += (dx / d) * 0.10 * u;
    }
    burst(p.x, p.y, '#d9d4ff', 18, 4.0);
    burst(p.x, p.y, cls.color, 32, 5.2);
    spawnShockwaveRing(p.x, p.y, radius, cls.color, { life: 360, width: 5, fill: 0.10, rough: 0.070 });
    addShake(4.8, 145);
    chargeGravityCore(0.85, p.x, p.y);
  }
  // a straight thrown dagger that can be recovered after landing
  function spawnDagger(ang, opts) {
    opts = opts || {};
    const spd = opts.speed != null ? opts.speed : (opts.homing ? 3.2 : 31);
    let mx, my;
    if (opts.x != null && opts.y != null) {
      mx = opts.x; my = opts.y;
    } else {
      const shX = player.x + player.facing * 11, shY = player.y - 96;
      mx = shX + Math.cos(ang) * 22; my = shY + Math.sin(ang) * 10;
    }
    const color = opts.color || (opts.poison ? '#9cff5e' : opts.summoned ? '#f1ffe8' : '#cfd6df');
    projectiles.push({
      kind: 'dagger',
      team: player.team,
      x: mx,
      y: my,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: opts.life || 1450,
      color,
      angle: ang,
      hit: opts.hit || (opts.explosive ? 17 : opts.summoned ? 8.8 : opts.fan ? 13 : 14),
      bounce: opts.bounce || 0,
      explosive: !!opts.explosive,
      poison: !!opts.poison,
      fan: !!opts.fan,
      homing: !!opts.homing,
      summoned: !!opts.summoned,
      noDrop: !!opts.noDrop,
      arm: opts.arm || 0,
      phase: opts.phase || 0,
      stagger: opts.stagger || 0,
      seekSpeed: opts.seekSpeed || (opts.summoned ? 24 : 21),
      seekRange: opts.seekRange || 760,
    });
    if (!opts.quiet) burst(mx, my, opts.summoned ? '#ffffff' : cls.color, opts.summoned ? 5 : 10, opts.summoned ? 1.8 : 2.6);
  }
  function arrowSpeed(power) {
    return 23 + 10 * clamp(power, 0.45, 1.55);
  }
  function arrowOrigin(ang) {
    const shX = player.x, shY = player.y - 72;
    return { x: shX + Math.cos(ang) * 34, y: shY + Math.sin(ang) * 34 };
  }
  function spawnArrow(ang, power, opts) {
    const spd = arrowSpeed(power), o = arrowOrigin(ang), mx = o.x, my = o.y;
    opts = opts || {};
    projectiles.push({ kind: 'arrow', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1280, color: cls.color, angle: ang, hit: 8 + 9 * clamp(power, 0.45, 1.55), pierce: opts.pierce || 0, powerShot: !!opts.powerShot, storm: !!opts.storm, bounce: opts.bounce || 0, pin: opts.pin || 0 });
    burst(mx, my, cls.color, 8, 2.4);
  }
  function activateShieldGuard() {
    player.shieldGuard = Math.max(player.shieldGuard || 0, KNIGHT_SHIELD_TIME);
    player.shieldFlash = Math.max(player.shieldFlash || 0, 180);
    burst(player.x + player.facing * 24, player.y - 42, cls.color, 18, 3.2);
    burst(player.x + player.facing * 28, player.y - 46, '#dcecff', 10, 2.2);
  }
  function spawnGravitySeed(ang) {
    const shX = player.x, shY = player.y - 76, spd = 16.5;
    const mx = shX + Math.cos(ang) * 40, my = shY + Math.sin(ang) * 40;
    const range = clamp(player.anim.atkRange || 500, 130, 580);
    projectiles.push({ kind: 'gravitySeed', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 900, color: cls.color, r: 10, hit: 0, angle: ang, range, traveled: 0 });
    burst(mx, my, '#ffffff', 18, 3.2);
    burst(mx, my, cls.color, 28, 4.2);
  }
  function spawnFirebolt(ang, power, opts) {
    opts = opts || {};
    const shX = player.x, shY = player.y - 76, spd = 24.5 * (power || 1);
    const mx = shX + Math.cos(ang) * 38, my = shY + Math.sin(ang) * 38;
    projectiles.push({ kind: 'firebolt', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 900, color: '#ff6b32', r: 12.5, hit: 16.5 * (power || 1), angle: ang, fire: true,
      sparkle: 3, scorch: !!opts.scorch });
    pyroStaffFlare(ang, 1.0);
    burst(mx, my, '#ffd45e', 22, 4.2);
    burst(mx, my, '#ff6b32', 24, 4.8);
    emitFlameJet(mx, my, ang, 18, { spread: 0.26, speed: 7.4, length: 28, life: 360, r: 4.8, color: '#ff6b32' });
    emitSmokePuff(mx - Math.cos(ang) * 6, my - Math.sin(ang) * 4, ang + Math.PI, 5, { speed: 1.2, life: 760, alpha: 0.24 });
  }
  function spawnIgnitionOrb(ang, opts) {
    opts = opts || {};
    const shX = player.x, shY = player.y - 74;
    const origin = { x: shX + Math.cos(ang) * 42, y: shY + Math.sin(ang) * 26 };
    const aim = aimedPoint(opts.range || 520);
    const anchor = nearestPyroAnchor(aim.x, aim.y, opts.snap || 0, player.team);
    const target = anchor || aim;
    const dx = target.x - origin.x, dy = target.y - origin.y;
    const dist = clamp(Math.hypot(dx, dy) || 1, 90, opts.range || 520);
    const throwAng = Math.atan2(dy, dx);
    const spd = 19.6;
    projectiles.push({
      kind: 'ignitionOrb',
      team: player.team,
      x: origin.x,
      y: origin.y,
      vx: Math.cos(throwAng) * spd,
      vy: Math.sin(throwAng) * spd,
      life: 980,
      color: '#ff6b32',
      r: 14,
      hit: 0,
      angle: throwAng,
      range: dist,
      traveled: 0,
      originX: origin.x,
      originY: origin.y,
      ignition: Object.assign({}, opts),
    });
    pyroStaffFlare(throwAng, 1.45);
    emitFlameJet(origin.x, origin.y, throwAng, 24, { spread: 0.36, speed: 7.4, length: 34, life: 420, r: 5.4, color: '#ff6b32' });
    emitSmokePuff(origin.x - Math.cos(throwAng) * 6, origin.y + 2, throwAng + Math.PI, 8, { speed: 1.4, life: 860, alpha: 0.28 });
    addShake(1.8, 85);
  }
  function spawnIgnitionAfterburnTrail(fromX, fromY, toX, toY, team, opts) {
    opts = opts || {};
    if (fromX == null || fromY == null) return;
    const dx = toX - fromX, dy = toY - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const steps = clamp(Math.floor(len / 84), 2, 7);
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const x = fromX + dx * t + rand(-18, 18);
      const airY = fromY + dy * t;
      const gy = terrainYAt(x);
      if (Math.abs(gy - airY) > 180) continue;
      const hot = hasPassive('mg_pyromancy');
      spawnFireZone(x, gy - 4, team, {
        r: hot ? rand(42, 62) : rand(30, 44),
        w: hot ? rand(118, 172) : rand(74, 112),
        life: hot ? rand(1500, 2300) : rand(720, 1100),
        color: '#ff6b32',
        ground: true,
        spread: hot,
        quiet: true,
      });
      if (hot) feedPyromancyGroundFire(x, gy, team, { r: 42, w: 128, life: 1500, radius: 130 });
      pyroLink(fromX + dx * Math.max(0, t - 0.10), fromY + dy * Math.max(0, t - 0.10), x, gy - 18, '#ff6b32', 260);
    }
  }
  function detonateIgnitionOrb(x, y, team, opts) {
    opts = opts || {};
    team = team || 'hero';
    const anchor = nearestPyroAnchor(x, y, opts.snap || 0, team);
    if (anchor) { x = anchor.x; y = anchor.y; }
    const r = opts.r || 132, force = opts.force || 24;
    const groundY = terrainYAt(x);
    const groundish = Math.abs(groundY - y) < 135;
    emitFlameJet(x, y, -Math.PI / 2, 34, { spread: 1.25, speed: 5.8, length: 44, life: 520, r: 7.0, color: '#ff6b32' });
    emitSmokePuff(x, y, -Math.PI / 2, 18, { spread: 1.4, speed: 2.0, life: 1180, alpha: 0.33 });
    burst(x, y, '#ffd45e', 16, 4.8);
    burst(x, y, '#ff6b32', 22, 5.4);
    spawnIgnitionAfterburnTrail(opts.fromX, opts.fromY, x, y, team, opts);
    if (groundish) spawnFireZone(x, groundY - 4, team, {
      r: r * (hasPassive('mg_pyromancy') ? 0.48 : 0.34),
      w: r * (hasPassive('mg_pyromancy') ? 1.85 : 1.20),
      life: hasPassive('mg_pyromancy') ? 1900 : 1050,
      color: '#ff6b32',
      ground: true,
      spread: hasPassive('mg_pyromancy'),
      quiet: true,
    });
    else spawnFireZone(x, y, team, { r: r * 0.42, life: 720, color: '#ff6b32', quiet: true });
    feedPyromancyGroundFire(x, y, team, { r: 56, w: 160, life: 1850, radius: 170, flare: 430 });
    flareNearbyFireZones(x, y, r + 100, team, '#ff6b32');
    radialActorPulse(x, y, r, force, team, '#ff6b32');
    detonateBurningTargets(x, y, r, force + 12, team, '#ff6b32', { link: true, chain: opts.chain });
    pushBoxesRadial(x, y, force, r, team);
    addShake(4.8, 150);
  }
  function spawnSpiritBolt(ang) {
    const shX = player.x, shY = player.y - 76, spd = 19.5;
    const mx = shX + Math.cos(ang) * 38, my = shY + Math.sin(ang) * 38;
    projectiles.push({ kind: 'spiritBolt', team: player.team, x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 920, color: '#b48cff', r: 10, hit: 11, angle: ang, spirit: true });
    emitSoulWisp(shX - player.facing * 8, shY + 12, mx, my, { count: 12, color: '#b48cff', lifeMin: 220, lifeMax: 520 });
    for (let i = 0; i < 5; i++) soulParticle(mx + rand(-4, 4), my + rand(-4, 4), Math.cos(ang) * rand(0.4, 1.2) + rand(-0.25, 0.25), Math.sin(ang) * rand(0.3, 1.0) - rand(0.10, 0.45), { color: Math.random() < 0.35 ? '#f5efff' : '#b48cff', life: rand(220, 520), r: rand(1.0, 2.2) });
  }
  function spawnFireZone(x, y, team, opts) {
    opts = opts || {};
    const pyromancy = (team || 'hero') === 'hero' && hasPassive('mg_pyromancy');
    const r = (opts.r || 128) * (pyromancy ? 1.12 : 1);
    const life = (opts.life || 2400) + (pyromancy ? 520 : 0);
    fireZones.push({
      x, y,
      team: team || 'hero',
      r,
      max: life,
      life,
      age: 0,
      tick: opts.openingFlare ? 30 : 80,
      color: opts.color || '#ff6b32',
      ultimate: !!opts.ultimate,
      flare: opts.openingFlare ? 380 : 0,
      detonateOnEnd: !!opts.detonateOnEnd,
      ground: !!opts.ground,
      spread: !!opts.spread,
      spreadTick: rand(180, 320),
      w: opts.w || 0,
    });
    if (!opts.quiet) {
      burst(x, y, '#ffd45e', opts.ultimate ? 54 : 18, opts.ultimate ? 7.2 : 3.8);
      burst(x, y, opts.color || '#ff6b32', opts.ultimate ? 72 : 24, opts.ultimate ? 8.0 : 4.2);
    }
    for (let i = 0; i < (opts.ultimate ? 52 : opts.ground ? 16 : 28); i++) {
      const a = rand(0, Math.PI * 2), rr = rand(6, r * 0.86);
      flameParticle(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.38, Math.cos(a) * rand(0.5, 2.4), rand(-3.2, -0.55), {
        life: rand(260, opts.ultimate ? 620 : 480),
        r: rand(3.0, opts.ultimate ? 10.5 : 7.8),
        color: Math.random() < 0.38 ? '#ffd45e' : opts.color || '#ff6b32',
        buoy: rand(0.025, 0.070),
      });
      if (i % 3 === 0) smokeParticle(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.35, Math.cos(a) * rand(0.18, 1.2), rand(-1.0, -0.08), {
        life: rand(760, 1420),
        r: rand(7, opts.ultimate ? 18 : 13),
        alpha: opts.ultimate ? 0.32 : 0.24,
      });
    }
    if (opts.ultimate && !opts.ground) spawnShockwaveRing(x, y, r + 28, opts.color || '#ff6b32', {
      life: 420,
      width: 5.8,
      fill: 0.12,
      rough: 0.085,
    });
    if (!opts.quiet) addShake(opts.ultimate ? 6.2 : 2.0, opts.ultimate ? 180 : 70);
  }
  function feedPyromancyGroundFire(x, y, team, opts) {
    opts = opts || {};
    team = team || 'hero';
    if (team !== 'hero' || !hasPassive('mg_pyromancy')) return false;
    const gy = terrainYAt(x);
    if (y != null && Math.abs(gy - y) > (opts.maxDelta || 170)) return false;
    const radius = opts.radius || 145;
    let fed = false;
    for (const z of fireZones || []) {
      if ((z.team || 'hero') !== team || !z.ground) continue;
      const d = Math.hypot(z.x - x, z.y - gy);
      if (d > radius + z.r * 0.45) continue;
      const bonus = opts.life || 980;
      const oldMax = z.max || z.life || bonus;
      z.max = Math.min(4600, Math.max(oldMax, oldMax + bonus * 0.28));
      z.life = Math.min(z.max, Math.max(z.life || 0, bonus * 0.62) + bonus * 0.46);
      z.flare = Math.max(z.flare || 0, opts.flare || 360);
      z.spread = true;
      z.spreadTick = Math.min(z.spreadTick || 260, 190);
      fed = true;
    }
    if (!fed && (!fireZones || fireZones.length < 24)) {
      spawnFireZone(x, gy - 4, team, {
        r: opts.r || 42,
        w: opts.w || 112,
        life: opts.life || 980,
        color: opts.color || '#ff6b32',
        ground: true,
        spread: true,
        quiet: true,
      });
      fed = true;
    }
    if (fed) {
      for (let i = 0; i < 6; i++) {
        const px = x + rand(-32, 32), py = gy - rand(4, 16);
        flameParticle(px, py, rand(-0.35, 0.35), rand(-1.7, -0.25), {
          life: rand(240, 520),
          r: rand(2.6, 7.6),
          color: Math.random() < 0.42 ? '#ffd45e' : opts.color || '#ff6b32',
        });
      }
    }
    return fed;
  }
  function magePyroLoadoutActive() {
    if (!loadout) return false;
    return loadout.passive === 'mg_pyromancy' || ['attack', 'secondary', 'e', 'q'].some(slot => {
      const spec = ability(loadout[slot]);
      return spec && spec.branch === 'pyromancer';
    });
  }
  function pyroStatusCounts() {
    const hotBoxes = (boxes || []).filter(b => !b.dead && (b.heat || 0) > 22).length;
    const burningActors = (player && (player.burned || 0) > 0 ? 1 : 0) +
      (fighters ? fighters.filter(e => (e.burned || 0) > 0).length : 0) +
      (allies ? allies.filter(a => (a.burned || 0) > 0).length : 0) +
      (dummies ? dummies.filter(d => (d.burned || 0) > 0).length : 0);
    return {
      hotBoxes,
      burningActors,
      fireZones: fireZones ? fireZones.length : 0,
      flameBreaths: flameBreaths ? flameBreaths.length : 0,
    };
  }
  function pyroStatusText() {
    const c = pyroStatusCounts();
    const parts = [];
    if (c.burningActors) parts.push(`${c.burningActors} burn`);
    if (c.hotBoxes) parts.push(`${c.hotBoxes} hot`);
    if (c.fireZones) parts.push(`${c.fireZones} zone`);
    if (c.flameBreaths) parts.push(`${c.flameBreaths} breath`);
    return parts.length ? parts.join(' / ') : 'prime heat';
  }
  function pyroStaffFlare(ang, scale) {
    if (!player || player.team !== 'hero') return;
    scale = scale || 1;
    const sx = player.x + Math.cos(ang) * 20;
    const sy = player.y - 72 + Math.sin(ang) * 20;
    burst(sx, sy, '#ffd45e', Math.round(10 * scale), 2.9 + scale);
    burst(sx, sy, '#ff6b32', Math.round(15 * scale), 3.3 + scale);
    emitFlameJet(sx, sy, ang, Math.round(12 + scale * 10), { spread: 0.38, speed: 4.9 + scale * 1.7, length: 22 + scale * 12, life: 340 + scale * 100, r: 4.2 + scale * 1.15, color: '#ff6b32' });
    emitSmokePuff(sx, sy, ang + Math.PI, Math.round(2 + scale * 3), { speed: 1.0 + scale * 0.30, life: 720 + scale * 110, alpha: 0.20 });
    for (let i = 0; i < Math.round(3 + scale * 5); i++) {
      const a = ang + rand(-0.55, 0.55);
      flameParticle(sx + rand(-3, 3), sy + rand(-3, 3),
        Math.cos(a) * rand(1.2, 3.8 + scale) + rand(-0.25, 0.25),
        Math.sin(a) * rand(0.7, 2.4 + scale * 0.6) - rand(0.35, 1.1), {
          life: rand(220, 480 + scale * 110),
          r: rand(2.2, 6.5 + scale * 1.2),
          color: Math.random() < 0.48 ? '#ffd45e' : '#ff6b32',
          buoy: rand(0.030, 0.082),
        });
    }
    for (let i = 0; i < Math.round(2 + scale * 2); i++) emberParticle(sx + rand(-2, 2), sy + rand(-2, 2), Math.cos(ang + rand(-0.7, 0.7)) * rand(1.5, 4.5), Math.sin(ang + rand(-0.7, 0.7)) * rand(0.7, 2.6) - rand(0.4, 1.4), { life: rand(260, 700) });
  }
  function pyroLink(ax, ay, bx, by, color, life) {
    spawnBladeRecallTrail(ax, ay, bx, by, {
      color: '#ffd45e',
      accent: color || '#ff6b32',
      life: life || 360,
      phase: rand(0, Math.PI * 2),
    });
    rememberDebugSegment('ability', ax, ay, bx, by, 8, color || '#ff6b32', life || 360);
    const dx = bx - ax, dy = by - ay;
    for (let i = 0; i < 5; i++) {
      const t = rand(0.15, 0.90);
      particles.push({
        x: ax + dx * t + rand(-4, 4),
        y: ay + dy * t + rand(-4, 4),
        vx: rand(-0.35, 0.35),
        vy: rand(-1.05, -0.18),
        life: rand(180, 340),
        max: 340,
        color: Math.random() < 0.42 ? '#ffd45e' : color || '#ff6b32',
        r: rand(1.4, 3.4),
      });
    }
  }
  function nearestPyroAnchor(x, y, range, team) {
    if (!range || range <= 0) return null;
    const side = team || 'hero';
    let best = null, bd = range;
    const check = (tx, ty, weight) => {
      const d = Math.hypot(tx - x, ty - y) - (weight || 0);
      if (d < bd) { bd = d; best = { x: tx, y: ty }; }
    };
    if (fireZones) for (const z of fireZones) {
      if ((z.team || 'hero') !== side) continue;
      check(z.x, z.y, Math.min(70, z.r * 0.35));
    }
    const actors = side === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
    for (const a of actors) if ((a.burned || 0) > 0) check(a.x, a.y - 42, 36);
    if (side !== 'enemy' && dummies) for (const d of dummies) if ((d.burned || 0) > 0) {
      const p = d.pts && (d.pts.chest || d.pts.head);
      if (p) check(p.x, p.y, 30);
    }
    for (const b of boxes || []) {
      if (b.dead) continue;
      const heat = b.heat || 0;
      if (heat <= 20 && b.kind !== 'barrel') continue;
      check(b.x + b.w / 2, b.y + b.h / 2, b.kind === 'barrel' ? 54 : clamp(heat * 0.36, 8, 44));
    }
    return best;
  }
  function flareNearbyFireZones(x, y, radius, team, color) {
    let any = false;
    for (const z of fireZones || []) {
      if ((z.team || 'hero') !== (team || 'hero')) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d > radius + z.r * 0.42) continue;
      z.flare = Math.max(z.flare || 0, 420);
      z.tick = Math.min(z.tick || 0, 22);
      z.life = Math.max(z.life || 0, Math.min(z.max || 1000, 620));
      pyroLink(x, y, z.x, z.y, color || z.color, 340);
      any = true;
    }
    return any;
  }
  function finishFireZone(z) {
    if (!z) return;
    const r = z.r + (z.ultimate ? 62 : 20);
    const color = z.color || '#ff6b32';
    burst(z.x, z.y, '#ffd45e', z.ultimate ? 52 : 20, z.ultimate ? 7.2 : 3.4);
    burst(z.x, z.y, color, z.ultimate ? 78 : 28, z.ultimate ? 8.2 : 4.0);
    for (let i = 0; i < (z.ultimate ? 64 : 20); i++) {
      const a = rand(0, Math.PI * 2), s = rand(2.0, z.ultimate ? 8.2 : 4.4);
      flameParticle(z.x + Math.cos(a) * rand(6, r * 0.32), z.y + Math.sin(a) * rand(3, r * 0.16),
        Math.cos(a) * s, Math.sin(a) * s * 0.42 - rand(0.7, 2.4), {
          life: rand(260, z.ultimate ? 720 : 460),
          r: rand(3.0, z.ultimate ? 11.5 : 7.2),
          color: Math.random() < 0.42 ? '#ffd45e' : color,
        });
      if (i % 2 === 0) smokeParticle(z.x + Math.cos(a) * rand(12, r * 0.52), z.y + Math.sin(a) * rand(5, r * 0.22),
        Math.cos(a) * rand(0.6, 2.6), Math.sin(a) * rand(0.2, 1.1) - rand(0.45, 1.3), {
          life: rand(760, z.ultimate ? 1580 : 1100),
          r: rand(8, z.ultimate ? 24 : 16),
          alpha: z.ultimate ? 0.34 : 0.25,
        });
    }
    spawnShockwaveRing(z.x, z.y, r, color, {
      life: z.ultimate ? 520 : 280,
      width: z.ultimate ? 6.8 : 3.8,
      fill: z.ultimate ? 0.16 : 0.07,
      rough: z.ultimate ? 0.095 : 0.070,
    });
    radialActorPulse(z.x, z.y, r, z.ultimate ? 30 : 12, z.team, color);
    detonateBurningTargets(z.x, z.y, r, z.ultimate ? 42 : 18, z.team, color, { link: !!z.ultimate, chain: !!z.ultimate });
    pushBoxesRadial(z.x, z.y, z.ultimate ? 32 : 12, r, z.team);
    addShake(z.ultimate ? 6.8 : 2.8, z.ultimate ? 190 : 90);
  }
  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }
  function flamePathPoint(o, ang, dist, b) {
    const yScale = b && b.yScale || 0.72;
    return { x: o.x + Math.cos(ang) * dist, y: o.y + Math.sin(ang) * dist * yScale };
  }
  function pointInExpandedAabb(px, py, r, pad) {
    pad = pad || 0;
    return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }
  function flameObstacleAt(px, py, ignoreBox) {
    const L = levels[li];
    for (const p of L.platforms) if (!isOneWay(p) && pointInExpandedAabb(px, py, p, 5)) return p;
    for (const b of boxes || []) if (b && !b.dead && b !== ignoreBox && b.kind !== 'spring' && pointInExpandedAabb(px, py, b, 6)) return b;
    return null;
  }
  function flameRayBlockDistance(o, ang, range, b, ignoreBox) {
    const step = b && b.dragon ? 13 : 17;
    for (let d = 18; d <= range; d += step) {
      const p = flamePathPoint(o, ang, d, b);
      if (flameObstacleAt(p.x, p.y, ignoreBox)) return Math.max(18, d - step * 0.8);
    }
    return range;
  }
  function flameBreathOrigin(actor, ang, type, t) {
    const ax = actor ? actor.x : player.x;
    const ay = actor ? actor.y : player.y;
    const castType = type || (actor && actor.anim && isPyroVisualAttack(actor.anim.atkType) ? actor.anim.atkType : 'pyroBreath');
    if (castType === 'pyroBreath' || castType === 'pyroDragon') {
      const f = Math.cos(ang) >= 0 ? 1 : -1;
      const castT = t == null
        ? clamp(actor && actor.anim && isPyroVisualAttack(actor.anim.atkType) ? actor.anim.atkT : 0.35, 0, 1)
        : clamp(t, 0, 1);
      const body = pyroBodyOffset(castType, castT, f);
      const lean = (actor && actor.anim && actor.anim.lean || 0) + body.lean;
      const shX = ax + body.x + Math.sin(lean) * f * 30;
      const shY = ay - 49 + body.y - Math.cos(lean) * 30;
      const pose = weaponPose(castType, castT, ang, f, 0);
      const wc = armChain(shX, shY, pose.shAng, pose.elBend);
      const staffAng = wc.foreAng + pose.wrBend;
      return {
        x: wc.hx + Math.cos(staffAng) * 66,
        y: wc.hy + Math.sin(staffAng) * 66,
      };
    }
    return {
      x: ax + Math.cos(ang) * 30,
      y: ay - 66 + Math.sin(ang) * 12,
    };
  }
  function pointInFlameBreath(px, py, b, o, ignoreBox) {
    const dx = px - o.x, dy = py - o.y;
    const yScale = b && b.yScale || 0.72;
    const sy = dy / yScale;
    const d = Math.hypot(dx, sy) || 1;
    if (d > b.range) return null;
    const half = (b.cone || 0.54) * (0.52 + 0.48 * clamp(d / Math.max(1, b.range), 0, 1));
    const rayAng = Math.atan2(sy, dx);
    const off = Math.abs(angleDelta(rayAng, b.angle));
    if (off > half) return null;
    const block = flameRayBlockDistance(o, rayAng, Math.min(b.range, d + 18), b, ignoreBox);
    if (block < d - 12) return null;
    return { d, u: 1 - d / b.range, off };
  }
  function startPyroBreath(ang, opts) {
    opts = opts || {};
    const life = opts.life || 720;
    const dragon = !!opts.dragon;
    const pyromancy = (player.team || 'hero') === 'hero' && hasPassive('mg_pyromancy');
    const b = {
      actor: player,
      team: player.team || 'hero',
      angle: ang,
      range: opts.range || 270,
      cone: opts.cone || 0.54,
      force: opts.force || 14,
      heat: opts.heat || 18,
      life,
      max: life,
      age: 0,
      tick: 0,
      spreadTick: 0,
      color: opts.color || '#ff6b32',
      dragon,
      spread: !!opts.spread || pyromancy,
      yScale: dragon ? 0.58 : 0.72,
    };
    flameBreaths.push(b);
    player.facing = Math.cos(ang) >= 0 ? 1 : -1;
    player.pyroBreath = Math.max(player.pyroBreath || 0, life);
    player.vx -= Math.cos(ang) * (dragon ? 2.4 : 0.75);
    if (!player.grounded) player.vy -= dragon ? 0.45 : 0.18;
    const o = flameBreathOrigin(player, ang, dragon ? 'pyroDragon' : 'pyroBreath', dragon ? 0.18 : 0.22);
    pyroStaffFlare(ang, dragon ? 2.75 : 1.80);
    emitFlameJet(o.x, o.y, ang, dragon ? 82 : 38, { spread: b.cone * (dragon ? 0.96 : 0.76), speed: dragon ? 11.2 : 7.8, length: dragon ? 78 : 44, life: dragon ? 680 : 440, r: dragon ? 11.4 : 6.8, color: b.color });
    emitSmokePuff(o.x - Math.cos(ang) * 8, o.y + 2, ang + Math.PI, dragon ? 30 : 12, { spread: dragon ? 1.14 : 0.88, speed: dragon ? 2.2 : 1.5, life: dragon ? 1320 : 860, alpha: dragon ? 0.36 : 0.28 });
    addShake(dragon ? 7.4 : 2.8, dragon ? 260 : 120);
    return true;
  }
  function startGroundFireFlow(ang, opts) {
    opts = opts || {};
    const f = Math.cos(ang) >= 0 ? 1 : -1;
    const fireAng = Math.atan2(0.10 + Math.sin(ang) * 0.22, f);
    const o = flameBreathOrigin(player, fireAng);
    const probe = { yScale: 0.38, dragon: false };
    const limit = flameRayBlockDistance(o, fireAng, opts.range || 320, probe);
    pyroStaffFlare(fireAng, 1.3);
    emitFlameJet(o.x, o.y, fireAng, 28, { spread: 0.34, speed: 6.6, length: 46, life: 460, r: 5.6, color: '#ff6b32' });
    const lanes = opts.lanes || 5;
    for (let i = 0; i < lanes; i++) {
      const d = clamp(44 + i * 58, 38, limit - 12);
      if (d <= 32) continue;
      const x = o.x + Math.cos(fireAng) * d;
      const y = terrainYAt(x) - 4;
      spawnFireZone(x, y, player.team, { r: 48 + i * 4, w: 96 + i * 16, life: (opts.life || 1550) - i * 90, color: '#ff6b32', ground: true, spread: true, quiet: i > 0 });
    }
    addShake(2.4, 95);
    return true;
  }
  function emitFlameBreathParticles(b, o) {
    const live = clamp(b.life / Math.max(1, b.max), 0, 1);
    const push = (b.dragon ? 1.15 : 0.65) + (1 - live) * (b.dragon ? 0.35 : 0.18);
    for (let i = 0; i < (b.dragon ? 32 : 14); i++) {
      const seedDist = rand(10, b.range * 0.96);
      const spread = rand(-b.cone, b.cone) * (0.18 + 0.82 * seedDist / b.range);
      const a = b.angle + spread;
      const maxDist = flameRayBlockDistance(o, a, b.range, b);
      if (maxDist < 24) continue;
      const dist = rand(10, maxDist * rand(0.22, 0.98));
      const p = flamePathPoint(o, a, dist, b);
      const x = p.x + rand(-4, 4);
      const y = p.y + rand(-4, 4);
      const s = rand(b.dragon ? 4.4 : 2.6, b.dragon ? 12.6 : 8.0) * push * (1 - dist / b.range * 0.42);
      flameParticle(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.52 + rand(-0.45, 0.18), {
        life: rand(240, b.dragon ? 760 : 540),
        r: rand(b.dragon ? 5.8 : 3.6, b.dragon ? 17.5 : 10.8),
        color: Math.random() < 0.38 ? '#ffd45e' : b.color,
        buoy: rand(0.020, b.dragon ? 0.088 : 0.060),
        grow: rand(0.018, b.dragon ? 0.086 : 0.060),
        alpha: 0.96,
      });
      if (Math.random() < (b.dragon ? 0.48 : 0.38)) emberParticle(x, y, Math.cos(a) * rand(1.8, 5.4), Math.sin(a) * rand(0.6, 2.6) - rand(0.6, 1.7));
    }
    for (let i = 0; i < (b.dragon ? 13 : 5); i++) {
      const spread = rand(-b.cone * 0.92, b.cone * 0.92);
      const a = b.angle + spread;
      const maxDist = flameRayBlockDistance(o, a, b.range, b);
      if (maxDist < 34) continue;
      const dist = rand(maxDist * 0.35, maxDist * 0.98);
      const p = flamePathPoint(o, a, dist, b);
      smokeParticle(p.x, p.y + rand(-6, 6),
        Math.cos(a) * rand(0.55, b.dragon ? 3.1 : 1.8), Math.sin(a) * rand(0.15, 0.75) - rand(0.25, 0.9), {
          life: rand(680, b.dragon ? 1720 : 1300),
          r: rand(6.5, b.dragon ? 25.5 : 16.5),
          alpha: rand(0.20, b.dragon ? 0.44 : 0.36),
        });
    }
  }
  function spreadGroundFireFromBreath(b, o) {
    if (!b.spread || !fireZones) return;
    const pyromancy = (b.team || 'hero') === 'hero' && hasPassive('mg_pyromancy');
    const atCap = fireZones.length > 22;
    const count = b.dragon ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const a = b.angle + rand(-b.cone * 0.62, b.cone * 0.62);
      const maxDist = flameRayBlockDistance(o, a, b.range, b);
      if (maxDist < 80) continue;
      const d = rand(72, maxDist * 0.90);
      const p = flamePathPoint(o, a, d, b);
      const y = terrainYAt(p.x) - 4;
      if (Math.abs(y - p.y) > (b.dragon ? 150 : 90)) continue;
      const near = fireZones.some(z => Math.hypot(z.x - p.x, z.y - y) < z.r * 0.62);
      if (near) {
        feedPyromancyGroundFire(p.x, y, b.team, { r: b.dragon ? 62 : 38, w: b.dragon ? 176 : 110, life: b.dragon ? 1500 : 950, radius: b.dragon ? 152 : 116, maxDelta: 110 });
        continue;
      }
      if (atCap) continue;
      spawnFireZone(p.x, y, b.team, {
        r: b.dragon ? rand(62, 92) : rand(38, 56),
        w: b.dragon ? rand(150, 230) : rand(88, 130),
        life: b.dragon || pyromancy ? rand(1150, 1900) : rand(720, 1200),
        color: b.color,
        ground: true,
        spread: (b.dragon || pyromancy) && Math.random() < 0.45,
        quiet: true,
      });
      feedPyromancyGroundFire(p.x, y, b.team, { r: b.dragon ? 62 : 38, w: b.dragon ? 176 : 110, life: b.dragon ? 1500 : 950, radius: b.dragon ? 152 : 116, maxDelta: 110 });
    }
  }
  function updateFlameBreaths(dtStep) {
    if (!flameBreaths || !flameBreaths.length) return;
    for (let i = flameBreaths.length - 1; i >= 0; i--) {
      const b = flameBreaths[i];
      const actor = b.actor || player;
      if (!actor || actor.dead) { flameBreaths.splice(i, 1); continue; }
      b.life -= dtStep;
      b.age = (b.age || 0) + dtStep;
      const o = flameBreathOrigin(actor, b.angle, b.dragon ? 'pyroDragon' : 'pyroBreath', clamp(b.age / (b.dragon ? 140 : 190), 0, 1));
      b.centerBlock = flameRayBlockDistance(o, b.angle, b.range, b);
      emitFlameBreathParticles(b, o);
      const tip = flamePathPoint(o, b.angle, b.centerBlock || b.range, b);
      rememberDebugSegment('ability', o.x, o.y, tip.x, tip.y, b.dragon ? 48 : 28, b.color, 120);
      b.spreadTick -= dtStep;
      if (b.spreadTick <= 0) {
        b.spreadTick = b.dragon ? 86 : 160;
        spreadGroundFireFromBreath(b, o);
      }
      b.tick -= dtStep;
      if (b.tick <= 0) {
        b.tick = b.dragon ? 46 : 64;
        const team = b.team || 'hero';
        const targets = team === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
        for (const t of targets.slice()) {
          const hit = pointInFlameBreath(t.x, t.y - 42, b, o);
          if (!hit) continue;
          const heat = 0.55 + hit.u * 0.75;
          markBurnActor(t, 980 + hit.u * 760, b.color);
          if (team === 'enemy') hurtEnemyTarget(t, Math.cos(b.angle), Math.sin(b.angle) * 0.25 - 0.18, b.force * heat, t.x, t.y - 42);
          else hurtFighter(t, Math.cos(b.angle), Math.sin(b.angle) * 0.25 - 0.18, b.force * heat, t.x, t.y - 42);
        }
        if (team !== 'enemy' && dummies) for (const d of dummies) {
          const n = dummyNearest(d, o.x + Math.cos(b.angle) * b.range * 0.58, o.y + Math.sin(b.angle) * b.range * 0.35);
          if (!n.p) continue;
          const hit = pointInFlameBreath(n.p.x, n.p.y, b, o);
          if (!hit) continue;
          markBurnDummy(d, 1050 + hit.u * 720, b.color);
          hurtDummy(d, Math.cos(b.angle), Math.sin(b.angle) * 0.22 - 0.12, b.force * (0.55 + hit.u), n.p.x, n.p.y);
        }
        for (const bx of boxes || []) {
          if (!bx || bx.dead) continue;
          const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
          const hit = pointInFlameBreath(cx, cy, b, o, bx);
          if (!hit) continue;
          heatBoxFromFire(bx, { x: o.x, y: o.y, color: b.color, ultimate: hit.u > 0.45 }, b.heat * (0.72 + hit.u * 0.95));
          pushBox(bx, Math.cos(b.angle), Math.sin(b.angle) * 0.18 - 0.10, (b.force * 0.34) * (0.65 + hit.u));
        }
      }
      if (b.life <= 0) {
        emitSmokePuff(o.x + Math.cos(b.angle) * b.range * 0.58, o.y + Math.sin(b.angle) * b.range * 0.34, b.angle, 12, { spread: b.cone, speed: 1.9, life: 1050, alpha: 0.30 });
        flameBreaths.splice(i, 1);
      }
    }
    if (player) player.pyroBreath = Math.max(0, (player.pyroBreath || 0) - dtStep);
  }
  function emitBlackHoleBirth(x, y, r, color) {
    burst(x, y, '#ffffff', 18, 3.4);
    burst(x, y, color || '#8f7dff', 58, 6.4);
    for (let i = 0; i < 52; i++) {
      const a = rand(0, Math.PI * 2), rr = rand(r * 0.34, r * 0.98);
      const tangent = a + Math.PI / 2;
      gravityParticle(x + Math.cos(a) * rr, y + Math.sin(a) * rr,
        Math.cos(tangent) * rand(0.25, 1.4) - Math.cos(a) * rand(0.10, 0.55),
        Math.sin(tangent) * rand(0.25, 1.4) - Math.sin(a) * rand(0.10, 0.55), {
          color: Math.random() < 0.24 ? '#ffffff' : color || '#8f7dff',
          life: rand(360, 860),
          r: rand(1.1, 3.2),
        });
    }
    spawnShockwaveRing(x, y, r * 0.88, color || '#8f7dff', { life: 480, width: 5.6, fill: 0.08, rough: 0.075 });
    addShake(6.6, 190);
  }
  function spawnBlackHole(x, y, team, color, opts) {
    opts = Object.assign({}, opts || {}, { blackHole: true, ultimate: true, tether: true });
    spawnGravityField(x, y, team, color || '#8f7dff', opts);
  }
  function spawnGravityField(x, y, team, color, opts) {
    opts = opts || {};
    let life = opts.life || 2600;
    let r = opts.r || 152;
    if ((team || 'hero') === 'hero' && hasPassive('mg_resonance')) { life += 420; r *= 1.08; }
    const blackHole = !!opts.blackHole;
    const fieldColor = color || (blackHole ? '#8f7dff' : '#ff77d2');
    gravityFields.push({
      x, y, team: team || 'hero', color: fieldColor, life, max: life, r,
      ultimate: !!opts.ultimate, tether: opts.tether !== false, phase: rand(0, Math.PI * 2),
      blackHole,
      pullPower: opts.force || opts.pullPower || (blackHole ? 1.35 : 1),
      damageTick: blackHole ? 90 : 0,
    });
    if (blackHole) {
      emitBlackHoleBirth(x, y, r, fieldColor);
      if ((team || 'hero') === 'hero' && gravityCore) chargeGravityCore(1.65, x, y);
      return;
    }
    burst(x, y, '#ffffff', opts.ultimate ? 28 : 22, opts.ultimate ? 4.8 : 3.8);
    burst(x, y, fieldColor, opts.ultimate ? 48 : 36, opts.ultimate ? 5.8 : 4.8);
    spawnShockwaveRing(x, y, r, fieldColor, { life: opts.ultimate ? 520 : 360, width: opts.ultimate ? 6 : 4, fill: opts.ultimate ? 0.10 : 0.06, rough: opts.ultimate ? 0.080 : 0.060 });
    addShake(opts.ultimate ? 5.4 : 3.6, opts.ultimate ? 170 : 120);
    if ((team || 'hero') === 'hero' && gravityCore) chargeGravityCore(opts.ultimate ? 1.45 : 0.85, x, y);
  }
  function spawnGravityCore(x, y, team, color, opts) {
    opts = opts || {};
    const r = (opts.r || 205) * (hasPassive('mg_eventhorizon') ? 1.12 : 1);
    gravityCore = {
      x, y,
      vx: 0, vy: 0,
      team: team || 'hero',
      color: color || '#ff77d2',
      r,
      max: r,
      age: 0,
      pulse: 0,
      power: hasPassive('mg_eventhorizon') ? 1.24 : 1,
      resonance: 1,
      resonanceMax: hasPassive('mg_eventhorizon') ? 5 : 4,
      resonancePulse: 620,
    };
    burst(x, y, '#ffffff', 30, 4.2);
    burst(x, y, color || '#ff77d2', 56, 5.4);
    addShake(4.6, 145);
  }
  function chargeGravityCore(amount, x, y) {
    const g = gravityCore;
    if (!g) return 0;
    const max = g.resonanceMax || (hasPassive('mg_eventhorizon') ? 5 : 4);
    const before = g.resonance || 0;
    g.resonance = clamp(before + (amount || 1), 0, max);
    g.resonancePulse = Math.max(g.resonancePulse || 0, 520);
    if (x != null && y != null) rememberDebugSegment('ability', x, y, g.x, g.y, 6, g.color || cls.color, 420);
    if (g.resonance > before + 0.05) {
      const gain = g.resonance - before;
      burst(g.x, g.y, '#ffffff', 6 + gain * 5, 2.5 + gain * 0.7);
      burst(g.x, g.y, g.color || cls.color, 8 + gain * 7, 3.0 + gain * 0.8);
    }
    return g.resonance;
  }
  function fieldAffectsActor(g, act) {
    return act && !act.dead && ((g.team || 'hero') === 'enemy' ? act.team !== 'enemy' : act.team === 'enemy');
  }
  function applyGravityFieldToActor(g, act) {
    if (!fieldAffectsActor(g, act)) return;
    const cx = act.x, cy = act.y - 38;
    const dx = g.x - cx, dy = g.y - cy, d = Math.hypot(dx, dy) || 1;
    if (d > g.r) return;
    const u = 1 - d / g.r;
    const power = g.pullPower || 1;
    act.vx += (dx / d) * (0.035 + u * 0.11) * power;
    act.vy = act.vy * (0.90 - u * 0.12) + (dy / d) * (0.05 + u * 0.12) * power - GRA * (0.55 + u * (g.blackHole ? 0.15 : 0.55));
    if (g.blackHole && u > 0.45) {
      act.vx += (dx / d) * 0.10 * u;
      act.vy += (dy / d) * 0.07 * u;
    }
    if (u > 0.25) { act.grounded = false; act.coyote = Math.max(act.coyote || 0, 2); }
  }
  function applyGravityFieldToDummy(g, d) {
    if ((g.team || 'hero') === 'enemy') return;
    let touched = false;
    for (const k in d.pts) {
      const p = d.pts[k];
      if (p.pin) continue;
      const dx = g.x - p.x, dy = g.y - p.y, dist = Math.hypot(dx, dy) || 1;
      if (dist > g.r) continue;
      const u = 1 - dist / g.r;
      const power = g.pullPower || 1;
      p.x += (dx / dist) * (0.45 + u * 1.2) * power;
      p.y += (dy / dist) * (0.35 + u * 1.0) * power - (g.blackHole ? 0.18 : 0.9 + u * 1.2);
      touched = true;
    }
    if (touched) d.flash = Math.max(d.flash, 60);
  }
  function applyGravityFieldToBox(g, b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = g.x - cx, dy = g.y - cy, d = Math.hypot(dx, dy) || 1;
    if (d > g.r) return;
    const u = 1 - d / g.r;
    const power = g.pullPower || 1;
    b.vx += (dx / d) * (0.12 + u * 0.24) * power;
    b.vy = b.vy * (0.86 - u * 0.08) + (dy / d) * (0.08 + u * 0.20) * power - (g.blackHole ? 0.05 : 0.58 * (0.8 + u));
    b.va += (dx / d) * 0.012 * power;
  }
  function updateGravityCore(dtStep) {
    const g = gravityCore;
    if (!g) return;
    g.age += dtStep;
    g.pulse = Math.sin(g.age * 0.006) * 0.5 + 0.5;
    g.resonancePulse = Math.max(0, (g.resonancePulse || 0) - dtStep);
    const resonance = clamp(g.resonance || 0, 0, g.resonanceMax || 5);
    const core = { x: g.x, y: g.y, team: g.team, color: g.color, r: g.r + resonance * 7, ultimate: true };
    const resonancePower = 1 + resonance * 0.085;
    for (const b of boxes) {
      applyGravityFieldToBox(core, b);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = g.x - cx, dy = g.y - cy, d = Math.hypot(dx, dy) || 1;
      if (d < g.r) {
        const u = 1 - d / g.r;
        b.vx += (dx / d) * 0.055 * g.power * resonancePower * u;
        b.vy += (dy / d) * 0.035 * g.power * resonancePower * u;
        b.va += (dx / d) * 0.009 * g.power * resonancePower;
      }
    }
    if ((g.team || 'hero') === 'enemy') for (const t of enemyAttackTargets()) applyGravityFieldToActor(core, t);
    else if (fighters) for (const e of fighters) applyGravityFieldToActor(core, e);
    if (dummies) for (const d of dummies) applyGravityFieldToDummy(core, d);
    if (Math.random() < 0.92) {
      const a = rand(0, Math.PI * 2), rr = rand(24, g.r * 0.92);
      particles.push({
        x: g.x + Math.cos(a) * rr,
        y: g.y + Math.sin(a) * rr,
        vx: -Math.cos(a) * rand(0.18, 0.7),
        vy: -Math.sin(a) * rand(0.18, 0.7) - 0.12,
        life: rand(280, 520),
        max: 520,
        color: Math.random() < 0.32 ? '#ffffff' : g.color,
        r: rand(1.1, 2.9),
      });
    }
  }
  function implodeGravityField(g) {
    const blackHole = !!g.blackHole;
    burst(g.x, g.y, blackHole ? '#d9d4ff' : '#ffffff', blackHole ? 34 : 26, blackHole ? 6.2 : 5.2);
    burst(g.x, g.y, g.color, blackHole ? 72 : 42, blackHole ? 7.0 : 5.8);
    spawnShockwaveRing(g.x, g.y, g.r + (blackHole ? 108 : 70), g.color, {
      life: blackHole ? 650 : g.ultimate ? 560 : 430,
      width: blackHole ? 8 : g.ultimate ? 6.5 : 5,
      fill: blackHole ? 0.18 : g.ultimate ? 0.14 : 0.09,
      rough: blackHole ? 0.095 : 0.070,
    });
    addShake(blackHole ? 8.4 : 5.6, blackHole ? 230 : 170);
    if (blackHole) {
      for (let i = 0; i < 70; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(1.2, 5.2);
        gravityParticle(g.x, g.y, Math.cos(a) * sp, Math.sin(a) * sp - rand(0.2, 1.4), {
          color: Math.random() < 0.28 ? '#ffffff' : g.color,
          life: rand(280, 760),
          r: rand(1.2, 3.8),
        });
      }
    }
    for (const b of boxes) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = g.x - cx, dy = g.y - cy, d = Math.hypot(dx, dy) || 1;
      const reach = g.r + (blackHole ? 108 : 70);
      if (d < reach) { b.vx += (dx / d) * (blackHole ? 12.5 : 8.5); b.vy += (dy / d) * (blackHole ? 9.0 : 6.5) - (blackHole ? 0.5 : 2); b.va += (dx / d) * (blackHole ? 0.26 : 0.18); }
    }
    if ((g.team || 'hero') === 'enemy') {
      for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t)) {
        const dx = g.x - t.x, dy = g.y - (t.y - 38), d = Math.hypot(dx, dy) || 1;
        const reach = g.r + (blackHole ? 108 : 70);
        if (d < reach) hurtEnemyTarget(t, dx / d, dy / d, (blackHole ? 32 : 18) * (1 - Math.min(d, reach) / reach), g.x, g.y);
      }
    } else {
      if (fighters) for (const e of fighters.slice()) {
        const dx = g.x - e.x, dy = g.y - (e.y - 42), d = Math.hypot(dx, dy) || 1;
        const reach = g.r + (blackHole ? 108 : 70);
        if (d < reach) hurtFighter(e, dx / d, dy / d, (blackHole ? 34 : 20) * (1 - Math.min(d, reach) / reach), g.x, g.y);
      }
      if (dummies) for (const d of dummies) {
        for (const k in d.pts) {
          const p = d.pts[k];
          if (p.pin) continue;
          const dx = g.x - p.x, dy = g.y - p.y, dist = Math.hypot(dx, dy) || 1;
          if (dist < g.r + (blackHole ? 94 : 60)) { p.x += (dx / dist) * (blackHole ? 20 : 12); p.y += (dy / dist) * (blackHole ? 17 : 10); }
        }
        d.flash = Math.max(d.flash, blackHole ? 260 : 180);
      }
    }
  }
  function collapseGravityCore(ang) {
    if (!gravityCore) {
      const p = aimedPoint(500);
      spawnBlackHole(p.x, p.y, player.team, cls.color, { r: 235, life: 1850, pullPower: 1.35 });
      return;
    }
    const g = Object.assign({}, gravityCore, {
      r: gravityCore.r + (hasPassive('mg_eventhorizon') ? 104 : 72),
      color: gravityCore.color,
      ultimate: true,
      blackHole: true,
      pullPower: hasPassive('mg_eventhorizon') ? 1.65 : 1.42,
    });
    burst(g.x, g.y, '#ffffff', 54, 6.4);
    burst(g.x, g.y, g.color, 76, 7.2);
    implodeGravityField(g);
    gravityCore = null;
  }
  function pushDummyRadial(d, x, y, radius, force, color) {
    let touched = false;
    for (const k in d.pts) {
      const p = d.pts[k];
      if (p.pin) continue;
      const dx = p.x - x, dy = p.y - y, dist = Math.hypot(dx, dy) || 1;
      if (dist > radius) continue;
      const u = 1 - dist / radius;
      p.x += (dx / dist) * force * u;
      p.y += (dy / dist) * force * 0.55 * u - force * 0.12 * u;
      touched = true;
    }
    if (touched) {
      d.flash = Math.max(d.flash || 0, 180);
      if (color) burst(x, y, color, 8, 2.4);
    }
    return touched;
  }
  function radialActorPulse(x, y, radius, force, team, color, opts) {
    opts = opts || {};
    const targets = (team || 'hero') === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
    let hitAny = false;
    for (const t of targets.slice()) {
      const dx = t.x - x, dy = (t.y - 42) - y, d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      const u = 1 - d / radius;
      if ((team || 'hero') === 'enemy') hurtEnemyTarget(t, dx / d, dy / d - 0.12, force * u, x, y);
      else hurtFighter(t, dx / d, dy / d - 0.12, force * u, x, y);
      if (opts.poison) t.poisoned = Math.max(t.poisoned || 0, opts.poison);
      hitAny = true;
    }
    if ((team || 'hero') !== 'enemy' && dummies) for (const d of dummies) hitAny = pushDummyRadial(d, x, y, radius, force * 1.35, color) || hitAny;
    return hitAny;
  }
  function markBurnActor(act, ms, color) {
    if (!act || act.dead) return false;
    const dur = ms || 1100;
    act.burned = Math.max(act.burned || 0, dur);
    act.burnedMax = Math.max(act.burnedMax || 0, dur);
    act.flash = Math.max(act.flash || 0, 90);
    if (Math.random() < 0.72) flameParticle(act.x + rand(-14, 14), act.y - rand(24, 72), rand(-0.35, 0.35), rand(-1.45, -0.22), {
      life: rand(170, 390),
      r: rand(2.0, 5.8),
      color: Math.random() < 0.46 ? '#ffd45e' : color || '#ff6b32',
    });
    if (Math.random() < 0.36) smokeParticle(act.x + rand(-13, 13), act.y - rand(34, 74), rand(-0.20, 0.20), rand(-0.82, -0.12), {
      life: rand(540, 980),
      r: rand(4.5, 10.5),
      alpha: 0.22,
    });
    return true;
  }
  function markBurnDummy(d, ms, color) {
    if (!d || d.defeated) return false;
    const dur = ms || 1100;
    d.burned = Math.max(d.burned || 0, dur);
    d.burnedMax = Math.max(d.burnedMax || 0, dur);
    d.flash = Math.max(d.flash || 0, 120);
    const p = d.pts && d.pts.chest;
    if (p && Math.random() < 0.70) flameParticle(p.x + rand(-14, 14), p.y + rand(-12, 12), rand(-0.32, 0.32), rand(-1.25, -0.16), {
      life: rand(170, 380),
      r: rand(1.8, 5.5),
      color: Math.random() < 0.45 ? '#ffd45e' : color || '#ff6b32',
    });
    if (p && Math.random() < 0.34) smokeParticle(p.x + rand(-14, 14), p.y + rand(-12, 12), rand(-0.20, 0.20), rand(-0.75, -0.08), {
      life: rand(520, 930),
      r: rand(4.2, 10.0),
      alpha: 0.22,
    });
    return true;
  }
  function markBurnsInFireZone(z, dur) {
    const team = z.team || 'hero';
    const actors = team === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
    for (const t of actors) {
      const d = Math.hypot(t.x - z.x, (t.y - 42) - z.y);
      if (d <= z.r) markBurnActor(t, dur, z.color);
    }
    if (team !== 'enemy' && dummies) for (const d of dummies) {
      const p = dummyNearest(d, z.x, z.y).p;
      if (p && Math.hypot(p.x - z.x, p.y - z.y) <= z.r + 18) markBurnDummy(d, dur, z.color);
    }
  }
  function detonateBurningTargets(x, y, radius, force, team, color, opts) {
    opts = opts || {};
    color = color || '#ff6b32';
    const chainMul = (opts.chain || hasPassive('mg_pyromancy')) ? 1.18 : 1;
    let pops = 0;
    const actors = (team || 'hero') === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
    for (const t of actors.slice()) {
      const d = Math.hypot(t.x - x, (t.y - 42) - y);
      if (d > radius + 72 || (t.burned || 0) <= 0) continue;
      const nx = (t.x - x) / (d || 1), ny = ((t.y - 42) - y) / (d || 1);
      t.burned = 0;
      t.burnedMax = 0;
      if (opts.link) pyroLink(x, y, t.x, t.y - 42, color, 380);
      burst(t.x, t.y - 44, '#ffd45e', 18, 4.8);
      burst(t.x, t.y - 44, color, 24, 5.4);
      spawnShockwaveRing(t.x, t.y - 42, 64, color, { life: 260, width: 3.2, fill: 0.10, rough: 0.080 });
      if ((team || 'hero') === 'enemy') hurtEnemyTarget(t, nx, ny - 0.18, force * 0.78 * chainMul, t.x, t.y - 42);
      else hurtFighter(t, nx, ny - 0.18, force * 0.78 * chainMul, t.x, t.y - 42);
      pops++;
    }
    if ((team || 'hero') !== 'enemy' && dummies) for (const d of dummies) {
      if ((d.burned || 0) <= 0) continue;
      const p = dummyNearest(d, x, y).p;
      if (!p) continue;
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist > radius + 76) continue;
      d.burned = 0;
      d.burnedMax = 0;
      const nx = (p.x - x) / (dist || 1), ny = (p.y - y) / (dist || 1);
      if (opts.link) pyroLink(x, y, p.x, p.y, color, 360);
      burst(p.x, p.y, '#ffd45e', 16, 4.6);
      burst(p.x, p.y, color, 22, 5.2);
      spawnShockwaveRing(p.x, p.y, 58, color, { life: 240, width: 3.0, fill: 0.09, rough: 0.080 });
      hurtDummy(d, nx, ny - 0.16, force * 0.90 * chainMul, p.x, p.y);
      pops++;
    }
    for (const b of boxes || []) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d > radius + 54) continue;
      const heat = b.heat || 0;
      if (heat > 20 || b.kind === 'barrel') {
        if (opts.link) pyroLink(x, y, cx, cy, heat > 76 || b.kind === 'barrel' ? '#ffd45e' : color, 320);
        heatBoxFromFire(b, { x, y, color, ultimate: true }, 42 + heat * 0.28);
        pushBox(b, (cx - x) / (d || 1), (cy - y) / (d || 1) - 0.15, force * 0.46 * chainMul);
        pops++;
      }
    }
    if (pops > 0) {
      addShake(Math.min(7.5, 3.8 + pops * 0.55), 160);
      spawnShockwaveRing(x, y, radius + 22, color, { life: 320, width: 4.2, fill: 0.08, rough: 0.090 });
    }
    return pops;
  }
  function updateFireZones(dtStep) {
    if (!fireZones) return;
    for (let i = fireZones.length - 1; i >= 0; i--) {
      const z = fireZones[i];
      z.age = (z.age || 0) + dtStep;
      z.life -= dtStep;
      z.tick -= dtStep;
      z.flare = Math.max(0, (z.flare || 0) - dtStep);
      const flare = clamp((z.flare || 0) / 420, 0, 1);
      if (z.spread && fireZones.length < 22) {
        z.spreadTick = (z.spreadTick || 0) - dtStep;
        if (z.spreadTick <= 0 && z.life > 520) {
          z.spreadTick = rand(520, 860);
          const dir = Math.random() < 0.5 ? -1 : 1;
          const nx = z.x + dir * rand(z.r * 0.62, z.r * 1.10);
          const ny = terrainYAt(nx) - 4;
          const blocked = flameObstacleAt((z.x + nx) * 0.5, Math.min(z.y, ny) - 18, null);
          const near = fireZones.some(o => o !== z && Math.hypot(o.x - nx, o.y - ny) < Math.max(34, o.r * 0.68));
          if (!blocked && !near && Math.abs(ny - z.y) < 92) {
            spawnFireZone(nx, ny, z.team, {
              r: Math.max(28, z.r * rand(0.48, 0.72)),
              w: Math.max(72, (z.w || z.r * 1.8) * rand(0.58, 0.86)),
              life: Math.min(z.life * 0.62, rand(820, 1450)),
              color: z.color,
              ground: true,
              spread: Math.random() < 0.28,
              quiet: true,
            });
          }
        }
      }
      if (Math.random() < (z.ultimate ? 0.94 : 0.75) + flare * 0.22) {
        const a = rand(0, Math.PI * 2), rr = rand(10, z.r);
        const px = z.x + Math.cos(a) * rr, py = z.y + Math.sin(a) * rr * 0.42;
        flameParticle(px, py,
          Math.cos(a) * rand(0.05, 0.46 + flare * 0.24),
          rand(-1.85 - flare * 1.15, -0.28), {
            life: rand(210, 520 + flare * 150),
            r: rand(2.6, 7.4 + flare * 2.6),
            color: Math.random() < 0.36 + flare * 0.20 ? '#ffd45e' : z.color,
            buoy: rand(0.025, 0.075 + flare * 0.018),
          });
        if (Math.random() < 0.42 + flare * 0.20) smokeParticle(px + rand(-4, 4), py + rand(-3, 4),
          Math.cos(a) * rand(0.04, 0.45), rand(-0.95 - flare * 0.3, -0.06), {
            life: rand(640, 1250 + flare * 240),
            r: rand(5.5, 15.5 + flare * 4.0),
            alpha: z.ultimate ? rand(0.26, 0.40) : rand(0.18, 0.31),
          });
        if (Math.random() < 0.18 + flare * 0.12) emberParticle(px, py, Math.cos(a) * rand(0.5, 2.1), rand(-2.2, -0.2));
      }
      if (z.tick <= 0) {
        z.tick = Math.max(70, (z.ultimate ? 142 : 195) - flare * 55);
        radialActorPulse(z.x, z.y, z.r, (z.ultimate ? 10.5 : 6.6) + flare * 4, z.team, z.color);
        markBurnsInFireZone(z, z.ultimate ? 1850 : 1280);
        for (const b of boxes || []) {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2, d = Math.hypot(cx - z.x, cy - z.y) || 1;
          if (d > z.r) continue;
          heatBoxFromFire(b, z, (z.ultimate ? 60 : 36) + flare * 16);
          if (b.kind !== 'barrel') pushBox(b, (cx - z.x) / d, -0.26, (z.ultimate ? 10 : 5.5) + flare * 4);
        }
      }
      if (z.life <= 0) {
        if (z.detonateOnEnd || z.ultimate) finishFireZone(z);
        else burst(z.x, z.y, '#5b1e12', 16, 2.8);
        fireZones.splice(i, 1);
      }
    }
  }
  function heatBoxFromFire(b, z, amount) {
    if (!b || b.dead) return;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    b.heat = clamp((b.heat || 0) + amount, 0, 120);
    b.heatFlash = 220;
    b.vx += (cx - z.x) * 0.0018;
    b.va += (cx < z.x ? -1 : 1) * 0.018;
    const heat = clamp((b.heat || 0) / 120, 0, 1);
    flameParticle(cx + rand(-b.w * 0.35, b.w * 0.35), cy + rand(-b.h * 0.35, b.h * 0.25),
      rand(-0.42, 0.42), rand(-1.95 - heat * 0.7, -0.35), {
        life: rand(190, 430 + heat * 160),
        r: rand(1.8, 5.4 + heat * 3.6),
        color: Math.random() < 0.45 ? '#ffd45e' : z.color,
        buoy: rand(0.026, 0.074),
      });
    if (Math.random() < 0.40 + heat * 0.34) smokeParticle(cx + rand(-b.w * 0.42, b.w * 0.42), cy + rand(-b.h * 0.38, b.h * 0.18),
      rand(-0.28, 0.28), rand(-0.95 - heat * 0.32, -0.10), {
        life: rand(620, 1260),
        r: rand(5.0, 15.0 + heat * 5.0),
        alpha: 0.20 + heat * 0.12,
      });
    if (b.kind === 'barrel' && Math.random() < 0.30 + heat * 0.36) emberParticle(cx + rand(-b.w * 0.4, b.w * 0.4), cy + rand(-b.h * 0.3, b.h * 0.2),
      rand(-0.7, 0.7), rand(-2.0, -0.25), { life: rand(320, 760), r: rand(1.2, 2.8) });
    if (b.kind === 'barrel' && b.heat >= 100) explodeBox(b, z.ultimate ? 24 : 18);
  }
  function tickBlackHoleDamage(g, dtStep) {
    if (!g.blackHole) return;
    g.damageTick = (g.damageTick || 0) - dtStep;
    if (g.damageTick > 0) return;
    g.damageTick = 135;
    const radius = g.r * 0.76;
    const team = g.team || 'hero';
    const targets = team === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : targetActorsForPlayer();
    for (const t of targets.slice()) {
      const dx = g.x - t.x, dy = g.y - (t.y - 42), d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      const u = 1 - d / radius;
      t.vx += (dx / d) * 0.75 * u;
      t.vy += (dy / d) * 0.55 * u;
      if (team === 'enemy') hurtEnemyTarget(t, dx / d, dy / d, 5.5 + u * 8.5, g.x, g.y);
      else hurtFighter(t, dx / d, dy / d, 6.0 + u * 9.0, g.x, g.y);
    }
    if (team !== 'enemy' && dummies) for (const d of dummies) {
      let touched = false;
      for (const k in d.pts) {
        const p = d.pts[k];
        if (p.pin) continue;
        const dx = g.x - p.x, dy = g.y - p.y, dist = Math.hypot(dx, dy) || 1;
        if (dist > radius) continue;
        const u = 1 - dist / radius;
        p.x += (dx / dist) * (1.8 + u * 3.8);
        p.y += (dy / dist) * (1.4 + u * 3.0);
        touched = true;
      }
      if (touched) d.flash = Math.max(d.flash || 0, 120);
    }
    for (const b of boxes || []) {
      if (!b || b.dead) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = g.x - cx, dy = g.y - cy, d = Math.hypot(dx, dy) || 1;
      if (d > g.r) continue;
      const u = 1 - d / g.r;
      b.vx += (dx / d) * 0.78 * u;
      b.vy += (dy / d) * 0.58 * u;
      b.va += (dx / d) * 0.030 * u;
    }
  }
  function updateGravityFields(dtStep) {
    if (!gravityFields) return;
    for (let i = gravityFields.length - 1; i >= 0; i--) {
      const g = gravityFields[i];
      g.life -= dtStep;
      tickBlackHoleDamage(g, dtStep);
      for (const b of boxes) applyGravityFieldToBox(g, b);
      if ((g.team || 'hero') === 'enemy') for (const t of enemyAttackTargets()) applyGravityFieldToActor(g, t);
      else if (fighters) for (const e of fighters) applyGravityFieldToActor(g, e);
      if (dummies) for (const d of dummies) applyGravityFieldToDummy(g, d);
      if (g.blackHole && Math.random() < 0.96) {
        const a = rand(0, Math.PI * 2), rr = rand(26, g.r);
        const tangent = a + Math.PI / 2;
        particles.push({ x: g.x + Math.cos(a) * rr, y: g.y + Math.sin(a) * rr,
          vx: Math.cos(tangent) * rand(0.18, 0.95) - Math.cos(a) * rand(0.10, 0.62),
          vy: Math.sin(tangent) * rand(0.18, 0.95) - Math.sin(a) * rand(0.10, 0.62),
          life: rand(260, 620), max: 620, color: Math.random() < 0.24 ? '#ffffff' : g.color, r: rand(1, 2.9) });
      } else if (Math.random() < 0.75) {
        const a = rand(0, Math.PI * 2), rr = rand(18, g.r);
        particles.push({ x: g.x + Math.cos(a) * rr, y: g.y + Math.sin(a) * rr,
          vx: -Math.cos(a) * rand(0.2, 0.9), vy: -Math.sin(a) * rand(0.2, 0.9) - 0.2,
          life: rand(220, 420), max: 420, color: Math.random() < 0.35 ? '#ffffff' : g.color, r: rand(1, 2.8) });
      }
      if (g.life <= 0) { implodeGravityField(g); gravityFields.splice(i, 1); }
    }
  }
  function spawnMageSigil(ang) {
    const shX = player.x, shY = player.y - 76;
    const mx = shX + Math.cos(ang) * 42, my = shY + Math.sin(ang) * 42;
    projectiles.push({ kind: 'sigil', team: player.team, x: mx, y: my, vx: Math.cos(ang) * 8.6, vy: Math.sin(ang) * 8.6,
      life: 700, age: 0, color: cls.color, r: 18, hit: 19, angle: ang });
    burst(mx, my, '#ffffff', 22, 3.6);
    burst(mx, my, cls.color, 40, 4.4);
  }
  function explodeSigil(b) {
    burst(b.x, b.y, b.color, 34, 5.2);
    burst(b.x, b.y, '#ffffff', 18, 3.6);
    pushBoxesRadial(b.x, b.y, 18, 92, b.team);
    for (let i = 0; i < 8; i++) {
      const a = b.angle + i * Math.PI / 4 + Math.sin(b.age * 0.02) * 0.25;
      const spd = 12.5;
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
    if (type === 'pyroFirebolt') return 'pyroBolt';
    if (type === 'pyroIgnite') return 'pyroThrow';
    if (type === 'pyroBreath' || type === 'pyroDragon') return 'pyroBreath';
    if (type === 'pyroGroundFlow') return 'pyroFlow';
    if (type === 'throw') return 'throw';
    if (type === 'arrow' || type === 'volley') return 'shoot';
    if (type === 'shieldBash' || type === 'shieldGuard') return 'bash';
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
  const THROW_VARIANTS = [{ raiseT: 0.26, over: -0.08 }, { raiseT: 0.23, over: 0.08 }];
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
    } else if (arc === 'pyroBolt') {
      const snap = ease(clamp(t / 0.24, 0, 1));
      const settle = ease(clamp((t - 0.24) / 0.56, 0, 1));
      const draw = aim - s * 0.86;
      const line = aim - s * 0.04;
      shAng = lerpAngle(draw, line, snap);
      elBend = s * lerp(-1.24, -0.12, snap);
      wrBend = s * lerp(0.42, -0.16, snap) * (1 - settle * 0.55);
    } else if (arc === 'pyroThrow') {
      const up = -Math.PI / 2 - s * 0.20;
      const back = aim - s * 1.06;
      const snapT = ease(clamp((t - 0.24) / 0.18, 0, 1));
      if (t < 0.24) shAng = lerpAngle(aim, up, ease(t / 0.24));
      else if (t < 0.42) shAng = lerpAngle(up, aim + s * 0.16, snapT);
      else shAng = lerpAngle(aim + s * 0.16, aim, ease(clamp((t - 0.42) / 0.42, 0, 1)));
      elBend = s * kfa(t, [[0, -0.48], [0.18, -1.48], [0.34, -1.12], [0.46, -0.08], [0.66, 0.04], [1, -0.42]]);
      wrBend = s * kfa(t, [[0, 0.22], [0.24, 0.92], [0.42, -0.54], [0.62, -0.10], [1, 0.16]]);
      if (t < 0.16) shAng = lerpAngle(back, shAng, ease(t / 0.16));
    } else if (arc === 'pyroBreath') {
      const dragon = type === 'pyroDragon';
      const brace = ease(clamp(t / (dragon ? 0.12 : 0.18), 0, 1));
      const pulse = Math.sin(t * Math.PI * (dragon ? 7.0 : 5.5)) * (dragon ? 0.025 : 0.018) * brace;
      shAng = lerpAngle(aim - s * (dragon ? 0.98 : 0.88), aim - s * (dragon ? 0.36 : 0.30), brace);
      elBend = s * lerp(-1.06, dragon ? 0.34 : 0.30, brace);
      wrBend = aim + s * pulse - (shAng + elBend);
    } else if (arc === 'pyroFlow') {
      const target = Math.atan2(0.46 + Math.sin(aim) * 0.20, Math.cos(aim) || s);
      const pour = ease(clamp(t / 0.24, 0, 1));
      shAng = lerpAngle(aim - s * 0.72, target - s * 0.20, pour);
      elBend = s * lerp(-1.12, -0.24, pour);
      wrBend = s * lerp(0.30, -0.34, pour);
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
  function currentBowPull() {
    if (!player || cls.id !== 'ranger') return 0;
    if (player.draw && player.draw.active) return rangerDrawPower(player);
    const a = player.anim;
    if (a && a.atkActive && isRangerShot(a.atkType)) {
      return clamp(a.drawPower || 1, 0.45, 1.4) * (1 - ease(clamp(a.atkT / 0.42, 0, 1)));
    }
    return 0;
  }
  function currentRangerShotType() {
    if (!player || cls.id !== 'ranger') return null;
    if (player.draw && player.draw.active) return player.draw.type;
    const a = player.anim;
    if (a && a.atkActive && isRangerShot(a.atkType)) return a.atkType;
    return null;
  }
  function currentRangerNock() {
    if (!player || cls.id !== 'ranger') return 0;
    if (player.draw && player.draw.active) return rangerNockAmount(player);
    const a = player.anim;
    return a && a.atkActive && isRangerShot(a.atkType) ? 1 - ease(clamp(a.atkT / 0.34, 0, 1)) * 0.45 : 0;
  }
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
      const pyro = cls.id === 'mage' && magePyroLoadoutActive();
      const grav = cls.id === 'mage' && mageGraviturgeLoadoutActive();
      const backLen = pyro ? 58 : grav ? 62 : 48;
      const frontLen = pyro ? 74 : grav ? 78 : 64;
      ctx.strokeStyle = pyro ? '#3f2919' : grav ? '#352c55' : '#62462c';
      ctx.lineCap = 'round';
      ctx.lineWidth = pyro ? 4.6 : grav ? 4.7 : 4.2;
      ctx.beginPath(); ctx.moveTo(hx - dx * backLen, hy - dy * backLen); ctx.lineTo(hx + dx * frontLen * L, hy + dy * frontLen * L); ctx.stroke();
      if (pyro) {
        const now = performance.now();
        const cast = player && player.anim && player.anim.atkActive && isPyroVisualAttack(player.anim.atkType)
          ? Math.sin(clamp(player.anim.atkT || 0, 0, 1) * Math.PI) : 0;
        ctx.save();
        ctx.lineCap = 'round';
        for (const mark of [-34, -8, 18, 46]) {
          const wob = Math.sin(now * 0.011 + mark) * 0.7;
          ctx.globalAlpha = 0.28 + cast * 0.18;
          ctx.strokeStyle = mark > 12 ? '#ff6b32' : '#9a4c24';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(hx + dx * mark + nx * (3.2 + wob), hy + dy * mark + ny * (3.2 + wob));
          ctx.lineTo(hx + dx * mark - nx * (3.2 - wob), hy + dy * mark - ny * (3.2 - wob));
          ctx.stroke();
        }
        const tipX = hx + dx * frontLen * L, tipY = hy + dy * frontLen * L;
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#2a1a11';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(tipX - dx * 8 + nx * 6, tipY - dy * 8 + ny * 6);
        ctx.lineTo(tipX + dx * 5, tipY + dy * 5);
        ctx.lineTo(tipX - dx * 8 - nx * 6, tipY - dy * 8 - ny * 6);
        ctx.stroke();
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.018);
        const flameLen = 16 + cast * 18 + pulse * 4;
        const flameW = 6 + cast * 4;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.70 + cast * 0.20;
        ctx.fillStyle = '#ff6b32';
        ctx.beginPath();
        ctx.moveTo(tipX + nx * flameW, tipY + ny * flameW);
        ctx.quadraticCurveTo(tipX + dx * flameLen * 0.38 + nx * (flameW * 1.2), tipY + dy * flameLen * 0.38 + ny * (flameW * 1.2),
          tipX + dx * flameLen + nx * Math.sin(now * 0.020) * 3, tipY + dy * flameLen + ny * Math.sin(now * 0.017) * 3);
        ctx.quadraticCurveTo(tipX + dx * flameLen * 0.38 - nx * (flameW * 1.2), tipY + dy * flameLen * 0.38 - ny * (flameW * 1.2),
          tipX - nx * flameW, tipY - ny * flameW);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.86 + cast * 0.10;
        ctx.fillStyle = '#ffd45e';
        ctx.beginPath();
        ctx.moveTo(tipX + nx * (flameW * 0.36), tipY + ny * (flameW * 0.36));
        ctx.quadraticCurveTo(tipX + dx * flameLen * 0.34 + nx * 2, tipY + dy * flameLen * 0.34 + ny * 2,
          tipX + dx * flameLen * 0.72, tipY + dy * flameLen * 0.72);
        ctx.quadraticCurveTo(tipX + dx * flameLen * 0.34 - nx * 2, tipY + dy * flameLen * 0.34 - ny * 2,
          tipX - nx * (flameW * 0.36), tipY - ny * (flameW * 0.36));
        ctx.closePath();
        ctx.fill();
        for (let i = 0; i < 5; i++) {
          const moteA = now * (0.006 + i * 0.0011) + i * 1.91;
          const moteD = 8 + i * 2.6 + cast * 5;
          const mx = tipX + dx * (5 + i * 1.8) + Math.cos(moteA) * moteD;
          const my = tipY + dy * (5 + i * 1.8) + Math.sin(moteA) * moteD - cast * 4;
          const moteFade = 0.42 + 0.36 * Math.sin(now * 0.010 + i);
          ctx.globalAlpha = (0.24 + cast * 0.24) * moteFade;
          ctx.fillStyle = i % 2 ? '#ffd45e' : '#ff6b32';
          ctx.beginPath();
          ctx.arc(mx, my, 1.6 + (i % 3) * 0.45 + cast * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.strokeStyle = grav ? '#8f7dff' : '#9aa0aa'; ctx.lineWidth = grav ? 2.7 : 2.4;
        ctx.beginPath(); ctx.moveTo(hx + dx * frontLen * L + nx * 5, hy + dy * frontLen * L + ny * 5); ctx.lineTo(hx + dx * frontLen * L - nx * 5, hy + dy * frontLen * L - ny * 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx - dx * backLen + nx * 4, hy - dy * backLen + ny * 4); ctx.lineTo(hx - dx * backLen - nx * 4, hy - dy * backLen - ny * 4); ctx.stroke();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
        if (grav) {
          const tipX = hx + dx * (frontLen + 4) * L, tipY = hy + dy * (frontLen + 4) * L;
          ctx.fillStyle = '#090814';
          ctx.beginPath(); ctx.arc(tipX, tipY, 5.2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#d9d4ff'; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.arc(tipX, tipY, 8.4, -0.85, Math.PI * 1.18); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(hx + dx * 69 * L, hy + dy * 69 * L, 5.5, 0.25, Math.PI * 1.75); ctx.stroke();
        }
      }
    } else if (cls.weapon === 'bow') {
      const pull = currentBowPull();
      const nock = currentRangerNock();
      const shotType = currentRangerShotType();
      ctx.strokeStyle = '#6b5330'; ctx.lineCap = 'round'; ctx.lineWidth = 3.8;
      const span = 30, bulge = 19;
      ctx.beginPath();
      ctx.moveTo(hx + nx * span, hy + ny * span);
      ctx.quadraticCurveTo(hx + dx * bulge, hy + dy * bulge, hx - nx * span, hy - ny * span);
      ctx.stroke();
      ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = 1.2;
      const sx = hx - dx * (4 + pull * 24), sy = hy - dy * (4 + pull * 24);
      ctx.beginPath();
      ctx.moveTo(hx + nx * (span - 1), hy + ny * (span - 1));
      ctx.lineTo(sx, sy);
      ctx.lineTo(hx - nx * (span - 1), hy - ny * (span - 1));
      ctx.stroke();
      if ((pull > 0.05 || nock > 0.42 || (player.anim.atkActive && isRangerShot(player.anim.atkType))) && shotType) {
        ctx.strokeStyle = '#8b6a3b'; ctx.lineWidth = 2.5;
        const offsets = shotType === 'volley' ? [-6, 0, 6] : [0];
        for (const off of offsets) {
          const ox = nx * off, oy = ny * off;
          ctx.beginPath(); ctx.moveTo(sx - dx * 10 + ox, sy - dy * 10 + oy); ctx.lineTo(hx + dx * 34 * L + ox, hy + dy * 34 * L + oy); ctx.stroke();
          ctx.fillStyle = '#aeb4bd'; ctx.beginPath();
          ctx.moveTo(hx + dx * 40 * L + ox, hy + dy * 40 * L + oy);
          ctx.lineTo(hx + dx * 30 * L + nx * 3.6 + ox, hy + dy * 30 * L + ny * 3.6 + oy);
          ctx.lineTo(hx + dx * 30 * L - nx * 3.6 + ox, hy + dy * 30 * L - ny * 3.6 + oy);
          ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
          ctx.strokeStyle = '#8b6a3b'; ctx.lineWidth = 2.5;
        }
      }
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
    const s = scale || 1, active = s > 1.18;
    ctx.translate(hx, hy); ctx.scale(s, s);
    if (active) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#dcecff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(face * -17, -22);
      ctx.quadraticCurveTo(face * 24, -20, face * 26, 2);
      ctx.quadraticCurveTo(face * 18, 28, face * -18, 16);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#5ea0ff'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(face * -12, -19);
    ctx.quadraticCurveTo(face * 18, -17, face * 19, 4);
    ctx.quadraticCurveTo(face * 8, 25, face * -15, 12);
    ctx.quadraticCurveTo(face * -19, -11, face * -12, -19);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.68)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(face * -7, -12); ctx.lineTo(face * 7, 12); ctx.stroke();
    ctx.strokeStyle = 'rgba(22,22,22,.22)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(face * -9, -2); ctx.quadraticCurveTo(face * 3, 4, face * 12, 0); ctx.stroke();
    ctx.restore();
  }
  function drawQuiver(x, y, face, count) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-face * 0.34);
    ctx.fillStyle = '#6b5330';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-8, -16); ctx.lineTo(8, -13); ctx.lineTo(7, 18); ctx.lineTo(-7, 18);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    const n = Math.min(count == null ? RANGER_MAX_ARROWS : count, RANGER_MAX_ARROWS);
    for (let i = 0; i < n; i++) {
      const ox = -5 + i * 1.7;
      ctx.strokeStyle = '#8b6a3b'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ox, -19); ctx.lineTo(ox + 2, -34); ctx.stroke();
      ctx.strokeStyle = '#53d4ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox + 2, -34); ctx.lineTo(ox - 2, -30); ctx.moveTo(ox + 2, -34); ctx.lineTo(ox + 5, -30); ctx.stroke();
    }
    ctx.restore();
  }
  function drawHeldArrow(hx, hy, ang, count, alpha) {
    count = Math.max(1, count || 1);
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const spread = count > 1 ? 4.2 : 0;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spread;
      const x = hx + nx * off, y = hy + ny * off;
      ctx.strokeStyle = '#8b6a3b'; ctx.lineCap = 'round'; ctx.lineWidth = 2.1;
      ctx.beginPath(); ctx.moveTo(x - dx * 16, y - dy * 16); ctx.lineTo(x + dx * 20, y + dy * 20); ctx.stroke();
      ctx.fillStyle = '#aeb4bd'; ctx.strokeStyle = INK; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + dx * 25, y + dy * 25);
      ctx.lineTo(x + dx * 17 + nx * 3, y + dy * 17 + ny * 3);
      ctx.lineTo(x + dx * 17 - nx * 3, y + dy * 17 - ny * 3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#53d4ff'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x - dx * 16, y - dy * 16);
      ctx.lineTo(x - dx * 23 + nx * 3, y - dy * 23 + ny * 3);
      ctx.moveTo(x - dx * 16, y - dy * 16);
      ctx.lineTo(x - dx * 23 - nx * 3, y - dy * 23 - ny * 3);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawSpiritOrbit(cx, cy, charges) {
    const count = clamp(Math.floor(charges || 0), 0, 6);
    if (!count) return;
    const t = performance.now() * 0.0032;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < count; i++) {
      const a = t + i * Math.PI * 2 / count;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.1 + i);
      const x = cx + Math.cos(a) * (25 + pulse * 3.5);
      const y = cy + Math.sin(a) * (22 + pulse * 3.0);
      const tail = 10 + pulse * 5;
      ctx.globalAlpha = 0.18 + pulse * 0.18;
      ctx.strokeStyle = '#b48cff';
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail);
      ctx.quadraticCurveTo(x - Math.sin(a) * 4, y + Math.cos(a) * 4, x, y);
      ctx.stroke();
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = '#f5efff';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 3.8, y);
      ctx.quadraticCurveTo(x, y - 3.2, x - Math.cos(a) * 5.2, y);
      ctx.quadraticCurveTo(x, y + 3.2, x + Math.cos(a) * 3.8, y);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawGravityDebrisOrbit(cx, cy, count, max) {
    count = clamp(Math.floor(count || 0), 0, max || MAGE_DEBRIS_MAX);
    if (!count) return;
    const t = (player.gravityDebrisSpin || 0) + performance.now() * 0.0021;
    const active = player.anim && player.anim.atkActive && player.anim.visualKind === 'gravityDebris';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < count; i++) {
      const a = t + i * Math.PI * 2 / Math.max(1, max || count);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.7);
      const orbitX = 30 + pulse * 4 + (active ? 8 : 0);
      const orbitY = 25 + pulse * 3 + (active ? 4 : 0);
      const x = cx + Math.cos(a) * orbitX;
      const y = cy + Math.sin(a) * orbitY - 9;
      ctx.globalAlpha = 0.16 + pulse * 0.12;
      ctx.strokeStyle = '#8f7dff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.quadraticCurveTo((cx + x) * 0.5 + Math.sin(a) * 5, (cy + y) * 0.5 - 8, x, y);
      ctx.stroke();
      ctx.globalAlpha = 0.90;
      ctx.fillStyle = i % 2 ? '#6d62b8' : '#8574d9';
      ctx.strokeStyle = '#d9d4ff';
      ctx.lineWidth = 1.1;
      const r = 4.2 + pulse * 1.7;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const aa = a * 1.7 + k * Math.PI * 2 / 6;
        const rr = r * (0.72 + ((k + i) % 3) * 0.18);
        const px = x + Math.cos(aa) * rr;
        const py = y + Math.sin(aa) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.72;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawPyromancerCrest(headCX, headCY, shX, shY, f, power) {
    if (!(cls.id === 'mage' && magePyroLoadoutActive())) return;
    const now = performance.now();
    const cast = player && player.anim && player.anim.atkActive && isPyroVisualAttack(player.anim.atkType)
      ? Math.sin(clamp(player.anim.atkT || 0, 0, 1) * Math.PI) : 0;
    const heat = clamp((power || 0) + cast, 0, 1.6);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.58;
    ctx.strokeStyle = '#2a1a11';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(headCX - f * 8, headCY - 8);
    ctx.quadraticCurveTo(headCX - f * 4, headCY - 13, headCX + f * 5, headCY - 11);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const off = (i - 0.5) * 4.4;
      const sway = Math.sin(now * (0.011 + i * 0.002) + i * 2.1) * (1.3 + heat * 0.55);
      const baseX = headCX - f * 2 + off;
      const baseY = headCY - 12;
      const tipX = baseX - f * (5.5 + i * 2.0) + sway;
      const tipY = baseY - (5.5 + i * 1.8 + heat * 2.6);
      ctx.globalAlpha = 0.22 + heat * 0.16;
      ctx.strokeStyle = i === 0 ? '#ff6b32' : '#ffd45e';
      ctx.lineWidth = i === 0 ? 1.45 : 1.15;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo((baseX + tipX) * 0.5 - sway * 0.30, (baseY + tipY) * 0.5, tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawSpiritRemnants() {
    if (!spiritRemnants || !spiritRemnants.length) return;
    const now = performance.now();
    const bindTarget = player && player.team === 'hero' && cls && cls.id === 'mage' && mageSpiritLoadoutActive() ? nearestSpiritRemnant(340) : null;
    const mageX = player ? player.x - cam.x : 0;
    const mageY = player ? player.y - cam.y - 58 : 0;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of spiritRemnants) {
      const fade = clamp(r.life / (r.max || 1), 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.007 + r.x * 0.03);
      const x = r.x - cam.x;
      const y = r.y - cam.y + Math.sin(now * 0.003 + r.y * 0.02) * 3;
      const gy = (r.groundY || r.y + 42) - cam.y;
      const sway = Math.sin(now * 0.004 + r.x * 0.02) * (8 + pulse * 4);
      if (r === bindTarget) {
        const midX = (mageX + x) * 0.5 + Math.sin(now * 0.005 + r.x) * 10;
        const midY = (mageY + y) * 0.5 - 18 + Math.cos(now * 0.004 + r.y) * 5;
        ctx.setLineDash([6, 9]);
        ctx.lineDashOffset = -now * 0.04;
        ctx.globalAlpha = 0.18 + pulse * 0.20;
        ctx.strokeStyle = r.color || '#b48cff';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(mageX, mageY);
        ctx.quadraticCurveTo(midX, midY, x, y);
        ctx.stroke();
        ctx.globalAlpha = 0.34 + pulse * 0.30;
        ctx.strokeStyle = '#f5efff';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(mageX, mageY);
        ctx.quadraticCurveTo(midX, midY, x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.16 * fade;
      ctx.strokeStyle = r.color || '#b48cff';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.quadraticCurveTo(x + sway, (gy + y) * 0.54, x, y);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const phase = now * (0.003 + i * 0.0009) + i * 2.1 + r.x * 0.01;
        const ox = Math.sin(phase) * (9 + i * 3);
        const oy = Math.cos(phase * 0.8) * (3 + i);
        ctx.globalAlpha = (0.20 + pulse * 0.22) * fade * (1 - i * 0.18);
        ctx.strokeStyle = i === 1 ? '#f5efff' : r.color || '#b48cff';
        ctx.lineWidth = i === 1 ? 1.1 : 1.8;
        ctx.beginPath();
        ctx.moveTo(x + ox * 0.45, y + 11 + oy);
        ctx.quadraticCurveTo(x - ox * 0.35, y - 4 - i * 2, x + ox, y - 20 - i * 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.86 * fade;
      ctx.fillStyle = '#f5efff';
      ctx.beginPath();
      ctx.moveTo(x, y - 7 - pulse * 2);
      ctx.quadraticCurveTo(x + 5.0 + pulse * 2, y - 1, x + 1.2, y + 7 + pulse * 2);
      ctx.quadraticCurveTo(x - 5.4 - pulse * 2, y + 1, x, y - 7 - pulse * 2);
      ctx.fill();
      ctx.globalAlpha = 0.50 * fade;
      ctx.strokeStyle = r.color || '#b48cff';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
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
    const flipCurlStrength = flipActive ? (player.flip.curl || 1) : 1;
    const flipTuckStrength = flipActive ? (player.flip.tuck || 1) : 1;
    const flipTuckIn = flipActive ? ease(clamp((flipT - 0.10) / 0.22, 0, 1)) : 0;
    const flipTuckOut = flipActive ? ease(clamp((flipT - 0.64) / 0.25, 0, 1)) : 0;
    const flipTuckBase = flipTuckIn * (1 - flipTuckOut);
    const flipOpen = flipActive ? ease(clamp((flipT - 0.68) / 0.26, 0, 1)) : 0;
    const flipCurl = flipActive ? clamp((Math.sin(flipT * Math.PI) * 0.52 + flipTuckBase * 0.86) * flipCurlStrength, 0, 1.38) : 0;
    const flipTuck = flipActive ? clamp(ease(flipTuckBase) * flipTuckStrength, 0, 1.28) : 0;
    const flipLead = flipActive ? Math.sin(flipT * Math.PI * 2) * flipCurlStrength : 0;
    const flipSpin = flipActive ? flipT * Math.PI * 2 : 0;
    const now = performance.now();
    // metrics — body proportions are shared; STANCE & motion come from the class style
    const S = cls.style;
    const hipH = S.hipH, torso = 30, neck = 4, headR = 12;
    const thigh = 24, shin = 24, uArm = 18, fArm = 16, armLen = uArm + fArm;
    const strideH = S.strideH, lift = S.lift, armStride = S.armStride, bounceAmp = S.bounceAmp, sway = 2, stanceW = S.stanceW;
    const guardReach = armLen * 0.6;            // bent-elbow "on guard" hold
    const posture = actorPosture(player);
    const bowActive = cls.id === 'ranger' && ((player.draw && player.draw.active) || (a.atkActive && isRangerShot(a.atkType)));
    const bowRestAim = Math.PI / 2 + f * 0.08;
    const bowAim = player.draw && player.draw.active ? player.draw.aim : (a.atkActive && isRangerShot(a.atkType) ? a.atkAim : bowRestAim);
    const bowPull = currentBowPull();
    const bowNock = player.draw && player.draw.active ? rangerNockAmount(player) : bowActive ? 1 : 0;
    const bowReload = cls.id === 'ranger' ? rangerReloadAmount(player) : 1;
    const bowGripReach = 33;

    const idleAmt = (1 - moveAmt) * (1 - air);
    const idleFidget = idleAmt * Math.sin(now * 0.0022 + cls.id.length);
    const idleLift = idleAmt * (0.5 + 0.5 * Math.sin(now * 0.00135 + cls.id.length * 0.7));
    const bob = bounceAmp * moveAmt * (0.5 - 0.5 * Math.cos(2 * p));   // downward compression
    const breathe = idleAmt * Math.sin(now * S.breatheSpd) * S.breatheAmp;
    // signature idle flourish + hover (the "personality" beat)
    let idleX = 0, idleY = 0, hoverY = 0;
    if (S.idle === 'shift') { idleX = Math.sin(now * 0.0016) * 2.6 * idleAmt; idleY = idleLift * 0.45; } // Knight: heavy weight shift
    else if (S.idle === 'sneak') idleX = Math.sin(now * 0.003) * 1.3 * idleAmt + idleFidget * 0.5;       // Rogue: low restless sway
    else if (S.idle === 'lance') idleY = Math.sin(now * 0.0012) * 0.35 * idleAmt + idleLift * 0.28;      // Lancer: locked-down stance
    else if (S.idle === 'mystic') idleY = Math.sin(now * 0.0017) * 0.9 * idleAmt + idleLift * 0.35;      // Mage: grounded staff breathing
    else if (S.idle === 'archer') idleX = Math.sin(now * 0.0018) * 1.0 * idleAmt + idleFidget * 0.35;
    hoverY = fly * (S.hover + Math.sin(now * 0.004) * 1.8);

    let postureLean = 0, guardCrouch = 0;            // (no cursor aiming for now)
    if (moveType === 'slide') { postureLean -= f * 0.96; guardCrouch = 36 * Math.sin(moveT * Math.PI); }
    else if (moveType === 'shoulder' || moveType === 'shieldStep' || moveType === 'brace') postureLean += f * 0.16 * Math.sin(moveT * Math.PI);
    else if (moveType === 'airDash') postureLean += f * 0.22;
    if (posture.down > 0 || posture.sweep > 0) {
      postureLean += posture.lean;
      guardCrouch = Math.max(guardCrouch, posture.drop);
    }
    if (flipActive) {
      postureLean += player.flip.dir * (0.34 * flipCurl + 0.22 * flipTuck + 0.16 * flipLead - 0.14 * flipOpen);
      guardCrouch -= 20 * flipCurl + 7 * flipTuck;
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
      else if (isPyroVisualAttack(ty)) { castT = t; const m = pyroBodyOffset(ty, t, f); atkHip = m.x; clipHipY = m.y; atkLean = m.lean; }
      else if (ty === 'cast' || ty === 'arcaneBloom') { castT = t; atkHip = f * bell * 3; atkLean = f * bell * 0.05; }
      else if (ty === 'arrow' || ty === 'volley') { shootT = t; atkHip = -f * bell * 2; atkLean = -f * bell * 0.05; }
      else if (ty === 'throw') { throwT = t; atkHip = f * bell * 5; atkLean = -f * 0.16 + f * bell * 0.24; }
      else { slashT = t; atkHip = f * bell * (ty === 'dualSlash' ? 4 : 6); atkLean = f * bell * (ty === 'dualSlash' ? 0.11 : 0.16); }   // slash body commit
    }

    const hiddenFade = clamp((player.hidden || 0) / (hasPassive('rg_nightshade') ? 1900 : 1300), 0, 1);
    ctx.save();
    ctx.translate(player.x, player.y - hoverY);         // hoverY floats the whole figure (Mage)
    if (hiddenFade > 0) {
      ctx.globalAlpha = lerp(1, 0.48, hiddenFade);
      ctx.shadowColor = `rgba(88, 94, 116, ${0.22 + hiddenFade * 0.28})`;
      ctx.shadowBlur = 8 + hiddenFade * 10;
    }
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
      headCX = lerp(headCX, hipX - player.flip.dir * (10 + flipTuck * 8 + flipLead * 2), flipCurl * 0.62);
      headCY = lerp(headCY, hipY - 15 + flipTuck * 2 - flipOpen * 3, flipCurl * 0.64);
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

    if (hiddenFade > 0) drawHiddenSilhouette(hipX, hipY, shX, shY, headCX, headCY, hiddenFade, f);

    const teamAccent = actorTeamAccent(player);
    drawTeamGroundMarker(teamAccent, f);

    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    if (cls.id === 'mage' && player.team === 'hero' && mageSpiritLoadoutActive() && (player.spiritCharges || 0) > 0) {
      drawSpiritOrbit((hipX + shX) * 0.5, (hipY + shY) * 0.5, player.spiritCharges);
    }
    if (cls.id === 'mage' && player.team === 'hero' && mageGraviturgeLoadoutActive() && (player.gravityDebris || 0) > 0) {
      drawGravityDebrisOrbit((hipX + shX) * 0.5, (hipY + shY) * 0.5, player.gravityDebris, gravityDebrisMax());
    }
    if (cls.id === 'ranger') drawQuiver(shX - f * 13, shY + 23, f, player.arrowAmmo);

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
        foot.x = frontLeg ? f * (62 + 18 * slide) : -f * (38 + 12 * slide);
        foot.y = frontLeg ? 2 : -9;
      } else if (flipActive) {
        const kneePhase = flipSpin + legSign * 0.62;
        const tuckX = -player.flip.dir * (18 + flipTuck * 9 + flipCurl * 2) + legSign * (8 - flipTuck * 3) + Math.cos(kneePhase) * 2.2;
        const tuckY = hipY - 13 + legSign * 3 + Math.sin(kneePhase) * 2.2;
        const openX = player.flip.dir * (11 + flipOpen * 13) + legSign * (8 + flipOpen * 5);
        const openY = -9 + legSign * 2 - flipOpen * 4;
        const tuckAmt = clamp(flipTuck * 1.08, 0, 1);
        foot.x = lerp(foot.x, tuckX, tuckAmt);
        foot.y = lerp(foot.y, tuckY, tuckAmt);
        foot.x = lerp(foot.x, openX, flipOpen * 0.70);
        foot.y = lerp(foot.y, openY, flipOpen * 0.70);
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
    function rogueFlipHandTarget(side) {
      const phase = flipSpin + side * 0.72;
      const tuckX = shX - player.flip.dir * (19 + flipCurl * 8 + flipTuck * 8) + side * (6 - flipTuck * 2) + Math.cos(phase) * 2.5;
      const tuckY = shY + 2 + flipTuck * 8 + Math.sin(phase) * 3.0;
      const openX = shX + player.flip.dir * (side > 0 ? 23 : -10) + side * 3;
      const openY = shY + (side > 0 ? 5 : 17) - flipOpen * 4;
      return {
        x: lerp(tuckX, openX, flipOpen * 0.62),
        y: lerp(tuckY, openY, flipOpen * 0.62),
      };
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
        hand.x = lerp(hand.x, shX + f * (front ? 44 : -24), slide);
        hand.y = lerp(hand.y, shY + (front ? 25 : 29), slide);
      }
      if (posture.down > 0 || posture.sweep > 0) {
        const duck = Math.max(posture.down, posture.sweep);
        const front = theta === p;
        hand.x = lerp(hand.x, shX + f * (front ? 18 : -12), duck);
        hand.y = lerp(hand.y, shY + (front ? 22 : 26), duck);
      }
      if (flipActive) {
        const target = rogueFlipHandTarget(theta === p ? 1 : -1);
        const fold = clamp(flipCurl * 0.82 + flipTuck * 0.35, 0, 1);
        hand.x = lerp(hand.x, target.x, fold);
        hand.y = lerp(hand.y, target.y, fold);
      }
      return hand;
    }

    // rogue dual-wield strikes alternate hands; this strike belongs to the off hand
    const rogueOff = cls.id === 'rogue' && a.atkActive && (a.atkType === 'dualSlash' || a.atkType === 'rogueStab') && a.rogueHand === 1;
    const rogueStrikeT = a.atkType === 'rogueStab' ? stabT : slashT;
    // ----- back arm (ragdoll: hand position springs loosely so the elbow swings) -----
    const knifeTrick = cls.id === 'rogue' && !a.atkActive && idleAmt > 0.72 && ((now % 4300) / 4300) > 0.70
      ? ease((((now % 4300) / 4300) - 0.70) / 0.30) : 0;
    let h = armHand(p), offhandAim = null, offhandStretch = 1, offhandBend = f;
    if (rogueOff && rogueStrikeT !== null) {
      // full-range off-hand strike (uses the same engine as the front hand)
      const pose = weaponPose(a.atkType, rogueStrikeT, a.atkAim, f, a.atkVar);
      const bc = armChain(shX, shY, pose.shAng, pose.elBend);
      offhandAim = bc.foreAng + pose.wrBend;
      offhandStretch = 1 + Math.sin(clamp(rogueStrikeT, 0, 1) * Math.PI) * 0.18;
      h = { x: bc.hx, y: bc.hy };
    } else if (cls.id === 'rogue') {
      h = flipActive
        ? rogueFlipHandTarget(-1)
        : moveType === 'slide'
          ? { x: shX - f * 28, y: shY + 29 }
          : { x: shX - f * 9, y: shY + 20 };                       // off dagger held at low guard
    } else if (cls.offhand === 'shield') {
      const guarding = (player.shieldGuard || 0) > 0 || (a.atkActive && a.atkType === 'shieldGuard');
      const push = guarding ? 0.72 : (a.atkActive && a.atkType === 'shieldBash') || moveType === 'shieldStep' ? Math.sin(Math.min(1, a.atkT || moveT) * Math.PI) : 0;
      h = { x: shBX + f * (15 + push * 27 + idleLift * 1.2), y: shBY + 15 - push * 9 + idleFidget * 1.1 };
    } else if (cls.weapon === 'lance') {
      h = { x: shX - f * (4 + idleLift * 1.6), y: shY + 18 + idleFidget * 1.0 };
    } else if (cls.weapon === 'staff') {
      if (a.atkActive && isPyroVisualAttack(a.atkType)) {
        const pose = weaponPose(a.atkType, clamp(a.atkT, 0, 1), a.atkAim, f, a.atkVar);
        const wc = armChain(shX, shY, pose.shAng, pose.elBend);
        const wang = wc.foreAng + pose.wrBend;
        const breathChannel = a.atkType === 'pyroBreath' || a.atkType === 'pyroDragon';
        const gripBack = a.atkType === 'pyroDragon' ? 52 : a.atkType === 'pyroBreath' ? 44 : a.atkType === 'pyroGroundFlow' ? 26 : 20;
        const gripSide = breathChannel ? (a.atkType === 'pyroDragon' ? 2.5 : 1.5) : 0;
        h = {
          x: wc.hx - Math.cos(wang) * gripBack - Math.sin(wang) * gripSide,
          y: wc.hy - Math.sin(wang) * gripBack + Math.cos(wang) * gripSide,
        };
        offhandStretch = breathChannel ? 1.08 : 1;
        offhandBend = -f;
      } else if (magePyroLoadoutActive()) {
        h = fly > 0.25
          ? { x: shX + f * (13 + idleLift * 2), y: shY + 21 + idleFidget * 1.4 }
          : { x: shX + f * (7 + idleLift * 1.4), y: shY + 28 + idleFidget * 1.1 };
      } else {
        h = fly > 0.25
          ? { x: shX + f * (10 + idleLift * 2), y: shY + 24 + idleFidget * 1.6 }
          : { x: shX + f * (8 + idleLift * 1.4), y: shY + 32 + idleFidget * 1.3 };
      }
    } else if (cls.weapon === 'bo') {
      if (a.atkActive && (a.atkType === 'staffSweep' || a.atkType === 'vaultKick')) h = { x: shX - f * 10, y: shY + 20 };
    } else if (cls.weapon === 'bow') {
      if (bowActive) {
        const bx = shX + Math.cos(bowAim) * bowGripReach, by = shY + Math.sin(bowAim) * bowGripReach;
        const passive = { x: shX - f * 12, y: shY + 30 };
        const string = { x: bx - Math.cos(bowAim) * (11 + bowPull * 28), y: by - Math.sin(bowAim) * (11 + bowPull * 28) };
        string.y = Math.max(string.y, shY + 3 + bowPull * 5);
        h = { x: lerp(passive.x, string.x, bowNock), y: lerp(passive.y, string.y, bowNock) };
        offhandBend = -f;
      } else {
        const quiver = { x: shX - f * 19, y: shY + 37 };
        const passive = { x: shX - f * (12 + idleLift * 1.4), y: shY + 30 + idleFidget * 1.0 };
        h = { x: lerp(quiver.x, passive.x, bowReload), y: lerp(quiver.y, passive.y, bowReload) };
        offhandBend = -f;
      }
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
    let ka = ik(shBX, shBY, a.bhx, a.bhy, uArm * offhandStretch, fArm * offhandStretch, offhandBend);
    seg(shBX, shBY, ka.jx, ka.jy, ka.ex, ka.ey, 6 / Math.sqrt(offhandStretch));
    if (cls.dual && player.knifeAmmo > 1) {
      let offAng = offhandAim != null ? offhandAim : Math.atan2(ka.ey - ka.jy, ka.ex - ka.jx);
      if (knifeTrick) offAng += f * Math.PI * 4 * knifeTrick;
      drawWeapon(ka.ex, ka.ey, offAng, offhandStretch);
      if (offhandAim != null) {
        slashTrail.push({ x: player.x + ka.ex + Math.cos(offAng) * WLEN.dagger * offhandStretch, y: (player.y - hoverY) + ka.ey + Math.sin(offAng) * WLEN.dagger * offhandStretch, life: 170, c: cls.trail });
        if (slashTrail.length > 38) slashTrail.shift();
      }
    } else if (cls.weapon === 'bow') {
      const shotCount = bowActive && ((player.draw && player.draw.type === 'volley') || (a.atkActive && a.atkType === 'volley')) ? 3 : 1;
      const looseAlpha = bowActive ? clamp(1 - bowNock, 0, 1) : clamp(bowReload, 0, 1);
      if (player.arrowAmmo > 0 && looseAlpha > 0.04) drawHeldArrow(ka.ex, ka.ey, bowAim == null ? (f > 0 ? 0 : Math.PI) : bowAim, shotCount, looseAlpha);
    } else if (cls.offhand === 'shield') {
      const guarding = (player.shieldGuard || 0) > 0 || (a.atkActive && a.atkType === 'shieldGuard');
      drawShield(ka.ex, ka.ey, f, guarding ? 1.42 + clamp((player.shieldFlash || 0) / 180, 0, 1) * 0.20 : (a.atkActive && a.atkType === 'shieldBash') || moveType === 'shieldStep' ? 1.24 : 1.08);
    }

    // ----- far leg ----- (knees bend forward: bend = -f; 0.6 = visually straighter)
    let lt = legFoot(p + Math.PI, +1);
    const flipLegScale = flipActive ? lerp(1, 0.68, flipTuck) : 1;
    const farBend = flipActive ? player.flip.dir : -f;
    const nearBend = flipActive ? -player.flip.dir : -f;
    let k = ik(hipBX, hipY, hipBX + lt.x, lt.y, thigh * flipLegScale, shin * flipLegScale, farBend, flipActive ? 1 : 0.6);
    seg(hipBX, hipY, k.jx, k.jy, k.ex, k.ey, 7);

    // ----- torso + head -----
    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();          // spine
    ctx.beginPath(); ctx.arc(headCX + a.headLag * (1 - air), headCY, headR, 0, Math.PI * 2); ctx.fill();
    drawPyromancerCrest(headCX + a.headLag * (1 - air), headCY, shX, shY, f, clamp((player.pyroBreath || 0) / 900, 0, 1));
    drawTeamBodyMarker(teamAccent, hipX, hipY, shX, shY, headCX + a.headLag * (1 - air), headCY, headR, f);

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
      if (!(cls.id === 'rogue' && player.knifeAmmo <= 0)) drawWeapon(wc.hx, wc.hy, a.blAng, 1);
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
        if (magePyroLoadoutActive()) {
          drawAim = -Math.PI / 2 + f * (fly > 0.25 ? 0.42 : 0.30);
          handT = fly > 0.25 ? { x: shX + f * 17, y: shY + 7 } : { x: shX + f * 16, y: shY + 15 };
        } else {
          drawAim = -Math.PI / 2 + f * (fly > 0.25 ? 0.24 : 0.16);
          handT = fly > 0.25 ? { x: shX + f * 15, y: shY + 8 } : { x: shX + f * 12, y: shY + 19 };
        }
      } else if (cls.weapon === 'bow') {
        drawAim = bowActive ? bowAim : bowRestAim;
        handT = bowActive
          ? { x: shX + Math.cos(drawAim) * bowGripReach, y: shY + Math.sin(drawAim) * bowGripReach }
          : { x: shX + f * (8 + idleLift * 1.0), y: shY + 32 + idleFidget * 0.8 };
        stretch = bowActive ? 1.10 : 0.96;
      } else if (cls.weapon === 'bo') {
        drawAim = f > 0 ? -0.36 : Math.PI + 0.36;
        handT = { x: shX + f * 12, y: shY + 18 };
      } else if (cls.weapon === 'hammer') {
        drawAim = f > 0 ? -1.08 : Math.PI + 1.08;
        handT = { x: shX + f * 12, y: shY + 12 };
      } else if (cls.id === 'rogue') {
        drawAim = flipActive ? -Math.PI / 2 + player.flip.dir * (0.24 + flipTuck * 0.18) + Math.sin(flipSpin) * 0.16 : f > 0 ? 0.12 : Math.PI - 0.12;
        handT = flipActive
          ? rogueFlipHandTarget(1)
          : moveType === 'slide'
            ? { x: shX + f * 46, y: shY + 24 }
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
      if (!(cls.id === 'rogue' && player.knifeAmmo <= 0)) drawWeapon(ka.ex, ka.ey, wAng, stretch);
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
    if (isOneWay(p)) {
      ctx.fillStyle = '#8f897b'; ctx.fillRect(x, y + 3, p.w, Math.max(4, p.h - 4));
      ctx.fillStyle = INK; ctx.fillRect(x, y, p.w, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (let sx = x + 18; sx < x + p.w - 8; sx += 36) ctx.fillRect(sx, y + 5, 12, 2);
      return;
    }
    ctx.fillStyle = '#cbc7b8'; ctx.fillRect(x, y, p.w, p.h);          // light body
    ctx.fillStyle = INK; ctx.fillRect(x, y, p.w, 5);                 // bold black ledge
  }
  function drawBoxHeatOverlay(b, hw, hh) {
    const heat = clamp((b.heat || 0) / 100, 0, 1);
    const flash = clamp((b.heatFlash || 0) / 220, 0, 1);
    if (heat <= 0 && flash <= 0) return;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.018 + b.x);
    ctx.save();
    ctx.globalAlpha = 0.12 + heat * 0.34 + flash * 0.16;
    ctx.fillStyle = '#ff6b32';
    ctx.fillRect(-hw + 2, -hh + 2, hw * 2 - 4, hh * 2 - 4);
    ctx.globalAlpha = 0.24 + heat * 0.52;
    ctx.strokeStyle = heat > 0.75 ? '#ffd45e' : '#ff9f6e';
    ctx.lineWidth = 1.4 + heat * 2.2;
    ctx.strokeRect(-hw + 3, -hh + 3, hw * 2 - 6, hh * 2 - 6);
    if (b.kind === 'barrel') {
      ctx.globalAlpha = 0.45 + heat * 0.45;
      ctx.strokeStyle = '#ffd45e';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-hw * 0.3, -hh - 5);
      ctx.quadraticCurveTo(0, -hh - 13 - pulse * 5, hw * 0.28, -hh - 4);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawBox(b) {
    const cx = b.x + b.w / 2 - cam.x, cy = b.y + b.h / 2 - cam.y, hw = b.w / 2, hh = b.h / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(b.angle || 0);
    if (b.kind === 'barrel') {
      ctx.fillStyle = '#b64628';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-hw, -hh, b.w, b.h, 8) : ctx.rect(-hw, -hh, b.w, b.h);
      ctx.fill();
      ctx.fillStyle = '#ffd45e'; ctx.fillRect(-hw + 5, -4, b.w - 10, 8);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.strokeRect(-hw + 1.5, -hh + 1.5, b.w - 3, b.h - 3);
      drawBoxHeatOverlay(b, hw, hh);
      ctx.restore(); return;
    }
    if (b.kind === 'spring') {
      ctx.fillStyle = '#26384f'; ctx.fillRect(-hw, -hh, b.w, b.h);
      ctx.strokeStyle = '#8fe6ff'; ctx.lineWidth = 2;
      for (let x = -hw + 6; x < hw - 4; x += 10) { ctx.beginPath(); ctx.moveTo(x, hh - 3); ctx.lineTo(x + 5, -hh + 3); ctx.lineTo(x + 10, hh - 3); ctx.stroke(); }
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.strokeRect(-hw + 1, -hh + 1, b.w - 2, b.h - 2);
      drawBoxHeatOverlay(b, hw, hh);
      ctx.restore(); return;
    }
    if (b.kind === 'barrier') {
      const fade = b.life ? clamp(b.life / 5200, 0.25, 1) : 0.75;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(120,170,255,.42)'; ctx.fillRect(-hw, -hh, b.w, b.h);
      ctx.strokeStyle = '#5ea0ff'; ctx.lineWidth = 3; ctx.strokeRect(-hw + 1.5, -hh + 1.5, b.w - 3, b.h - 3);
      drawBoxHeatOverlay(b, hw, hh);
      ctx.restore(); return;
    }
    ctx.fillStyle = '#bb8a4e'; ctx.fillRect(-hw, -hh, b.w, b.h);          // wood
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.lineJoin = 'miter';
    ctx.strokeRect(-hw + 1.5, -hh + 1.5, b.w - 3, b.h - 3);
    ctx.lineWidth = 1.5;                                                  // plank cross
    ctx.beginPath();
    ctx.moveTo(-hw + 3, -hh + 3); ctx.lineTo(hw - 3, hh - 3);
    ctx.moveTo(hw - 3, -hh + 3); ctx.lineTo(-hw + 3, hh - 3);
    ctx.stroke();
    drawBoxHeatOverlay(b, hw, hh);
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
    if (!L.flag) return;
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
      if (allies) for (const a of allies) {
        for (const s of actorCapsules(a)) drawDebugCapsule(s.ax, s.ay, s.bx, s.by, s.r, a.cls.color || '#53d4ff', 0.18);
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
  function drawRangerTrajectory() {
    if (!player || cls.id !== 'ranger' || !player.draw || !player.draw.active) return;
    const aim = player.draw.aim;
    const power = 0.48 + rangerDrawPower(player) * 0.92;
    const lanes = player.draw.type === 'volley' ? [-0.13, 0, 0.13] : [0];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const off of lanes) {
      const a = aim + off, o = arrowOrigin(a);
      let x = o.x, y = o.y, vx = Math.cos(a) * arrowSpeed(power), vy = Math.sin(a) * arrowSpeed(power);
      ctx.strokeStyle = off === 0 ? 'rgba(83,212,255,0.62)' : 'rgba(83,212,255,0.34)';
      ctx.lineWidth = off === 0 ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 34; i++) {
        x += vx * 0.55;
        y += vy * 0.55;
        vy += ARROW_GRAVITY * 0.55;
        if (i % 2 === 0) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        const r = { x: x - 2, y: y - 2, w: 4, h: 4 };
        const L = levels[li];
        if (L.platforms.some(p => !isOneWay(p) && hit(r, p)) || boxes.some(b => hit(r, b))) break;
      }
      ctx.stroke();
    }
    ctx.restore();
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
  function drawArenaOverlay() {
    if (!arenaMode || labMode || state !== 'playing') return;
    let text = '';
    let alpha = 0;
    if (arenaBanner > 0) { text = `WAVE ${arenaWave || 1}`; alpha = clamp(arenaBanner / 650, 0, 1); }
    else if (fighters && fighters.length === 0) { text = `WAVE ${(arenaWave || 1) + 1}`; alpha = 0.55 + 0.25 * Math.sin(performance.now() * 0.012); }
    if (!text) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.76)';
    ctx.strokeStyle = 'rgba(22,22,22,.34)';
    ctx.lineWidth = 5;
    ctx.strokeText(text, view.w / 2, 92);
    ctx.fillStyle = '#161616';
    ctx.fillText(text, view.w / 2, 92);
    ctx.restore();
  }
  function addGravityTetherTarget(out, g, x, y, kind) {
    const dx = x - g.x, dy = y - g.y, d = Math.hypot(dx, dy) || 1;
    if (d > g.r * 1.04) return;
    out.push({ x, y, kind, d, pull: 1 - Math.min(d, g.r) / g.r });
  }
  function gravityCoreTetherTargets(g) {
    const out = [];
    for (const b of boxes || []) {
      if (b.dead) continue;
      addGravityTetherTarget(out, g, b.x + b.w / 2, b.y + b.h / 2, b.kind || 'box');
    }
    const actors = (g.team || 'hero') === 'enemy' ? enemyAttackTargets().filter(actorCanBeHitByEnemy) : (fighters || []);
    for (const act of actors || []) {
      if (!fieldAffectsActor(g, act)) continue;
      addGravityTetherTarget(out, g, act.x, act.y - 42, 'actor');
    }
    if ((g.team || 'hero') !== 'enemy') for (const d of dummies || []) {
      const pts = d && d.pts;
      if (!pts) continue;
      const p = pts.chest || pts.head || pts.hip || Object.values(pts)[0];
      if (p) addGravityTetherTarget(out, g, p.x, p.y, 'dummy');
    }
    out.sort((a, b) => b.pull - a.pull);
    return out.slice(0, 7);
  }
  function drawGravityCoreTethers(g, t) {
    const targets = gravityCoreTetherTargets(g);
    if (!targets.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([8, 9]);
    ctx.lineDashOffset = -t * 0.04;
    for (const target of targets) {
      const dx = g.x - target.x, dy = g.y - target.y;
      const mx = target.x + dx * 0.52 + Math.sin(t * 0.004 + target.x * 0.02) * 9;
      const my = target.y + dy * 0.52 - 8 + Math.cos(t * 0.003 + target.y * 0.02) * 5;
      const alpha = 0.16 + target.pull * 0.36 + Math.sin(t * 0.012 + target.d) * 0.035;
      ctx.globalAlpha = clamp(alpha, 0.12, 0.56);
      ctx.strokeStyle = g.color || '#ff77d2';
      ctx.lineWidth = 2.4 + target.pull * 2.6;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y);
      ctx.quadraticCurveTo(mx, my, g.x, g.y);
      ctx.stroke();
      ctx.globalAlpha = clamp(alpha * 0.74, 0.08, 0.35);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1 + target.pull * 1.2;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y);
      ctx.quadraticCurveTo(mx, my, g.x, g.y);
      ctx.stroke();
      ctx.globalAlpha = clamp(0.20 + target.pull * 0.32, 0.16, 0.52);
      ctx.setLineDash([]);
      ctx.fillStyle = target.kind === 'barrel' ? '#ffd45e' : '#ffffff';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 2.8 + target.pull * 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([8, 9]);
    }
    ctx.restore();
  }
  function traceWobblyCirclePath(x, y, r, opts) {
    opts = opts || {};
    const steps = opts.steps || 72;
    const phase = opts.phase || 0;
    const rough = opts.rough == null ? 0.045 : opts.rough;
    const yScale = opts.yScale == null ? 1 : opts.yScale;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const a = u * Math.PI * 2;
      const wob = 1
        + Math.sin(a * 3 + phase) * rough
        + Math.sin(a * 7 - phase * 0.7) * rough * 0.52;
      const px = x + Math.cos(a) * r * wob;
      const py = y + Math.sin(a) * r * yScale * wob;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function drawShockwaves() {
    if (!shockwaves || !shockwaves.length) return;
    ctx.save();
    for (const w of shockwaves) {
      const p = 1 - clamp(w.life / (w.max || 1), 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const fade = clamp(w.life / (w.max || 1), 0, 1);
      const r = w.r * (0.16 + eased * 0.84);
      const yScale = w.yScale == null ? 1 : w.yScale;
      const phase = (w.phase || 0) + p * 2.2;
      ctx.globalAlpha = fade * (w.fill || 0.08);
      ctx.fillStyle = w.color || '#ff77d2';
      traceWobblyCirclePath(w.x, w.y, r, { yScale, phase, rough: w.rough });
      ctx.fill();
      ctx.globalAlpha = fade * 0.76;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.2, (w.width || 5) * (1 - p * 0.45));
      traceWobblyCirclePath(w.x, w.y, r, { yScale, phase: phase + 0.8, rough: (w.rough || 0.045) * 1.18 });
      ctx.stroke();
      ctx.globalAlpha = fade * 0.58;
      ctx.strokeStyle = w.color || '#ff77d2';
      ctx.lineWidth = Math.max(1, (w.width || 5) * 0.46);
      traceWobblyCirclePath(w.x, w.y, r * 0.84, { yScale, phase: phase - 0.45, rough: (w.rough || 0.045) * 0.82 });
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawGravityCore() {
    const g = gravityCore;
    if (!g) return;
    const t = performance.now();
    const pulse = 1 + Math.sin(t * 0.006) * 0.045;
    const charge = clamp(g.resonance || 0, 0, g.resonanceMax || 5);
    const chargeFlash = clamp((g.resonancePulse || 0) / 620, 0, 1);
    const rr = (g.r + charge * 7) * pulse;
    ctx.save();
    const grad = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, rr);
    grad.addColorStop(0, `rgba(255,255,255,${0.34 + chargeFlash * 0.12})`);
    grad.addColorStop(0.22, `rgba(255,119,210,${0.22 + charge * 0.018})`);
    grad.addColorStop(0.68, `rgba(255,119,210,${0.10 + charge * 0.012})`);
    grad.addColorStop(1, 'rgba(255,119,210,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(g.x, g.y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'round';
    for (let ring = 0; ring < 3; ring++) {
      const r = rr * (0.34 + ring * 0.18 + Math.sin(t * 0.002 + ring) * 0.018);
      ctx.strokeStyle = ring === 0 ? 'rgba(255,255,255,.62)' : 'rgba(255,119,210,.44)';
      ctx.lineWidth = ring === 0 ? 2.4 : 1.7;
      ctx.beginPath();
      for (let i = 0; i <= 56; i++) {
        const a = i / 56 * Math.PI * 2 + t * (0.0014 + ring * 0.00055);
        const wob = Math.sin(a * 3 + t * 0.003 + ring) * 3;
        const x = g.x + Math.cos(a) * (r + wob);
        const y = g.y + Math.sin(a) * (r + wob);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    const moteCount = Math.ceil(charge);
    for (let i = 0; i < moteCount; i++) {
      const a = t * (0.003 + i * 0.00038) + i * Math.PI * 2 / Math.max(1, moteCount);
      const orbit = rr * (0.28 + (i % 3) * 0.13);
      const x = g.x + Math.cos(a) * orbit;
      const y = g.y + Math.sin(a) * orbit;
      const motePulse = 0.55 + 0.45 * Math.sin(t * 0.013 + i);
      ctx.globalAlpha = 0.44 + chargeFlash * 0.25;
      ctx.fillStyle = i % 2 ? g.color : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3.2 + motePulse * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.24 + chargeFlash * 0.22;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y, 7 + motePulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawGravityCoreTethers(g, t);
    ctx.fillStyle = g.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4 + chargeFlash * 1.1;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(g.x, g.y, 9 + charge * 0.9 + Math.sin(t * 0.01) * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawBlackHoleField(g, t) {
    const fade = clamp(g.life / (g.max || 1), 0, 1);
    const age = 1 - fade;
    const pulse = 1 + Math.sin(t * 0.010 + (g.phase || 0)) * 0.035;
    const rr = g.r * pulse;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const grad = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, rr);
    grad.addColorStop(0, `rgba(0,0,0,${0.94 * fade})`);
    grad.addColorStop(0.16, `rgba(8,7,18,${0.88 * fade})`);
    grad.addColorStop(0.36, `rgba(86,72,176,${0.30 * fade})`);
    grad.addColorStop(0.72, `rgba(143,125,255,${0.12 * fade})`);
    grad.addColorStop(1, 'rgba(143,125,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(g.x, g.y, rr, 0, Math.PI * 2); ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let ring = 0; ring < 4; ring++) {
      const baseR = rr * (0.22 + ring * 0.145 + Math.sin(t * 0.002 + ring) * 0.012);
      ctx.globalAlpha = fade * (ring === 0 ? 0.82 : 0.34);
      ctx.strokeStyle = ring === 0 ? '#d9d4ff' : (ring % 2 ? g.color : '#ffffff');
      ctx.lineWidth = ring === 0 ? 2.8 : 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const u = i / 96;
        const a = u * Math.PI * 2 + t * (0.0032 + ring * 0.0008) + ring * 0.7;
        const swirl = Math.sin(u * Math.PI * 6 + t * 0.006 + ring) * (3.5 + ring);
        const x = g.x + Math.cos(a) * (baseR + swirl);
        const y = g.y + Math.sin(a) * (baseR + swirl);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.96 * fade;
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.arc(g.x, g.y, 19 + age * 9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.82 * fade;
    ctx.strokeStyle = '#d9d4ff';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(g.x, g.y, 25 + Math.sin(t * 0.014) * 2.3, 0, Math.PI * 2); ctx.stroke();
    drawGravityCoreTethers(g, t);
    ctx.restore();
  }
  function drawAbilityMarkers() {
    const t = performance.now();
    ctx.save();
    ctx.lineCap = 'round';
    for (const a of anchors || []) {
      const fade = clamp((a.life || 0) / (a.max || 1), 0, 1);
      const pulse = 1 + Math.sin(t * 0.012 + a.x) * 0.08;
      ctx.globalAlpha = 0.78 * fade;
      ctx.strokeStyle = a.color || '#ffd45e';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 26); ctx.lineTo(a.x, a.y + 28); ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(a.x, a.y - 14, 15 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = a.color || '#ffd45e';
      ctx.beginPath(); ctx.arc(a.x, a.y - 14, 27 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x - 18, a.y + 24); ctx.lineTo(a.x + 18, a.y + 24); ctx.stroke();
    }
    if (portals && portals.length >= 2) {
      const [a, b] = portals;
      const fade = Math.min(clamp(a.life / (a.max || 1), 0, 1), clamp(b.life / (b.max || 1), 0, 1));
      ctx.globalAlpha = 0.30 * fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of portals) {
        const r = 24 + Math.sin(t * 0.01 + p.x) * 2.2;
        ctx.globalAlpha = 0.82 * fade;
        ctx.strokeStyle = p.color || cls.color;
        ctx.lineWidth = 3;
        traceWobblyCirclePath(p.x, p.y, r, { phase: t * 0.002 + p.x * 0.03, rough: 0.080, steps: 54 });
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        traceWobblyCirclePath(p.x, p.y, r * 0.56, { phase: -t * 0.002 + p.y * 0.03, rough: 0.060, steps: 42 });
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawFlameBreaths() {
    // Flame Breath and Dragon Breath are visualized by simulated flame/smoke
    // particles emitted in updateFlameBreaths; no painted cone layer.
  }
  function drawFireZones() {
    if (!fireZones || !fireZones.length) return;
    const t = performance.now();
    ctx.save();
    ctx.lineCap = 'round';
    for (const z of fireZones) {
      const fade = clamp(z.life / z.max, 0, 1);
      const flare = clamp((z.flare || 0) / 420, 0, 1);
      const pulse = 1 + Math.sin(t * 0.011 + z.x) * (0.055 + flare * 0.035) + flare * 0.08;
      const rw = (z.w || (z.ground ? z.r * 2.05 : z.r * 1.35)) * pulse;
      const rh = (z.ground ? z.r * 0.22 : z.r * 0.34) * (0.88 + flare * 0.10);
      if (z.ground) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.18 * fade;
        ctx.strokeStyle = '#5b1e12';
        ctx.lineWidth = 2.2 + flare * 0.8;
        ctx.beginPath();
        const scorchN = 8;
        for (let i = 0; i <= scorchN; i++) {
          const u = -0.5 + i / scorchN;
          const x = z.x + u * rw * 1.12;
          const y = z.y + Math.sin(t * 0.004 + i * 1.9 + z.x * 0.02) * Math.max(2, rh * 0.22);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          const phase = t * 0.010 + i * 1.71 + z.x * 0.013;
          const u = -0.86 + i * (1.72 / 13);
          const x0 = z.x + u * rw * (0.72 + 0.10 * Math.sin(phase));
          const y0 = z.y + Math.sin(phase * 0.6) * rh * 0.22;
          const lick = (26 + flare * 18) * (0.65 + 0.35 * Math.sin(phase));
          ctx.globalAlpha = (0.12 + flare * 0.13 + (z.ultimate ? 0.08 : 0)) * fade;
          ctx.strokeStyle = i % 3 === 0 ? '#ffd45e' : z.color;
          ctx.lineWidth = 2.1;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(x0 + Math.sin(phase) * 10, y0 - lick * 0.55, x0 + Math.cos(phase) * 8, y0 - lick);
          ctx.stroke();
        }
      } else {
        ctx.globalCompositeOperation = 'lighter';
        const ring = z.r * (0.40 + flare * 0.15) * pulse;
        for (let i = 0; i < 11; i++) {
          const phase = t * 0.010 + i * 1.43 + z.x * 0.013;
          const a = i / 11 * Math.PI * 2 + Math.sin(phase) * 0.10;
          const x0 = z.x + Math.cos(a) * ring * (0.34 + 0.22 * Math.sin(phase));
          const y0 = z.y + Math.sin(a) * ring * (0.34 + 0.18 * Math.cos(phase));
          const lick = (20 + flare * 18) * (0.65 + 0.35 * Math.sin(phase));
          ctx.globalAlpha = (0.13 + flare * 0.14 + (z.ultimate ? 0.08 : 0)) * fade;
          ctx.strokeStyle = i % 3 === 0 ? '#ffd45e' : z.color;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(x0 + Math.cos(a) * lick * 0.25, y0 + Math.sin(a) * lick * 0.25,
            x0 + Math.cos(a) * lick * 0.58, y0 + Math.sin(a) * lick * 0.58);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const b of boxes || []) {
        if (!b || b.dead) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const d = Math.hypot(cx - z.x, cy - z.y) || 1;
        if (d > z.r * 1.05) continue;
        const heat = clamp((b.heat || 0) / 100, 0, 1);
        const link = clamp(1 - d / Math.max(1, z.r), 0, 1);
        if (heat <= 0.04 && link <= 0.14) continue;
        const wob = Math.sin(t * 0.006 + cx * 0.02 + cy * 0.01) * 12;
        const mx = (z.x + cx) * 0.5 + wob;
        const my = (z.y + cy) * 0.5 - 14 - heat * 12;
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -t * 0.036;
        ctx.globalAlpha = fade * (0.10 + heat * 0.34 + link * 0.16);
        ctx.strokeStyle = b.kind === 'barrel' && heat > 0.62 ? '#ffd45e' : '#ff6b32';
        ctx.lineWidth = 1.5 + heat * 2.3 + (b.kind === 'barrel' ? 0.6 : 0);
        ctx.beginPath();
        ctx.moveTo(z.x, z.y);
        ctx.quadraticCurveTo(mx, my, cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        if (b.kind === 'barrel' && heat > 0.72) {
          ctx.globalAlpha = fade * (0.25 + heat * 0.42);
          ctx.strokeStyle = '#ffd45e';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(b.w, b.h) * (0.62 + heat * 0.18), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function drawSmokeZones() {
    if (!smokeZones || !smokeZones.length) return;
    const t = performance.now();
    ctx.save();
    for (const z of smokeZones) {
      const fade = clamp(z.life / (z.max || 1), 0, 1);
      const rr = z.r * (0.96 + Math.sin(t * 0.0017 + z.phase) * 0.035);
      const lobes = z.poison ? 14 : 12;
      const main = z.poison ? [118, 176, 93] : [114, 124, 141];
      const bright = z.poison ? [156, 255, 94] : [210, 224, 240];
      const dark = z.poison ? [56, 76, 52] : [45, 51, 62];
      for (let i = 0; i < lobes; i++) {
        const seed = z.phase + i * 2.399;
        const wob = Math.sin(t * 0.0011 + seed) * 0.10;
        const ring = (0.16 + ((i * 37) % 100) / 100 * 0.62) * rr;
        const a = seed + Math.sin(t * 0.0008 + i) * 0.18;
        const lx = z.x + Math.cos(a) * ring * (0.68 + wob);
        const ly = z.y + Math.sin(a) * ring * (z.poison ? 0.34 : 0.40) - Math.sin(t * 0.0013 + seed) * 7;
        const size = rr * (0.24 + (((i * 23) % 100) / 100) * 0.20) * (z.thickness || 1);
        const mix = i % 5 === 0 ? bright : i % 4 === 0 ? dark : main;
        const alpha = (i % 5 === 0 ? 0.10 : i % 4 === 0 ? 0.13 : 0.18) * fade * (z.poison ? 1.10 : 0.92);
        const grad = ctx.createRadialGradient(lx, ly, 2, lx, ly, size);
        grad.addColorStop(0, `rgba(${mix[0]},${mix[1]},${mix[2]},${alpha})`);
        grad.addColorStop(0.58, `rgba(${mix[0]},${mix[1]},${mix[2]},${alpha * 0.62})`);
        grad.addColorStop(1, `rgba(${mix[0]},${mix[1]},${mix[2]},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lx, ly, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawBladeRecallTrails() {
    if (!bladeRecallTrails || !bladeRecallTrails.length) return;
    const t = performance.now();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const trail of bladeRecallTrails) {
      const fade = clamp(trail.life / (trail.max || 1), 0, 1);
      const p = 1 - fade;
      const ax = trail.ax - cam.x, ay = trail.ay - cam.y;
      const bx = trail.bx - cam.x, by = trail.by - cam.y;
      const dx = bx - ax, dy = by - ay;
      const mx = ax + dx * 0.5 + Math.sin(t * 0.006 + trail.phase) * 9;
      const my = ay + dy * 0.5 - 8 + Math.cos(t * 0.004 + trail.phase) * 5;
      ctx.globalAlpha = 0.28 * fade;
      ctx.strokeStyle = trail.accent || '#9cff5e';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
      ctx.globalAlpha = 0.78 * fade;
      ctx.strokeStyle = trail.color || '#cfd6df';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([14, 8]);
      ctx.lineDashOffset = -t * 0.04 - trail.phase * 12;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      const u = clamp(0.15 + p * 1.16, 0, 1);
      const ix = lerp(lerp(ax, mx, u), lerp(mx, bx, u), u);
      const iy = lerp(lerp(ay, my, u), lerp(my, by, u), u);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ix, iy, 3.2 + fade * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
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
    drawSpiritRemnants();
    drawBladeRecallTrails();
    if (!arenaMode) drawFlag(L);
    // particles
    ctx.save();
    for (const pt of particles) {
      const fade = clamp(pt.life / pt.max, 0, 1);
      const age = 1 - fade;
      const sx = pt.x - cam.x, sy = pt.y - cam.y;
      if (pt.kind === 'flame') {
        const rr = pt.r * (1 + age * 0.72) * (0.88 + Math.sin((runTime || 0) * 0.022 + (pt.seed || 0)) * 0.12);
        const grad = ctx.createRadialGradient(sx, sy, 1, sx, sy, rr * 2.0);
        grad.addColorStop(0, `rgba(255,245,190,${0.86 * fade})`);
        grad.addColorStop(0.32, `rgba(255,212,94,${0.72 * fade})`);
        grad.addColorStop(0.72, `rgba(255,90,34,${0.38 * fade})`);
        grad.addColorStop(1, 'rgba(255,90,34,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.globalAlpha = pt.alpha || 0.9;
        traceWobblyCirclePath(sx, sy, rr * 1.22, { phase: (pt.seed || 0) + age * 4.6, rough: 0.18, steps: 14 });
        ctx.fill();
      } else if (pt.kind === 'smoke') {
        const rr = pt.r * (1 + age * 1.35);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (pt.alpha || 0.34) * Math.sin(fade * Math.PI);
        ctx.fillStyle = pt.color || '#46404a';
        traceWobblyCirclePath(sx, sy, rr * 1.08, { phase: (pt.seed || 0) + age * 1.9, rough: 0.14, steps: 12 });
        ctx.fill();
      } else if (pt.kind === 'ember') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (pt.alpha || 0.86) * fade;
        ctx.fillStyle = pt.color || '#ffd45e';
        ctx.beginPath();
        ctx.arc(sx, sy, pt.r * (0.8 + fade * 0.8), 0, Math.PI * 2);
        ctx.fill();
      } else if (pt.kind === 'soul') {
        const rr = pt.r * (0.72 + fade * 0.72);
        const ang = Math.atan2(pt.vy || -1, pt.vx || 0);
        const tail = (pt.tail || 12) * (0.35 + fade * 0.75);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.globalAlpha = (pt.alpha || 0.8) * fade * 0.58;
        ctx.strokeStyle = pt.color || '#b48cff';
        ctx.lineWidth = Math.max(0.8, rr * 1.15);
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(ang) * tail, sy - Math.sin(ang) * tail);
        ctx.quadraticCurveTo(sx - Math.sin(ang) * rr * 2.0, sy + Math.cos(ang) * rr * 1.2, sx, sy);
        ctx.stroke();
        ctx.globalAlpha = (pt.alpha || 0.8) * fade * 0.72;
        ctx.fillStyle = '#f5efff';
        ctx.beginPath();
        ctx.moveTo(sx, sy - rr * 1.7);
        ctx.quadraticCurveTo(sx + rr * 1.45, sy, sx, sy + rr * 1.8);
        ctx.quadraticCurveTo(sx - rr * 1.45, sy, sx, sy - rr * 1.7);
        ctx.fill();
      } else if (pt.kind === 'gravity') {
        const rr = pt.r * (0.8 + fade * 0.55);
        const ang = Math.atan2(pt.vy || -1, pt.vx || 0) + (pt.seed || 0) * 0.22;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.24 * fade;
        ctx.strokeStyle = pt.color || '#8f7dff';
        ctx.lineWidth = Math.max(0.8, rr * 0.72);
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(ang) * rr * 6, sy - Math.sin(ang) * rr * 6);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.globalAlpha = 0.70 * fade;
        ctx.fillStyle = pt.color || '#8f7dff';
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(ang) * rr * 1.8, sy + Math.sin(ang) * rr * 1.8);
        ctx.lineTo(sx + Math.cos(ang + 2.35) * rr, sy + Math.sin(ang + 2.35) * rr);
        ctx.lineTo(sx - Math.cos(ang) * rr * 1.2, sy - Math.sin(ang) * rr * 1.2);
        ctx.lineTo(sx + Math.cos(ang - 2.35) * rr, sy + Math.sin(ang - 2.35) * rr);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = fade;
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(sx, sy, pt.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    for (const k of droppedKnives) {
      const recoverable = cls.id === 'rogue' && player && player.knifeAmmo < ROGUE_MAX_KNIVES;
      const near = recoverable ? clamp(1 - Math.hypot(k.x - player.x, k.y - (player.y - 25)) / 112, 0, 1) : 0;
      const pulse = Math.sin((k.age || 0) * 0.012) * 0.5 + 0.5;
      ctx.save(); ctx.translate(k.x - cam.x, k.y - cam.y);
      if (recoverable) {
        ctx.strokeStyle = `rgba(156,255,94,${0.28 + near * 0.40})`;
        ctx.lineWidth = 1.5 + near * 1.2;
        ctx.beginPath(); ctx.arc(0, 0, 12 + pulse * 3 + near * 5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(156,255,94,${0.08 + near * 0.12})`;
        ctx.beginPath(); ctx.arc(0, 0, 8 + near * 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.rotate(k.angle);
      ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(1, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1, -2); ctx.lineTo(11, 0); ctx.lineTo(1, 2); ctx.closePath();
      ctx.fillStyle = '#cfd6df'; ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    // figure (translate by camera)
    ctx.translate(-cam.x, -cam.y);
    drawRangerTrajectory();
    drawGravityCore();
    drawShockwaves();
    drawAbilityMarkers();
    drawSmokeZones();
    drawFireZones();
    drawFlameBreaths();
    for (const g of gravityFields) {
      const now = performance.now();
      if (g.blackHole) {
        drawBlackHoleField(g, now);
        continue;
      }
      const pulse = Math.sin(now * 0.009 + (g.phase || 0)) * 0.08 + 1;
      const fade = clamp(g.life / g.max, 0, 1);
      const rr = g.r * pulse;
      const grad = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, rr);
      grad.addColorStop(0, `rgba(255,255,255,${0.22 * fade})`);
      grad.addColorStop(0.45, `rgba(255,119,210,${0.13 * fade})`);
      grad.addColorStop(1, 'rgba(255,119,210,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(g.x, g.y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = g.color; ctx.globalAlpha = (g.ultimate ? 0.52 : 0.35) * fade; ctx.lineWidth = g.ultimate ? 3 : 2;
      ctx.beginPath(); ctx.arc(g.x, g.y, rr * 0.72, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.42 * fade;
      ctx.lineWidth = g.ultimate ? 2.2 : 1.6;
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI * 2 / 10 + now * 0.0018 + (g.phase || 0);
        const outer = rr * (0.86 + 0.05 * Math.sin(now * 0.006 + i + (g.phase || 0)));
        const inner = rr * 0.45;
        ctx.beginPath();
        ctx.moveTo(g.x + Math.cos(a) * outer, g.y + Math.sin(a) * outer);
        ctx.lineTo(g.x + Math.cos(a) * inner, g.y + Math.sin(a) * inner);
        ctx.stroke();
      }
      if (g.tether) drawGravityCoreTethers(g, now);
      ctx.globalAlpha = 0.82 * fade;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(g.x, g.y, g.ultimate ? 7 : 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.92 * fade;
      ctx.fillStyle = g.color;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.ultimate ? 4.2 : 3.2, 0, Math.PI * 2); ctx.fill();
      if (g.ultimate) {
        ctx.globalAlpha = 0.36 * fade;
        ctx.beginPath(); ctx.arc(g.x, g.y, rr * 0.96, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // projectiles: glowing bolts, sigils, and thrown daggers
    for (const b of projectiles) {
      if (b.kind === 'dagger') {
        const glow = b.summoned || b.homing;
        if (glow || b.fan) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = glow ? 0.48 : 0.24;
          ctx.strokeStyle = glow ? 'rgba(156,255,94,0.55)' : 'rgba(207,214,223,0.32)';
          ctx.lineCap = 'round';
          ctx.lineWidth = glow ? 3.6 : 2.1;
          ctx.beginPath();
          ctx.moveTo(b.x - b.vx * 0.92, b.y - b.vy * 0.92);
          ctx.lineTo(b.x - b.vx * 0.20, b.y - b.vy * 0.20);
          ctx.stroke();
          ctx.restore();
        }
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        if (glow) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = b.color || '#9cff5e';
          traceWobblyCirclePath(0, 0, 11, { phase: (b.phase || 0) + performance.now() * 0.003, rough: 0.18, steps: 12 });
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(2, 0); ctx.stroke();          // grip
        ctx.beginPath();                                                              // blade
        ctx.moveTo(2, -2.4); ctx.lineTo(14, 0); ctx.lineTo(2, 2.4); ctx.closePath();
        ctx.fillStyle = b.poison ? '#9cff5e' : b.summoned ? '#f1ffe8' : b.color || '#cfd6df';
        ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke();
        if (b.summoned) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(12, 0); ctx.stroke();
        }
        ctx.restore();
      } else if (b.kind === 'arrow') {
        ctx.save();
        ctx.strokeStyle = b.powerShot ? 'rgba(255,255,255,0.75)' : b.storm ? 'rgba(83,212,255,0.45)' : 'rgba(83,212,255,0.32)';
        ctx.lineCap = 'round';
        ctx.lineWidth = b.powerShot ? 4 : 2.4;
        ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.82, b.y - b.vy * 0.82); ctx.lineTo(b.x - b.vx * 0.16, b.y - b.vy * 0.16); ctx.stroke();
        ctx.restore();
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.strokeStyle = b.powerShot ? '#2a5770' : '#5f432b'; ctx.lineCap = 'round'; ctx.lineWidth = b.powerShot ? 3.1 : 2.2;
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
      } else if (b.kind === 'gravityDebris') {
        const r = b.r || 11;
        const ang = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = b.heavy ? 0.42 : 0.28;
        ctx.strokeStyle = b.color || '#8f7dff';
        ctx.lineCap = 'round';
        ctx.lineWidth = b.heavy ? 7 : 4.5;
        ctx.beginPath();
        ctx.moveTo(b.x - Math.cos(ang) * (42 + r), b.y - Math.sin(ang) * (42 + r));
        ctx.quadraticCurveTo(b.x - Math.sin(ang) * r * 0.8, b.y + Math.cos(ang) * r * 0.8, b.x, b.y);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate((b.angle || 0) + performance.now() * 0.003);
        ctx.fillStyle = b.heavy ? '#5d56a3' : '#7068b4';
        ctx.strokeStyle = '#d9d4ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const pts = 7;
        for (let i = 0; i < pts; i++) {
          const a = i * Math.PI * 2 / pts;
          const rr = r * (0.72 + (i % 3) * 0.14);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.72;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(-r * 0.20, -r * 0.42);
        ctx.lineTo(r * 0.46, r * 0.08);
        ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'gravitySeed') {
        const r = b.r || 8;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate((b.angle || 0) + performance.now() * 0.01);
        ctx.strokeStyle = b.color; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(0, 0, r + 5 + Math.sin(performance.now() * 0.02) * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-r - 5, 0); ctx.lineTo(r + 5, 0); ctx.moveTo(0, -r - 5); ctx.lineTo(0, r + 5); ctx.stroke();
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (b.kind === 'ignitionOrb') {
        const r = b.r || 14;
        const wob = Math.sin(performance.now() * 0.022 + b.x * 0.01) * 2.2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, r * 2.2 + wob);
        grad.addColorStop(0, 'rgba(255,248,190,0.95)');
        grad.addColorStop(0.34, 'rgba(255,212,94,0.80)');
        grad.addColorStop(0.72, 'rgba(255,92,32,0.42)');
        grad.addColorStop(1, 'rgba(255,92,32,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 2.1 + wob, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffd45e'; ctx.lineWidth = 2.1;
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.86 + wob * 0.25, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'smokeBomb') {
        const r = b.r || (b.poison ? 11 : 9);
        const ang = b.angle || Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(ang + (b.spinAngle || 0));
        ctx.fillStyle = b.poison ? '#596b45' : '#5a6471';
        ctx.strokeStyle = b.poison ? '#d7ffba' : '#d8e4f0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-r * 0.72, -r * 0.58, r * 1.44, r * 1.16, 3);
        else ctx.rect(-r * 0.72, -r * 0.58, r * 1.44, r * 1.16);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.78;
        ctx.strokeStyle = b.poison ? '#9cff5e' : '#cfe0f6';
        ctx.beginPath();
        ctx.moveTo(-r * 0.38, -r * 0.18);
        ctx.lineTo(r * 0.34, -r * 0.18);
        ctx.moveTo(-r * 0.42, r * 0.18);
        ctx.lineTo(r * 0.38, r * 0.18);
        ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'spiritBolt') {
        const r = b.r || 9;
        const ang = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = b.color || '#b48cff';
        ctx.globalAlpha = 0.38;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(b.x - Math.cos(ang) * 34, b.y - Math.sin(ang) * 34);
        ctx.quadraticCurveTo(b.x - Math.sin(ang) * 7, b.y + Math.cos(ang) * 7, b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 0.78;
        ctx.strokeStyle = '#f5efff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - Math.cos(ang) * 18, b.y - Math.sin(ang) * 18);
        ctx.lineTo(b.x + Math.cos(ang) * 6, b.y + Math.sin(ang) * 6);
        ctx.stroke();
        ctx.fillStyle = '#f5efff';
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r);
        ctx.quadraticCurveTo(b.x - Math.sin(ang) * r * 0.6, b.y + Math.cos(ang) * r * 0.6, b.x - Math.cos(ang) * r * 0.9, b.y - Math.sin(ang) * r * 0.9);
        ctx.quadraticCurveTo(b.x + Math.sin(ang) * r * 0.6, b.y - Math.cos(ang) * r * 0.6, b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r);
        ctx.fill();
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
    drawAllies();
    drawFighters();
    drawStick(moveAmt);
    drawWorldDebug();
    ctx.restore();
    cam.x = camBase.x; cam.y = camBase.y;
    drawArenaOverlay();
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
        while (acc >= STEP && guard++ < 5) { physics(); updateFighters(STEP); updateAllies(STEP); updateArena(STEP); acc -= STEP; if (state !== 'playing') break; }
        flagWave += dt * 0.006;
        // age effects: particles fly & fade; the sword trail fades out
        for (let i = particles.length - 1; i >= 0; i--) {
          const pt = particles[i];
          const age = 1 - clamp(pt.life / Math.max(1, pt.max || pt.life || 1), 0, 1);
          if (pt.kind === 'flame' || pt.kind === 'smoke') {
            const swirl = Math.sin((runTime || 0) * 0.010 + (pt.seed || 0) + age * 4.2) * (pt.swirl || 0);
            pt.vx += swirl;
            pt.vy -= pt.buoy || 0;
            pt.vx *= pt.drag || 0.97;
            pt.vy *= pt.drag || 0.97;
            pt.r += (pt.grow || 0) * (dt / 16.67);
          } else if (pt.kind === 'ember') {
            pt.vx *= pt.drag || 0.988;
            pt.vy += pt.gravity == null ? 0.035 : pt.gravity;
          } else if (pt.kind === 'soul') {
            const age = 1 - clamp(pt.life / Math.max(1, pt.max || pt.life || 1), 0, 1);
            pt.vx += Math.sin((runTime || 0) * 0.012 + (pt.seed || 0) + age * 5.2) * (pt.sway || 0.014);
            pt.vy -= pt.lift || 0.024;
            pt.vx *= pt.drag || 0.976;
            pt.vy *= pt.drag || 0.976;
          } else if (pt.kind === 'gravity') {
            const swirl = Math.sin((runTime || 0) * 0.013 + (pt.seed || 0) + age * 5.6) * 0.018;
            pt.vx += swirl;
            pt.vy -= 0.010;
            pt.vx *= 0.982;
            pt.vy *= 0.982;
          } else {
            pt.vy += 0.12;
          }
          pt.x += pt.vx; pt.y += pt.vy; pt.life -= dt;
          if (pt.life <= 0) particles.splice(i, 1);
        }
        if (particles.length > PARTICLE_SOFT_LIMIT + 120) particles.splice(0, particles.length - PARTICLE_SOFT_LIMIT);
        updateDroppedKnives(dt);
        updateSpiritRemnants(dt);
        updateSmokeZones(dt);
        for (let i = slashTrail.length - 1; i >= 0; i--) { if ((slashTrail[i].life -= dt) <= 0) slashTrail.splice(i, 1); }
        if (bladeRecallTrails) for (let i = bladeRecallTrails.length - 1; i >= 0; i--) { if ((bladeRecallTrails[i].life -= dt) <= 0) bladeRecallTrails.splice(i, 1); }
        if (shockwaves) for (let i = shockwaves.length - 1; i >= 0; i--) { if ((shockwaves[i].life -= dt) <= 0) shockwaves.splice(i, 1); }
        for (let i = debug.segments.length - 1; i >= 0; i--) { if ((debug.segments[i].life -= dt) <= 0) debug.segments.splice(i, 1); }
        const L = levels[li];
        for (let i = projectiles.length - 1; i >= 0; i--) {
          const b = projectiles[i];
          const px = b.x, py = b.y;
          b.x += b.vx; b.y += b.vy; b.life -= dt;
          if (b.kind === 'gravitySeed' || b.kind === 'ignitionOrb' || b.kind === 'smokeBomb') b.traveled = (b.traveled || 0) + Math.hypot(b.x - px, b.y - py);
          if (b.kind === 'dagger') {
            if (b.homing) updateHomingDagger(b);
            else {
              b.vy += 0.18;                                  // thrown knives arc slightly, without spinning
              b.angle = Math.atan2(b.vy, b.vx);
              if (b.fan && Math.random() < 0.32) particles.push({
                x: b.x - b.vx * rand(0.10, 0.26),
                y: b.y - b.vy * rand(0.10, 0.26),
                vx: -b.vx * rand(0.006, 0.014) + rand(-0.08, 0.08),
                vy: -b.vy * rand(0.006, 0.014) + rand(-0.08, 0.08),
                life: rand(110, 230),
                max: 230,
                color: b.color,
                r: rand(0.7, 1.5),
              });
            }
          }
          else if (b.kind === 'arrow') { b.vy += ARROW_GRAVITY; b.angle = Math.atan2(b.vy, b.vx); }
          else if (b.kind === 'smokeBomb') {
            b.vy += b.poison ? 0.31 : 0.28;
            b.vx *= 0.996;
            b.angle = Math.atan2(b.vy, b.vx);
            b.spinAngle = (b.spinAngle || 0) + (b.spin || 0.18);
            if (Math.random() < (b.poison ? 0.86 : 0.74)) smokeParticle(
              b.x - b.vx * rand(0.08, 0.30) + rand(-2.5, 2.5),
              b.y - b.vy * rand(0.08, 0.30) + rand(-2.5, 2.5),
              -b.vx * rand(0.010, 0.026) + rand(-0.12, 0.12),
              -b.vy * rand(0.004, 0.014) - rand(0.05, b.poison ? 0.32 : 0.50), {
                color: smokeCloudColor(!!b.poison, Math.random() < 0.18),
                life: rand(b.poison ? 560 : 460, b.poison ? 1050 : 880),
                r: rand(b.poison ? 4.8 : 5.4, b.poison ? 11.8 : 13.6),
                alpha: b.poison ? 0.30 : 0.24,
                grow: rand(0.032, 0.076),
                buoy: b.poison ? rand(0.004, 0.018) : rand(0.012, 0.034),
              });
          }
          else if (b.kind === 'gravitySeed') {
            b.angle += 0.08;
            b.vx *= 0.992; b.vy *= 0.992;
            if (Math.random() < 0.85) particles.push({ x: b.x - b.vx * rand(0.1, 0.35) + rand(-2, 2), y: b.y - b.vy * rand(0.1, 0.35) + rand(-2, 2),
              vx: rand(-0.35, 0.35), vy: rand(-0.45, 0.25), life: rand(170, 310), max: 310, color: Math.random() < 0.35 ? '#ffffff' : b.color, r: rand(1, 2.4) });
          }
          else if (b.kind === 'ignitionOrb') {
            b.angle += 0.11;
            b.vx *= 0.994; b.vy *= 0.994;
            flameParticle(b.x + rand(-5, 5), b.y + rand(-5, 5), -b.vx * rand(0.018, 0.040) + rand(-0.45, 0.45), -b.vy * rand(0.004, 0.016) + rand(-1.25, -0.05), {
              life: rand(190, 430),
              r: rand(2.6, 7.2),
              color: Math.random() < 0.50 ? '#ffd45e' : '#ff6b32',
            });
            if (Math.random() < 0.58) smokeParticle(b.x - b.vx * rand(0.08, 0.30), b.y - b.vy * rand(0.08, 0.30),
              -b.vx * 0.014 + rand(-0.20, 0.20), rand(-0.82, -0.03), {
                life: rand(600, 1050),
                r: rand(5.2, 12.4),
                alpha: 0.24,
              });
            if (Math.random() < 0.18) emberParticle(b.x, b.y, -b.vx * rand(0.02, 0.05), rand(-1.3, 0.2));
            if ((b.team || 'hero') === 'hero' && hasPassive('mg_pyromancy') && Math.random() < 0.18) {
              feedPyromancyGroundFire(b.x, b.y, b.team, { r: 24, w: 68, life: 720, radius: 84, maxDelta: 120, flare: 220 });
            }
          }
          else if (b.kind === 'gravityDebris') {
            b.angle = (b.angle || 0) + (b.spin || 0.08);
            b.vy += 0.035;
            b.vx *= 0.998;
            if (Math.random() < 0.82) {
              const a = Math.atan2(b.vy, b.vx) + Math.PI + rand(-0.38, 0.38);
              gravityParticle(b.x + rand(-4, 4), b.y + rand(-4, 4),
                Math.cos(a) * rand(0.35, 1.4), Math.sin(a) * rand(0.35, 1.4) - 0.12, {
                  color: Math.random() < 0.34 ? '#ffffff' : b.color,
                  life: rand(160, 360),
                  r: rand(0.9, b.heavy ? 2.8 : 2.0),
                });
            }
          }
          else if (b.kind === 'bolt' || b.kind === 'firebolt' || b.kind === 'spiritBolt') {
            for (let s = 0; s < (b.sparkle || 1); s++) if (Math.random() < 0.65) {
              const trail = rand(0.12, 0.45);
              if (b.kind === 'spiritBolt') soulParticle(
                b.x - b.vx * trail + rand(-2.5, 2.5),
                b.y - b.vy * trail + rand(-2.5, 2.5),
                -b.vx * rand(0.010, 0.028) + rand(-0.28, 0.28),
                -b.vy * rand(0.010, 0.028) + rand(-0.42, 0.08),
                { color: Math.random() < 0.35 ? '#f5efff' : b.color, life: rand(190, 420), r: rand(0.9, 2.4), tail: rand(8, 22) }
              );
              else particles.push({ x: b.x - b.vx * trail + rand(-2.5, 2.5), y: b.y - b.vy * trail + rand(-2.5, 2.5),
                vx: -b.vx * rand(0.01, 0.035) + rand(-0.45, 0.45), vy: -b.vy * rand(0.01, 0.035) + rand(-0.45, 0.45),
                life: rand(180, 360), max: 360, color: Math.random() < 0.35 ? '#ffffff' : b.color, r: rand(1, 2.7) });
            }
            if (b.kind === 'firebolt' && Math.random() < 0.92) {
              flameParticle(b.x + rand(-4, 4), b.y + rand(-4, 4), -b.vx * rand(0.018, 0.042) + rand(-0.38, 0.38), -b.vy * rand(0.006, 0.020) + rand(-1.15, -0.08), {
                life: rand(180, 390),
                r: rand(2.0, 5.8),
                color: Math.random() < 0.54 ? '#ffd45e' : '#ff6b32',
              });
              if (Math.random() < 0.42) smokeParticle(b.x - b.vx * rand(0.08, 0.28), b.y - b.vy * rand(0.08, 0.28),
                -b.vx * 0.012 + rand(-0.18, 0.18), rand(-0.75, -0.04), {
                  life: rand(520, 900),
                  r: rand(4.5, 10.5),
                  alpha: 0.20,
                });
            }
            if (b.kind === 'spiritBolt' && Math.random() < 0.70) soulParticle(b.x + rand(-3, 3), b.y + rand(-3, 3), rand(-0.35, 0.35), rand(-0.65, 0.02), { color: Math.random() < 0.45 ? '#f5efff' : '#b48cff', life: rand(200, 420), r: rand(1.0, 2.4) });
          } else if (b.kind === 'sigil') {
            b.age += dt;
            b.angle += 0.045;
            b.vx *= 0.985; b.vy *= 0.985;
            if (Math.random() < 0.9) particles.push({ x: b.x + rand(-10, 10), y: b.y + rand(-10, 10),
              vx: rand(-0.5, 0.5), vy: rand(-0.6, 0.2), life: rand(220, 430), max: 430, color: Math.random() < 0.35 ? '#ffffff' : b.color, r: rand(1.2, 3.2) });
            if (b.age > 430) b.life = 0;
          }
          const crate = boxes.find(bx => projectileHitsBox(b, px, py, bx));
          const sp = Math.hypot(b.vx, b.vy) || 1;
          if (crate) {
            if (b.kind === 'firebolt') {
              heatBoxFromFire(crate, { x: b.x, y: b.y, color: b.color, ultimate: !!b.scorch }, crate.kind === 'barrel' ? 82 : b.scorch ? 58 : 42);
              if (crate.kind === 'barrel') {
                crate.vx += b.vx / sp * 1.2;
                crate.va += (b.vx >= 0 ? 1 : -1) * 0.08;
              } else pushBox(crate, b.vx / sp, b.vy / sp, (b.hit || 12) * 0.75);
            } else if (b.kind === 'ignitionOrb') {
              heatBoxFromFire(crate, { x: b.x, y: b.y, color: b.color, ultimate: true }, crate.kind === 'barrel' ? 90 : 46);
              pushBox(crate, b.vx / sp, b.vy / sp - 0.12, 9);
            } else if (b.kind === 'smokeBomb') {
              pushBox(crate, b.vx / sp, b.vy / sp - 0.06, b.poison ? 8 : 6);
            } else if (b.kind === 'gravityDebris') {
              pushBox(crate, b.vx / sp, b.vy / sp - 0.08, (b.hit || 16) * (b.heavy ? 1.15 : 0.78));
              crate.va += (b.vx >= 0 ? 1 : -1) * (b.heavy ? 0.12 : 0.07);
            } else pushBox(crate, b.vx / sp, b.vy / sp, b.hit);
            addShake(b.kind === 'bolt' || b.kind === 'sigil' || b.kind === 'firebolt' || b.kind === 'ignitionOrb' || b.kind === 'gravityDebris' || b.kind === 'smokeBomb' ? 2.8 : 1.2, 80);
          }
          let struckActor = false;
          if ((b.team || 'hero') === 'enemy') {
            // enemy fire seeks the hero and party allies
            for (const t of enemyAttackTargets()) if (actorCanBeHitByEnemy(t)) {
              const h = segHitActor(px, py, b.x, b.y, projectileRadius(b), t);
              if (h) {
                if (b.kind !== 'gravitySeed' && b.kind !== 'ignitionOrb' && b.kind !== 'smokeBomb') hurtEnemyTarget(t, b.vx / sp, b.vy / sp, b.hit || 10, b.x, b.y);
                if (b.poison) t.poisoned = Math.max(t.poisoned || 0, 1600);
                if (b.fire) markBurnActor(t, b.scorch ? 1850 : 1350, b.color);
                if (b.kind === 'dagger') {
                  if (b.stagger && t.brain) t.brain.stagger = Math.max(t.brain.stagger || 0, b.stagger);
                  burst(b.x, b.y, b.summoned ? '#ffffff' : b.color, b.summoned ? 8 : 6, b.summoned ? 2.4 : 1.9);
                }
                struckActor = true;
                break;
              }
            }
          } else {
            // hero fire hits training dummies + enemy fighters
            if (dummies) for (const d of dummies) {
              const h = projectileHitsDummy(b, px, py, d);
              if (h) {
                if (b.kind !== 'gravitySeed' && b.kind !== 'ignitionOrb' && b.kind !== 'smokeBomb') hurtDummy(d, b.vx / sp, b.vy / sp, b.hit || 10, h.p.x, h.p.y);
                if (b.fire) markBurnDummy(d, b.scorch ? 1850 : 1350, b.color);
                if (b.spirit) grantSpiritCharge(h.p.x, h.p.y, 0.35);
                if (b.kind === 'dagger') {
                  burst(h.p.x, h.p.y, b.summoned ? '#ffffff' : b.color, b.summoned ? 8 : 6, b.summoned ? 2.4 : 1.9);
                  d.flash = Math.max(d.flash || 0, b.stagger ? 260 : 160);
                }
                addShake(b.kind === 'bolt' || b.kind === 'sigil' || b.kind === 'gravitySeed' || b.kind === 'gravityDebris' || b.kind === 'firebolt' || b.kind === 'ignitionOrb' || b.kind === 'smokeBomb' || b.kind === 'spiritBolt' ? 2.5 : 1.1, 75); struckActor = true; break;
              }
            }
            if (!struckActor && fighters) for (const e of fighters.slice()) {
              const h = segHitActor(px, py, b.x, b.y, projectileRadius(b), e);
              if (h) {
                if (b.kind !== 'gravitySeed' && b.kind !== 'smokeBomb') {
                  if (b.kind !== 'ignitionOrb') hurtFighter(e, b.vx / sp, b.vy / sp, b.hit || 10, h.x, h.y);
                  if (b.pin) { e.vx *= 0.25; e.vy *= 0.25; e.brain.stagger = Math.max(e.brain.stagger || 0, 420); }
                  if (b.kind === 'dagger' && b.stagger) e.brain.stagger = Math.max(e.brain.stagger || 0, b.stagger);
                  if (b.poison) e.poisoned = Math.max(e.poisoned || 0, 1800);
                  if (b.fire) markBurnActor(e, b.scorch ? 1850 : 1350, b.color);
                  if (b.spirit) grantSpiritCharge(h.x, h.y, 0.5);
                }
                if (b.kind === 'dagger') burst(h.x, h.y, b.summoned ? '#ffffff' : b.color, b.summoned ? 8 : 6, b.summoned ? 2.4 : 1.9);
                addShake(b.kind === 'bolt' || b.kind === 'sigil' || b.kind === 'gravitySeed' || b.kind === 'gravityDebris' || b.kind === 'firebolt' || b.kind === 'ignitionOrb' || b.kind === 'smokeBomb' || b.kind === 'spiritBolt' ? 2.5 : 1.1, 75); struckActor = true; break;
              }
            }
          }
          rememberDebugSegment('projectile', px, py, b.x, b.y, projectileRadius(b), b.color, 120);
          if (struckActor && b.pierce > 0) { b.pierce--; struckActor = false; }
          const hitPlatform = L.platforms.some(pl => !isOneWay(pl) && projectileHitsBox(b, px, py, pl));
          const rangedBurst = (b.kind === 'gravitySeed' || b.kind === 'ignitionOrb' || b.kind === 'smokeBomb') && b.range && b.traveled >= b.range;
          if ((crate || hitPlatform) && b.bounce > 0 && !struckActor) {
            b.bounce--;
            if (crate) { b.vx *= -0.72; b.vy *= 0.82; }
            else { b.vx *= -0.78; b.vy *= 0.90; }
            b.x = px; b.y = py;
            b.angle = Math.atan2(b.vy, b.vx);
            burst(b.x, b.y, b.color, 8, 2.6);
            continue;
          }
          const dead = b.life <= 0 || crate || struckActor || hitPlatform || rangedBurst;
          if (dead) {
            if (b.kind === 'dagger') {
              if (!b.noDrop && !b.summoned) spawnDroppedKnife(b.x, b.y, b.angle, b.vx, b.vy);
              if (b.explosive) pushBoxesRadial(b.x, b.y, 20, 122, b.team);
              burst(b.x, b.y, b.summoned ? '#ffffff' : b.color, b.explosive ? 18 : b.summoned ? 9 : 7, b.explosive ? 4.2 : b.summoned ? 2.5 : 2.0);
              if (b.summoned) {
                for (let j = 0; j < 4; j++) particles.push({
                  x: b.x + rand(-3, 3),
                  y: b.y + rand(-3, 3),
                  vx: rand(-0.55, 0.55),
                  vy: rand(-0.72, 0.15),
                  life: rand(170, 340),
                  max: 340,
                  color: Math.random() < 0.42 ? '#ffffff' : b.color,
                  r: rand(0.8, 2.0),
                });
              }
            }
            else if (b.kind === 'gravitySeed') spawnGravityField(b.x, b.y, b.team, b.color);
            else if (b.kind === 'gravityDebris') gravityDebrisImpact(b.x, b.y, b.team, b.color, b.hit || 16, { heavy: b.heavy });
            else if (b.kind === 'sigil') explodeSigil(b);
            else if (b.kind === 'smokeBomb') detonateSmokeBomb(b);
            else if (b.kind === 'firebolt') {
              const gy = terrainYAt(b.x);
              if (Math.abs(gy - b.y) < 135) {
                spawnFireZone(b.x, gy - 4, b.team, {
                  r: b.scorch ? 44 : 34,
                  w: b.scorch ? 116 : 82,
                  life: b.scorch ? 980 : 660,
                  color: b.color,
                  ground: true,
                  spread: b.scorch && (b.team || 'hero') === 'hero' && hasPassive('mg_pyromancy'),
                  quiet: true,
                });
                feedPyromancyGroundFire(b.x, gy, b.team, { r: b.scorch ? 44 : 34, w: b.scorch ? 128 : 92, life: b.scorch ? 1300 : 920, radius: 118 });
              } else {
                emitFlameJet(b.x, b.y, -Math.PI / 2, 18, { spread: 1.05, speed: 4.0, length: 28, life: 380, r: 5.4, color: b.color });
                emitSmokePuff(b.x, b.y, -Math.PI / 2, 8, { spread: 1.2, speed: 1.4, life: 780, alpha: 0.25 });
              }
              radialActorPulse(b.x, b.y, b.scorch ? 112 : 92, b.scorch ? 15 : 12, b.team, b.color);
              detonateBurningTargets(b.x, b.y, b.scorch ? 86 : 64, b.scorch ? 18 : 12, b.team, b.color, { link: false, chain: false });
            }
            else if (b.kind === 'ignitionOrb') {
              detonateIgnitionOrb(b.x, b.y, b.team, Object.assign({}, b.ignition || {}, { fromX: b.originX, fromY: b.originY }));
            }
            else if (b.kind === 'spiritBolt') {
              emitSoulWisp(b.x - b.vx * 0.55, b.y - b.vy * 0.55, b.x, b.y, { count: 14, color: '#b48cff', lifeMin: 220, lifeMax: 560 });
              for (let j = 0; j < 7; j++) soulParticle(b.x + rand(-5, 5), b.y + rand(-5, 5), rand(-0.55, 0.55), rand(-0.95, 0.10), { color: Math.random() < 0.38 ? '#f5efff' : '#b48cff', life: rand(220, 520), r: rand(1.0, 2.2) });
            }
            else {
              if (b.explosive) pushBoxesRadial(b.x, b.y, 18, 112, b.team);
              if (b.portal && b.portal > 0) {
                b.portal = 0; b.life = 520; b.x += b.vx * 12; b.y += b.vy * 12;
                burst(b.x, b.y, b.color, 18, 3.6);
                continue;
              }
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
    if (player && freeze <= 0) { animateFighters(dt); animateAllies(dt); }
    if (player) render(moveAmt);
    if (player && (labMode || debug.enabled)) {
      const nowMs = performance.now();
      if (nowMs - debugExposeAt > 180) {
        debugExposeAt = nowMs;
        exposeDebugApi();
      }
    }
  });

  // test seam (no-op in production): lets the headless harness drive internals
  let testApi;
  function actorSnapshot(act) {
    if (!act) return null;
    const atk = act.anim && act.anim.atkActive ? { type: act.anim.atkType, t: act.anim.atkT, phase: act.anim.atkPhase, aim: act.anim.atkAim } : null;
    const move = act.move && act.move.active ? { type: act.move.type, t: act.move.t, phase: act.move.phase } : null;
    return {
      cls: act.cls && act.cls.id, team: act.team, x: act.x, y: act.y, vx: act.vx, vy: act.vy,
      facing: act.facing, grounded: act.grounded, coyote: act.coyote, airTime: act.airTime,
      jumpHeld: !!(act.intent && act.intent.jumpHeld), jumpHold: act.intent && act.intent.jumpHold || 0,
      rogueAirJump: act.rogueAirJump, knifeAmmo: act.knifeAmmo, arrowAmmo: act.arrowAmmo,
      gravityDebris: act.gravityDebris || 0,
      rogueBurst: act.rogueBurst, attackCd: act.attackCd, abilityCd: act.abilityCd, moveCd: act.moveCd,
      queuedAttack: act.queuedAttack ? { type: act.queuedAttack.type, slot: act.queuedAttack.slot } : null,
      queuedFlash: act.queuedFlash ? { slot: act.queuedFlash.slot } : null,
      cooldowns: Object.assign({}, act.cooldowns || {}),
      shieldGuard: act.shieldGuard, draw: act.draw ? Object.assign({}, act.draw) : null, hp: act.hp, maxHp: act.maxHp,
      hidden: act.hidden || 0, smokeBlind: act.smokeBlind || 0, poisoned: act.poisoned || 0, burned: act.burned || 0,
      spiritCommand: act.spiritCommand ? { x: act.spiritCommand.x, y: act.spiritCommand.y, life: act.spiritCommand.life || 0, max: act.spiritCommand.max || 0, type: act.spiritCommand.type || 'point' } : null,
      box: actorBox(act), capsules: actorCapsules(act), attack: atk, move,
    };
  }
  function getTestApi() {
    if (!testApi) testApi = {
      play, onStrike, triggerAttack, triggerSlotAbility, startRangerDraw, releaseRangerDraw,
      openHelp, closeHelp, draftPool, pickDraft,
      pressJump: press,
      sampleMelee(type, t) {
        if (!player) return null;
        return meleeSegment(type || cls.main, player.anim.atkAim || (player.facing > 0 ? 0 : Math.PI), t == null ? strikePoint(type || cls.main) : t);
      },
      bodyCapsules() { return player ? bodyCapsules() : []; },
      playerBox() { return player ? actorBox(player) : null; },
      segDistance(a, b) { return segSegDist(a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by); },
      segBoxDistance(a, b) { return segAabbDist(a.ax, a.ay, a.bx, a.by, b); },
      setDebug(v) { debug.enabled = !!v; exposeDebugApi(); },
      state() {
        const bindableRemnant = nearestSpiritRemnant(340);
        return {
          mode: state, level: li, debugEnabled: debug.enabled, classId: cls && cls.id,
          arenaMode, labMode, labBuildId, arenaWave, arenaKills, arenaNextWave,
          loadout: Object.assign({}, loadout || {}), draftChoices: arenaDraftChoices ? arenaDraftChoices.slice() : null,
          runBuild: runBuild ? { picked: runBuild.picked.slice(), branchPoints: Object.assign({}, runBuild.branchPoints), softBranch: runBuild.softBranch } : null,
          player: actorSnapshot(player),
          allies: allies ? allies.map(actorSnapshot) : [],
          fighters: fighters ? fighters.map(actorSnapshot) : [],
          boxes: boxes ? boxes.map(b => ({ kind: b.kind || 'crate', x: b.x, y: b.y, w: b.w, h: b.h, vx: b.vx, vy: b.vy, life: b.life || 0, heat: b.heat || 0 })) : [],
          coinsLeft: coinsLeft ? coinsLeft.filter(c => !c.got).length : 0,
          projectiles: projectiles ? projectiles.length : 0,
          gravityFields: gravityFields ? gravityFields.length : 0,
          flameBreaths: flameBreaths ? flameBreaths.length : 0,
          smokeZones: smokeZones ? smokeZones.length : 0,
          hiddenActors: (player && (player.hidden || 0) > 0 ? 1 : 0) +
            (fighters ? fighters.filter(e => (e.hidden || 0) > 0).length : 0) +
            (allies ? allies.filter(a => (a.hidden || 0) > 0).length : 0),
          smokeBlinded: (player && (player.smokeBlind || 0) > 0 ? 1 : 0) +
            (fighters ? fighters.filter(e => (e.smokeBlind || 0) > 0).length : 0) +
            (allies ? allies.filter(a => (a.smokeBlind || 0) > 0).length : 0),
          poisonedActors: (player && (player.poisoned || 0) > 0 ? 1 : 0) +
            (fighters ? fighters.filter(e => (e.poisoned || 0) > 0).length : 0) +
            (allies ? allies.filter(a => (a.poisoned || 0) > 0).length : 0) +
            (dummies ? dummies.filter(d => (d.poisoned || 0) > 0).length : 0),
          shockwaves: shockwaves ? shockwaves.length : 0,
          spiritRemnants: spiritRemnants ? spiritRemnants.length : 0,
          spiritAllies: allies ? allies.filter(a => a && a.spirit && !a.dead).length : 0,
          spiritCommands: allies ? allies.filter(a => a && a.spiritCommand).length : 0,
          bladeRecallTrails: bladeRecallTrails ? bladeRecallTrails.length : 0,
          gravityCore: gravityCore ? { x: gravityCore.x, y: gravityCore.y, r: gravityCore.r, age: gravityCore.age || 0, resonance: gravityCore.resonance || 0, resonanceMax: gravityCore.resonanceMax || 0 } : null,
          effects: {
            projectiles: projectiles ? projectiles.slice(0, 18).map(p => ({ kind: p.kind || 'bolt', x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life || 0, team: p.team })) : [],
            gravityFields: gravityFields ? gravityFields.map(g => ({ x: g.x, y: g.y, r: g.r, life: g.life || 0, max: g.max || 0, ultimate: !!g.ultimate, blackHole: !!g.blackHole, team: g.team })) : [],
            gravityCore: gravityCore ? { x: gravityCore.x, y: gravityCore.y, r: gravityCore.r, resonance: gravityCore.resonance || 0, resonanceMax: gravityCore.resonanceMax || 0, pulse: gravityCore.resonancePulse || 0 } : null,
            fireZones: fireZones ? fireZones.map(z => ({ x: z.x, y: z.y, r: z.r, life: z.life || 0, max: z.max || 0, ultimate: !!z.ultimate, team: z.team })) : [],
            flameBreaths: flameBreaths ? flameBreaths.map(b => {
              const o = flameBreathOrigin(b.actor || player, b.angle, b.dragon ? 'pyroDragon' : 'pyroBreath', clamp(b.age / (b.dragon ? 140 : 190), 0, 1));
              return { x: o.x, y: o.y, range: b.range, life: b.life || 0, max: b.max || 0, team: b.team };
            }) : [],
            smokeZones: smokeZones ? smokeZones.map(z => ({ x: z.x, y: z.y, r: z.r, life: z.life || 0, max: z.max || 0, poison: !!z.poison, team: z.team })) : [],
            hiddenActors: (player && (player.hidden || 0) > 0 ? 1 : 0) +
              (fighters ? fighters.filter(e => (e.hidden || 0) > 0).length : 0) +
              (allies ? allies.filter(a => (a.hidden || 0) > 0).length : 0),
            smokeBlinded: (player && (player.smokeBlind || 0) > 0 ? 1 : 0) +
              (fighters ? fighters.filter(e => (e.smokeBlind || 0) > 0).length : 0) +
              (allies ? allies.filter(a => (a.smokeBlind || 0) > 0).length : 0),
            poisonedActors: (player && (player.poisoned || 0) > 0 ? 1 : 0) +
              (fighters ? fighters.filter(e => (e.poisoned || 0) > 0).length : 0) +
              (allies ? allies.filter(a => (a.poisoned || 0) > 0).length : 0) +
              (dummies ? dummies.filter(d => (d.poisoned || 0) > 0).length : 0),
            shockwaves: shockwaves ? shockwaves.map(w => ({ x: w.x, y: w.y, r: w.r, life: w.life || 0, max: w.max || 0 })) : [],
            spiritRemnants: spiritRemnants ? spiritRemnants.map(r => ({ x: r.x, y: r.y, groundY: r.groundY, life: r.life || 0, max: r.max || 0, source: r.source || 'enemy', bindable: r === bindableRemnant })) : [],
            spiritAllies: allies ? allies.filter(a => a && a.spirit && !a.dead).map(a => ({ x: a.x, y: a.y, life: a.spiritLife || 0, max: a.spiritMaxLife || 0, commanded: !!a.spiritCommand })) : [],
            spiritCommands: allies ? allies.filter(a => a && a.spiritCommand).map(a => ({ x: a.spiritCommand.x, y: a.spiritCommand.y, life: a.spiritCommand.life || 0, max: a.spiritCommand.max || 0, type: a.spiritCommand.type || 'point' })) : [],
            burningActors: (player && (player.burned || 0) > 0 ? 1 : 0) +
              (fighters ? fighters.filter(e => (e.burned || 0) > 0).length : 0) +
              (allies ? allies.filter(a => (a.burned || 0) > 0).length : 0) +
              (dummies ? dummies.filter(d => (d.burned || 0) > 0).length : 0),
            hotBoxes: boxes ? boxes.filter(b => !b.dead && (b.heat || 0) > 22).length : 0,
            flameParticles: particles ? particles.filter(p => p.kind === 'flame').length : 0,
            smokeParticles: particles ? particles.filter(p => p.kind === 'smoke').length : 0,
          },
          droppedKnives: droppedKnives ? droppedKnives.length : 0,
        };
      },
      startLab, applyLabBuild, refillLabResources,
      debugSegments() { return debug.segments.slice(); },
      get player() { return player; },
      get dummies() { return dummies; },
      get fighters() { return fighters; },
      get allies() { return allies; },
      get cls() { return cls; },
      trees: CLASS_TREES,
      nodes: TREE_NODES,
    };
    return testApi;
  }
  function exposeDebugApi() {
    if (typeof window === 'undefined') return;
    const apiObj = getTestApi();
    if (window.__stickTest) window.__stickTest(apiObj);
    const exposed = debug.enabled || labMode;
    if (exposed) {
      window.__stickDebug = apiObj;
      if (root && root.dataset) {
        const snap = apiObj.state();
        const effects = snap.effects || {};
        root.dataset.stickDebug = '1';
        root.dataset.stickClass = snap.classId || '';
        root.dataset.stickLabBuild = snap.labMode ? (snap.labBuildId || '') : '';
        root.dataset.stickEffectCounts = JSON.stringify({
          projectiles: effects.projectiles ? effects.projectiles.length : 0,
          gravityFields: effects.gravityFields ? effects.gravityFields.length : 0,
          gravityCoreResonance: effects.gravityCore ? effects.gravityCore.resonance || 0 : 0,
          fireZones: effects.fireZones ? effects.fireZones.length : 0,
          flameBreaths: effects.flameBreaths ? effects.flameBreaths.length : 0,
          smokeZones: effects.smokeZones ? effects.smokeZones.length : 0,
          hiddenActors: effects.hiddenActors || 0,
          smokeBlinded: effects.smokeBlinded || 0,
          poisonedActors: effects.poisonedActors || 0,
          shockwaves: effects.shockwaves ? effects.shockwaves.length : 0,
          spiritRemnants: effects.spiritRemnants ? effects.spiritRemnants.length : 0,
          spiritAllies: effects.spiritAllies ? effects.spiritAllies.length : 0,
          spiritCommands: effects.spiritCommands ? effects.spiritCommands.length : 0,
          burningActors: effects.burningActors || 0,
          hotBoxes: effects.hotBoxes || 0,
          flameParticles: effects.flameParticles || 0,
          smokeParticles: effects.smokeParticles || 0,
        });
      }
    }
    else {
      if (window.__stickDebug === apiObj) delete window.__stickDebug;
      if (root && root.dataset) {
        delete root.dataset.stickDebug;
        delete root.dataset.stickClass;
        delete root.dataset.stickLabBuild;
        delete root.dataset.stickEffectCounts;
      }
    }
  }

  startFromQuery();
  exposeDebugApi();
};

Arcade.register(PUBLIC);
})();

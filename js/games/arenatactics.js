/* Arena Tactics — PROTOTYPE for Stick Arena's slower, terrain-driven combat.
   Implements both pillars of docs/stick-arena-tactics.md:
   (1) deliberate, terrain-as-weapon combat — Stagger -> Reposition -> Environmental
       KO, and (2) a no-stat-soup loadout: pick a CLASS, then after each wave draft
       1-of-3 to fork one slot (Attack/Shift/E/Q) or swap your keystone Passive.
   Side-view, one fixed screen scaled to fit. Not the real game. */
Arcade.register({
  id: 'arenatactics',
  name: 'Arena Tactics',
  emoji: '🥋',
  desc: 'PROTOTYPE: a slower, tactical stick brawl — pick a class, stagger foes, then use the pit, edges, and spikes to finish them.',
  color: '#7fd4ff',

  start(root, api) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const perf = api.perf || { particleCount: n => n, particleLimit: n => n };
    const TW = 480, TH = 320, GY = 246;
    const GROUND = [[20, 200], [280, 460]];
    const PIT = [200, 280];
    const SPIKES = [312, 392];
    let s = 1, offX = 0, offY = 0, W = 0, H = 0;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    function layout(v) { W = v.w; H = v.h; s = Math.min(W / TW, H / TH); offX = (W - TW * s) / 2; offY = (H - TH * s) / 2; }
    layout(view);

    // =============================================================== DATA
    // ----- abilities (data-driven; combat is dispatched by `kind`/params) -----
    // Attack specs carry an `atk` block; abilities carry a `kind`+params and a cd.
    // forkOf marks an upgrade within a slot. cls scopes it to a class ('neutral'
    // keystones are draftable by everyone). key:1 marks a keystone passive.
    const A = {};                                   // id -> spec
    const def = (id, spec) => { A[id] = Object.assign({ id }, spec); };
    // --- shared attack timing (ms): windup / active-end / recover-end ---
    const T_STD = { w: 180, a: 280, r: 480 }, T_FAST = { w: 120, a: 210, r: 350 };

    // KNIGHT — tanky bruiser
    def('kn_slash', { slot: 'attack', cls: 'knight', name: 'Slash', desc: 'Committed swing — solid stagger on one foe.', atk: { reach: 46, dmg: 9, stag: 34, kx: 1.6, t: T_STD } });
    def('kn_cleave', { slot: 'attack', cls: 'knight', forkOf: 'kn_slash', name: 'Cleave', desc: 'Wide arc hits every foe in front (less stagger each). Fuses with all-pulls.', atk: { reach: 60, dmg: 7, stag: 26, kx: 1.6, pierce: 1, wide: 1, t: T_STD } });
    def('kn_thrust', { slot: 'attack', cls: 'knight', forkOf: 'kn_slash', name: 'Thrust', desc: 'Piercing lunge-stab: fast stagger + line knockback.', atk: { reach: 64, dmg: 8, stag: 44, kx: 5, pierce: 1, lunge: 2.2, t: T_STD } });
    def('kn_dash', { slot: 'shift', cls: 'knight', name: 'Dash', desc: 'Quick i-frame dash.', kind: 'dash', cd: 1100, power: 7.5, iframe: 220 });
    def('kn_bash', { slot: 'shift', cls: 'knight', forkOf: 'kn_dash', name: 'Shield Bash', desc: 'Charging dash that staggers every foe you crash through.', kind: 'dash', cd: 1300, power: 8.5, iframe: 200, pierceStag: 28, dmg: 3 });
    def('kn_push', { slot: 'e', cls: 'knight', name: 'Push', desc: 'Shove foes ahead — massive if staggered.', kind: 'push', cd: 1500, reach: 64, kx: 6.4, ky: -1, stag: 18 });
    def('kn_launch', { slot: 'e', cls: 'knight', forkOf: 'kn_push', name: 'Launch', desc: 'Pop foes up & away — arc them over gaps into the pit.', kind: 'push', cd: 1600, reach: 60, kx: 4.6, ky: -3, stag: 18 });
    def('kn_shock', { slot: 'q', cls: 'knight', name: 'Shockwave', desc: 'Slam the ground — stagger & shove out everything around you.', kind: 'shock', cd: 4200, radius: 72, dmg: 6, stag: 40, push: 5 });
    def('kn_quake', { slot: 'q', cls: 'knight', forkOf: 'kn_shock', name: 'Quake', desc: 'A bigger slam with a wider ring and harder shove.', kind: 'shock', cd: 5200, radius: 98, dmg: 8, stag: 55, push: 7 });
    def('kn_vengeance', { slot: 'passive', cls: 'knight', key: 1, name: 'Vengeance', desc: 'Keystone: damage you take is stored; your next attack releases it as a stagger shockwave.' });
    def('kn_bulwark', { slot: 'passive', cls: 'knight', key: 1, name: 'Bulwark', desc: 'Keystone: you take 50% less knockback, and your Push/Launch hits 30% harder.' });

    // ROGUE — fast & fragile
    def('rg_jab', { slot: 'attack', cls: 'rogue', name: 'Jab', desc: 'Fast poke — quick recovery, light stagger.', atk: { reach: 40, dmg: 7, stag: 22, kx: 1.2, t: T_FAST } });
    def('rg_flurry', { slot: 'attack', cls: 'rogue', forkOf: 'rg_jab', name: 'Flurry', desc: 'A rapid combo that rips through two foes.', atk: { reach: 44, dmg: 5, stag: 19, kx: 1, pierce: 1, t: T_FAST } });
    def('rg_backstab', { slot: 'attack', cls: 'rogue', forkOf: 'rg_jab', name: 'Backstab', desc: 'Doubles stagger on foes facing away from you.', atk: { reach: 40, dmg: 8, stag: 26, kx: 1.2, backstab: 1, t: T_FAST } });
    def('rg_dash', { slot: 'shift', cls: 'rogue', name: 'Dash', desc: 'Snappy i-frame dash on a short cooldown.', kind: 'dash', cd: 900, power: 8, iframe: 240 });
    def('rg_blink', { slot: 'shift', cls: 'rogue', forkOf: 'rg_dash', name: 'Blink', desc: 'Longer dash that staggers any foe you pass through.', kind: 'dash', cd: 1300, power: 9.5, iframe: 320, pierceStag: 22, dmg: 3 });
    def('rg_kick', { slot: 'e', cls: 'rogue', name: 'Kick', desc: 'A quick shove to create space.', kind: 'push', cd: 1300, reach: 50, kx: 6, ky: -1, stag: 16 });
    def('rg_launch', { slot: 'e', cls: 'rogue', forkOf: 'rg_kick', name: 'Uplift', desc: 'Kick that pops a foe up and away over the gap.', kind: 'push', cd: 1500, reach: 48, kx: 4.4, ky: -3, stag: 16 });
    def('rg_hook', { slot: 'q', cls: 'rogue', name: 'Hook', desc: 'Yank the nearest front foe toward you across the gap.', kind: 'pull', cd: 1700, range: 220, stag: 10 });
    def('rg_vortex', { slot: 'q', cls: 'rogue', forkOf: 'rg_hook', name: 'Vortex', desc: 'Drag ALL front foes into one cluster to share a hazard.', kind: 'pull', cd: 2200, range: 220, stag: 12, all: 1 });
    def('rg_bloodrush', { slot: 'passive', cls: 'rogue', key: 1, name: 'Bloodrush', desc: 'Keystone: each KO refunds your Dash and grants a brief i-frame window.' });
    def('rg_assassinate', { slot: 'passive', cls: 'rogue', key: 1, name: 'Assassinate', desc: 'Keystone: your hits deal 60% more stagger to foes that are already staggered.' });

    // LANCER — long reach
    def('ln_thrust', { slot: 'attack', cls: 'lancer', name: 'Thrust', desc: 'Long piercing stab with good reach.', atk: { reach: 70, dmg: 8, stag: 36, kx: 4, pierce: 1, lunge: 1.5, t: T_STD } });
    def('ln_sweep', { slot: 'attack', cls: 'lancer', forkOf: 'ln_thrust', name: 'Sweep', desc: 'Wide low sweep across everything in front. Fuses with all-pulls.', atk: { reach: 62, dmg: 7, stag: 28, kx: 1.8, pierce: 1, wide: 1, t: T_STD } });
    def('ln_skewer', { slot: 'attack', cls: 'lancer', forkOf: 'ln_thrust', name: 'Skewer', desc: 'A huge lunging impale — enormous reach and knockback.', atk: { reach: 86, dmg: 9, stag: 30, kx: 7, pierce: 1, lunge: 3, t: T_STD } });
    def('ln_charge', { slot: 'shift', cls: 'lancer', name: 'Charge', desc: 'Long lance-charge that shoves foes along with you.', kind: 'dash', cd: 1300, power: 9, iframe: 200, pierceStag: 14, dmg: 3, carry: 1 });
    def('ln_vault', { slot: 'shift', cls: 'lancer', forkOf: 'ln_charge', name: 'Vault', desc: 'Pole-vault dash that hops you over a gap.', kind: 'dash', cd: 1100, power: 7, iframe: 260, vy: -6 });
    def('ln_push', { slot: 'e', cls: 'lancer', name: 'Push', desc: 'Two-handed shove with extra reach.', kind: 'push', cd: 1500, reach: 72, kx: 6, ky: -1, stag: 18 });
    def('ln_launch', { slot: 'e', cls: 'lancer', forkOf: 'ln_push', name: 'Launch', desc: 'Pop foes up & away into the pit.', kind: 'push', cd: 1600, reach: 68, kx: 4.6, ky: -3, stag: 18 });
    def('ln_hook', { slot: 'q', cls: 'lancer', name: 'Hook', desc: 'Reel a far foe in across the gap.', kind: 'pull', cd: 1700, range: 250, stag: 12 });
    def('ln_maw', { slot: 'q', cls: 'lancer', forkOf: 'ln_hook', name: 'Maw', desc: 'Drag ALL front foes toward you at once.', kind: 'pull', cd: 2200, range: 250, stag: 12, all: 1 });
    def('ln_ironstance', { slot: 'passive', cls: 'lancer', key: 1, name: 'Iron Stance', desc: 'Keystone: stand still ~0.8s to root — you ignore knockback and your next hit lands heavy.' });

    // MAGE — ranged control
    def('mg_bolt', { slot: 'attack', cls: 'mage', name: 'Bolt', desc: 'Fire a staggering arcane bolt.', atk: { ranged: 1, speed: 6, dmg: 6, stag: 26, color: '#c9a3ff', t: T_STD } });
    def('mg_frost', { slot: 'attack', cls: 'mage', forkOf: 'mg_bolt', name: 'Frostbolt', desc: 'A slower bolt that chills a foe, slowing it for a while.', atk: { ranged: 1, speed: 5, dmg: 5, stag: 22, slow: 1300, color: '#7fe6ff', t: T_STD } });
    def('mg_blast', { slot: 'attack', cls: 'mage', forkOf: 'mg_bolt', name: 'Blast', desc: 'A close arcane nova that rips everything right in front.', atk: { reach: 60, dmg: 8, stag: 34, kx: 2.4, pierce: 1, wide: 1, t: T_STD } });
    def('mg_blink', { slot: 'shift', cls: 'mage', name: 'Blink', desc: 'Short-range teleport with i-frames.', kind: 'dash', cd: 1300, power: 9, iframe: 320 });
    def('mg_phase', { slot: 'shift', cls: 'mage', forkOf: 'mg_blink', name: 'Phase', desc: 'A longer blink that crosses the whole pit.', kind: 'dash', cd: 1600, power: 11, iframe: 420 });
    def('mg_force', { slot: 'e', cls: 'mage', name: 'Force', desc: 'A telekinetic shove with long reach.', kind: 'push', cd: 1500, reach: 74, kx: 6, ky: -1, stag: 20 });
    def('mg_launch', { slot: 'e', cls: 'mage', forkOf: 'mg_force', name: 'Updraft', desc: 'Lift foes up and away over the gap.', kind: 'push', cd: 1600, reach: 70, kx: 4.6, ky: -3, stag: 20 });
    def('mg_singularity', { slot: 'q', cls: 'mage', name: 'Singularity', desc: 'Pull ALL front foes into one point to share a hazard.', kind: 'pull', cd: 2400, range: 260, stag: 12, all: 1 });
    def('mg_blackhole', { slot: 'q', cls: 'mage', forkOf: 'mg_singularity', name: 'Black Hole', desc: 'A stronger singularity that staggers as it clusters.', kind: 'pull', cd: 3000, range: 270, stag: 22, all: 1 });
    def('mg_resonance', { slot: 'passive', cls: 'mage', key: 1, name: 'Resonance', desc: 'Keystone: every 4th bolt you cast echoes a free copy at a nearby foe.' });

    // RANGER — kiter
    def('rn_shot', { slot: 'attack', cls: 'ranger', name: 'Shot', desc: 'A fast arrow with light stagger.', atk: { ranged: 1, speed: 8, dmg: 5, stag: 18, gravity: 0.02, color: '#ffcf8a', t: T_FAST } });
    def('rn_power', { slot: 'attack', cls: 'ranger', forkOf: 'rn_shot', name: 'Power Shot', desc: 'A heavy arrow that knocks foes back — ring them out from range.', atk: { ranged: 1, speed: 7, dmg: 7, stag: 30, knock: 3, gravity: 0.02, color: '#ffb05e', t: T_STD } });
    def('rn_multishot', { slot: 'attack', cls: 'ranger', forkOf: 'rn_shot', name: 'Multishot', desc: 'A spread of three arrows.', atk: { ranged: 1, speed: 8, dmg: 3, stag: 12, spread: 3, gravity: 0.02, color: '#ffcf8a', t: T_FAST } });
    def('rn_roll', { slot: 'shift', cls: 'ranger', name: 'Roll', desc: 'An evasive roll with generous i-frames.', kind: 'dash', cd: 1000, power: 7.5, iframe: 300 });
    def('rn_dash', { slot: 'shift', cls: 'ranger', forkOf: 'rn_roll', name: 'Sprint', desc: 'A faster, lower-cooldown dash.', kind: 'dash', cd: 900, power: 9, iframe: 220 });
    def('rn_kick', { slot: 'e', cls: 'ranger', name: 'Kick', desc: 'Boot a foe away to reset spacing.', kind: 'push', cd: 1300, reach: 50, kx: 6, ky: -1, stag: 16 });
    def('rn_net', { slot: 'e', cls: 'ranger', forkOf: 'rn_kick', name: 'Snare', desc: 'Yank the nearest foe in and slow it.', kind: 'pull', cd: 1600, range: 180, stag: 10, slow: 1400 });
    def('rn_hook', { slot: 'q', cls: 'ranger', name: 'Hook', desc: 'Reel a far foe toward you across the gap.', kind: 'pull', cd: 1700, range: 220, stag: 10 });
    def('rn_volley', { slot: 'q', cls: 'ranger', forkOf: 'rn_hook', name: 'Volley', desc: 'Loose a fan of five arrows downrange.', kind: 'volley', cd: 2600, speed: 7, dmg: 4, stag: 16, spread: 5, gravity: 0.02, color: '#ffcf8a' });
    def('rn_packbond', { slot: 'passive', cls: 'ranger', key: 1, name: 'Pack Bond', desc: 'Keystone: foes you KO rise as wolf allies that hound the rest of the pack.' });
    def('rn_hunter', { slot: 'passive', cls: 'ranger', key: 1, name: "Hunter's Mark", desc: 'Keystone: after a KO you move faster, and your hits stagger staggered foes harder.' });

    // NEUTRAL keystones — draftable by any class
    def('momentum', { slot: 'passive', cls: 'neutral', key: 1, name: 'Momentum', desc: 'Keystone: Push/Launch knockback +45%. Every edge gets closer.' });
    def('executioner', { slot: 'passive', cls: 'neutral', key: 1, name: 'Executioner', desc: 'Keystone: staggered foes stay stunned 60% longer — more reposition time.' });
    def('overload', { slot: 'passive', cls: 'neutral', key: 1, name: 'Overload', desc: 'Keystone: your abilities skip cooldowns but cost a little HP each.' });

    const CLASSES = {
      knight: { name: 'Knight', emoji: '🛡️', color: '#ffd45e', hp: 120, moveMul: 0.92, blurb: 'Tanky bruiser. Shove and slam foes into the terrain.', start: { attack: 'kn_slash', shift: 'kn_dash', e: 'kn_push', q: 'kn_shock', passive: null } },
      rogue: { name: 'Rogue', emoji: '🗡️', color: '#9cff5e', hp: 85, moveMul: 1.2, blurb: 'Fast & fragile. Dash through, stagger, and execute.', start: { attack: 'rg_jab', shift: 'rg_dash', e: 'rg_kick', q: 'rg_hook', passive: null } },
      lancer: { name: 'Lancer', emoji: '🔱', color: '#7fd4ff', hp: 100, moveMul: 1.0, blurb: 'Long reach. Skewer and charge foes off the edge.', start: { attack: 'ln_thrust', shift: 'ln_charge', e: 'ln_push', q: 'ln_hook', passive: null } },
      mage: { name: 'Mage', emoji: '🔮', color: '#b48cff', hp: 80, moveMul: 0.96, blurb: 'Ranged control. Bolts, force, and a singularity pull.', start: { attack: 'mg_bolt', shift: 'mg_blink', e: 'mg_force', q: 'mg_singularity', passive: null } },
      ranger: { name: 'Ranger', emoji: '🏹', color: '#ff9f6e', hp: 90, moveMul: 1.1, blurb: 'Kiter. Arrows that knock foes off ledges from afar.', start: { attack: 'rn_shot', shift: 'rn_roll', e: 'rn_kick', q: 'rn_hook', passive: null } },
    };
    const SLOTS = ['attack', 'shift', 'e', 'q', 'passive'];
    const SLOT_LABEL = { attack: 'ATK', shift: '⇧', e: 'E', q: 'Q', passive: '🔑' };
    const SLOT_KEY = { attack: 'J / Click', shift: 'Shift', e: 'K', q: 'L', passive: '—' };

    // ----- waves -----
    const WAVES = [
      [{ x: 360, hp: 90, facing: -1 }, { x: 150, hp: 90, facing: 1 }],
      [{ x: 385, hp: 110, facing: -1 }, { x: 120, hp: 110, facing: 1 }, { x: 340, hp: 150, facing: -1, armored: 1 }],
      [{ x: 400, hp: 120, facing: -1 }, { x: 95, hp: 120, facing: 1 }, { x: 350, hp: 170, facing: -1, armored: 1 }, { x: 160, hp: 110, facing: 1, charger: 1 }],
    ];

    // =============================================================== DOM / UI
    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);

    const top = document.createElement('div'); top.className = 'at-top'; top.style.display = 'none';
    top.innerHTML = `<span class="at-cls" id="at-cls"></span>
      <span class="at-hpwrap"><i id="at-hpbar"></i><b id="at-hpnum">100</b></span>
      <span class="at-meta">W<b id="at-wave">1</b> · <span id="at-foes">0</span> foes</span>`;
    root.appendChild(top);

    const helpBtn = document.createElement('button'); helpBtn.className = 'at-helpbtn'; helpBtn.type = 'button'; helpBtn.textContent = '?'; helpBtn.style.display = 'none';
    helpBtn.setAttribute('aria-label', 'Abilities help');
    root.appendChild(helpBtn);

    // bottom ability bar — doubles as cooldown HUD and (on touch) the controls
    const abar = document.createElement('div'); abar.className = 'at-abar'; abar.style.display = 'none';
    const cells = {};
    for (const slot of ['attack', 'shift', 'e', 'q']) {
      const c = document.createElement('button'); c.className = 'at-cell'; c.type = 'button'; c.dataset.slot = slot;
      c.innerHTML = `<i class="cd"></i><span class="nm"></span><span class="kb">${SLOT_LABEL[slot]}</span>`;
      abar.appendChild(c); cells[slot] = c;
    }
    root.appendChild(abar);

    // left movement pad (touch)
    const style = document.createElement('style');
    style.textContent = `
      .at-top{position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;z-index:20;
        font:700 12px/1 system-ui,sans-serif;color:#cfe0f6;background:rgba(10,16,30,.55);padding:6px 10px;border-radius:999px;white-space:nowrap}
      .at-cls{font-size:13px}.at-hpwrap{position:relative;display:inline-flex;align-items:center;width:96px;height:12px;
        background:rgba(255,255,255,.1);border-radius:7px;overflow:hidden}
      .at-hpwrap i{position:absolute;inset:0;width:100%;transform-origin:left;background:linear-gradient(90deg,#ff7a7a,#ffd45e);transition:transform .15s}
      .at-hpwrap b{position:relative;width:100%;text-align:center;font-size:10px;color:#05060f;text-shadow:0 1px 1px rgba(255,255,255,.4)}
      .at-meta{opacity:.85}.at-meta b{color:#fff}
      .at-helpbtn{position:absolute;top:8px;right:max(10px,env(safe-area-inset-right));z-index:21;width:28px;height:28px;border-radius:50%;
        border:1px solid rgba(127,212,255,.5);background:rgba(12,20,38,.7);color:#bfe8ff;font:800 14px/1 system-ui;cursor:pointer}
      .at-helpbtn:active{background:rgba(127,212,255,.4);color:#04101f}
      .at-abar{position:absolute;bottom:max(12px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
        display:flex;gap:8px;z-index:20;touch-action:none}
      .at-cell{position:relative;width:58px;height:54px;border-radius:12px;border:1px solid rgba(127,212,255,.4);
        background:rgba(14,22,40,.62);color:#dff0ff;overflow:hidden;display:flex;flex-direction:column;align-items:center;
        justify-content:center;user-select:none;cursor:pointer;padding:0}
      .at-cell .cd{position:absolute;left:0;right:0;bottom:0;height:100%;transform-origin:bottom;transform:scaleY(0);
        background:rgba(0,0,0,.5);pointer-events:none}
      .at-cell.rdy{border-color:rgba(127,212,255,.85)}
      .at-cell .nm{position:relative;font-weight:800;font-size:11px;text-align:center;line-height:1.05;padding:0 3px}
      .at-cell .kb{position:relative;font-size:9px;opacity:.55;margin-top:2px;font-weight:800}
      .at-cell:active{background:rgba(127,212,255,.35);color:#04101f}
      .at-pad{position:absolute;bottom:max(12px,env(safe-area-inset-bottom));left:max(10px,env(safe-area-inset-left));
        display:flex;gap:9px;z-index:21;opacity:.6;touch-action:none}
      .at-b{width:50px;height:50px;border-radius:50%;border:2px solid rgba(127,212,255,.55);background:rgba(20,28,48,.5);
        color:#dff0ff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;user-select:none}
      .at-b:active{background:rgba(127,212,255,.5);color:#04101f}
      .at-draft{display:flex;flex-direction:column;gap:9px;width:min(440px,88vw)}
      .at-pick,.at-classcard{text-align:left;padding:10px 12px;border:1px solid rgba(127,212,255,.5);border-radius:12px;
        background:rgba(18,28,50,.7);color:#dff0ff;cursor:pointer;transition:background .12s,border-color .12s}
      .at-pick:hover,.at-pick:focus,.at-classcard:hover,.at-classcard:focus{background:rgba(127,212,255,.16);border-color:#7fd4ff;outline:none}
      .at-pick .pn,.at-classcard .pn{font-weight:800;font-size:14px}
      .at-pick .ps,.at-classcard .ps{font-size:11px;opacity:.72;display:block;margin-top:2px}
      .at-pick .pslot{float:right;font-size:10px;opacity:.6;font-weight:800;letter-spacing:.06em}
      .at-pick.key{border-color:rgba(255,212,94,.6)}.at-pick.key:hover{background:rgba(255,212,94,.14);border-color:#ffd45e}
      .at-help{display:flex;flex-direction:column;gap:7px;width:min(440px,88vw);text-align:left}
      .at-help .row{display:flex;gap:8px;align-items:baseline;background:rgba(18,28,50,.6);border-radius:9px;padding:7px 10px}
      .at-help .row .s{font-weight:800;font-size:10px;color:#7fd4ff;min-width:30px}
      .at-help .row .n{font-weight:800}.at-help .row .d{font-size:11px;opacity:.7;display:block}
      .at-help .row.k{border:1px solid rgba(255,212,94,.4)}.at-help .row.k .s{color:#ffd45e}
      @media (hover:hover) and (pointer:fine){.at-pad{display:none}.at-abar{opacity:.92}}`;
    root.appendChild(style);

    function pad(cls, defs) { const d = document.createElement('div'); d.className = 'at-pad ' + cls; for (const [label, set] of defs) { const b = document.createElement('div'); b.className = 'at-b'; b.textContent = label; hold(b, set); d.appendChild(b); } root.appendChild(d); return d; }
    function hold(btn, set) { const on = e => { e.preventDefault(); set(true); }; const off = e => { e.preventDefault(); set(false); }; api.on(btn, 'pointerdown', on); api.on(btn, 'pointerup', off); api.on(btn, 'pointerleave', off); api.on(btn, 'pointercancel', off); }

    // =============================================================== STATE
    const input = { left: false, right: false, jump: false, attack: false, e: false, q: false, dash: false };
    let player, mobs, bolts, pets, state, prevState, particles, shake, simAcc, wave, loadout, chosenClass, cls;
    const STEP = 16.7, GRAV = 0.5, MOVE = 1.3, MOVE_ATK = 0.42, JUMP = -10;

    function mkFighter(x, opts = {}) {
      return {
        x, y: GY, vx: 0, vy: 0, grounded: false, facing: opts.facing || 1,
        hp: opts.hp || 100, maxHp: opts.hp || 100, stagger: 0, stunned: 0, hitstun: 0,
        atk: null, cd: { shift: 0, e: 0, q: 0 }, iframe: 0, dead: false, foe: !!opts.foe,
        windup: 0, lungeReady: 1200, lunging: 0, flash: 0, slow: 0,
        armored: !!opts.armored, charger: !!opts.charger,
        venge: 0, stillT: 0, rooted: 0, castN: 0, haste: 0,
      };
    }
    function spawnWave(i) { mobs = WAVES[i].map(d => mkFighter(d.x, { foe: 1, hp: d.hp, facing: d.facing, armored: d.armored, charger: d.charger })); }
    function reset() {
      cls = CLASSES[chosenClass];
      player = mkFighter(110, { hp: cls.hp, facing: 1 });
      loadout = Object.assign({}, cls.start);
      wave = 0; spawnWave(0); particles = []; bolts = []; pets = []; shake = 0; simAcc = 0;
    }
    const equipped = slot => A[loadout[slot]];
    const hasPassive = id => loadout.passive === id;

    // =============================================================== HUD sync
    let hudT = 0;
    function syncTop() {
      document.getElementById('at-cls').textContent = cls.emoji + ' ' + cls.name;
      document.getElementById('at-hpnum').textContent = Math.max(0, Math.ceil(player.hp));
      document.getElementById('at-hpbar').style.transform = 'scaleX(' + clamp(player.hp / player.maxHp, 0, 1) + ')';
      document.getElementById('at-wave').textContent = (wave + 1) + '/' + WAVES.length;
      document.getElementById('at-foes').textContent = mobs.filter(m => !m.dead).length;
    }
    function syncAbar() {
      for (const slot of ['attack', 'shift', 'e', 'q']) {
        const c = cells[slot], spec = equipped(slot);
        c.querySelector('.nm').textContent = spec ? spec.name : '—';
        let frac = 0;
        if (slot === 'attack') frac = player.atk ? clamp(1 - player.atk.t / equipped('attack').atk.t.r, 0, 1) : 0;
        else { const cd = player.cd[slot] || 0, mx = spec ? spec.cd : 1; frac = clamp(cd / mx, 0, 1); }
        c.querySelector('.cd').style.transform = 'scaleY(' + frac + ')';
        c.classList.toggle('rdy', frac <= 0.001);
      }
    }

    // =============================================================== SCREENS
    function setPlayUI(on) { top.style.display = on ? 'flex' : 'none'; abar.style.display = on ? 'flex' : 'none'; helpBtn.style.display = on ? 'block' : 'none'; }
    function showMenu() {
      state = 'menu'; setPlayUI(false); ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Arena Tactics <span style="font-size:.5em;opacity:.6">prototype</span></h2>
        <p class="msg">Slower, tactical stick combat. Raw hits barely dent foes — <b>stagger</b> them (attack until they flash gold),
        then <b>Push</b>/<b>Pull</b> them into the pit, off an edge, or onto spikes. Pick a class, then <b>draft</b> one upgrade
        after each wave. <b>Armored</b> foes only die to the terrain.</p>
        <button class="btn" data-act="classes">CHOOSE CLASS ▸</button>`;
    }
    function showClassSelect() {
      state = 'classsel'; setPlayUI(false); ov.classList.remove('hidden');
      const cards = Object.keys(CLASSES).map(id => { const c = CLASSES[id]; return `<button class="at-classcard" data-cls="${id}" style="border-color:${c.color}88">
        <span class="pn">${c.emoji} ${c.name}</span><span class="ps">${c.blurb}</span></button>`; }).join('');
    ov.innerHTML = `<h2>Pick your fighter</h2><div class="at-draft">${cards}</div>`;
    }
    function play() { reset(); setPlayUI(true); ov.classList.add('hidden'); state = 'playing'; syncTop(); syncAbar(); }
    function endScreen(win) {
      state = 'over'; setPlayUI(false); ov.classList.remove('hidden');
      ov.innerHTML = `<h2>${win ? 'Arena Cleared' : 'You Fell'}</h2>
        <p class="msg">${win ? 'Every wave met the terrain. That’s the idea.' : 'Mind the edges — they cut both ways.'}</p>
        <button class="btn" data-act="classes">NEW RUN ↻</button>`;
    }
    function openHelp() {
      if (state !== 'playing') return;
      prevState = state; state = 'help'; ov.classList.remove('hidden');
      const rows = SLOTS.map(slot => { const sp = equipped(slot); const k = slot === 'passive'; return `<div class="row${k ? ' k' : ''}">
        <span class="s">${SLOT_LABEL[slot]}</span><span><span class="n">${sp ? sp.name : '— none —'}</span> <span style="opacity:.4">${k ? 'keystone' : SLOT_KEY[slot]}</span><span class="d">${sp ? sp.desc : 'No keystone yet — draft one between waves.'}</span></span></div>`; }).join('');
      ov.innerHTML = `<h2>${cls.emoji} ${cls.name} — abilities</h2><div class="at-help">${rows}</div>
        <button class="btn alt" data-act="resume">RESUME ▸</button>`;
    }
    function closeHelp() { if (state !== 'help') return; state = prevState || 'playing'; ov.classList.add('hidden'); input.attack = input.e = input.q = input.dash = false; }

    ov.addEventListener('click', e => {
      const act = e.target.dataset.act;
      if (act === 'classes') { showClassSelect(); return; }
      if (act === 'resume') { closeHelp(); return; }
      const cc = e.target.closest('[data-cls]'); if (cc) { chosenClass = cc.dataset.cls; play(); return; }
      const p = e.target.closest('[data-pick]'); if (p) pick(p.dataset.pick);
    });
    api.on(helpBtn, 'click', () => { if (state === 'help') closeHelp(); else openHelp(); });

    // =============================================================== DRAFT
    function draftPool() {
      const elig = Object.keys(A).filter(id => {
        const v = A[id]; if (v.cls !== chosenClass && v.cls !== 'neutral') return false;
        if (v.slot === 'passive') return loadout.passive !== id;
        return !!v.forkOf && loadout[v.slot] !== id;
      });
      const bySlot = {};
      for (const id of elig.sort(() => Math.random() - 0.5)) if (!bySlot[A[id].slot]) bySlot[A[id].slot] = id;
      return Object.values(bySlot).sort(() => Math.random() - 0.5).slice(0, 3);
    }
    function openDraft() {
      state = 'draft'; setPlayUI(false); ov.classList.remove('hidden');
      const picks = draftPool();
      if (!picks.length) { nextWave(); return; }
      const cards = picks.map(id => { const v = A[id]; return `<button class="at-pick${v.key ? ' key' : ''}" data-pick="${id}">
        <span class="pslot">${SLOT_LABEL[v.slot]}</span><span class="pn">${v.name}</span><span class="ps">${v.desc}</span></button>`; }).join('');
      ov.innerHTML = `<h2>Wave ${wave + 1} cleared</h2>
        <p class="msg" style="margin-bottom:4px">Draft one upgrade. Forks replace that slot — one pick per slot.</p>
        <div class="at-draft">${cards}</div>`;
    }
    function pick(id) { if (!A[id]) return; loadout[A[id].slot] = id; nextWave(); }
    function nextWave() {
      wave++;
      if (wave >= WAVES.length) { endScreen(true); return; }
      spawnWave(wave); state = 'playing'; setPlayUI(true); ov.classList.add('hidden'); syncTop(); syncAbar();
    }

    // =============================================================== INPUT
    pad('at-move', [['◀', v => input.left = v], ['▶', v => input.right = v], ['⤒', v => input.jump = v]]);
    for (const slot of ['attack', 'shift', 'e', 'q']) {
      const key = slot === 'shift' ? 'dash' : slot;
      api.on(cells[slot], 'pointerdown', e => { e.preventDefault(); if (state === 'playing') input[key] = true; });
    }
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') input.left = true;
      else if (k === 'arrowright' || k === 'd') input.right = true;
      else if (k === 'arrowup' || k === 'w' || k === ' ') { input.jump = true; if (k === ' ') e.preventDefault(); }
      else if (k === 'j') input.attack = true;
      else if (k === 'k') input.e = true;
      else if (k === 'l') input.q = true;
      else if (k === 'shift') input.dash = true;
      else if (k === 'h' || k === '?' || k === '/') { if (state === 'help') closeHelp(); else openHelp(); }
    });
    api.on(window, 'keyup', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') input.left = false;
      else if (k === 'arrowright' || k === 'd') input.right = false;
      else if (k === 'arrowup' || k === 'w' || k === ' ') input.jump = false;
    });
    api.on(view.canvas, 'pointerdown', e => { if (state !== 'playing') return; const vx = (e.clientX - offX) / s; player.facing = vx >= player.x ? 1 : -1; input.attack = true; });

    // =============================================================== TERRAIN
    function groundAt(x) { for (const [a, b] of GROUND) if (x >= a && x <= b) return GY; return null; }
    const overDrop = x => groundAt(x) === null;
    const onSpikes = x => x >= SPIKES[0] && x <= SPIKES[1];

    // =============================================================== COMBAT
    function hitFighter(t, dmg, kx, ky, stag) {
      if (t.iframe > 0 || t.dead) return;
      if (!t.armored) t.hp -= dmg;
      // keystones that scale stagger vs already-staggered foes
      if (t.foe && (t.stagger > 0 || t.stunned > 0)) { if (hasPassive('rg_assassinate') || hasPassive('rn_hunter')) stag *= 1.6; }
      t.stagger = clamp(t.stagger + stag, 0, 100); t.flash = 1; t.hitstun = Math.max(t.hitstun, 120);
      const heavy = t.stunned > 0, m = heavy ? 3.8 : 1;
      let kmul = m;
      if (t === player && t.rooted) kmul = 0;                       // Iron Stance
      if (t === player && hasPassive('kn_bulwark')) kmul *= 0.5;    // Bulwark
      t.vx += kx * kmul; t.vy += (ky - (heavy ? 1.6 : 0.4)) * (heavy ? 1.5 : 1); t.grounded = false;
      if (t.stagger >= 100 && t.stunned <= 0) { t.stunned = 1700 * (hasPassive('executioner') ? 1.6 : 1); t.stagger = 100; burst(t.x, t.y - 30, '#ffd45e', 14); }
      burst(t.x, t.y - 30, t.foe ? '#ff8a8a' : '#8ad0ff', 8); shake = Math.max(shake, heavy ? 6 : 2.5);
      if (t === player) { if (hasPassive('kn_vengeance') && kmul > 0) player.venge += dmg; syncTop(); }
    }
    function spawnBolt(x, y, dir, p, owner) {
      bolts.push({ x, y, vx: dir * (p.speed || 6), vy: p.vy || 0, g: p.gravity || 0, dmg: p.dmg, stag: p.stag, knock: (p.knock || 0) * dir, slow: p.slow || 0, color: p.color || '#cfe0f6', life: 1400, owner });
    }
    function fireRanged(p, dir) {
      const y = player.y - 40, n = p.spread || 1;
      player.castN++;
      for (let i = 0; i < n; i++) { const spread = (i - (n - 1) / 2) * 0.7; spawnBolt(player.x + dir * 14, y, dir, Object.assign({}, p, { vy: (p.vy || 0) + spread }), 'player'); }
      if (hasPassive('mg_resonance') && player.castN % 4 === 0) { const tgt = nearestFoe(); if (tgt) spawnBolt(player.x + dir * 14, y, Math.sign(tgt.x - player.x) || dir, p, 'player'); }
    }
    function nearestFoe() { let best = null, bd = 1e9; for (const m of mobs) if (!m.dead) { const d = Math.abs(m.x - player.x); if (d < bd) { bd = d; best = m; } } return best; }
    function playerAttack() {
      if (player.atk || player.hitstun > 0 || !player.grounded) return;
      player.atk = { t: 0, hit: false };
      const a = equipped('attack').atk; if (a.lunge) player.vx += player.facing * a.lunge;
    }
    function attackActive() {
      const a = equipped('attack').atk, dir = player.facing;
      // Vengeance discharge
      if (player.venge > 0 && hasPassive('kn_vengeance')) { shockwave(player.x, player.y, 70, 0, 30 + clamp(player.venge, 0, 60), 5, dir); player.venge = 0; }
      if (a.ranged) { fireRanged(a, dir); player.atk.hit = true; return; }
      const wide = a.pierce, fused = a.wide && (equipped('q') && equipped('q').all); // Cleave+all-pull fusion
      let hitAny = false;
      for (const m of mobs) {
        if (m.dead) continue; const dx = m.x - player.x;
        if (Math.sign(dx) === dir && Math.abs(dx) < a.reach && Math.abs(m.y - player.y) < 56) {
          let stag = a.stag;
          if (a.backstab && m.facing === dir) stag *= 2;            // hit from behind
          if (player.rooted) stag *= 1.5;                          // Iron Stance heavy hit
          if (fused) stag = Math.round(stag * 1.6);
          hitFighter(m, a.dmg, dir * a.kx, -0.3, stag); hitAny = true;
          if (!wide) break;
        }
      }
      if (hitAny) { player.atk.hit = true; if (player.rooted) player.rooted = 0; }
    }
    function activate(slot) {
      const spec = equipped(slot); if (!spec) return;
      const slotKey = slot;
      if (player.cd[slotKey] > 0 || player.hitstun > 0) return;
      const overload = hasPassive('overload');
      runAbility(spec);
      if (overload) { player.cd[slotKey] = 250; player.hp = Math.max(1, player.hp - 7); syncTop(); }
      else player.cd[slotKey] = spec.cd;
    }
    function runAbility(spec) {
      const dir = player.facing;
      if (spec.kind === 'dash') {
        player.iframe = spec.iframe; player.vx = dir * spec.power; if (spec.vy) { player.vy = spec.vy; player.grounded = false; }
        burst(player.x, player.y - 26, '#dff0ff', 8);
        if (spec.pierceStag) for (const m of mobs) { if (m.dead) continue; const dx = m.x - player.x; if (Math.sign(dx) === dir && Math.abs(dx) < 96 && Math.abs(m.y - player.y) < 50) { hitFighter(m, spec.dmg || 0, dir * (spec.carry ? 4 : 1.2), -0.4, spec.pierceStag); } }
      } else if (spec.kind === 'push') {
        const momentum = hasPassive('momentum') ? 1.45 : 1, bul = hasPassive('kn_bulwark') ? 1.3 : 1, mul = momentum * bul;
        burst(player.x + dir * 30, player.y - 30, '#7fd4ff', 12); shake = Math.max(shake, 4);
        for (const m of mobs) { if (m.dead) continue; const dx = m.x - player.x; if (Math.sign(dx) === dir && Math.abs(dx) < spec.reach && Math.abs(m.y - player.y) < 60) hitFighter(m, 4, dir * spec.kx * mul, spec.ky, spec.stag); }
      } else if (spec.kind === 'pull') {
        const targets = mobs.filter(m => !m.dead && Math.sign(m.x - player.x) === dir && Math.abs(m.x - player.x) < spec.range && Math.abs(m.y - player.y) < 70);
        if (!targets.length) return;
        const chosen = spec.all ? targets : [targets.reduce((a, b) => Math.abs(b.x - player.x) < Math.abs(a.x - player.x) ? b : a)];
        for (const t of chosen) { const d = Math.sign(player.x - t.x) || -dir; t.vx += d * 7.5; t.vy -= 2.2; t.grounded = false; t.stagger = clamp(t.stagger + spec.stag, 0, 100); if (spec.slow) t.slow = spec.slow; burst(t.x, t.y - 30, '#b48cff', 12); }
        shake = Math.max(shake, 3);
      } else if (spec.kind === 'shock') {
        shockwave(player.x, player.y, spec.radius, spec.dmg, spec.stag, spec.push, dir);
      } else if (spec.kind === 'volley') {
        fireRanged(spec, dir);
      }
    }
    function shockwave(cx, cy, radius, dmg, stag, push, dir) {
      burst(cx, cy - 20, '#ffd45e', 18); shake = Math.max(shake, 6);
      for (const m of mobs) { if (m.dead) continue; if (Math.abs(m.x - cx) < radius && Math.abs(m.y - cy) < 70) { const d = Math.sign(m.x - cx) || dir; hitFighter(m, dmg, d * push, -1.2, stag); } }
    }

    // =============================================================== STEP
    function stepFighter(f) {
      if (!f.armored && f.hp <= 0) return kill(f, 'hp');   // HP death works, just slow vs. terrain
      f.flash = Math.max(0, f.flash - 0.08);
      if (f.iframe > 0) f.iframe -= STEP;
      if (f.hitstun > 0) f.hitstun -= STEP;
      if (f.slow > 0) f.slow -= STEP;
      if (f.stunned > 0) { f.stunned -= STEP; if (f.stunned <= 0) f.stagger = 0; }
      else if (f.stagger > 0) f.stagger = Math.max(0, f.stagger - 0.35);
      f.vy += GRAV; f.x += f.vx; f.y += f.vy;
      const g = groundAt(f.x);
      if (g !== null && f.y >= g && f.vy >= 0) { f.y = g; f.vy = 0; f.grounded = true; f.vx *= 0.8; }
      else f.grounded = false;
      if (f.grounded && onSpikes(f.x)) return kill(f, 'spikes');
      if (f.y > TH + 50) return kill(f, 'fall');
    }
    function kill(f, how) {
      if (f.dead) return; f.dead = true;
      burst(f.x, Math.min(f.y, TH), f.foe ? '#ff6b6b' : '#7fd4ff', 22); shake = Math.max(shake, 6);
      if (f === player) { syncTop(); endScreen(false); return; }
      if (hasPassive('rg_bloodrush')) { player.cd.shift = 0; player.iframe = Math.max(player.iframe, 260); }
      if (hasPassive('rn_hunter')) player.haste = 2500;
      if (hasPassive('rn_packbond') && pets.length < 3 && how !== 'fall') pets.push(mkPet(f.x, f.y));
      syncTop();
      if (mobs.every(m => m.dead)) { if (wave + 1 >= WAVES.length) endScreen(true); else openDraft(); }
    }
    function stepPlayer() {
      if (player.dead) return;
      for (const k of ['shift', 'e', 'q']) if (player.cd[k] > 0) { player.cd[k] -= STEP; if (player.cd[k] < 0) player.cd[k] = 0; }
      const slowed = player.atk ? MOVE_ATK : 1;
      const hasteMul = player.haste > 0 ? 1.3 : 1; if (player.haste > 0) player.haste -= STEP;
      const moveSpd = MOVE * cls.moveMul * hasteMul;
      let moving = false;
      if (player.hitstun <= 0) {
        if (input.left && !input.right) { player.vx = -moveSpd * slowed; player.facing = -1; moving = true; }
        else if (input.right && !input.left) { player.vx = moveSpd * slowed; player.facing = 1; moving = true; }
        else if (player.grounded) player.vx *= 0.55;
        if (input.jump && player.grounded) { player.vy = JUMP; player.grounded = false; }
      }
      // Iron Stance: rooting by standing still
      if (hasPassive('ln_ironstance') && player.grounded && !moving && !player.atk) { player.stillT += STEP; if (player.stillT >= 800) player.rooted = 1; }
      else { player.stillT = 0; if (!player.atk) player.rooted = 0; }
      // one-shot actions
      if (input.attack) { playerAttack(); input.attack = false; }
      if (input.e) { activate('e'); input.e = false; }
      if (input.q) { activate('q'); input.q = false; }
      if (input.dash) { activate('shift'); input.dash = false; }
      // attack timing
      if (player.atk) {
        const a = equipped('attack').atk; player.atk.t += STEP; const t = player.atk.t;
        if (t >= a.t.w && t < a.t.a && !player.atk.hit) attackActive();
        if (t >= a.t.r) player.atk = null;
      }
      stepFighter(player);
    }
    function stepMob(m) {
      if (m.dead) return;
      if (m.stunned > 0 || m.hitstun > 0) { stepFighter(m); return; }
      const slowF = m.slow > 0 ? 0.5 : 1;
      m.lungeReady -= STEP;
      const dx = player.x - m.x, adx = Math.abs(dx), dir = dx >= 0 ? 1 : -1; m.facing = dir;
      const rng = m.charger ? 64 : 40, lungeVx = (m.charger ? 8 : 6) * slowF, lungeT = m.charger ? 170 : 120;
      if (m.windup > 0) { m.windup -= STEP; if (m.windup <= 0) { m.vx = dir * lungeVx; m.vy = -2; m.grounded = false; m.lunging = lungeT; } }
      else if (m.lunging > 0) { m.lunging -= STEP; if (adx < 30 && Math.abs(player.y - m.y) < 50) { hitFighter(player, m.charger ? 15 : 12, dir * 4.5, -1.2, 0); m.lunging = 0; } }
      else {
        if (adx < rng && m.lungeReady <= 0 && Math.abs(player.y - m.y) < 50) { m.windup = m.charger ? 480 : 420; m.lungeReady = 1700; m.vx = 0; }
        else if (adx > 26) { const ahead = m.x + dir * 24; if (m.grounded && (overDrop(ahead) || onSpikes(ahead))) m.vx *= 0.6; else m.vx = dir * (m.charger ? 1.05 : 0.8) * slowF; }
        else m.vx *= 0.6;
      }
      stepFighter(m);
    }
    // ----- pets (Pack Bond) -----
    function mkPet(x, y) { return { x, y: Math.min(y, GY), vx: 0, vy: 0, grounded: false, facing: 1, life: 9000, cd: 0, dead: false }; }
    function stepPet(p) {
      if (p.dead) return;
      p.life -= STEP; if (p.life <= 0) { p.dead = true; return; }
      if (p.cd > 0) p.cd -= STEP;
      const tgt = nearestFoe();
      if (tgt) { const dir = Math.sign(tgt.x - p.x) || 1; p.facing = dir; const adx = Math.abs(tgt.x - p.x);
        const ahead = p.x + dir * 16; if (p.grounded && (overDrop(ahead) || onSpikes(ahead))) p.vx *= 0.5; else p.vx = dir * 1.4;
        if (adx < 22 && p.cd <= 0) { hitFighter(tgt, 2, dir * 1.2, -0.3, 18); p.cd = 700; } }
      p.vy += GRAV; p.x += p.vx; p.y += p.vy;
      const g = groundAt(p.x); if (g !== null && p.y >= g && p.vy >= 0) { p.y = g; p.vy = 0; p.grounded = true; p.vx *= 0.7; } else p.grounded = false;
      if (p.y > TH + 50) p.dead = true;
    }
    function stepBolt(b) {
      b.vy += b.g; b.x += b.vx; b.y += b.vy; b.life -= STEP;
      if (b.life <= 0 || b.x < -20 || b.x > TW + 20 || b.y > TH + 20) { b.dead = true; return; }
      if (b.owner === 'player') { for (const m of mobs) { if (m.dead) continue; if (Math.abs(m.x - b.x) < 12 && Math.abs((m.y - 34) - b.y) < 26) { hitFighter(m, b.dmg, b.knock || Math.sign(b.vx) * 1, -0.2, b.stag); if (b.slow) m.slow = b.slow; b.dead = true; return; } } }
    }

    // =============================================================== JUICE
    function burst(x, y, color, n) {
      const count = perf.particleCount(n);
      for (let i = 0; i < count; i++) { const a = rand(0, Math.PI * 2), sp = rand(0.5, 3); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5, life: rand(180, 380), max: 380, color, r: rand(1, 2.6) }); }
      const lim = perf.particleLimit(160); if (particles.length > lim) particles.splice(0, particles.length - lim);
    }

    function update(dt) {
      if (state !== 'playing') return;
      simAcc += dt; let guard = 0;
      while (simAcc >= STEP && guard++ < 5) {
        stepPlayer();
        for (const m of mobs) stepMob(m);
        for (const p of pets) stepPet(p);
        for (const b of bolts) stepBolt(b);
        for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].dead) bolts.splice(i, 1);
        for (let i = pets.length - 1; i >= 0; i--) if (pets[i].dead) pets.splice(i, 1);
        for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= STEP; if (p.life <= 0) particles.splice(i, 1); }
        if (shake > 0) shake = Math.max(0, shake - 0.5);
        simAcc -= STEP;
      }
      hudT += dt; if (hudT > 70) { hudT = 0; syncAbar(); }
    }

    // =============================================================== RENDER
    function drawFighter(f, isPlayer) {
      if (f.dead) return;
      const x = f.x, y = f.y, dir = f.facing, stun = f.stunned > 0;
      const base = isPlayer ? (cls ? cls.color : '#bfe8ff') : (f.charger ? '#ff9f6e' : f.armored ? '#9fb4d8' : '#ff7a7a');
      ctx.strokeStyle = f.flash > 0.1 ? '#fff' : (stun ? '#ffd45e' : base);
      ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 3; ctx.lineCap = 'round';
      const hipY = y - 26, shY = y - 44, headY = y - 56;
      ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x - 6, y); ctx.moveTo(x, hipY); ctx.lineTo(x + 6, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x, shY); ctx.stroke();
      const atkExt = isPlayer && f.atk && !equipped('attack').atk.ranged && f.atk.t >= 120 && f.atk.t < 300 ? 1 : 0;
      const aim = isPlayer && f.atk && equipped('attack').atk.ranged && f.atk.t >= 120 ? 1 : 0;
      ctx.beginPath();
      ctx.moveTo(x, shY); ctx.lineTo(x + dir * (10 + atkExt * 16 + aim * 12), shY + (atkExt || aim ? -2 : 8));
      ctx.moveTo(x, shY); ctx.lineTo(x - dir * 8, shY + 9); ctx.stroke();
      if (atkExt) { ctx.beginPath(); ctx.moveTo(x + dir * 26, shY - 4); ctx.lineTo(x + dir * (40 + (equipped('attack').atk.reach > 70 ? 14 : 0)), shY - 8); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, headY, 6, 0, Math.PI * 2); ctx.fill();
      if (f.rooted) { ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 22, 16, 0, Math.PI * 2); ctx.stroke(); }
      if (f.armored) { ctx.save(); ctx.strokeStyle = '#cfe0f6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x - dir * 11, shY + 2, 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      if (f.slow > 0) { ctx.fillStyle = 'rgba(127,230,255,.5)'; ctx.beginPath(); ctx.arc(x, headY - 2, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = ctx.strokeStyle; }
      if (stun) { ctx.fillStyle = '#ffd45e'; for (let i = 0; i < 3; i++) { const a = performance.now() * 0.006 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 10, headY - 11 + Math.sin(a) * 3, 1.6, 0, Math.PI * 2); ctx.fill(); } }
      else if (f.stagger > 4) { ctx.fillStyle = 'rgba(255,212,94,.25)'; ctx.fillRect(x - 12, headY - 14, 24, 3); ctx.fillStyle = '#ffd45e'; ctx.fillRect(x - 12, headY - 14, 24 * f.stagger / 100, 3); }
      if (f.foe) {
        if (!f.armored) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x - 13, headY - 19, 26, 3); ctx.fillStyle = '#ff6b6b'; ctx.fillRect(x - 13, headY - 19, 26 * clamp(f.hp / f.maxHp, 0, 1), 3); }
        if (f.windup > 0) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x, headY - 24, 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    function drawPet(p) {
      if (p.dead) return; ctx.strokeStyle = '#9cffd0'; ctx.fillStyle = '#9cffd0'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      const x = p.x, y = p.y; ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y - 6); ctx.stroke();      // body
      ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x + 6, y); ctx.stroke(); // legs
      ctx.beginPath(); ctx.arc(x + p.facing * 8, y - 9, 3, 0, Math.PI * 2); ctx.fill();                                // head
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(offX + (shake ? rand(-shake, shake) : 0), offY + (shake ? rand(-shake, shake) : 0));
      ctx.scale(s, s);
      const bg = ctx.createLinearGradient(0, 0, 0, TH); bg.addColorStop(0, '#0c1428'); bg.addColorStop(1, '#060a16');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, TH);
      if (player && (state === 'playing' || state === 'draft' || state === 'over' || state === 'help')) {
        ctx.fillStyle = '#1d2a4a'; for (const [a, b] of GROUND) ctx.fillRect(a, GY, b - a, TH - GY);
        ctx.fillStyle = '#2a3c66'; for (const [a, b] of GROUND) ctx.fillRect(a, GY, b - a, 4);
        ctx.fillStyle = '#3a5088'; ctx.fillRect(PIT[0] - 4, GY, 4, 6); ctx.fillRect(PIT[1], GY, 4, 6);
        ctx.fillStyle = '#9fb4d8'; for (let x = SPIKES[0]; x < SPIKES[1]; x += 10) { ctx.beginPath(); ctx.moveTo(x, GY); ctx.lineTo(x + 5, GY - 11); ctx.lineTo(x + 10, GY); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,90,90,.10)'; ctx.fillRect(0, GY, 20, TH - GY); ctx.fillRect(460, GY, 20, TH - GY); ctx.fillRect(PIT[0], GY, PIT[1] - PIT[0], TH - GY);
        for (const m of mobs) drawFighter(m, false);
        for (const p of pets) drawPet(p);
        drawFighter(player, true);
        for (const b of bolts) { ctx.strokeStyle = b.color; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(b.x - Math.sign(b.vx) * 5, b.y); ctx.lineTo(b.x + Math.sign(b.vx) * 5, b.y); ctx.stroke(); }
        for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    api.loop((dt) => { update(dt); draw(); });
    showMenu();

    if (typeof window !== 'undefined' && window.__arenaTest) {
      window.__arenaTest({
        get state() { return state; }, get player() { return player; }, get mobs() { return mobs; },
        get bolts() { return bolts; }, get pets() { return pets; }, get loadout() { return loadout; }, get wave() { return wave; },
        input, ABILITIES: A, CLASSES,
        chooseClass(id) { chosenClass = id; play(); }, pick, draftPool, openHelp, closeHelp,
      });
    }
  },
});

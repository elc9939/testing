/* Arena Tactics — PROTOTYPE for Stick Arena's slower, terrain-driven combat.
   Validates one pillar from docs/stick-arena-tactics.md: deliberate pace where
   raw damage is slow and the *terrain* is the weapon. Kill loop is
   Stagger -> Reposition -> Environmental KO: chip an enemy to STAGGER it, then
   Push it off a ledge / into the pit / onto spikes, or Pull a far one across the
   gap. Side-view, one fixed screen scaled to fit. Not the real game. */
Arcade.register({
  id: 'arenatactics',
  name: 'Arena Tactics',
  emoji: '🥋',
  desc: 'PROTOTYPE: a slower, tactical stick brawl — stagger foes, then use the pit, edges, and spikes to finish them.',
  color: '#7fd4ff',

  start(root, api) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const perf = api.perf || { particleCount: n => n, particleLimit: n => n };
    const TW = 480, TH = 320, GY = 246;        // virtual arena; GY = ground top
    // solid ground spans (x ranges that have floor at GY); everything else = drop
    const GROUND = [[20, 200], [280, 460]];
    const PIT = [200, 280];                     // central bottomless gap
    const SPIKES = [312, 392];                  // lethal strip on the right ledge
    let s = 1, offX = 0, offY = 0, W = 0, H = 0;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    function layout(v) { W = v.w; H = v.h; s = Math.min(W / TW, H / TH); offX = (W - TW * s) / 2; offY = (H - TH * s) / 2; }
    layout(view);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">HP <b id="at-hp">100</b></span><span id="at-cd"></span><span class="b">FOES <b id="at-foes">0</b></span>`;
    root.appendChild(hud);

    // touch controls (so it's testable on a phone too)
    const style = document.createElement('style');
    style.textContent = `
      .at-pad{position:absolute;bottom:max(14px,env(safe-area-inset-bottom));display:flex;gap:10px;z-index:30;opacity:.62;touch-action:none}
      .at-left{left:max(12px,env(safe-area-inset-left))}.at-right{right:max(12px,env(safe-area-inset-right))}
      .at-b{width:58px;height:58px;border-radius:50%;border:2px solid rgba(127,212,255,.6);background:rgba(20,28,48,.5);
        color:#dff0ff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;user-select:none}
      .at-b:active{background:rgba(127,212,255,.5);color:#04101f}
      @media (hover:hover) and (pointer:fine){.at-pad{opacity:.3}}`;
    root.appendChild(style);
    function pad(cls, defs) { const d = document.createElement('div'); d.className = 'at-pad ' + cls; for (const [label, set] of defs) { const b = document.createElement('div'); b.className = 'at-b'; b.textContent = label; hold(b, set); d.appendChild(b); } root.appendChild(d); return d; }
    function hold(btn, set) { const on = e => { e.preventDefault(); set(true); }; const off = e => { e.preventDefault(); set(false); }; api.on(btn, 'pointerdown', on); api.on(btn, 'pointerup', off); api.on(btn, 'pointerleave', off); api.on(btn, 'pointercancel', off); }

    // ---------- state ----------
    const input = { left: false, right: false, jump: false, attack: false, push: false, pull: false, dash: false };
    let player, mobs, state, particles, shake, simAcc;
    const STEP = 16.7, GRAV = 0.5, MOVE = 1.7, MOVE_ATK = 0.5, JUMP = -10;

    function mkFighter(x, opts = {}) {
      return {
        x, y: GY, vx: 0, vy: 0, grounded: false, facing: opts.facing || 1,
        hp: opts.hp || 100, maxHp: opts.hp || 100, stagger: 0, stunned: 0, hitstun: 0,
        atk: null, abilityCd: 0, dashCd: 0, iframe: 0, dead: false, foe: !!opts.foe,
        windup: 0, lungeReady: 1200, flash: 0,
      };
    }
    function reset() {
      player = mkFighter(110, { hp: 100, facing: 1 });
      mobs = [mkFighter(360, { foe: true, hp: 120, facing: -1 }), mkFighter(420, { foe: true, hp: 120, facing: -1 }), mkFighter(150, { foe: true, hp: 120, facing: 1 })];
      particles = []; shake = 0; simAcc = 0;
    }
    function sync() {
      document.getElementById('at-hp').textContent = Math.max(0, Math.ceil(player.hp));
      document.getElementById('at-foes').textContent = mobs.filter(m => !m.dead).length;
      const cd = document.getElementById('at-cd');
      cd.textContent = (player.abilityCd > 0 ? '· E/Q…' : '· E/Q ✓') + (player.dashCd > 0 ? ' · ⇧…' : ' · ⇧✓');
    }
    function showMenu() {
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Arena Tactics <span style="font-size:.5em;opacity:.6">prototype</span></h2>
        <p class="msg">Slower, tactical stick combat. Raw hits barely dent foes — instead <b>stagger</b> them
        (attack until they flash), then <b>Push</b> them into the pit, off an edge, or onto spikes. <b>Pull</b> a
        far foe across the gap to drop it.<br><br>
        <b>A/D</b> move · <b>W</b> jump · <b>J</b>/click attack · <b>K</b> Push · <b>L</b> Pull · <b>Shift</b> dash.</p>
        <button class="btn" data-act="play">PLAY ▸</button>`;
    }
    function play() { reset(); sync(); state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; }
    function endScreen(win) {
      state = 'over'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>${win ? 'Arena Cleared' : 'You Fell'}</h2>
        <p class="msg">${win ? 'Every foe met the terrain. That’s the idea.' : 'Mind the edges — they cut both ways.'}</p>
        <button class="btn" data-act="play">${win ? 'AGAIN ↻' : 'RETRY ↻'}</button>`;
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    // ---------- input ----------
    pad('at-left', [['◀', v => input.left = v], ['▶', v => input.right = v], ['⤒', v => input.jump = v]]);
    pad('at-right', [['Atk', v => { if (v) input.attack = true; }], ['Push', v => { if (v) input.push = true; }], ['Pull', v => { if (v) input.pull = true; }], ['⇧', v => { if (v) input.dash = true; }]]);
    api.on(window, 'keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') input.left = true;
      else if (k === 'arrowright' || k === 'd') input.right = true;
      else if (k === 'arrowup' || k === 'w' || k === ' ') { input.jump = true; if (k === ' ') e.preventDefault(); }
      else if (k === 'j') input.attack = true;
      else if (k === 'k') input.push = true;
      else if (k === 'l') input.pull = true;
      else if (k === 'shift') input.dash = true;
    });
    api.on(window, 'keyup', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') input.left = false;
      else if (k === 'arrowright' || k === 'd') input.right = false;
      else if (k === 'arrowup' || k === 'w' || k === ' ') input.jump = false;
    });
    api.on(view.canvas, 'pointerdown', e => { if (state !== 'playing') return; const vx = (e.clientX - offX) / s; player.facing = vx >= player.x ? 1 : -1; input.attack = true; });

    // ---------- terrain ----------
    function groundAt(x) { for (const [a, b] of GROUND) if (x >= a && x <= b) return GY; return null; }
    const overDrop = x => groundAt(x) === null;
    const onSpikes = x => x >= SPIKES[0] && x <= SPIKES[1];

    // ---------- combat ----------
    function hitFighter(t, dmg, kx, ky, stag) {
      if (t.iframe > 0 || t.dead) return;
      t.hp -= dmg; t.stagger = clamp(t.stagger + stag, 0, 100); t.flash = 1; t.hitstun = Math.max(t.hitstun, 120);
      const heavy = t.stunned > 0;               // staggered = huge knockback
      const m = heavy ? 3.4 : 1;
      t.vx += kx * m; t.vy += (ky - (heavy ? 1.6 : 0.4)) * (heavy ? 1.5 : 1); t.grounded = false;
      if (t.stagger >= 100 && t.stunned <= 0) { t.stunned = 1500; t.stagger = 100; burst(t.x, t.y - 30, '#ffd45e', 14); }
      burst(t.x, t.y - 30, t.foe ? '#ff8a8a' : '#8ad0ff', 8); shake = Math.max(shake, heavy ? 6 : 2.5);
      if (t === player) sync();
    }
    function playerAttack() {
      if (player.atk || player.hitstun > 0 || !player.grounded) return;
      player.atk = { t: 0, hit: false };
    }
    function doPush() {
      if (player.abilityCd > 0 || player.hitstun > 0) return;
      player.abilityCd = 1500;
      const reach = 64, dir = player.facing;
      burst(player.x + dir * 30, player.y - 30, '#7fd4ff', 12); shake = Math.max(shake, 4);
      for (const m of mobs) { if (m.dead) continue; const dx = m.x - player.x; if (Math.sign(dx) === dir && Math.abs(dx) < reach && Math.abs(m.y - player.y) < 60) hitFighter(m, 4, dir * 6.4, -1.0, 18); }
    }
    function doPull() {
      if (player.abilityCd > 0 || player.hitstun > 0) return;
      player.abilityCd = 1700;
      // yank the nearest foe in front toward the player (can drag it across the pit)
      let best = null, bd = 220;
      for (const m of mobs) { if (m.dead) continue; const dx = m.x - player.x; if (Math.sign(dx) === player.facing && Math.abs(dx) < bd && Math.abs(m.y - player.y) < 70) { bd = Math.abs(dx); best = m; } }
      if (best) { const dir = Math.sign(player.x - best.x) || -player.facing; best.vx += dir * 7.5; best.vy -= 2.2; best.grounded = false; best.stagger = clamp(best.stagger + 10, 0, 100); burst(best.x, best.y - 30, '#b48cff', 12); shake = Math.max(shake, 3); }
    }
    function doDash() {
      if (player.dashCd > 0 || player.hitstun > 0) return;
      player.dashCd = 1100; player.iframe = 220; player.vx = player.facing * 7.5; burst(player.x, player.y - 26, '#dff0ff', 8);
    }

    // ---------- step ----------
    function stepFighter(f) {
      f.flash = Math.max(0, f.flash - 0.08);
      if (f.iframe > 0) f.iframe -= STEP;
      if (f.hitstun > 0) f.hitstun -= STEP;
      if (f.stunned > 0) { f.stunned -= STEP; if (f.stunned <= 0) f.stagger = 0; }
      else if (f.stagger > 0) f.stagger = Math.max(0, f.stagger - 0.5);  // decay
      // gravity + integrate
      f.vy += GRAV; f.x += f.vx; f.y += f.vy;
      const g = groundAt(f.x);
      if (g !== null && f.y >= g && f.vy >= 0) { f.y = g; f.vy = 0; f.grounded = true; f.vx *= 0.8; }
      else f.grounded = false;
      // hazards / ring-out
      if (f.grounded && onSpikes(f.x)) return kill(f, 'spikes');
      if (f.y > TH + 50) return kill(f, 'fall');
    }
    function kill(f, how) {
      if (f.dead) return; f.dead = true;
      burst(f.x, Math.min(f.y, TH), f.foe ? '#ff6b6b' : '#7fd4ff', 22); shake = Math.max(shake, 6);
      if (f === player) { sync(); endScreen(false); }
      else { sync(); if (mobs.every(m => m.dead)) endScreen(true); }
    }
    function stepPlayer() {
      if (player.dead) return;
      if (player.abilityCd > 0) player.abilityCd -= STEP;
      if (player.dashCd > 0) player.dashCd -= STEP;
      const slowed = player.atk ? MOVE_ATK : 1;
      if (player.hitstun <= 0) {
        if (input.left && !input.right) { player.vx = -MOVE * slowed; player.facing = -1; }
        else if (input.right && !input.left) { player.vx = MOVE * slowed; player.facing = 1; }
        else if (player.grounded) player.vx *= 0.55;
        if (input.jump && player.grounded) { player.vy = JUMP; player.grounded = false; }
      }
      // one-shot actions
      if (input.attack) { playerAttack(); input.attack = false; }
      if (input.push) { doPush(); input.push = false; }
      if (input.pull) { doPull(); input.pull = false; }
      if (input.dash) { doDash(); input.dash = false; }
      // attack timing: windup .18 / active .10 / recovery .22 (in seconds-ish via t)
      if (player.atk) {
        player.atk.t += STEP;
        const t = player.atk.t;
        if (t >= 180 && t < 280 && !player.atk.hit) {     // active window
          const dir = player.facing;
          for (const m of mobs) { if (m.dead) continue; const dx = m.x - player.x; if (Math.sign(dx) === dir && Math.abs(dx) < 46 && Math.abs(m.y - player.y) < 56) { hitFighter(m, 9, dir * 1.6, -0.3, 34); player.atk.hit = true; } }
        }
        if (t >= 480) player.atk = null;
      }
      stepFighter(player);
      if (player.abilityCd < 0) player.abilityCd = 0;
      if (player.dashCd < 0) player.dashCd = 0;
    }
    function stepMob(m) {
      if (m.dead) return;
      if (m.stunned > 0 || m.hitstun > 0) { stepFighter(m); return; }  // reeling: no control
      m.lungeReady -= STEP;
      const dx = player.x - m.x, adx = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
      m.facing = dir;
      // approach, but never walk into a drop or spikes (terrain-aware)
      if (m.windup > 0) {
        m.windup -= STEP;
        if (m.windup <= 0) { m.vx = dir * 6; m.vy = -2; m.grounded = false; m.lunging = 120; }
      } else if (m.lunging > 0) {
        m.lunging -= STEP;
        if (adx < 30 && Math.abs(player.y - m.y) < 50) { hitFighter(player, 12, dir * 4.5, -1.2, 0); m.lunging = 0; }
      } else {
        if (adx < 40 && m.lungeReady <= 0 && Math.abs(player.y - m.y) < 50) { m.windup = 360; m.lungeReady = 1700; m.vx = 0; }
        else if (adx > 26) {
          const ahead = m.x + dir * 24;
          if (m.grounded && (overDrop(ahead) || onSpikes(ahead))) m.vx *= 0.6;   // refuse to step into death
          else m.vx = dir * 0.95;
        } else m.vx *= 0.6;
      }
      stepFighter(m);
    }

    // ---------- juice ----------
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
        for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= STEP; if (p.life <= 0) particles.splice(i, 1); }
        if (shake > 0) shake = Math.max(0, shake - 0.5);
        simAcc -= STEP;
      }
    }

    // ---------- render ----------
    function drawFighter(f) {
      if (f.dead) return;
      const x = f.x, y = f.y, dir = f.facing;
      const stun = f.stunned > 0;
      ctx.strokeStyle = f.flash > 0.1 ? '#fff' : (f.foe ? (stun ? '#ffd45e' : '#ff7a7a') : '#bfe8ff');
      ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 3; ctx.lineCap = 'round';
      const hipY = y - 26, shY = y - 44, headY = y - 56;
      // legs
      ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x - 6, y); ctx.moveTo(x, hipY); ctx.lineTo(x + 6, y); ctx.stroke();
      // spine
      ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x, shY); ctx.stroke();
      // arms: attack pose extends front arm
      const atkExt = f === player && f.atk && f.atk.t >= 120 && f.atk.t < 300 ? 1 : 0;
      ctx.beginPath();
      ctx.moveTo(x, shY); ctx.lineTo(x + dir * (10 + atkExt * 16), shY + (atkExt ? -2 : 8));
      ctx.moveTo(x, shY); ctx.lineTo(x - dir * 8, shY + 9); ctx.stroke();
      if (atkExt) { ctx.beginPath(); ctx.moveTo(x + dir * 26, shY - 4); ctx.lineTo(x + dir * 40, shY - 8); ctx.stroke(); }   // blade
      // head
      ctx.beginPath(); ctx.arc(x, headY, 6, 0, Math.PI * 2); ctx.fill();
      // stagger meter / stun stars
      if (stun) { ctx.fillStyle = '#ffd45e'; for (let i = 0; i < 3; i++) { const a = performance.now() * 0.006 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 10, headY - 11 + Math.sin(a) * 3, 1.6, 0, Math.PI * 2); ctx.fill(); } }
      else if (f.stagger > 4) { ctx.fillStyle = 'rgba(255,212,94,.25)'; ctx.fillRect(x - 12, headY - 14, 24, 3); ctx.fillStyle = '#ffd45e'; ctx.fillRect(x - 12, headY - 14, 24 * f.stagger / 100, 3); }
      // foe HP + windup tell
      if (f.foe) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x - 13, headY - 19, 26, 3); ctx.fillStyle = '#ff6b6b'; ctx.fillRect(x - 13, headY - 19, 26 * clamp(f.hp / f.maxHp, 0, 1), 3); if (f.windup > 0) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x, headY - 24, 3, 0, Math.PI * 2); ctx.fill(); } }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(offX + (shake ? rand(-shake, shake) : 0), offY + (shake ? rand(-shake, shake) : 0));
      ctx.scale(s, s);
      // backdrop
      const bg = ctx.createLinearGradient(0, 0, 0, TH); bg.addColorStop(0, '#0c1428'); bg.addColorStop(1, '#060a16');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, TH);
      if (state !== 'menu') {
        // ledges
        ctx.fillStyle = '#1d2a4a'; for (const [a, b] of GROUND) ctx.fillRect(a, GY, b - a, TH - GY);
        ctx.fillStyle = '#2a3c66'; for (const [a, b] of GROUND) ctx.fillRect(a, GY, b - a, 4);
        // pit lips
        ctx.fillStyle = '#3a5088'; ctx.fillRect(PIT[0] - 4, GY, 4, 6); ctx.fillRect(PIT[1], GY, 4, 6);
        // spikes
        ctx.fillStyle = '#9fb4d8'; for (let x = SPIKES[0]; x < SPIKES[1]; x += 10) { ctx.beginPath(); ctx.moveTo(x, GY); ctx.lineTo(x + 5, GY - 11); ctx.lineTo(x + 10, GY); ctx.closePath(); ctx.fill(); }
        // edge hazard glow (left/right drops + pit)
        ctx.fillStyle = 'rgba(255,90,90,.10)'; ctx.fillRect(0, GY, 20, TH - GY); ctx.fillRect(460, GY, 20, TH - GY); ctx.fillRect(PIT[0], GY, PIT[1] - PIT[0], TH - GY);
        for (const m of mobs) drawFighter(m);
        drawFighter(player);
        for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    api.loop((dt) => { update(dt); draw(); });
    showMenu();

    if (typeof window !== 'undefined' && window.__arenaTest) {
      window.__arenaTest({ get state() { return state; }, get player() { return player; }, get mobs() { return mobs; }, input, start: play });
    }
  },
});

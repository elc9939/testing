/* Gambit — a bite-size roguelike deckbuilder card battler.
   Pick a class, fight a ladder of foes that telegraph their intent, spend energy
   on attack/skill/power cards, and draft new cards between fights up to a boss.
   Pure DOM (cards want clicks, not pixels); state-driven render with CSS juice. */
Arcade.register({
  id: 'gambit',
  name: 'Gambit',
  emoji: '🃏',
  desc: 'A roguelike deckbuilder: pick a class, battle foes that telegraph their moves, and draft a deck up to a boss.',
  color: '#ff7a9c',

  start(root, api) {
    // ---------- content ----------
    const CARDS = {
      strike: { name: 'Strike', cost: 1, type: 'attack', dmg: 6, text: 'Deal 6.' },
      guard: { name: 'Guard', cost: 1, type: 'skill', block: 5, text: 'Gain 5 Block.' },
      bash: { name: 'Bash', cost: 2, type: 'attack', dmg: 8, vuln: 2, text: 'Deal 8. Apply 2 Vulnerable.' },
      brace: { name: 'Brace', cost: 1, type: 'skill', block: 8, draw: 1, text: 'Gain 8 Block. Draw 1.' },
      dart: { name: 'Poison Dart', cost: 1, type: 'attack', dmg: 4, poison: 3, text: 'Deal 4. Apply 3 Poison.' },
      firebolt: { name: 'Firebolt', cost: 1, type: 'attack', dmg: 9, text: 'Deal 9.' },
      focus: { name: 'Focus', cost: 1, type: 'power', strength: 2, text: 'Gain 2 Strength.' },
      // reward pool
      heavyslash: { name: 'Heavy Slash', cost: 2, type: 'attack', dmg: 14, text: 'Deal 14.' },
      cleave: { name: 'Cleave', cost: 1, type: 'attack', dmg: 9, text: 'Deal 9.' },
      ironwall: { name: 'Iron Wall', cost: 2, type: 'skill', block: 15, text: 'Gain 15 Block.' },
      doublestrike: { name: 'Double Strike', cost: 1, type: 'attack', dmg: 5, hits: 2, text: 'Deal 5 twice.' },
      lifesteal: { name: 'Leech', cost: 2, type: 'attack', dmg: 8, heal: 5, text: 'Deal 8. Heal 5.' },
      frenzy: { name: 'Frenzy', cost: 2, type: 'attack', dmg: 7, draw: 2, text: 'Deal 7. Draw 2.' },
      fireball: { name: 'Fireball', cost: 2, type: 'attack', dmg: 17, text: 'Deal 17.' },
      weaken: { name: 'Weaken', cost: 1, type: 'skill', weak: 2, text: 'Apply 2 Weak.' },
      expose: { name: 'Expose', cost: 1, type: 'attack', dmg: 4, vuln: 2, text: 'Deal 4. Apply 2 Vulnerable.' },
      adrenaline: { name: 'Adrenaline', cost: 0, type: 'skill', draw: 2, energy: 1, text: 'Draw 2. Gain 1 energy.' },
      bulwark: { name: 'Bulwark', cost: 2, type: 'skill', block: 20, text: 'Gain 20 Block.' },
      quickjab: { name: 'Quick Jab', cost: 0, type: 'attack', dmg: 4, text: 'Deal 4.' },
      regen: { name: 'Mend', cost: 1, type: 'skill', heal: 8, text: 'Heal 8.' },
      venom: { name: 'Venom', cost: 1, type: 'attack', dmg: 6, poison: 5, text: 'Deal 6. Apply 5 Poison.' },
      rally: { name: 'Rally', cost: 1, type: 'power', strength: 2, text: 'Gain 2 Strength.' },
    };
    const REWARD_POOL = ['heavyslash', 'cleave', 'ironwall', 'doublestrike', 'lifesteal', 'frenzy', 'fireball', 'weaken', 'expose', 'adrenaline', 'bulwark', 'quickjab', 'regen', 'venom', 'rally', 'bash', 'firebolt'];
    const CLASSES = {
      knight: { name: 'Knight', emoji: '🛡️', hp: 72, color: '#5ea0ff', deck: ['strike', 'strike', 'strike', 'strike', 'guard', 'guard', 'guard', 'guard', 'bash', 'brace'] },
      rogue: { name: 'Rogue', emoji: '🗡️', hp: 60, color: '#9cff5e', deck: ['strike', 'strike', 'strike', 'strike', 'strike', 'guard', 'guard', 'guard', 'dart', 'dart'] },
      mage: { name: 'Mage', emoji: '🔮', hp: 55, color: '#ff77d2', deck: ['strike', 'strike', 'strike', 'strike', 'guard', 'guard', 'guard', 'firebolt', 'firebolt', 'focus'] },
    };
    // intent: {t:'attack', dmg, hits?} | {t:'block', block} | {t:'buff', strength?} | {t:'debuff', weak?, vuln?, dmg?}
    const ENEMIES = [
      { name: 'Slime', emoji: '🟢', hp: 26, pattern: [{ t: 'attack', dmg: 7 }, { t: 'attack', dmg: 7 }, { t: 'block', block: 6 }] },
      { name: 'Bandit', emoji: '🦹', hp: 34, pattern: [{ t: 'attack', dmg: 11 }, { t: 'debuff', dmg: 6, weak: 1 }, { t: 'block', block: 8 }] },
      { name: 'Hexer', emoji: '🧙', hp: 38, pattern: [{ t: 'attack', dmg: 9 }, { t: 'debuff', dmg: 5, vuln: 2 }, { t: 'attack', dmg: 11 }] },
      { name: 'Brute', emoji: '👹', hp: 58, pattern: [{ t: 'attack', dmg: 16 }, { t: 'block', block: 12 }, { t: 'buff', strength: 2 }, { t: 'attack', dmg: 16 }] },
      { name: 'Archer', emoji: '🏹', hp: 42, pattern: [{ t: 'attack', dmg: 6, hits: 2 }, { t: 'attack', dmg: 12 }, { t: 'debuff', dmg: 6, weak: 2 }] },
      { name: 'Warlord', emoji: '💀', hp: 136, boss: true, pattern: [{ t: 'attack', dmg: 13 }, { t: 'buff', strength: 4 }, { t: 'attack', dmg: 18 }, { t: 'block', block: 16 }, { t: 'attack', dmg: 28 }] },
    ];
    const HAND_SIZE = 5, MAX_ENERGY = 3;

    // ---------- scoped styles ----------
    const style = document.createElement('style');
    style.textContent = `
      .gx{position:absolute;inset:0;display:flex;flex-direction:column;color:var(--text);font-family:inherit;overflow:hidden;background:var(--bg);padding-top:var(--topbar-h,58px)}
      .gx-top{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;font-size:13px;color:var(--muted);letter-spacing:.04em}
      .gx-arena{flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:6px 14px;min-height:0}
      .gx-enemy,.gx-hero{display:flex;align-items:center;gap:12px}
      .gx-hero{justify-content:flex-start}
      .gx-enemy{justify-content:flex-end;text-align:right;flex-direction:row-reverse}
      .gx-ava{font-size:42px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.28))}
      .gx-info{min-width:180px}
      .gx-name{font-weight:800;font-size:15px}
      .gx-bar{position:relative;height:16px;border-radius:8px;background:var(--surface-2);overflow:hidden;margin-top:3px;border:1px solid var(--line)}
      .gx-bar>span{position:absolute;inset:0;width:100%;transform-origin:left;background:linear-gradient(90deg,#ff5a6e,#ff9a6e);transition:transform .25s}
      .gx-bar.hero>span{background:linear-gradient(90deg,#5ef2ff,#5e8bff)}
      .gx-bar b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;text-shadow:0 1px 2px #000}
      .gx-badges{display:flex;gap:5px;margin-top:4px;font-size:11px;flex-wrap:wrap}
      .gx-enemy .gx-badges{justify-content:flex-end}
      .gx-badge{background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-weight:700}
      .gx-block{color:#bfe3ff}.gx-vuln{color:#ff9a6e}.gx-weak{color:#c7a3ff}.gx-poison{color:#9cff7a}.gx-str{color:#ffd45e}
      .gx-intent{font-size:14px;font-weight:800;margin-bottom:2px}
      .gx-hand{display:flex;gap:8px;justify-content:center;align-items:flex-end;padding:8px;flex-wrap:wrap;min-height:128px}
      .gx-card{width:96px;min-height:120px;border-radius:8px;background:var(--panel);
        border:1px solid color-mix(in srgb,var(--cc,#8ab4f8) 34%,var(--line));padding:8px 7px;cursor:pointer;display:flex;flex-direction:column;gap:4px;
        transition:transform .12s,box-shadow .12s,border-color .12s,background .12s;user-select:none;position:relative}
      .gx-card:hover{transform:translateY(-6px);box-shadow:var(--soft-shadow);background:color-mix(in srgb,var(--cc,#8ab4f8) 10%,var(--panel))}
      .gx-card.dis{opacity:.4;cursor:not-allowed}.gx-card.dis:hover{transform:none;box-shadow:none}
      .gx-cost{position:absolute;top:-8px;left:-8px;width:24px;height:24px;border-radius:50%;background:var(--accent-3);color:#241a00;
        font-weight:900;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid var(--panel)}
      .gx-cn{font-weight:800;font-size:12.5px}.gx-ct{font-size:10.5px;color:var(--muted);line-height:1.25}
      .gx-cardtype{margin-top:auto;font-size:9px;letter-spacing:1px;opacity:.6;text-transform:uppercase}
      .gx-foot{display:flex;justify-content:space-between;align-items:center;padding:6px 14px 12px}
      .gx-energy{font-size:15px;font-weight:800;color:var(--accent-3)}
      .gx-end{background:color-mix(in srgb,#ff7a9c 18%,var(--panel));color:var(--text);border:1px solid color-mix(in srgb,#ff7a9c 34%,var(--line));border-radius:8px;padding:10px 20px;font-weight:900;
        font-size:15px;cursor:pointer;letter-spacing:1px}
      .gx-end:hover{filter:brightness(1.1)}
      .gx-pop{position:absolute;font-weight:900;font-size:20px;pointer-events:none;animation:gxpop 1s ease-out forwards;text-shadow:0 2px 4px #000;z-index:5}
      @keyframes gxpop{0%{opacity:1;transform:translateY(0) scale(1.1)}100%{opacity:0;transform:translateY(-46px) scale(1)}}
      .gx-shake{animation:gxshake .3s}
      @keyframes gxshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
      .gx-reward{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:10px 0}`;
    root.appendChild(style);

    const wrap = document.createElement('div'); wrap.className = 'gx'; root.appendChild(wrap);
    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);

    // ---------- state ----------
    const TEST = typeof window !== 'undefined' && !!window.__gambitTest;   // synchronous enemy turns under test
    let phase = 'menu', clsId, player, enemy, deck, hand, discard, floor, rewardChoices;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };

    function startRun(id) {
      clsId = id; const c = CLASSES[id];
      player = { hp: c.hp, maxHp: c.hp, block: 0, energy: MAX_ENERGY, vuln: 0, weak: 0, poison: 0, strength: 0 };
      deck = c.deck.slice(); floor = 0;
      phase = 'battle'; nextBattle();
    }
    function nextBattle() {
      const tpl = ENEMIES[Math.min(floor, ENEMIES.length - 1)];
      enemy = { name: tpl.name, emoji: tpl.emoji, boss: tpl.boss, hp: tpl.hp, maxHp: tpl.hp, block: 0, vuln: 0, weak: 0, poison: 0, strength: 0, pattern: tpl.pattern, pi: 0, intent: null };
      enemy.intent = tpl.pattern[0];
      discard = []; hand = [];
      drawPile = shuffle(deck.slice());                      // fresh shuffled draw pile from the master deck
      startPlayerTurn();
      phase = 'battle'; render(); renderOverlayNone();
    }
    let drawPile = [];
    function drawCards(n) {
      for (let i = 0; i < n; i++) {
        if (!drawPile.length) { drawPile = shuffle(discard.slice()); discard = []; }
        if (!drawPile.length) break;
        hand.push(drawPile.pop());
      }
    }
    function startPlayerTurn() {
      player.block = 0;
      if (player.poison > 0) { dealHp(player, player.poison, 'hero'); player.poison--; }
      player.energy = MAX_ENERGY;
      hand = []; drawCards(HAND_SIZE);
      phase = 'battle';
    }
    function dmgAfter(src, base, target) {
      let d = base + (src.strength || 0);
      if (src.weak > 0) d = Math.floor(d * 0.75);
      if (target.vuln > 0) d = Math.ceil(d * 1.5);
      return Math.max(0, d);
    }
    function dealHp(target, amount, who) {            // ignores block (poison)
      target.hp = clamp(target.hp - amount, 0, target.maxHp); pop(who, '-' + amount, '#9cff7a');
    }
    function strike(src, target, base, who) {
      let d = dmgAfter(src, base, target);
      const ab = Math.min(target.block, d); target.block -= ab; d -= ab;
      target.hp = clamp(target.hp - d, 0, target.maxHp);
      pop(who, '-' + (d || 'blok'), who === 'enemy' ? '#ff9a6e' : '#ff5a6e');
      if (who === 'hero') shake();
    }
    function playCard(i) {
      if (phase !== 'battle') return;
      const id = hand[i]; if (!id) return; const card = CARDS[id];
      if (card.cost > player.energy) return;
      player.energy -= card.cost;
      hand.splice(i, 1); discard.push(id);
      const hits = card.hits || 1;
      for (let h = 0; h < hits; h++) if (card.dmg) strike(player, enemy, card.dmg, 'enemy');
      if (card.block) player.block += card.block;
      if (card.poison) enemy.poison += card.poison;
      if (card.vuln) enemy.vuln += card.vuln;
      if (card.weak) enemy.weak += card.weak;
      if (card.strength) player.strength += card.strength;
      if (card.heal) { player.hp = clamp(player.hp + card.heal, 0, player.maxHp); pop('hero', '+' + card.heal, '#5ef2ff'); }
      if (card.energy) player.energy += card.energy;
      if (card.draw) drawCards(card.draw);
      if (enemy.hp <= 0) return winBattle();
      render();
    }
    function endTurn() {
      if (phase !== 'battle') return;
      discard.push(...hand); hand = [];
      if (player.vuln > 0) player.vuln--; if (player.weak > 0) player.weak--;
      phase = 'enemy'; render();
      if (TEST) enemyTurn(); else setTimeout(enemyTurn, 420);
    }
    function enemyTurn() {
      if (phase !== 'enemy') return;
      enemy.block = 0;
      if (enemy.poison > 0) { dealHp(enemy, enemy.poison, 'enemy'); enemy.poison--; if (enemy.hp <= 0) return winBattle(); }
      const it = enemy.intent;
      if (it.t === 'attack' || it.t === 'debuff') { const hits = it.hits || 1; for (let h = 0; h < hits; h++) if (it.dmg) strike(enemy, player, it.dmg, 'hero'); if (it.weak) player.weak += it.weak; if (it.vuln) player.vuln += it.vuln; }
      else if (it.t === 'block') enemy.block += it.block;
      else if (it.t === 'buff') enemy.strength += it.strength || 0;
      if (enemy.vuln > 0) enemy.vuln--; if (enemy.weak > 0) enemy.weak--;
      enemy.pi = (enemy.pi + 1) % enemy.pattern.length; enemy.intent = enemy.pattern[enemy.pi];
      if (player.hp <= 0) return lose();
      startPlayerTurn(); render();
    }
    function winBattle() {
      floor++;
      if (floor >= ENEMIES.length) return victory();
      player.hp = clamp(player.hp + Math.round(player.maxHp * 0.10), 0, player.maxHp);   // small heal between fights
      phase = 'reward';
      const pool = shuffle(REWARD_POOL.slice()).slice(0, 3); rewardChoices = pool;
      render(); showReward(pool);
    }
    function pickReward(i) { if (phase !== 'reward') return; if (rewardChoices[i]) deck.push(rewardChoices[i]); nextBattle(); }
    function victory() { phase = 'over'; api.setBest('gambit', ENEMIES.length); endScreen(true); }
    function lose() { phase = 'over'; api.setBest('gambit', floor); endScreen(false); }

    // ---------- juice ----------
    function pop(who, text, color) {
      const host = who === 'enemy' ? wrap.querySelector('.gx-enemy .gx-ava') : wrap.querySelector('.gx-hero .gx-ava');
      if (!host) return;
      const d = document.createElement('div'); d.className = 'gx-pop'; d.textContent = text; d.style.color = color;
      const r = host.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      d.style.left = (r.left - wr.left + 8) + 'px'; d.style.top = (r.top - wr.top) + 'px';
      wrap.appendChild(d); setTimeout(() => d.remove(), 1000);
    }
    function shake() { wrap.classList.remove('gx-shake'); void wrap.offsetWidth; wrap.classList.add('gx-shake'); }

    // ---------- render ----------
    function badges(u) {
      const b = [];
      if (u.block > 0) b.push(`<span class="gx-badge gx-block">🛡 ${u.block}</span>`);
      if (u.strength > 0) b.push(`<span class="gx-badge gx-str">💪 ${u.strength}</span>`);
      if (u.vuln > 0) b.push(`<span class="gx-badge gx-vuln">vuln ${u.vuln}</span>`);
      if (u.weak > 0) b.push(`<span class="gx-badge gx-weak">weak ${u.weak}</span>`);
      if (u.poison > 0) b.push(`<span class="gx-badge gx-poison">☠ ${u.poison}</span>`);
      return b.join('');
    }
    function intentText(it) {
      if (!it) return '';
      if (it.t === 'attack') return `⚔ ${it.dmg}${it.hits ? '×' + it.hits : ''}`;
      if (it.t === 'debuff') return `⚔ ${it.dmg || 0}${it.weak ? ' +weak' : ''}${it.vuln ? ' +vuln' : ''}`;
      if (it.t === 'block') return `🛡 ${it.block}`;
      if (it.t === 'buff') return `💪 +${it.strength}`;
      return '';
    }
    function bar(u, hero) { return `<div class="gx-bar ${hero ? 'hero' : ''}"><span style="transform:scaleX(${clamp(u.hp / u.maxHp, 0, 1)})"></span><b>${u.hp} / ${u.maxHp}</b></div>`; }
    function render() {
      if (phase === 'menu') { wrap.style.display = 'none'; return; }
      wrap.style.display = 'flex';
      const heroEmoji = CLASSES[clsId].emoji;
      wrap.innerHTML = `
        <div class="gx-top"><span>FLOOR ${floor + 1} / ${ENEMIES.length}</span><span>🂠 ${drawPile.length} · 🗑 ${discard.length}</span></div>
        <div class="gx-arena">
          <div class="gx-enemy">
            <div class="gx-ava">${enemy.emoji}</div>
            <div class="gx-info"><div class="gx-intent">${phase === 'battle' ? intentText(enemy.intent) : '…'}</div>
              <div class="gx-name">${enemy.name}${enemy.boss ? ' 👑' : ''}</div>${bar(enemy, false)}
              <div class="gx-badges">${badges(enemy)}</div></div>
          </div>
          <div class="gx-hero">
            <div class="gx-ava">${heroEmoji}</div>
            <div class="gx-info"><div class="gx-name">${CLASSES[clsId].name} (you)</div>${bar(player, true)}
              <div class="gx-badges">${badges(player)}</div></div>
          </div>
        </div>
        <div class="gx-hand"></div>
        <div class="gx-foot"><span class="gx-energy">⚡ ${player.energy} / ${MAX_ENERGY}</span>
          <button class="gx-end">END TURN</button></div>`;
      const handEl = wrap.querySelector('.gx-hand');
      hand.forEach((id, i) => {
        const c = CARDS[id]; const el = document.createElement('div');
        el.className = 'gx-card' + (c.cost > player.energy || phase !== 'battle' ? ' dis' : '');
        el.style.setProperty('--cc', c.type === 'attack' ? '#ff7a6e' : c.type === 'power' ? '#ffd45e' : '#5ef2ff');
        el.innerHTML = `<div class="gx-cost">${c.cost}</div><div class="gx-cn">${c.name}</div><div class="gx-ct">${c.text}</div><div class="gx-cardtype">${c.type}</div>`;
        el.addEventListener('click', () => playCard(i));
        handEl.appendChild(el);
      });
      wrap.querySelector('.gx-end').addEventListener('click', endTurn);
    }

    // ---------- overlays ----------
    function renderOverlayNone() { ov.classList.add('hidden'); }
    function showMenu() {
      phase = 'menu'; render(); ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Gambit</h2>
        <p class="msg">A roguelike deckbuilder. Each turn, spend ⚡ energy to play cards — attack, block, and debuff.
        Enemies show their next move, so plan around it. Win to draft a new card; survive all ${ENEMIES.length} floors to beat the boss.
        Pick your class:</p>
        <div class="gx-reward">${Object.entries(CLASSES).map(([id, c]) => `<button class="btn" data-cls="${id}" style="background:${c.color}">${c.emoji} ${c.name.toUpperCase()}</button>`).join('')}</div>`;
    }
    function showReward(pool) {
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Victory!</h2><p class="msg">Floor ${floor} cleared. You healed up. Draft a card for your deck:</p>
        <div class="gx-reward">${pool.map((id, i) => { const c = CARDS[id]; const cc = c.type === 'attack' ? '#ff7a6e' : c.type === 'power' ? '#ffd45e' : '#5ef2ff'; return `<div class="gx-card" data-rw="${i}" style="--cc:${cc};width:110px"><div class="gx-cost">${c.cost}</div><div class="gx-cn">${c.name}</div><div class="gx-ct">${c.text}</div><div class="gx-cardtype">${c.type}</div></div>`; }).join('')}</div>
        <button class="btn alt" data-rw="skip">SKIP</button>`;
    }
    function endScreen(win) {
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>${win ? '🏆 You beat the Warlord!' : 'Defeated'}</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${win ? ENEMIES.length : floor}</span><span class="l">Floors</span></div>
          <div class="stat"><span class="v">${api.getBest('gambit')}</span><span class="l">Best</span></div>
        </div>
        <button class="btn" data-act="again">NEW RUN ↻</button>`;
    }
    ov.addEventListener('click', e => {
      const t = e.target.closest('[data-cls],[data-rw],[data-act]'); if (!t) return;
      if (t.dataset.cls) { ov.classList.add('hidden'); startRun(t.dataset.cls); }
      else if (t.dataset.rw != null) { ov.classList.add('hidden'); pickReward(t.dataset.rw === 'skip' ? -1 : parseInt(t.dataset.rw, 10)); }
      else if (t.dataset.act === 'again') { ov.classList.add('hidden'); showMenu(); }
    });
    api.on(window, 'keydown', e => {
      if (phase !== 'battle') return;
      if (e.key >= '1' && e.key <= '9') { playCard(parseInt(e.key, 10) - 1); }
      else if (e.key.toLowerCase() === 'e') endTurn();
    });

    showMenu();

    // inert test seam
    if (typeof window !== 'undefined' && window.__gambitTest) {
      window.__gambitTest({
        get phase() { return phase; }, get player() { return player; }, get enemy() { return enemy; },
        get hand() { return hand; }, get floor() { return floor; }, get deck() { return deck; }, get rewards() { return rewardChoices; },
        cards: CARDS, startRun, playCard, endTurn, pickReward,
      });
    }
  },
});

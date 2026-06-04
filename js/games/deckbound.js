/* Deckbound Tactics - a small roguelike card-chess prototype. */
Arcade.register({
  id: 'deckbound',
  name: 'Deckbound Tactics',
  emoji: 'DB',
  desc: 'Draft cards, move on a tiny chess board, and survive waves of readable enemy pieces.',
  color: '#a78bfa',

  start(root, api) {
    const BOARD = 6;
    const MAX_HP = 22;
    const HAND_SIZE = 5;
    const START_DECK = ['step', 'step', 'slash', 'slash', 'guard', 'spark', 'dash', 'knight'];
    const DRAFT_POOL = ['lunge', 'bishop', 'fork', 'shieldwall', 'execute', 'plan', 'queen', 'rookdash'];
    const RELIC_POOL = ['banner', 'boots', 'lens', 'thorns', 'tempo', 'mender'];
    const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const KNIGHT = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

    const CARDS = {
      step: { name: 'King Step', cost: 0, text: 'Move 1 tile in any direction.', target: 'empty' },
      slash: { name: 'Short Slash', cost: 1, text: 'Deal 3 to an adjacent enemy.', target: 'enemy' },
      guard: { name: 'Guard', cost: 1, text: 'Gain 5 block.', target: 'self' },
      spark: { name: 'Spark', cost: 1, text: 'Deal 2 within range 3.', target: 'enemy' },
      dash: { name: 'Rook Dash', cost: 1, text: 'Move up to 3 tiles in a straight line.', target: 'empty' },
      knight: { name: 'Knight Feint', cost: 1, text: 'Jump in an L. Deal 3 if you land on an enemy.', target: 'tile' },
      lunge: { name: 'Lance Line', cost: 1, text: 'Deal 4 up to 2 tiles in a straight line.', target: 'enemy' },
      bishop: { name: 'Bishop Slip', cost: 1, text: 'Move diagonally up to 3. Gain 2 block.', target: 'empty' },
      fork: { name: 'Fork Bolt', cost: 2, text: 'Deal 2, then 2 to enemies adjacent to it.', target: 'enemy' },
      shieldwall: { name: 'Shield Wall', cost: 1, text: 'Gain 8 block.', target: 'self' },
      execute: { name: 'Checkmate Cut', cost: 2, text: 'Adjacent hit for 6. +3 if target is weak.', target: 'enemy' },
      plan: { name: 'Study Lines', cost: 0, text: 'Draw 2 cards.', target: 'self' },
      queen: { name: 'Queen Sweep', cost: 2, text: 'Hit enemies sharing your row, file, or diagonal for 3.', target: 'self' },
      rookdash: { name: 'Castle Crash', cost: 1, text: 'Move up to 4 straight, then hit adjacent enemies for 2.', target: 'empty' },
    };
    const PIECES = {
      pawn: { name: 'Pawn', hp: 4, dmg: 2, color: '#ffb65e', label: 'P' },
      rook: { name: 'Rook', hp: 7, dmg: 3, color: '#ff5ec4', label: 'R' },
      bishop: { name: 'Bishop', hp: 6, dmg: 3, color: '#a78bfa', label: 'B' },
      knight: { name: 'Knight', hp: 6, dmg: 3, color: '#5ef2ff', label: 'N' },
    };
    const RELICS = {
      banner: { name: 'Battle Standard', text: 'Start each turn with 1 block.' },
      boots: { name: 'Winged Boots', text: 'Your first move card each turn costs 0.' },
      lens: { name: 'Prism Lens', text: 'Spark and Fork Bolt deal +1 damage.' },
      thorns: { name: 'Barbed Guard', text: 'When block absorbs a melee hit, deal 1 back.' },
      tempo: { name: 'Tempo Engine', text: 'Gain +1 energy on the first turn of each wave.' },
      mender: { name: 'Mender Rune', text: 'Heal 1 extra after each wave.' },
    };
    const MOVE_CARDS = new Set(['step', 'dash', 'bishop', 'knight', 'rookdash']);

    const style = document.createElement('style');
    style.textContent = `
      .db-wrap{position:absolute;inset:0;padding:70px 16px 16px;display:grid;grid-template-columns:minmax(320px,1fr) minmax(280px,340px);gap:16px;background:radial-gradient(circle at 35% 12%,rgba(167,139,250,.18),transparent 38%)}
      .db-board-shell{min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.1);background:rgba(5,6,15,.28);border-radius:8px;overflow:hidden}
      .db-board{position:relative;width:100%;height:100%;min-height:420px}
      .db-panel{min-height:0;display:flex;flex-direction:column;gap:10px}
      .db-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font-weight:900}
      .db-pill{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:8px;padding:9px 10px;font-size:13px}
      .db-pill b{color:#ffd45e}
      .db-log{min-height:48px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.18);border-radius:8px;padding:10px;font-size:13px;line-height:1.35;color:rgba(234,242,255,.86)}
      .db-info{border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.14);border-radius:8px;padding:10px;font-size:12px;line-height:1.35;color:rgba(234,242,255,.78)}
      .db-info h4{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#ffd45e;margin:0 0 6px}
      .db-info .legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      .db-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 7px;background:rgba(255,255,255,.06)}
      .db-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
      .db-enemies{display:grid;gap:5px}
      .db-enemy-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .db-relics{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .db-relic{border:1px solid rgba(167,139,250,.4);background:rgba(167,139,250,.12);border-radius:7px;padding:4px 6px;color:#e9ddff}
      .db-hand{min-height:0;overflow:auto;display:grid;grid-template-columns:1fr;gap:8px;padding-right:2px}
      .db-card{width:100%;text-align:left;color:var(--text);background:linear-gradient(160deg,rgba(22,28,60,.95),rgba(8,10,24,.95));border:1px solid rgba(255,255,255,.13);border-radius:8px;padding:10px;cursor:pointer;font:inherit;transition:transform .1s,border-color .15s,background .15s}
      .db-card:hover:not(:disabled),.db-card.active{transform:translateY(-1px);border-color:#a78bfa;background:linear-gradient(160deg,rgba(57,43,102,.95),rgba(12,15,34,.95))}
      .db-card:disabled{opacity:.42;cursor:default}
      .db-card .top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;font-weight:900}
      .db-card .cost{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:50%;background:#ffd45e;color:#05060f;font-weight:900}
      .db-card .txt{font-size:12px;line-height:1.35;color:rgba(234,242,255,.75)}
      .db-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .db-btn{border:0;border-radius:8px;padding:11px 12px;font-weight:900;cursor:pointer;color:#05060f;background:#5ef2ff}
      .db-btn.alt{background:#ffd45e}
      .db-btn:disabled{opacity:.4;cursor:default}
      .db-draft{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;max-width:760px}
      .db-draft .db-card{min-height:136px}
      .db-reward-skip{margin-top:10px}
      @media (max-width:780px){
        .db-wrap{grid-template-columns:1fr;grid-template-rows:minmax(300px,48vh) minmax(230px,1fr);padding:58px 10px 10px;gap:10px}
        .db-board{min-height:300px}
        .db-stats{grid-template-columns:repeat(4,minmax(0,1fr))}
        .db-pill{padding:7px 6px;font-size:12px;text-align:center}
        .db-hand{grid-template-columns:repeat(2,minmax(0,1fr))}
        .db-card{padding:9px;min-height:92px}
        .db-draft{grid-template-columns:1fr;max-height:58vh;overflow:auto}
        .db-info{display:none}
      }
    `;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'db-wrap';
    wrap.innerHTML = `
      <div class="db-board-shell"><div class="db-board" id="db-board"></div></div>
      <div class="db-panel">
        <div class="db-stats" id="db-stats"></div>
        <div class="db-log" id="db-log"></div>
        <div class="db-info" id="db-info"></div>
        <div class="db-actions">
          <button class="db-btn" id="db-end">End Turn</button>
          <button class="db-btn alt" id="db-redraw">New Run</button>
        </div>
        <div class="db-hand" id="db-hand"></div>
      </div>`;
    root.appendChild(wrap);
    const boardEl = wrap.querySelector('#db-board');
    const statsEl = wrap.querySelector('#db-stats');
    const logEl = wrap.querySelector('#db-log');
    const infoEl = wrap.querySelector('#db-info');
    const handEl = wrap.querySelector('#db-hand');
    const endBtn = wrap.querySelector('#db-end');
    const newBtn = wrap.querySelector('#db-redraw');
    const overlay = document.createElement('div');
    overlay.className = 'center-overlay';
    root.appendChild(overlay);

    let view, ctx, cell = 0, boardSize = 0, offX = 0, offY = 0, enemyId = 1;
    const state = {
      phase: 'menu',
      wave: 0,
      cleared: 0,
      hp: MAX_HP,
      block: 0,
      energy: 3,
      deck: [],
      relics: [],
      draw: [],
      discard: [],
      hand: [],
      player: { r: BOARD - 1, c: 2 },
      enemies: [],
      selected: -1,
      turn: 0,
      moveDiscountUsed: false,
      fx: [],
      log: 'Draft cards, read enemy threats, and clear waves.',
    };

    function layout(v) {
      boardSize = Math.max(240, Math.min(v.w, v.h) - 22);
      cell = boardSize / BOARD;
      offX = (v.w - boardSize) / 2;
      offY = (v.h - boardSize) / 2;
    }
    view = api.makeCanvas(boardEl, { onResize: layout });
    ctx = view.ctx;
    layout(view);

    const inside = (r, c) => r >= 0 && r < BOARD && c >= 0 && c < BOARD;
    const sameDiag = (a, b) => Math.abs(a.r - b.r) === Math.abs(a.c - b.c);
    const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
    const keyOf = t => `${t.r},${t.c}`;
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const enemyAt = (r, c) => state.enemies.find(e => e.hp > 0 && e.r === r && e.c === c);
    const occupied = (r, c) => (state.player.r === r && state.player.c === c) || !!enemyAt(r, c);
    const empty = (r, c) => inside(r, c) && !occupied(r, c);
    const cardNeedsTarget = id => CARDS[id].target !== 'self';
    const hasRelic = id => state.relics.includes(id);
    const isMoveCard = id => MOVE_CARDS.has(id);

    function energyCost(id) {
      const base = CARDS[id].cost;
      return hasRelic('boots') && isMoveCard(id) && !state.moveDiscountUsed ? 0 : base;
    }

    function addFx(text, r, c, color = '#eaf2ff') {
      state.fx.push({ text, r, c, color, life: 760, max: 760, drift: 0 });
      if (state.fx.length > 18) state.fx.splice(0, state.fx.length - 18);
    }

    function lineClear(r, c) {
      const pr = state.player.r, pc = state.player.c;
      const dr = Math.sign(r - pr), dc = Math.sign(c - pc);
      const steps = Math.max(Math.abs(r - pr), Math.abs(c - pc));
      for (let i = 1; i < steps; i++) if (occupied(pr + dr * i, pc + dc * i)) return false;
      return true;
    }

    function addLog(text) {
      state.log = text;
      logEl.textContent = text;
    }

    function drawCards(n) {
      for (let i = 0; i < n; i++) {
        if (!state.draw.length) {
          if (!state.discard.length) return;
          state.draw = shuffle(state.discard.splice(0));
        }
        state.hand.push(state.draw.pop());
      }
    }

    function resetCombatDeck() {
      state.draw = shuffle(state.deck.slice());
      state.discard = [];
      state.hand = [];
    }

    function showIntro() {
      state.phase = 'menu';
      overlay.classList.remove('hidden');
      overlay.innerHTML = `<h2>Deckbound Tactics</h2>
        <p class="msg">A small card-chess roguelike prototype. Select a card, click a highlighted tile, survive the enemy pieces, then draft a new card after each wave.</p>
        <div class="stat-row">
          <div class="stat"><span class="v">${api.getBest('deckbound')}</span><span class="l">Best Waves</span></div>
        </div>
        <button class="btn" data-act="play">PLAY</button>`;
      updateUI();
    }

    function newRun() {
      state.phase = 'player';
      state.wave = 0;
      state.cleared = 0;
      state.hp = MAX_HP;
      state.block = 0;
      state.energy = 3;
      state.deck = START_DECK.slice();
      state.relics = [];
      state.player = { r: BOARD - 1, c: 2 };
      state.enemies = [];
      state.selected = -1;
      state.fx = [];
      overlay.classList.add('hidden');
      addLog('Your opening deck is simple: move, block, and find clean trades.');
      nextWave();
    }

    function spawn(type, r, c) {
      state.enemies.push({ id: enemyId++, type, r, c, hp: PIECES[type].hp, maxHp: PIECES[type].hp });
    }

    function nextWave() {
      state.wave++;
      state.block = 0;
      state.turn = 0;
      state.player = { r: BOARD - 1, c: 2 + (state.wave % 2) };
      state.enemies = [];
      const plans = [
        [['pawn', 1, 2], ['pawn', 1, 3]],
        [['pawn', 1, 1], ['rook', 0, 4], ['pawn', 2, 4]],
        [['bishop', 0, 1], ['pawn', 1, 3], ['knight', 0, 5]],
        [['rook', 0, 0], ['bishop', 0, 5], ['pawn', 2, 2], ['pawn', 2, 3]],
      ];
      const plan = plans[state.wave - 1];
      if (plan) plan.forEach(p => spawn(p[0], p[1], p[2]));
      else {
        const types = ['pawn', 'pawn', 'rook', 'bishop', 'knight'];
        const spots = shuffle([[0, 0], [0, 2], [0, 4], [1, 1], [1, 3], [1, 5], [2, 0], [2, 5]]);
        const count = Math.min(6, 3 + Math.floor(state.wave / 2));
        for (let i = 0; i < count; i++) {
          const [r, c] = spots[i % spots.length];
          spawn(types[(i + state.wave) % types.length], r, c);
        }
      }
      resetCombatDeck();
      startPlayerTurn(`Wave ${state.wave}: read the red threats before ending your turn.`);
    }

    function startPlayerTurn(message) {
      if (state.hp <= 0) return gameOver();
      state.phase = 'player';
      state.turn++;
      state.energy = 3 + (hasRelic('tempo') && state.turn === 1 ? 1 : 0);
      state.block = hasRelic('banner') ? 1 : 0;
      state.moveDiscountUsed = false;
      state.selected = -1;
      drawCards(Math.max(0, HAND_SIZE - state.hand.length));
      if (message) addLog(message);
      updateUI();
    }

    function endTurn() {
      if (state.phase !== 'player') return;
      state.discard.push(...state.hand);
      state.hand = [];
      state.selected = -1;
      state.phase = 'enemy';
      addLog('Enemy pieces move. Block absorbs damage this turn only.');
      enemyTurn();
    }

    function damagePlayer(amount, enemy) {
      const source = PIECES[enemy.type].name;
      const blocked = Math.min(state.block, amount);
      state.block -= blocked;
      const taken = amount - blocked;
      state.hp -= taken;
      addFx(blocked ? 'BLOCK' : `-${taken}`, state.player.r, state.player.c, blocked ? '#ffd45e' : '#ff5ec4');
      addLog(`${source} attacks for ${amount}. ${blocked ? `${blocked} blocked. ` : ''}${taken ? `${taken} damage taken.` : 'No damage taken.'}`);
      if (blocked && hasRelic('thorns') && Math.max(Math.abs(enemy.r - state.player.r), Math.abs(enemy.c - state.player.c)) <= 1) {
        deal(enemy, 1, 'Barbed Guard');
      }
      if (state.hp <= 0) gameOver();
    }

    function deal(enemy, amount, source) {
      if (!enemy) return;
      enemy.hp -= amount;
      enemy.hit = 1;
      addFx(`-${amount}`, enemy.r, enemy.c, '#ffd45e');
      addLog(`${source} deals ${amount} to ${PIECES[enemy.type].name}.`);
      if (enemy.hp <= 0) {
        state.enemies = state.enemies.filter(e => e.id !== enemy.id);
        addLog(`${PIECES[enemy.type].name} removed from the board.`);
      }
    }

    function completeWave() {
      state.cleared = state.wave;
      api.setBest('deckbound', state.cleared);
      state.phase = 'draft';
      state.selected = -1;
      state.discard.push(...state.hand);
      state.hand = [];
      const heal = 2 + (hasRelic('mender') ? 1 : 0);
      const relicDraft = state.wave % 2 === 0;
      overlay.classList.remove('hidden');
      if (relicDraft) showRelicReward(heal);
      else showCardReward(heal);
      updateUI();
    }

    function showCardReward(heal) {
      const offers = shuffle(DRAFT_POOL.slice()).slice(0, 3);
      overlay.innerHTML = `<h2>Wave Cleared</h2>
        <p class="msg">Choose one card for your deck, or skip for a bigger heal. You recover ${heal} HP with a card pick.</p>
        <div class="db-draft">${offers.map(id => cardMarkup(id, true)).join('')}</div>
        <button class="btn alt db-reward-skip" data-skip="heal">SKIP: HEAL ${heal + 3}</button>`;
      overlay.querySelectorAll('[data-card]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.card;
          state.deck.push(id);
          state.hp = Math.min(MAX_HP, state.hp + heal);
          overlay.classList.add('hidden');
          addLog(`${CARDS[id].name} added to your deck.`);
          nextWave();
        });
      });
      overlay.querySelector('[data-skip]').addEventListener('click', () => {
        state.hp = Math.min(MAX_HP, state.hp + heal + 3);
        overlay.classList.add('hidden');
        addLog('You skip the card and patch up for extra health.');
        nextWave();
      });
    }

    function showRelicReward(heal) {
      const offers = shuffle(RELIC_POOL.filter(id => !hasRelic(id))).slice(0, 3);
      if (!offers.length) return showCardReward(heal);
      overlay.innerHTML = `<h2>Choose a Relic</h2>
        <p class="msg">Relics are passive upgrades that shape the rest of the run. You still recover ${heal} HP.</p>
        <div class="db-draft">${offers.map(relicMarkup).join('')}</div>`;
      overlay.querySelectorAll('[data-relic]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.relic;
          state.relics.push(id);
          state.hp = Math.min(MAX_HP, state.hp + heal);
          overlay.classList.add('hidden');
          addLog(`${RELICS[id].name} acquired.`);
          nextWave();
        });
      });
    }

    function gameOver() {
      state.phase = 'over';
      state.selected = -1;
      const best = api.setBest('deckbound', state.cleared);
      overlay.classList.remove('hidden');
      overlay.innerHTML = `<h2>Run Over</h2>
        <div class="stat-row">
          <div class="stat"><span class="v">${state.cleared}</span><span class="l">Waves</span></div>
          <div class="stat"><span class="v">${api.getBest('deckbound')}</span><span class="l">Best</span></div>
        </div>
        ${best ? '<div class="new-best">NEW BEST</div>' : '<div style="height:20px"></div>'}
        <button class="btn" data-act="play">PLAY AGAIN</button>`;
      updateUI();
    }

    function validTargets(cardId) {
      const p = state.player;
      const out = [];
      if (state.phase !== 'player') return out;
      if (cardId === 'step') {
        for (const [dr, dc] of DIR8) if (empty(p.r + dr, p.c + dc)) out.push({ r: p.r + dr, c: p.c + dc });
      } else if (cardId === 'slash') {
        for (const e of state.enemies) if (Math.max(Math.abs(e.r - p.r), Math.abs(e.c - p.c)) === 1) out.push({ r: e.r, c: e.c });
      } else if (cardId === 'spark' || cardId === 'fork') {
        for (const e of state.enemies) if (dist(p, e) <= 3) out.push({ r: e.r, c: e.c });
      } else if (cardId === 'dash') {
        for (const [dr, dc] of DIR4) for (let s = 1; s <= 3; s++) {
          const r = p.r + dr * s, c = p.c + dc * s;
          if (!inside(r, c) || occupied(r, c)) break;
          out.push({ r, c });
        }
      } else if (cardId === 'knight') {
        for (const [dr, dc] of KNIGHT) {
          const r = p.r + dr, c = p.c + dc;
          if (inside(r, c) && (!occupied(r, c) || enemyAt(r, c))) out.push({ r, c });
        }
      } else if (cardId === 'lunge') {
        for (const [dr, dc] of DIR4) for (let s = 1; s <= 2; s++) {
          const r = p.r + dr * s, c = p.c + dc * s;
          if (!inside(r, c)) break;
          const e = enemyAt(r, c);
          if (e) { out.push({ r, c }); break; }
          if (occupied(r, c)) break;
        }
      } else if (cardId === 'bishop') {
        for (const [dr, dc] of DIAG) for (let s = 1; s <= 3; s++) {
          const r = p.r + dr * s, c = p.c + dc * s;
          if (!inside(r, c) || occupied(r, c)) break;
          out.push({ r, c });
        }
      } else if (cardId === 'execute') {
        for (const e of state.enemies) if (Math.max(Math.abs(e.r - p.r), Math.abs(e.c - p.c)) === 1) out.push({ r: e.r, c: e.c });
      } else if (cardId === 'rookdash') {
        for (const [dr, dc] of DIR4) for (let s = 1; s <= 4; s++) {
          const r = p.r + dr * s, c = p.c + dc * s;
          if (!inside(r, c) || occupied(r, c)) break;
          out.push({ r, c });
        }
      }
      return out;
    }

    function playCard(index, target) {
      if (state.phase !== 'player') return;
      const cardId = state.hand[index];
      const card = CARDS[cardId];
      const cost = card ? energyCost(cardId) : 0;
      const discountedMove = card && hasRelic('boots') && isMoveCard(cardId) && !state.moveDiscountUsed;
      if (!card || state.energy < cost) return;
      if (cardNeedsTarget(cardId) && !validTargets(cardId).some(t => t.r === target.r && t.c === target.c)) return;

      state.hand.splice(index, 1);
      state.discard.push(cardId);
      state.energy -= cost;
      if (discountedMove) state.moveDiscountUsed = true;
      state.selected = -1;

      if (cardId === 'step' || cardId === 'dash' || cardId === 'bishop' || cardId === 'rookdash') {
        state.player = { r: target.r, c: target.c };
        addFx('MOVE', target.r, target.c, '#5ef2ff');
        if (cardId === 'bishop') state.block += 2;
        if (cardId === 'rookdash') for (const e of state.enemies.slice()) {
          if (Math.max(Math.abs(e.r - target.r), Math.abs(e.c - target.c)) === 1) deal(e, 2, card.name);
        }
        addLog(`${card.name} repositions you.`);
      } else if (cardId === 'slash') {
        deal(enemyAt(target.r, target.c), 3, card.name);
      } else if (cardId === 'spark') {
        deal(enemyAt(target.r, target.c), hasRelic('lens') ? 3 : 2, card.name);
      } else if (cardId === 'knight') {
        const e = enemyAt(target.r, target.c);
        if (e) {
          deal(e, 3, card.name);
          if (!enemyAt(target.r, target.c)) state.player = { r: target.r, c: target.c };
        } else state.player = { r: target.r, c: target.c };
      } else if (cardId === 'lunge') {
        deal(enemyAt(target.r, target.c), 4, card.name);
      } else if (cardId === 'fork') {
        const main = enemyAt(target.r, target.c);
        const forkDamage = hasRelic('lens') ? 3 : 2;
        if (main) deal(main, forkDamage, card.name);
        for (const e of state.enemies.slice()) {
          if (e.r === target.r && e.c === target.c) continue;
          if (Math.max(Math.abs(e.r - target.r), Math.abs(e.c - target.c)) === 1) deal(e, forkDamage, card.name);
        }
      } else if (cardId === 'execute') {
        const e = enemyAt(target.r, target.c);
        deal(e, e.hp <= 4 ? 9 : 6, card.name);
      } else if (cardId === 'guard') {
        state.block += 5; addFx('+5', state.player.r, state.player.c, '#ffd45e'); addLog('You brace for 5 block.');
      } else if (cardId === 'shieldwall') {
        state.block += 8; addFx('+8', state.player.r, state.player.c, '#ffd45e'); addLog('Shield Wall gives 8 block.');
      } else if (cardId === 'plan') {
        drawCards(2); addLog('You study the board and draw 2 cards.');
      } else if (cardId === 'queen') {
        let hits = 0;
        for (const e of state.enemies.slice()) {
          if (e.r === state.player.r || e.c === state.player.c || sameDiag(e, state.player)) { deal(e, 3, card.name); hits++; }
        }
        if (!hits) addLog('Queen Sweep found no aligned targets.');
      }

      if (state.enemies.length === 0) completeWave();
      else updateUI();
    }

    function enemyThreats(enemy) {
      const out = [];
      if (enemy.type === 'pawn') {
        const dr = enemy.r <= state.player.r ? 1 : -1;
        for (const dc of [-1, 1]) if (inside(enemy.r + dr, enemy.c + dc)) out.push({ r: enemy.r + dr, c: enemy.c + dc });
      } else if (enemy.type === 'rook') {
        rayThreats(enemy, DIR4, out);
      } else if (enemy.type === 'bishop') {
        rayThreats(enemy, DIAG, out);
      } else if (enemy.type === 'knight') {
        for (const [dr, dc] of KNIGHT) if (inside(enemy.r + dr, enemy.c + dc)) out.push({ r: enemy.r + dr, c: enemy.c + dc });
      }
      return out;
    }

    function rayThreats(enemy, dirs, out) {
      for (const [dr, dc] of dirs) {
        for (let s = 1; s < BOARD; s++) {
          const r = enemy.r + dr * s, c = enemy.c + dc * s;
          if (!inside(r, c)) break;
          out.push({ r, c });
          if (occupied(r, c)) break;
        }
      }
    }

    function attacksPlayer(enemy) {
      return enemyThreats(enemy).some(t => t.r === state.player.r && t.c === state.player.c);
    }

    function enemyTurn() {
      for (const enemy of state.enemies.slice()) {
        if (!state.enemies.includes(enemy) || state.hp <= 0) continue;
        if (attacksPlayer(enemy)) damagePlayer(PIECES[enemy.type].dmg, enemy);
        else moveEnemy(enemy);
      }
      if (state.hp > 0 && state.phase !== 'over') startPlayerTurn('Your turn. Red tiles show current enemy threats.');
    }

    function moveEnemy(enemy) {
      const p = state.player;
      const tryMove = (dr, dc) => {
        const r = enemy.r + dr, c = enemy.c + dc;
        if (empty(r, c)) { enemy.r = r; enemy.c = c; return true; }
        return false;
      };
      if (enemy.type === 'pawn') {
        if (tryMove(Math.sign(p.r - enemy.r), 0)) return;
        tryMove(0, Math.sign(p.c - enemy.c));
      } else if (enemy.type === 'rook') {
        const first = Math.abs(p.r - enemy.r) >= Math.abs(p.c - enemy.c) ? [Math.sign(p.r - enemy.r), 0] : [0, Math.sign(p.c - enemy.c)];
        if (!tryMove(first[0], first[1])) tryMove(first[1], first[0]);
      } else if (enemy.type === 'bishop') {
        if (!tryMove(Math.sign(p.r - enemy.r), Math.sign(p.c - enemy.c))) {
          if (!tryMove(Math.sign(p.r - enemy.r), 0)) tryMove(0, Math.sign(p.c - enemy.c));
        }
      } else if (enemy.type === 'knight') {
        let best = null, bestDist = Infinity;
        for (const [dr, dc] of KNIGHT) {
          const r = enemy.r + dr, c = enemy.c + dc;
          if (!empty(r, c)) continue;
          const d = dist({ r, c }, p);
          if (d < bestDist) { bestDist = d; best = { r, c }; }
        }
        if (best) { enemy.r = best.r; enemy.c = best.c; }
      }
    }

    function cardMarkup(id, draft) {
      const c = CARDS[id];
      return `<button class="db-card" ${draft ? `data-card="${id}"` : ''} type="button">
        <div class="top"><span>${c.name}</span><span class="cost">${c.cost}</span></div>
        <div class="txt">${c.text}</div>
      </button>`;
    }

    function relicMarkup(id) {
      const r = RELICS[id];
      return `<button class="db-card" data-relic="${id}" type="button">
        <div class="top"><span>${r.name}</span><span class="cost">R</span></div>
        <div class="txt">${r.text}</div>
      </button>`;
    }

    function piecePattern(type) {
      if (type === 'pawn') return 'diagonal bite';
      if (type === 'rook') return 'row/file beam';
      if (type === 'bishop') return 'diagonal beam';
      return 'L jump';
    }

    function intentText(enemy) {
      if (attacksPlayer(enemy)) return `attacks for ${PIECES[enemy.type].dmg}`;
      return `advances, threatens ${piecePattern(enemy.type)}`;
    }

    function updateUI() {
      statsEl.innerHTML = `
        <div class="db-pill">HP <b>${Math.max(0, state.hp)}/${MAX_HP}</b></div>
        <div class="db-pill">Block <b>${state.block}</b></div>
        <div class="db-pill">Energy <b>${state.energy}</b></div>
        <div class="db-pill">Wave <b>${state.wave}</b></div>
        <div class="db-pill">Draw <b>${state.draw.length}</b></div>
        <div class="db-pill">Discard <b>${state.discard.length}</b></div>
        <div class="db-pill">Deck <b>${state.deck.length}</b></div>
        <div class="db-pill">Best <b>${api.getBest('deckbound')}</b></div>`;
      logEl.textContent = state.log;
      const relicHtml = state.relics.length
        ? state.relics.map(id => `<span class="db-relic" title="${RELICS[id].text}">${RELICS[id].name}</span>`).join('')
        : '<span class="db-relic">No relics yet</span>';
      const enemyHtml = state.enemies.length
        ? state.enemies.map(e => `<div class="db-enemy-row"><span><b style="color:${PIECES[e.type].color}">${PIECES[e.type].label}</b> ${PIECES[e.type].name} ${e.hp}/${e.maxHp}</span><span>${intentText(e)}</span></div>`).join('')
        : '<div class="db-enemy-row"><span>Board clear</span><span>draft reward</span></div>';
      infoEl.innerHTML = `<h4>Read</h4>
        <div class="legend">
          <span class="db-chip"><span class="db-dot" style="background:#ff5ec4"></span>Enemy threat</span>
          <span class="db-chip"><span class="db-dot" style="background:#9cff5e"></span>Card target</span>
        </div>
        <h4>Enemy Intent</h4><div class="db-enemies">${enemyHtml}</div>
        <div class="db-relics">${relicHtml}</div>`;
      endBtn.disabled = state.phase !== 'player';
      handEl.innerHTML = '';
      state.hand.forEach((id, i) => {
        const def = CARDS[id];
        const cost = energyCost(id);
        const btn = document.createElement('button');
        btn.className = 'db-card' + (state.selected === i ? ' active' : '');
        btn.type = 'button';
        btn.disabled = state.phase !== 'player' || state.energy < cost || (cardNeedsTarget(id) && !validTargets(id).length);
        btn.innerHTML = `<div class="top"><span>${def.name}</span><span class="cost">${cost}</span></div><div class="txt">${def.text}</div>`;
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          if (!cardNeedsTarget(id)) playCard(i, null);
          else {
            state.selected = state.selected === i ? -1 : i;
            addLog(state.selected === i ? `Choose a target for ${def.name}.` : 'Card unselected.');
            updateUI();
          }
        });
        handEl.appendChild(btn);
      });
    }

    function eventCell(e) {
      const rect = view.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - offX;
      const y = e.clientY - rect.top - offY;
      const c = Math.floor(x / cell), r = Math.floor(y / cell);
      return inside(r, c) ? { r, c } : null;
    }

    function handleBoard(e) {
      if (state.phase !== 'player' || state.selected < 0) return;
      const t = eventCell(e);
      if (!t) return;
      const id = state.hand[state.selected];
      if (validTargets(id).some(v => v.r === t.r && v.c === t.c)) playCard(state.selected, t);
    }

    function draw(dt = 16) {
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.fillStyle = '#080b18';
      ctx.fillRect(0, 0, view.w, view.h);
      const selectedId = state.selected >= 0 ? state.hand[state.selected] : null;
      const targets = selectedId ? new Set(validTargets(selectedId).map(keyOf)) : new Set();
      const threats = new Set();
      for (const e of state.enemies) for (const t of enemyThreats(e)) threats.add(keyOf(t));

      for (let r = 0; r < BOARD; r++) for (let c = 0; c < BOARD; c++) {
        const x = offX + c * cell, y = offY + r * cell;
        ctx.fillStyle = (r + c) % 2 ? '#111733' : '#172044';
        ctx.fillRect(x, y, cell, cell);
        if (threats.has(`${r},${c}`)) {
          ctx.fillStyle = 'rgba(255,94,196,.26)';
          ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        }
        if (targets.has(`${r},${c}`)) {
          ctx.fillStyle = 'rgba(156,255,94,.26)';
          ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
        }
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.strokeRect(x + .5, y + .5, cell, cell);
      }

      for (const e of state.enemies) {
        e.hit = Math.max(0, (e.hit || 0) - dt / 220);
        drawEnemy(e);
      }
      drawPlayer();
      drawFx(dt);
    }

    function drawDisc(r, c, radius, fill, stroke) {
      const x = offX + c * cell + cell / 2;
      const y = offY + r * cell + cell / 2;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return { x, y };
    }

    function drawEnemy(e) {
      const def = PIECES[e.type];
      const p = drawDisc(e.r, e.c, cell * (.31 + (e.hit || 0) * .08), def.color, e.hit ? '#ffd45e' : 'rgba(255,255,255,.7)');
      ctx.fillStyle = '#05060f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(18, cell * .34)}px system-ui,sans-serif`;
      ctx.fillText(def.label, p.x, p.y - 1);
      const w = cell * .52, h = 5, x = p.x - w / 2, y = p.y + cell * .25;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#9cff5e';
      ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), h);
    }

    function drawPlayer() {
      const p = drawDisc(state.player.r, state.player.c, cell * .34, '#5ef2ff', '#eaf2ff');
      ctx.fillStyle = '#05060f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(18, cell * .34)}px system-ui,sans-serif`;
      ctx.fillText('H', p.x, p.y - 1);
      if (state.block > 0) {
        ctx.strokeStyle = 'rgba(255,212,94,.86)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, cell * .42, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawFx(dt) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(13, cell * .18)}px system-ui,sans-serif`;
      for (let i = state.fx.length - 1; i >= 0; i--) {
        const f = state.fx[i];
        f.life -= dt;
        f.drift += dt * .035;
        if (f.life <= 0) { state.fx.splice(i, 1); continue; }
        const x = offX + f.c * cell + cell / 2;
        const y = offY + f.r * cell + cell / 2 - f.drift;
        ctx.globalAlpha = Math.max(0, f.life / f.max);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, x, y);
        ctx.globalAlpha = 1;
      }
    }

    api.on(view.canvas, 'click', handleBoard);
    api.on(view.canvas, 'touchstart', e => {
      e.preventDefault();
      handleBoard(e.touches[0]);
    }, { passive: false });
    api.on(endBtn, 'click', endTurn);
    api.on(newBtn, 'click', newRun);
    overlay.addEventListener('click', e => {
      if (e.target.dataset.act === 'play') newRun();
    });
    api.loop(draw);
    showIntro();
  },
});

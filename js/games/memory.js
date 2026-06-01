/* Memory Match — flip cards to find matching pairs in the fewest moves. */
(() => {
let activeTimer = null;
Arcade.register({
  id: 'memory',
  name: 'Memory Match',
  emoji: '🧠',
  desc: 'Flip the tiles two at a time and pair every emoji. Fewer moves = a better score.',
  color: '#ff5ec4',

  start(root, api) {
    const EMOJIS = ['🚀', '🌟', '🍕', '🎲', '🐙', '🎸', '🦄', '🍉', '⚡', '🌈', '👾', '🎈'];
    let moves, matched, flipped, lock, elapsed, state;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;width:100%;height:100%;justify-content:center;padding:70px 16px 20px';
    root.appendChild(wrap);

    const ov = document.createElement('div');
    ov.className = 'center-overlay'; root.appendChild(ov);

    const style = document.createElement('style');
    style.textContent = `
      .mem-stats{display:flex;gap:30px;font-weight:800;font-size:clamp(15px,4vw,20px)}
      .mem-stats .a{color:var(--accent)} .mem-stats .b{color:var(--gold)}
      .mem-board{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:min(92vw,420px)}
      .mem-card{aspect-ratio:1;position:relative;cursor:pointer;perspective:600px}
      .mem-inner{position:absolute;inset:0;transition:transform .35s;transform-style:preserve-3d}
      .mem-card.flip .mem-inner{transform:rotateY(180deg)}
      .mem-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        border-radius:14px;backface-visibility:hidden;font-size:clamp(26px,8vw,40px);user-select:none}
      .mem-back{background:linear-gradient(160deg,#1b2350,#0c1024);border:1px solid rgba(94,242,255,.3);color:rgba(94,242,255,.5);font-size:24px}
      .mem-front{background:linear-gradient(160deg,#23284f,#141838);border:1px solid rgba(255,255,255,.12);transform:rotateY(180deg)}
      .mem-card.done .mem-front{border-color:var(--green);box-shadow:0 0 18px rgba(156,255,94,.4)}
    `;
    wrap.appendChild(style);

    const stats = document.createElement('div');
    stats.className = 'mem-stats';
    stats.innerHTML = `<span class="a">MOVES <b id="mm-moves">0</b></span>
      <span>PAIRS <b id="mm-pairs">0/8</b></span><span class="b">TIME <b id="mm-time">0s</b></span>`;
    wrap.appendChild(stats);
    const board = document.createElement('div');
    board.className = 'mem-board';
    wrap.appendChild(board);

    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }

    function build() {
      moves = 0; matched = 0; flipped = []; lock = false; elapsed = 0;
      board.innerHTML = '';
      const pick = shuffle(EMOJIS.slice()).slice(0, 8);
      const deck = shuffle([...pick, ...pick]);
      deck.forEach(sym => {
        const card = document.createElement('div');
        card.className = 'mem-card';
        card.dataset.sym = sym;
        card.innerHTML = `<div class="mem-inner">
          <div class="mem-face mem-back">?</div>
          <div class="mem-face mem-front">${sym}</div></div>`;
        card.addEventListener('click', () => flip(card));
        board.appendChild(card);
      });
      sync();
    }
    function sync() {
      document.getElementById('mm-moves').textContent = moves;
      document.getElementById('mm-pairs').textContent = matched + '/8';
      document.getElementById('mm-time').textContent = Math.floor(elapsed / 1000) + 's';
    }
    function flip(card) {
      if (lock || state !== 'playing' || card.classList.contains('flip') || flipped.includes(card)) return;
      card.classList.add('flip'); flipped.push(card);
      if (flipped.length === 2) {
        moves++; sync(); lock = true;
        const [a, b] = flipped;
        if (a.dataset.sym === b.dataset.sym) {
          a.classList.add('done'); b.classList.add('done');
          matched++; flipped = []; lock = false; sync();
          if (matched === 8) win();
        } else {
          setTimeout(() => { a.classList.remove('flip'); b.classList.remove('flip'); flipped = []; lock = false; }, 750);
        }
      }
    }
    function showMenu() {
      state = 'menu'; if (activeTimer) clearInterval(activeTimer);
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Memory Match</h2>
        <p class="msg">Flip two tiles at a time to find all 8 emoji pairs. Try to finish in as few moves
        and as little time as possible. Your best (fewest moves) is saved.</p>
        <button class="btn alt" data-act="play">PLAY ▸</button>`;
    }
    function play() {
      build(); state = 'playing'; ov.classList.add('hidden');
      if (activeTimer) clearInterval(activeTimer);
      const t0 = performance.now();
      activeTimer = setInterval(() => { if (state === 'playing') { elapsed = performance.now() - t0; sync(); } }, 250);
    }
    function win() {
      state = 'over'; if (activeTimer) clearInterval(activeTimer);
      // score: lower moves is better -> store best as "fewest moves" via inverted metric.
      const prevBest = api.getBest('memory'); // stored as 1000 - moves (higher = better)
      const metric = Math.max(0, 1000 - moves);
      const isBest = api.setBest('memory', metric);
      const bestMoves = api.getBest('memory') ? 1000 - api.getBest('memory') : moves;
      setTimeout(() => {
        ov.classList.remove('hidden');
        ov.innerHTML = `<h2>Solved! 🎉</h2>
          <div class="stat-row">
            <div class="stat"><span class="v">${moves}</span><span class="l">Moves</span></div>
            <div class="stat"><span class="v">${Math.floor(elapsed / 1000)}s</span><span class="l">Time</span></div>
            <div class="stat"><span class="v">${bestMoves}</span><span class="l">Best Moves</span></div>
          </div>
          ${isBest ? '<div class="new-best">★ FEWEST MOVES YET! ★</div>' : '<div style="height:20px"></div>'}
          <button class="btn alt" data-act="play">PLAY AGAIN ↻</button>`;
      }, 450);
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') play(); });

    showMenu();
  },

  stop() { if (activeTimer) { clearInterval(activeTimer); activeTimer = null; } },
});
})();

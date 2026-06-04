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
    const DIFF = { easy: { pairs: 6, cols: 4, label: 'Easy' }, normal: { pairs: 8, cols: 4, label: 'Normal' }, hard: { pairs: 10, cols: 5, label: 'Hard' } };
    let moves, matched, flipped, lock, elapsed, state, difficulty = 'normal', pairCount;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;width:100%;height:100%;justify-content:center;padding:70px 16px 20px';
    root.appendChild(wrap);

    const ov = document.createElement('div');
    ov.className = 'center-overlay'; root.appendChild(ov);

    const style = document.createElement('style');
    style.textContent = `
      .mem-stats{display:flex;gap:30px;font-weight:800;font-size:clamp(15px,4vw,20px)}
      .mem-stats .a{color:var(--accent)} .mem-stats .b{color:var(--gold)}
      .mem-board{display:grid;gap:10px;width:min(92vw,460px)}
      .mem-card{aspect-ratio:1;position:relative;cursor:pointer;perspective:600px;border:0;background:none;padding:0;font:inherit}
      .mem-inner{position:absolute;inset:0;transition:transform .35s;transform-style:preserve-3d}
      .mem-card.flip .mem-inner{transform:rotateY(180deg)}
      .mem-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        border-radius:14px;backface-visibility:hidden;font-size:clamp(26px,8vw,40px);user-select:none}
      .mem-back{background:linear-gradient(160deg,#1b2350,#0c1024);border:1px solid rgba(94,242,255,.3);color:rgba(94,242,255,.5);font-size:24px}
      .mem-front{background:linear-gradient(160deg,#23284f,#141838);border:1px solid rgba(255,255,255,.12);transform:rotateY(180deg)}
      .mem-card.done .mem-front{border-color:var(--green);box-shadow:0 0 18px rgba(156,255,94,.4)}
      .mem-modes{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
      .mem-modes .btn{font-size:14px;padding:10px 18px}
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
      pairCount = DIFF[difficulty].pairs;
      moves = 0; matched = 0; flipped = []; lock = true; elapsed = 0;
      board.innerHTML = '';
      board.style.gridTemplateColumns = `repeat(${DIFF[difficulty].cols},1fr)`;
      const pick = shuffle(EMOJIS.slice()).slice(0, pairCount);
      const deck = shuffle([...pick, ...pick]);
      deck.forEach(sym => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'mem-card';
        card.dataset.sym = sym;
        card.setAttribute('aria-label', 'Hidden memory card');
        card.innerHTML = `<div class="mem-inner">
          <div class="mem-face mem-back">?</div>
          <div class="mem-face mem-front">${sym}</div></div>`;
        card.addEventListener('click', () => flip(card));
        board.appendChild(card);
      });
      board.querySelectorAll('.mem-card').forEach(c => c.classList.add('flip'));
      setTimeout(() => {
        board.querySelectorAll('.mem-card:not(.done)').forEach(c => c.classList.remove('flip'));
        lock = false;
      }, difficulty === 'hard' ? 650 : 900);
      sync();
    }
    function sync() {
      document.getElementById('mm-moves').textContent = moves;
      document.getElementById('mm-pairs').textContent = matched + '/' + (pairCount || DIFF[difficulty].pairs);
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
          if (matched === pairCount) win();
        } else {
          setTimeout(() => { a.classList.remove('flip'); b.classList.remove('flip'); flipped = []; lock = false; }, 750);
        }
      }
    }
    function showMenu() {
      state = 'menu'; if (activeTimer) clearInterval(activeTimer);
      ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Memory Match</h2>
        <p class="msg">Pick a board size, study the quick preview, then find every pair in as few moves as possible.</p>
        <button class="btn alt" data-act="play">PLAY ▸</button>`;
      ov.querySelector('.msg').insertAdjacentHTML('afterend', `<div class="mem-modes">
        <button class="btn alt" data-act="play" data-diff="easy">Easy 6</button>
        <button class="btn alt" data-act="play" data-diff="normal">Normal 8</button>
        <button class="btn alt" data-act="play" data-diff="hard">Hard 10</button>
      </div>`);
    }
    function play() {
      build(); state = 'playing'; ov.classList.add('hidden');
      if (activeTimer) clearInterval(activeTimer);
      const t0 = performance.now();
      activeTimer = setInterval(() => { if (state === 'playing') { elapsed = performance.now() - t0; sync(); } }, 250);
    }
    function win() {
      state = 'over'; if (activeTimer) clearInterval(activeTimer);
      const key = 'memory_' + difficulty;
      const metric = Math.max(0, 2000 - moves * 20 - Math.floor(elapsed / 1000));
      const isBest = api.setBest(key, metric);
      api.setBest('memory', metric);
      const bestMetric = api.getBest(key);
      setTimeout(() => {
        ov.classList.remove('hidden');
        ov.innerHTML = `<h2>Solved! 🎉</h2>
          <div class="stat-row">
            <div class="stat"><span class="v">${moves}</span><span class="l">Moves</span></div>
            <div class="stat"><span class="v">${Math.floor(elapsed / 1000)}s</span><span class="l">Time</span></div>
            <div class="stat"><span class="v">${bestMetric}</span><span class="l">${DIFF[difficulty].label} Best</span></div>
          </div>
          ${isBest ? '<div class="new-best">★ FEWEST MOVES YET! ★</div>' : '<div style="height:20px"></div>'}
          <button class="btn alt" data-act="play">PLAY AGAIN ↻</button>`;
      }, 450);
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') { difficulty = e.target.dataset.diff || difficulty; play(); } });

    showMenu();
  },

  stop() { if (activeTimer) { clearInterval(activeTimer); activeTimer = null; } },
});
})();

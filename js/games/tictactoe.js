/* Tic-Tac-Toe — you (X) vs a minimax AI you can't beat (but can draw). */
Arcade.register({
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',
  emoji: '⭕',
  desc: 'Take on a flawless minimax AI. You can\'t win… but can you force a draw every time?',
  color: '#5ef2ff',

  start(root, api) {
    let board, gameDone, turnHuman, difficulty;
    const HUMAN = 'X', AI = 'O';

    const style = document.createElement('style');
    style.textContent = `
      .ttt-wrap{display:flex;flex-direction:column;align-items:center;gap:18px;padding:70px 16px 20px}
      .ttt-status{font-weight:800;font-size:clamp(17px,4.5vw,24px);min-height:30px;text-align:center}
      .ttt-status .x{color:var(--accent)} .ttt-status .o{color:var(--accent2)}
      .ttt-board{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:min(86vw,360px)}
      .ttt-cell{aspect-ratio:1;background:linear-gradient(160deg,#161c3c,#0b0f22);border:1px solid rgba(255,255,255,.1);
        border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:clamp(40px,13vw,64px);
        font-weight:900;cursor:pointer;transition:background .15s,transform .1s;user-select:none}
      .ttt-cell:hover:not(.taken){background:rgba(94,242,255,.12)}
      .ttt-cell.taken{cursor:default}
      .ttt-cell.x{color:var(--accent);text-shadow:0 0 14px rgba(94,242,255,.6)}
      .ttt-cell.o{color:var(--accent2);text-shadow:0 0 14px rgba(255,94,196,.6)}
      .ttt-cell.win{background:rgba(255,212,94,.22);animation:pulse 1s infinite}
      .ttt-score{display:flex;gap:24px;font-weight:800;font-size:15px}
      .ttt-score .w{color:var(--green)} .ttt-score .l{color:var(--accent2)} .ttt-score .d{color:var(--gold)}
    `;
    root.appendChild(style);

    const wrap = document.createElement('div'); wrap.className = 'ttt-wrap'; root.appendChild(wrap);
    const status = document.createElement('div'); status.className = 'ttt-status';
    const grid = document.createElement('div'); grid.className = 'ttt-board';
    const scoreEl = document.createElement('div'); scoreEl.className = 'ttt-score';
    const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'New Game ↻';
    wrap.append(status, grid, scoreEl, btn);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);

    const cells = [];
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('div'); c.className = 'ttt-cell'; c.dataset.i = i;
      c.addEventListener('click', () => humanMove(i));
      grid.appendChild(c); cells.push(c);
    }

    const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    let wins = api.getBest('ttt_w'), losses = api.getBest('ttt_l'), draws = api.getBest('ttt_d');

    function setScore(k, v) { try { localStorage.setItem('arcade_' + k, v); } catch (e) {} }
    function syncScore() {
      scoreEl.innerHTML = `<span class="w">WINS ${wins}</span><span class="l">LOSSES ${losses}</span><span class="d">DRAWS ${draws}</span>`;
    }

    function winner(b) {
      for (const [a, c, d] of WINS) if (b[a] && b[a] === b[c] && b[a] === b[d]) return { who: b[a], line: [a, c, d] };
      if (b.every(x => x)) return { who: 'draw', line: null };
      return null;
    }
    function render(winLine) {
      board.forEach((v, i) => {
        const c = cells[i];
        c.textContent = v || '';
        c.classList.toggle('taken', !!v);
        c.classList.toggle('x', v === HUMAN);
        c.classList.toggle('o', v === AI);
        c.classList.toggle('win', !!(winLine && winLine.includes(i)));
      });
    }
    function setStatus(html) { status.innerHTML = html; }

    function newGame() {
      board = Array(9).fill(''); gameDone = false; turnHuman = true;
      render(null); setStatus('Your move — you are <span class="x">X</span>');
    }
    function humanMove(i) {
      if (gameDone || !turnHuman || board[i]) return;
      board[i] = HUMAN; turnHuman = false; render(null);
      if (checkEnd()) return;
      setStatus('AI is thinking…');
      setTimeout(aiMove, 280);
    }
    function aiMove() {
      if (gameDone) return;
      const move = best(board);
      board[move] = AI; turnHuman = true; render(null);
      if (checkEnd()) return;
      setStatus('Your move — you are <span class="x">X</span>');
    }
    function checkEnd() {
      const res = winner(board);
      if (!res) return false;
      gameDone = true;
      render(res.line);
      if (res.who === HUMAN) { wins++; setScore('ttt_w', wins); finish('You win! 🎉', 'How… did you manage that?'); }
      else if (res.who === AI) { losses++; setScore('ttt_l', losses); finish('AI wins', 'The machine prevails. Try to block its lines.'); }
      else { draws++; setScore('ttt_d', draws); finish('Draw 🤝', 'A perfect game. That\'s the best you can do here!'); }
      syncScore();
      return true;
    }
    function finish(title, msg) {
      setTimeout(() => {
        ov.classList.remove('hidden');
        ov.innerHTML = `<h2>${title}</h2><p class="msg">${msg}</p>
          <button class="btn" data-act="play">PLAY AGAIN ↻</button>`;
      }, 600);
    }
    ov.addEventListener('click', e => { if (e.target.dataset.act === 'play') { ov.classList.add('hidden'); newGame(); } });
    btn.addEventListener('click', () => { ov.classList.add('hidden'); newGame(); });

    // minimax
    function best(b) {
      let bestScore = -Infinity, move = -1;
      for (let i = 0; i < 9; i++) if (!b[i]) {
        b[i] = AI; const s = minimax(b, 0, false); b[i] = '';
        if (s > bestScore) { bestScore = s; move = i; }
      }
      return move;
    }
    function minimax(b, depth, maxing) {
      const res = winner(b);
      if (res) { if (res.who === AI) return 10 - depth; if (res.who === HUMAN) return depth - 10; return 0; }
      if (maxing) {
        let best = -Infinity;
        for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = AI; best = Math.max(best, minimax(b, depth + 1, false)); b[i] = ''; }
        return best;
      } else {
        let best = Infinity;
        for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = HUMAN; best = Math.min(best, minimax(b, depth + 1, true)); b[i] = ''; }
        return best;
      }
    }

    syncScore();
    newGame();
  },
});

/* Four in a Row — Connect Four against an AlphaZero-style AI.
   The AI runs MCTS (PUCT) guided by a small policy+value network trained from
   self-play (ai/connect4 -> connect4-weights.json). Leaf positions
   are scored by blending the network's value with a quick random rollout, so the
   AI is strong even before the net loads. The search runs incrementally across
   frames, and you can watch its column preferences ("thinking") build live. */
Arcade.register({
  id: 'connect4',
  name: 'Four in a Row',
  emoji: '🔴',
  desc: 'Connect Four against an AlphaZero-style AI that learned from self-play. Watch it think, then try to beat it.',
  color: '#5ef2ff',

  start(root, api) {
    const COLS = 7, ROWS = 6, NC = COLS * ROWS, IN = NC * 2;
    let W = 0, H = 0, cell = 0, bx = 0, by = 0, bw = 0, bh = 0;
    let learning = false;

    const view = api.makeCanvas(root, { onResize: layout });
    const ctx = view.ctx;
    const perf = api.perf;
    function layout(v) {
      W = v.w; H = v.h;
      const teachSpace = learning ? Math.min(190, H * 0.32) : 0;
      const topSpace = Math.min(132, Math.max(82, H * 0.1));
      const bottomSpace = teachSpace + Math.max(18, H * 0.025);
      const arenaH = Math.max(240, H - topSpace - bottomSpace);
      const maxW = Math.min(W * 0.94, 560), maxH = Math.max(240, arenaH);
      cell = Math.min(maxW / COLS, maxH / (ROWS + 1));
      bw = cell * COLS; bh = cell * ROWS; bx = (W - bw) / 2;
      by = topSpace + Math.max(0, (arenaH - bh) * 0.35) + cell * 0.12;
    }
    layout(view);

    const ov = document.createElement('div'); ov.className = 'center-overlay'; root.appendChild(ov);
    const hud = document.createElement('div'); hud.className = 'hud c4-hud'; hud.style.display = 'none';
    hud.innerHTML = `<span class="a">YOU <b id="c4-you">0</b></span><span id="c4-turn">—</span><span class="b">AI <b id="c4-ai">0</b></span>`;
    root.appendChild(hud);
    const coach = document.createElement('div'); coach.className = 'c4-coach hidden'; root.appendChild(coach);

    // ---------- game logic ----------
    const newBoard = () => new Int8Array(NC);
    const legal = b => { const m = []; for (let c = 0; c < COLS; c++) if (!b[(ROWS - 1) * COLS + c]) m.push(c); return m; };
    function drop(b, c, p) { let r = 0; while (r < ROWS && b[r * COLS + c]) r++; if (r >= ROWS) return -1; b[r * COLS + c] = p; return r; }
    function winLine(b, c, r, p) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const line = [[r, c]];
        for (const s of [1, -1]) { let rr = r + dr * s, cc = c + dc * s; while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) { line.push([rr, cc]); rr += dr * s; cc += dc * s; } }
        if (line.length >= 4) return line;
      }
      return null;
    }
    const encode = (b, pl) => { const x = new Float32Array(IN), opp = pl === 1 ? 2 : 1; for (let i = 0; i < NC; i++) { if (b[i] === pl) x[i] = 1; else if (b[i] === opp) x[NC + i] = 1; } return x; };

    const lines = [];
    const addLine = (c, r, dc, dr) => { const line = []; for (let i = 0; i < 4; i++) line.push({ c: c + dc * i, r: r + dr * i }); lines.push(line); };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c <= COLS - 4; c++) addLine(c, r, 1, 0);
    for (let c = 0; c < COLS; c++) for (let r = 0; r <= ROWS - 4; r++) addLine(c, r, 0, 1);
    for (let c = 0; c <= COLS - 4; c++) for (let r = 0; r <= ROWS - 4; r++) addLine(c, r, 1, 1);
    for (let c = 0; c <= COLS - 4; c++) for (let r = 3; r < ROWS; r++) addLine(c, r, 1, -1);
    const other = p => p === 1 ? 2 : 1;
    const countPieces = b => { let n = 0; for (const p of b) if (p) n++; return n; };
    const heightAt = (b, c) => { let r = 0; while (r < ROWS && b[r * COLS + c]) r++; return r; };
    const colList = cols => cols.map(c => c + 1).join(', ');
    const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    function winningMoves(b, p) {
      return legal(b).filter(c => {
        const nb = Int8Array.from(b), r = drop(nb, c, p);
        return r >= 0 && !!winLine(nb, c, r, p);
      });
    }
    function collectThreats(b, p) {
      const opp = other(p), seen = new Set(), out = [];
      for (const line of lines) {
        let own = 0, blocked = 0, empty = null;
        for (const cell of line) {
          const v = b[cell.r * COLS + cell.c];
          if (v === p) own++;
          else if (v === opp) blocked++;
          else empty = cell;
        }
        if (own === 3 && blocked === 0 && empty) {
          const key = `${empty.c}:${empty.r}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ c: empty.c, r: empty.r, playable: heightAt(b, empty.c) === empty.r, odd: empty.r % 2 === 0 });
        }
      }
      return out;
    }
    function potentialScore(b, p) {
      const opp = other(p), weights = [0, 2, 14, 80, 5000];
      let score = 0;
      for (const line of lines) {
        let own = 0, enemy = 0;
        for (const cell of line) {
          const v = b[cell.r * COLS + cell.c];
          if (v === p) own++;
          else if (v === opp) enemy++;
        }
        if (own && enemy) continue;
        if (own) score += weights[own];
        if (enemy) score -= weights[enemy] * 1.08;
      }
      return score;
    }
    function policyPriors(b, p, moves) {
      if (!net) return null;
      const fwd = forward(b, p);
      let mx = -Infinity, sum = 0;
      for (const m of moves) mx = Math.max(mx, fwd.pl[m]);
      const pr = {};
      for (const m of moves) { pr[m] = Math.exp(fwd.pl[m] - mx); sum += pr[m]; }
      for (const m of moves) pr[m] /= sum || 1;
      return pr;
    }
    function moveReport(b, p, move, priors, oppWinsNow) {
      const opp = other(p), nb = Int8Array.from(b), row = drop(nb, move, p);
      const winsNow = row >= 0 && !!winLine(nb, move, row, p);
      const blocks = oppWinsNow.includes(move);
      const replies = winsNow ? [] : winningMoves(nb, opp);
      const nextWins = winsNow ? [] : winningMoves(nb, p);
      const threats = winsNow ? [] : collectThreats(nb, p);
      const center = 3 - Math.abs(3 - move);
      const modelPrior = priors ? priors[move] || 0 : 0;
      let modelValue = 0;
      if (net && !winsNow) modelValue = forward(nb, opp).value;
      let score = potentialScore(nb, p) + center * 24 + modelPrior * 180 - modelValue * 120;
      if (winsNow) score += 100000;
      if (oppWinsNow.length && blocks) score += 70000 / oppWinsNow.length;
      if (oppWinsNow.length && !blocks) score -= 90000;
      if (replies.length) score -= 70000 + replies.length * 8000;
      if (nextWins.length >= 2) score += 52000;
      else if (nextWins.length === 1) score += 5600;
      const playableThreats = threats.filter(t => t.playable);
      score += playableThreats.length * 3200 + threats.length * 260;
      const labels = [];
      if (winsNow) labels.push('wins now');
      if (blocks) labels.push('blocks');
      if (nextWins.length >= 2) labels.push('fork');
      if (replies.length) labels.push('unsafe');
      if (!labels.length && move === 3) labels.push('center');
      if (!labels.length && Math.abs(move - 3) <= 1) labels.push('near center');
      if (!labels.length && modelPrior > 0.18) labels.push('model likes');
      return { move, row, score, winsNow, blocks, replies, nextWins, threats, playableThreats, center, modelPrior, modelValue, labels };
    }
    function explainReport(r) {
      if (!r) return '';
      const col = r.move + 1;
      if (r.winsNow) return `Column ${col} wins immediately. Take the finish.`;
      if (r.replies.length) return `Column ${col} is risky because the AI can answer in column ${colList(r.replies)}.`;
      if (r.blocks) return `Column ${col} blocks the immediate threat. Boring defense is good defense here.`;
      if (r.nextWins.length >= 2) return `Column ${col} creates a fork: next turn you threaten columns ${colList(r.nextWins)}.`;
      if (r.nextWins.length === 1) return `Column ${col} creates a direct threat in column ${colList(r.nextWins)}.`;
      if (r.playableThreats.length) return `Column ${col} adds a playable threat while staying safe.`;
      if (r.move === 3) return `Column ${col} keeps the center, which touches the most four-in-a-row lines.`;
      if (Math.abs(r.move - 3) <= 1) return `Column ${col} stays near the center and keeps diagonal options open.`;
      return `Column ${col} is playable, but it gives you fewer central connections than the best lanes.`;
    }
    function coachInfo() {
      if (!board || state !== 'playing') return null;
      if (turn !== you) return {
        headline: 'Watch the search bars.',
        lesson: 'The gold bars show where the AI search is spending visits. Big bars usually mean the move is tactically important.',
        tags: ['tempo', 'search', 'defense'],
        ranked: [],
      };
      const moves = legal(board), priors = policyPriors(board, you, moves), oppWins = winningMoves(board, ai), youWins = winningMoves(board, you);
      const ranked = moves.map(m => moveReport(board, you, m, priors, oppWins)).sort((a, b) => b.score - a.score);
      const best = youWins.length ? ranked.find(r => r.move === youWins[0]) : ranked[0];
      const moveCount = countPieces(board);
      const ourThreats = collectThreats(board, you), theirThreats = collectThreats(board, ai);
      const tags = [];
      let headline = 'Build a safe plan.', lesson = 'First ask: do I win now, do I need to block, and does my move give them an instant reply?';
      if (youWins.length) { headline = `Finish in column ${youWins[0] + 1}.`; lesson = 'Immediate wins outrank every positional idea.'; tags.push('win now'); }
      else if (oppWins.length > 1) { headline = `Danger: columns ${colList(oppWins)} both win for AI.`; lesson = 'When the opponent has two immediate wins, one block is not enough. Look for your own forcing move.'; tags.push('double threat'); }
      else if (oppWins.length === 1) { headline = `Block column ${oppWins[0] + 1}.`; lesson = 'Before building a cool trap, erase the threat that already wins next move.'; tags.push('block'); }
      else if (best && best.nextWins.length >= 2) { headline = `Try column ${best.move + 1} for a fork.`; lesson = 'A fork makes two winning threats at once. Your opponent can usually stop only one.'; tags.push('fork'); }
      else if (moveCount < 6) { headline = best && best.move === 3 ? 'Own the center early.' : `Column ${best.move + 1} is the cleanest start.`; lesson = 'Center pieces connect horizontally and diagonally in more ways than edge pieces.'; tags.push('center'); }
      else if (best && best.playableThreats.length) { headline = `Column ${best.move + 1} keeps initiative.`; lesson = 'Initiative means your move asks a question the opponent has to answer.'; tags.push('initiative'); }
      else if (best) { headline = `Best safe lane: column ${best.move + 1}.`; lesson = explainReport(best); tags.push('safe move'); }
      const oddThreat = ourThreats.find(t => t.odd), evenThreat = theirThreats.find(t => !t.odd);
      if (oddThreat && tags.length < 3) tags.push('odd threat');
      if (evenThreat && tags.length < 3) tags.push('even threat');
      if (priors && best && best.modelPrior > 0.18 && tags.length < 3) tags.push('model nudge');
      return { headline, lesson, tags: tags.slice(0, 3), ranked, best, ourThreats, theirThreats };
    }

    // ---------- network ----------
    let net = null, modelMeta = null, modelStatus = 'Loading local model...';
    fetch('./js/games/connect4-weights.json').then(r => r.json()).then(w => {
      modelMeta = w.meta || {};
      net = { W1: f(w.W1), b1: f(w.b1), W2: f(w.W2), b2: f(w.b2), Wp: f(w.Wp), bp: f(w.bp), Wv: f(w.Wv), bv: f(w.bv), H1: modelMeta.h1, H2: modelMeta.h2 };
      dirtyCoach();
      if (state === 'menu') showMenu();
      else if (state === 'playing') syncCoach();
    }).catch(() => {
      net = null;
      modelStatus = 'Weights unavailable; using rollout search fallback.';
      dirtyCoach();
      if (state === 'menu') showMenu();
      else if (state === 'playing') syncCoach();
    });
    function f(a) { return Float32Array.from(a); }
    function modelText() {
      if (!modelMeta) return modelStatus;
      const parts = [];
      if (modelMeta.iters) parts.push(`${modelMeta.iters} train iters`);
      if (modelMeta.games) parts.push(`${modelMeta.games} games/iter`);
      if (modelMeta.sims) parts.push(`${modelMeta.sims} sims/search`);
      return `Local model loaded: ${parts.join(', ') || 'weights ready'}.`;
    }
    function forward(b, pl) {
      const x = encode(b, pl), H1 = net.H1, H2 = net.H2;
      const h1 = new Float32Array(H1); for (let i = 0; i < H1; i++) { let s = net.b1[i]; const base = i * IN; for (let j = 0; j < IN; j++) s += net.W1[base + j] * x[j]; h1[i] = s > 0 ? s : 0; }
      const h2 = new Float32Array(H2); for (let i = 0; i < H2; i++) { let s = net.b2[i]; const base = i * H1; for (let j = 0; j < H1; j++) s += net.W2[base + j] * h1[j]; h2[i] = s > 0 ? s : 0; }
      const pl2 = new Float32Array(COLS); for (let i = 0; i < COLS; i++) { let s = net.bp[i]; const base = i * H2; for (let j = 0; j < H2; j++) s += net.Wp[base + j] * h2[j]; pl2[i] = s; }
      let vs = net.bv[0]; for (let j = 0; j < H2; j++) vs += net.Wv[j] * h2[j];
      return { pl: pl2, value: Math.tanh(vs) };
    }
    function rollout(b, player) {
      const bb = Int8Array.from(b); let p = player;
      for (;;) { const m = legal(bb); if (!m.length) return 0; const c = m[(Math.random() * m.length) | 0], r = drop(bb, c, p); if (winLine(bb, c, r, p)) return p === player ? 1 : -1; p = p === 1 ? 2 : 1; }
    }
    const CPUCT = 1.6, ROLLOUT_W = 0.5;
    function leafEval(b, player, moves) {
      if (!net) { const pr = {}; for (const m of moves) pr[m] = 1 / moves.length; return { priors: pr, v: rollout(b, player) }; }
      const fr = forward(b, player); let mx = -Infinity; for (const m of moves) mx = Math.max(mx, fr.pl[m]);
      let sum = 0; const pr = {}; for (const m of moves) { pr[m] = Math.exp(fr.pl[m] - mx); sum += pr[m]; } for (const m of moves) pr[m] /= sum;
      return { priors: pr, v: (1 - ROLLOUT_W) * fr.value + ROLLOUT_W * rollout(b, player) };
    }
    // incremental MCTS. search(node) returns value for the player to move at node.
    function search(node) {
      if (node.terminal !== undefined) return node.terminal;
      if (!node.children) {
        const moves = legal(node.board);
        if (!moves.length) { node.terminal = 0; return 0; }
        const ev = leafEval(node.board, node.player, moves);
        node.children = {}; for (const m of moves) node.children[m] = { move: m, N: 0, Wv: 0, P: ev.priors[m], child: null };
        node.N = (node.N || 0) + 1; return ev.v;
      }
      let best = null, bestU = -Infinity; const sq = Math.sqrt(Math.max(1, node.N));
      for (const m in node.children) { const e = node.children[m], q = e.N ? e.Wv / e.N : 0, u = q + CPUCT * e.P * sq / (1 + e.N); if (u > bestU) { bestU = u; best = e; } }
      if (!best.child) {
        const nb = Int8Array.from(node.board), r = drop(nb, best.move, node.player), other = node.player === 1 ? 2 : 1;
        if (winLine(nb, best.move, r, node.player)) best.child = { board: nb, player: other, terminal: -1 };
        else if (!legal(nb).length) best.child = { board: nb, player: other, terminal: 0 };
        else best.child = { board: nb, player: other, children: null, N: 0 };
      }
      const v = -search(best.child);
      best.N++; best.Wv += v; node.N = (node.N || 0) + 1; return v;
    }
    const visits = root => { const a = new Array(COLS).fill(0); if (root.children) for (const m in root.children) a[m] = root.children[m].N; return a; };

    // ---------- state ----------
    let board, turn, you, ai, state, win, anim, aiRoot, aiSims, aiTarget, aiVisits, aiThinking, aiWorker, aiJobId = 0, hoverCol, youScore, aiScore, streak, result;
    let coachCache = null, coachKey = '';
    function setTurnLabel() { const el = document.getElementById('c4-turn'); if (el) el.textContent = state === 'over' ? '·' : (turn === you ? 'YOUR TURN' : 'AI THINKING…'); }
    function sync() { document.getElementById('c4-you').textContent = youScore; document.getElementById('c4-ai').textContent = aiScore; setTurnLabel(); syncCoach(); }
    function dirtyCoach() { coachCache = null; coachKey = ''; }
    function stopAiWorker() {
      if (!aiWorker) return;
      try { aiWorker.terminate(); } catch (e) {}
      aiWorker = null;
      aiThinking = false;
      aiVisits = null;
    }
    function ensureAiWorker() {
      if (aiWorker) return true;
      if (!window.Worker) return false;
      try {
        aiWorker = new Worker('js/games/connect4-worker.js?v=1');
        aiWorker.onmessage = e => {
          const msg = e.data || {};
          if (msg.id !== aiJobId) return;
          if (msg.type === 'progress') {
            aiVisits = msg.visits;
          } else if (msg.type === 'done') {
            aiThinking = false;
            aiVisits = msg.visits || aiVisits;
            if (state !== 'playing' || turn !== ai || anim) return;
            const moves = legal(board);
            const move = moves.includes(msg.move) ? msg.move : moves[(Math.random() * moves.length) | 0];
            startDrop(move, ai, () => afterMove(move, ai));
          }
        };
        aiWorker.onerror = () => {
          stopAiWorker();
          aiRoot = null;
          aiSims = 0;
        };
        if (api.onCleanup) api.onCleanup(stopAiWorker);
        return true;
      } catch (e) {
        aiWorker = null;
        return false;
      }
    }
    function cancelAiSearch() {
      aiJobId++;
      aiThinking = false;
      aiVisits = null;
      if (aiWorker) {
        try { aiWorker.postMessage({ type: 'cancel', id: aiJobId }); } catch (e) {}
      }
    }
    function startWorkerSearch() {
      aiThinking = true;
      aiVisits = new Array(COLS).fill(0);
      const id = ++aiJobId;
      aiWorker.postMessage({
        type: 'search',
        id,
        board: Array.from(board),
        ai,
        target: aiTarget,
        aiScale: perf.quality().ai,
      });
    }
    function currentCoachInfo() {
      if (!board) return null;
      const key = `${turn}|${Array.from(board).join('')}`;
      if (key !== coachKey) { coachCache = coachInfo(); coachKey = key; }
      return coachCache;
    }
    function renderMovePills(info) {
      if (!info || !info.ranked.length) return '';
      return `<div class="c4-moves">${info.ranked.slice(0, 4).map((r, i) => {
        const tone = r.winsNow || i === 0 ? 'best' : r.replies.length ? 'warn' : r.blocks ? 'block' : '';
        const label = r.labels[0] || 'playable';
        return `<span class="c4-move ${tone}"><b>${r.move + 1}</b><small>${html(label)}</small></span>`;
      }).join('')}</div>`;
    }
    function syncCoach() {
      if (!learning || state !== 'playing') { coach.classList.add('hidden'); return; }
      const info = currentCoachInfo();
      if (!info) { coach.classList.add('hidden'); return; }
      const hover = info.ranked && hoverCol >= 0 ? info.ranked.find(r => r.move === hoverCol) : null;
      coach.classList.remove('hidden');
      coach.innerHTML = `<div class="c4-coach-head"><b>Coach</b><span>${turn === you ? 'your move' : 'AI move'}</span></div>
        <div class="c4-coach-title">${html(info.headline)}</div>
        <div class="c4-coach-copy">${html(hover ? explainReport(hover) : info.lesson)}</div>
        ${info.tags && info.tags.length ? `<div class="c4-tags">${info.tags.map(t => `<span>${html(t)}</span>`).join('')}</div>` : ''}
        ${renderMovePills(info)}`;
    }

    function showMenu() {
      learning = false; coach.classList.add('hidden'); layout(view);
      state = 'menu'; hud.style.display = 'none'; ov.classList.remove('hidden');
      ov.innerHTML = `<h2>Four in a Row</h2>
        <p class="msg">Drop discs and connect four. You're <b style="color:#5ef2ff">cyan</b>; the AI is
        <b style="color:#ffb65e">gold</b> and runs Monte-Carlo Tree Search guided by a net it trained against itself —
        the bars above the board show what it's considering. Pick a strength:</p>
        <p class="msg"><b>AI lab:</b> ${modelText()}</p>
        <p class="msg">Learning mode adds live coaching: best safe columns, blunder warnings, forks, and center-control tips.</p>
        <button class="btn" data-act="140">RELAXED</button>
        <button class="btn" data-act="500">SHARP</button>
        <button class="btn alt" data-act="1400">RUTHLESS</button>
        <button class="btn" data-act="learn">LEARNING MODE</button>`;
    }
    function play(sims, teach) {
      learning = !!teach; layout(view); coach.classList.toggle('hidden', !learning);
      dirtyCoach();
      cancelAiSearch();
      board = newBoard(); you = 1; ai = 2; turn = 1; win = null; anim = null; aiRoot = null; aiSims = 0; aiTarget = sims; result = null;
      if (youScore == null) { youScore = 0; aiScore = 0; streak = 0; }
      state = 'playing'; ov.classList.add('hidden'); hud.style.display = 'flex'; sync();
    }
    function gameOver(winner) {
      cancelAiSearch();
      state = 'over'; result = winner; setTurnLabel();
      coach.classList.add('hidden');
      if (winner === you) { youScore++; streak++; if (api.setBest('connect4', streak)) {} } else if (winner === ai) { aiScore++; streak = 0; }
      sync();
      const title = winner === you ? 'You win! 🎉' : winner === ai ? 'AI wins' : 'Draw';
      hud.style.display = 'flex';
      setTimeout(() => {
        if (state !== 'over') return;
        ov.classList.remove('hidden');
        ov.innerHTML = `<h2>${title}</h2>
          <div class="stat-row">
            <div class="stat"><span class="v">${youScore}</span><span class="l">You</span></div>
            <div class="stat"><span class="v">${aiScore}</span><span class="l">AI</span></div>
            <div class="stat"><span class="v">${api.getBest('connect4')}</span><span class="l">Best streak</span></div>
          </div>
          <button class="btn" data-act="${aiTarget}" data-learn="${learning ? '1' : '0'}">REMATCH ↻</button>
          <button class="btn alt" data-act="menu">CHANGE LEVEL</button>`;
      }, 900);
    }
    ov.addEventListener('click', e => {
      const a = e.target.dataset.act; if (!a) return;
      if (a === 'menu') showMenu();
      else if (a === 'learn') play(140, true);
      else play(parseInt(a, 10), e.target.dataset.learn === '1');
    });

    // ---------- input ----------
    const colAt = cx => { const c = Math.floor((cx - bx) / cell); return c >= 0 && c < COLS ? c : -1; };
    api.on(view.canvas, 'pointermove', e => {
      const next = state === 'playing' && turn === you && !anim ? colAt(e.clientX) : -1;
      if (next !== hoverCol) { hoverCol = next; syncCoach(); }
    });
    api.on(view.canvas, 'pointerleave', () => { hoverCol = -1; syncCoach(); });
    api.on(view.canvas, 'pointerdown', e => {
      if (state !== 'playing' || turn !== you || anim) return;
      const c = colAt(e.clientX); if (c < 0 || !legal(board).includes(c)) return;
      humanMove(c);
    });

    function humanMove(c) { startDrop(c, you, () => { afterMove(c, you); }); }
    function startDrop(c, p, done) {
      let r = 0; while (r < ROWS && board[r * COLS + c]) r++;
      anim = { c, r, p, y: by - cell * 0.5, vy: 0, targetY: by + (ROWS - 1 - r) * cell + cell / 2, done };
    }
    function afterMove(c, p) {
      const r = (() => { for (let rr = ROWS - 1; rr >= 0; rr--) if (board[rr * COLS + c] === p) return rr; return 0; })();
      const line = winLine(board, c, r, p);
      if (line) { win = line; gameOver(p); return; }
      if (!legal(board).length) { gameOver(0); return; }
      turn = turn === 1 ? 2 : 1; aiRoot = null; aiSims = 0; aiVisits = null; aiThinking = false; dirtyCoach(); setTurnLabel(); syncCoach();
    }

    // ---------- update ----------
    function update(dt) {
      const frame = Math.min(2.5, dt / 16.7);
      if (anim) {
        anim.vy += cell * 0.045 * frame;
        anim.y += anim.vy * frame;
        if (anim.y >= anim.targetY) { board[anim.r * COLS + anim.c] = anim.p; const d = anim.done; anim = null; d(); }
        return;
      }
      if (state === 'playing' && turn === ai) {
        if (ensureAiWorker()) {
          if (!aiThinking) startWorkerSearch();
          return;
        }
        if (!aiRoot) { aiRoot = { board: Int8Array.from(board), player: ai, children: null, N: 0 }; aiSims = 0; }
        const start = performance.now();
        const aiScale = perf.quality().ai;
        const budget = (aiTarget >= 1000 ? 5.5 : aiTarget >= 500 ? 4.5 : 3.2) * aiScale;
        const maxBatch = Math.max(24, Math.round(90 * aiScale));
        let batch = 0;
        while (aiSims < aiTarget && batch < maxBatch && (batch < 3 || performance.now() - start < budget)) {
          search(aiRoot);
          aiSims++;
          batch++;
        }
        if (aiSims >= aiTarget) {
          const v = visits(aiRoot); let move = -1, bn = -1; for (let c = 0; c < COLS; c++) if (v[c] > bn) { bn = v[c]; move = c; }
          if (move < 0) { const m = legal(board); move = m[(Math.random() * m.length) | 0]; }
          const mv = move; startDrop(mv, ai, () => afterMove(mv, ai));
          aiRoot = null;
        }
      }
    }

    // ---------- render ----------
    function discColor(p, x, y, r) { const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); if (p === 1) { g.addColorStop(0, '#bff6ff'); g.addColorStop(1, '#28b6d8'); } else { g.addColorStop(0, '#ffe6b0'); g.addColorStop(1, '#e8922e'); } return g; }
    function drawLearningHints() {
      if (!learning || state !== 'playing') return;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(11, cell * 0.18)}px "Trebuchet MS", system-ui, sans-serif`;
      for (let c = 0; c < COLS; c++) {
        const x = bx + c * cell + cell / 2;
        ctx.fillStyle = 'rgba(234,242,255,0.6)';
        ctx.fillText(String(c + 1), x, by + bh + cell * 0.28);
      }
      if (turn !== you || anim) { ctx.restore(); return; }
      const info = currentCoachInfo();
      if (!info || !info.ranked.length) { ctx.restore(); return; }
      const best = info.best || info.ranked[0];
      for (const report of info.ranked) {
        if (!report.replies.length) continue;
        const x = bx + report.move * cell;
        ctx.fillStyle = 'rgba(255,94,126,0.2)';
        ctx.fillRect(x + cell * 0.08, by, cell * 0.84, bh);
        ctx.fillStyle = '#ff5e7e';
        ctx.beginPath();
        ctx.moveTo(x + cell * 0.5, by - cell * 0.16);
        ctx.lineTo(x + cell * 0.36, by - cell * 0.38);
        ctx.lineTo(x + cell * 0.64, by - cell * 0.38);
        ctx.closePath();
        ctx.fill();
      }
      if (best) {
        const x = bx + best.move * cell;
        ctx.strokeStyle = '#5ef2ff';
        ctx.lineWidth = Math.max(2, cell * 0.045);
        ctx.strokeRect(x + cell * 0.08, by + cell * 0.05, cell * 0.84, bh - cell * 0.1);
        ctx.fillStyle = '#5ef2ff';
        ctx.font = `800 ${Math.max(11, cell * 0.17)}px "Trebuchet MS", system-ui, sans-serif`;
        ctx.fillText(best.winsNow ? 'WIN' : 'TRY', x + cell / 2, by - cell * 0.28);
      }
      ctx.restore();
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      // thinking bars (AI column preference)
      if (state === 'playing' && turn === ai && (aiVisits || aiRoot)) {
        const v = aiVisits || visits(aiRoot); const tot = v.reduce((a, b) => a + b, 0) || 1;
        for (let c = 0; c < COLS; c++) { const h = (v[c] / tot) * cell * 0.9; ctx.fillStyle = 'rgba(255,182,94,0.55)'; ctx.fillRect(bx + c * cell + cell * 0.2, by - cell * 0.5 - h, cell * 0.6, h); }
      } else if (state === 'playing' && turn === you && hoverCol >= 0 && legal(board).includes(hoverCol)) {
        ctx.fillStyle = 'rgba(94,242,255,0.16)'; ctx.fillRect(bx + hoverCol * cell, by, cell, bh);
        const x = bx + hoverCol * cell + cell / 2; ctx.fillStyle = discColor(you, x, by - cell * 0.45, cell * 0.38); ctx.beginPath(); ctx.arc(x, by - cell * 0.45, cell * 0.38, 0, Math.PI * 2); ctx.fill();
      }
      // board panel
      roundRect(bx - 6, by - 6, bw + 12, bh + 12, 14); ctx.fillStyle = '#16204a'; ctx.fill();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const x = bx + c * cell + cell / 2, y = by + (ROWS - 1 - r) * cell + cell / 2, p = board[r * COLS + c];
        if (p) { ctx.fillStyle = discColor(p, x, y, cell * 0.4); ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.fillStyle = '#0c1430'; ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2); ctx.fill(); }
      }
      // falling disc
      if (anim) { const x = bx + anim.c * cell + cell / 2; ctx.fillStyle = discColor(anim.p, x, anim.y, cell * 0.4); ctx.beginPath(); ctx.arc(x, anim.y, cell * 0.4, 0, Math.PI * 2); ctx.fill(); }
      drawLearningHints();
      // win highlight
      if (win) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; for (const [r, c] of win) { const x = bx + c * cell + cell / 2, y = by + (ROWS - 1 - r) * cell + cell / 2; ctx.beginPath(); ctx.arc(x, y, cell * 0.43, 0, Math.PI * 2); ctx.stroke(); } }
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

    api.loop(dt => { if (state === 'playing') update(dt); draw(); });
    showMenu();

    // inert test seam (no-op in production): lets a headless harness drive a game
    if (typeof window !== 'undefined' && window.__c4test) {
      window.__c4test({
        get state() { return state; }, get turn() { return turn; }, get anim() { return !!anim; },
        get you() { return you; }, get netReady() { return !!net; },
        legal: () => legal(board), play: c => humanMove(c), start: sims => play(sims),
      });
    }
  },
});

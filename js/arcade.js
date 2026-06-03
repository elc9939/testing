/* Arcade shell: registry, menu, and game lifecycle management. */
(() => {
  const games = [];
  const Arcade = {
    /* Each game registers a descriptor:
       { id, name, emoji, desc, color, start(root, api), stop() } */
    register(game) { games.push(game); },
    games,
  };
  window.Arcade = Arcade;

  let current = null; // active game descriptor
  let raf = 0;
  const listeners = []; // {target, type, fn}

  // Shared helpers exposed to games so cleanup is automatic.
  const api = {
    // localStorage-backed high score per game
    getBest(key) {
      try { return parseInt(localStorage.getItem('arcade_' + key) || '0', 10) || 0; }
      catch (e) { return 0; }
    },
    setBest(key, val) {
      const v = Math.floor(val);
      if (v > api.getBest(key)) {
        try { localStorage.setItem('arcade_' + key, v); } catch (e) {}
        return true; // new record
      }
      return false;
    },
    // managed event listener (auto-removed on stop)
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push({ target, type, fn, opts });
    },
    // managed animation loop (auto-cancelled on stop). cb receives dt in ms.
    loop(cb) {
      let last = performance.now();
      const tick = (now) => {
        let dt = now - last; last = now;
        if (dt > 60) dt = 60;
        cb(dt, now);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    // create a sized canvas that tracks its container (returns {canvas, ctx, w, h})
    makeCanvas(root, opts = {}) {
      const canvas = document.createElement('canvas');
      root.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const view = { canvas, ctx, w: 0, h: 0, dpr: 1 };
      function fit() {
        const rect = root.getBoundingClientRect();
        view.w = opts.width || rect.width;
        view.h = opts.height || rect.height;
        view.dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = view.w * view.dpr;
        canvas.height = view.h * view.dpr;
        canvas.style.width = view.w + 'px';
        canvas.style.height = view.h + 'px';
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        if (opts.onResize) opts.onResize(view);
      }
      fit();
      api.on(window, 'resize', fit);
      return view;
    },
    backToMenu: () => showMenu(),
  };

  // ---- DOM refs ----
  const menu = document.getElementById('menu');
  const stage = document.getElementById('stage');
  const gameRoot = document.getElementById('game-root');
  const gameName = document.getElementById('game-name');
  const grid = document.getElementById('game-grid');

  function buildMenu() {
    grid.innerHTML = '';
    games.forEach(g => {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.style.setProperty('--cardc', g.color || 'var(--accent)');
      const best = api.getBest(g.id);
      card.setAttribute('aria-label', `Play ${g.name}. ${g.desc}${best ? ` Best: ${best}.` : ''}`);
      card.innerHTML = `
        <span class="emoji">${g.emoji}</span>
        <h3>${g.name}</h3>
        <p>${g.desc}</p>
        <div class="hi">${best ? ('★ Best: ' + best) : '&nbsp;'}</div>`;
      card.addEventListener('click', () => launch(g));
      grid.appendChild(card);
    });
  }

  function launch(g) {
    current = g;
    gameName.textContent = g.name;
    menu.classList.add('hidden');
    stage.classList.add('active');
    gameRoot.innerHTML = '';
    try { g.start(gameRoot, api); }
    catch (e) { console.error('Game failed to start:', e); showMenu(); }
  }

  function stopCurrent() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    while (listeners.length) {
      const l = listeners.pop();
      l.target.removeEventListener(l.type, l.fn, l.opts);
    }
    if (current && current.stop) { try { current.stop(); } catch (e) {} }
    current = null;
    gameRoot.innerHTML = '';
  }

  function showMenu() {
    stopCurrent();
    stage.classList.remove('active');
    menu.classList.remove('hidden');
    buildMenu(); // refresh high scores
  }

  document.getElementById('back-btn').addEventListener('click', showMenu);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && current) showMenu();
  });

  // Boot once DOM + all game scripts have loaded.
  window.addEventListener('load', buildMenu);
})();

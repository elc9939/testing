/* Arcade shell: app catalog, lazy loading, menu, and lifecycle management. */
(() => {
  const apps = [];
  const appById = new Map();
  const scriptLoads = new Map();

  let current = null;
  let raf = 0;
  let activeLoadId = 0;
  const listeners = [];

  function upsertApp(app) {
    if (!app || !app.id) throw new Error('Arcade app entries need an id.');

    const existing = appById.get(app.id);
    if (existing) {
      const runtime = {
        start: existing.start,
        stop: existing.stop,
        loaded: existing.loaded,
      };
      Object.assign(existing, app);
      if (runtime.start && !app.start) existing.start = runtime.start;
      if (runtime.stop && !app.stop) existing.stop = runtime.stop;
      existing.loaded = !!existing.start || !!runtime.loaded;
      return existing;
    }

    const entry = Object.assign({ kind: 'game', loaded: !!app.start }, app);
    appById.set(entry.id, entry);
    apps.push(entry);
    return entry;
  }

  const Arcade = {
    /* App catalog entries are lightweight:
       { id, name, emoji, desc, color, src, kind, scoreKey }
       The loaded script still self-registers a runtime with start(root, api). */
    define(entries) {
      entries.forEach(upsertApp);
      if (document.readyState !== 'loading') buildMenu();
    },
    register(game) {
      let app = appById.get(game.id);
      if (!app) app = upsertApp(game);
      else {
        for (const key of ['name', 'emoji', 'desc', 'color', 'kind', 'scoreKey']) {
          if (!app[key] && game[key]) app[key] = game[key];
        }
      }
      app.start = game.start;
      app.stop = game.stop;
      app.runtime = game;
      app.loaded = typeof app.start === 'function';
      if (document.readyState !== 'loading') buildMenu();
      return app;
    },
    apps,
    games: apps,
  };
  window.Arcade = Arcade;

  const api = {
    getBest(key) {
      try { return parseInt(localStorage.getItem('arcade_' + key) || '0', 10) || 0; }
      catch (e) { return 0; }
    },
    setBest(key, val) {
      const v = Math.floor(val);
      if (v > api.getBest(key)) {
        try { localStorage.setItem('arcade_' + key, v); } catch (e) {}
        return true;
      }
      return false;
    },
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push({ target, type, fn, opts });
    },
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

  const menu = document.getElementById('menu');
  const stage = document.getElementById('stage');
  const gameRoot = document.getElementById('game-root');
  const gameName = document.getElementById('game-name');
  const grid = document.getElementById('game-grid');

  function bestFor(app) {
    if (app.scoreKey === false) return 0;
    return api.getBest(app.scoreKey || app.id);
  }

  function buildMenu() {
    grid.innerHTML = '';
    apps.forEach(app => {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.style.setProperty('--cardc', app.color || 'var(--accent)');
      const best = bestFor(app);
      const kind = app.kind || 'app';
      card.setAttribute('aria-label', `Open ${app.name}. ${app.desc}${best ? ` Best: ${best}.` : ''}`);
      card.innerHTML = `
        <span class="emoji">${app.emoji || '*'}</span>
        <h3>${app.name}</h3>
        <p>${app.desc}</p>
        <div class="hi">${best ? ('Best: ' + best) : kind.toUpperCase()}</div>`;
      card.addEventListener('click', () => launch(app));
      grid.appendChild(card);
    });
  }

  function loadScript(src) {
    const url = new URL(src, document.baseURI).href;
    if (scriptLoads.has(url)) return scriptLoads.get(url);

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.arcadeLazy = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
    scriptLoads.set(url, promise);
    return promise;
  }

  async function loadApp(app) {
    if (typeof app.start === 'function') return app;
    if (!app.src) throw new Error(`${app.name || app.id} has no script source.`);

    await loadScript(app.src);
    const loaded = appById.get(app.id);
    if (!loaded || typeof loaded.start !== 'function') {
      throw new Error(`${app.name || app.id} loaded but did not register a start function.`);
    }
    return loaded;
  }

  function showStageMessage(title, message, options = {}) {
    gameRoot.innerHTML = '';
    const ov = document.createElement('div');
    ov.className = 'center-overlay';
    ov.innerHTML = `
      <h2>${title}</h2>
      <p class="msg">${message}</p>
      ${options.busy ? '<div class="loader-bar"><span></span></div>' : ''}
      ${options.button ? `<button class="btn" type="button">${options.button}</button>` : ''}`;
    if (options.button) ov.querySelector('button').addEventListener('click', showMenu);
    gameRoot.appendChild(ov);
  }

  function cleanupCurrent() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    while (listeners.length) {
      const l = listeners.pop();
      l.target.removeEventListener(l.type, l.fn, l.opts);
    }
    if (current && current.stop) { try { current.stop(); } catch (e) {} }
    current = null;
    gameRoot.innerHTML = '';
  }

  async function launch(app) {
    cleanupCurrent();
    const loadId = ++activeLoadId;
    gameName.textContent = app.name;
    menu.classList.add('hidden');
    stage.classList.add('active');
    showStageMessage(app.name, 'Loading app...', { busy: true });

    try {
      const loaded = await loadApp(app);
      if (loadId !== activeLoadId) return;
      gameRoot.innerHTML = '';
      current = loaded;
      loaded.start(gameRoot, api);
    } catch (e) {
      if (loadId !== activeLoadId) return;
      console.error('App failed to start:', e);
      cleanupCurrent();
      gameName.textContent = app.name;
      menu.classList.add('hidden');
      stage.classList.add('active');
      showStageMessage('Could not start', 'This app failed to load. Return to the menu and try again.', { button: 'MENU' });
    }
  }

  function showMenu() {
    activeLoadId++;
    cleanupCurrent();
    stage.classList.remove('active');
    menu.classList.remove('hidden');
    buildMenu();
  }

  document.getElementById('back-btn').addEventListener('click', showMenu);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (current || stage.classList.contains('active'))) showMenu();
  });

  window.addEventListener('load', buildMenu);
})();

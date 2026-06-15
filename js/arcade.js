/* Arcade shell: app catalog, lazy loading, menu, and lifecycle management. */
(() => {
  const apps = [];
  const appById = new Map();
  const scriptLoads = new Map();

  let current = null;
  let raf = 0;
  let activeLoadId = 0;
  const listeners = [];
  const cleanupFns = [];
  const canvasFits = new Set();
  const params = new URLSearchParams(window.location.search);
  const THEME_KEY = 'miniHub.theme.v1';
  const RECENTS_KEY = 'miniHub.recents.v1';
  const THEME_MODES = ['system', 'dark', 'light'];
  const GROUPS = [
    { id: 'games', name: 'Games', hint: 'Fast arcade loops and touch-friendly browser games.' },
    { id: 'strategy', name: 'Strategy / Learning', hint: 'Deeper systems, tactics, AI practice, and roguelike experiments.' },
    { id: 'tools', name: 'Tools', hint: 'Practical apps for planning, tracking, and getting real work done.' },
    { id: 'learning', name: 'Learning', hint: 'Small games and study-friendly practice loops.' },
    { id: 'experiments', name: 'Experiments', hint: 'Sandboxes, prototypes, and odd little physics toys.' },
  ];
  let savedTheme = 'system';
  try { savedTheme = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) {}
  let themeMode = THEME_MODES.includes(savedTheme) ? savedTheme : 'system';
  let homeQuery = '';
  const isMobileLike = matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const qualityTiers = [
    { name: 'low', level: 0, dprCap: 1, particles: 0.45, particleLimit: 0.45, stars: 0.55, trail: 0.5, ai: 0.45, effects: false },
    { name: 'medium', level: 1, dprCap: 1.35, particles: 0.7, particleLimit: 0.7, stars: 0.75, trail: 0.72, ai: 0.7, effects: true },
    { name: 'high', level: 2, dprCap: 2, particles: 1, particleLimit: 1, stars: 1, trail: 1, ai: 1, effects: true },
  ];
  const perfState = {
    tier: isMobileLike ? 1 : 2,
    frameMs: 16.7,
    fps: 60,
    dropped: 0,
    goodMs: 0,
    lastAdjust: performance.now(),
    lastOverlay: 0,
    reason: 'startup',
    debug: params.has('perf') || params.get('debug') === '1',
    overlay: null,
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function readJSON(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '');
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function effectiveTheme() {
    if (themeMode === 'light' || themeMode === 'dark') return themeMode;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function themeLabel() {
    return themeMode === 'system' ? 'System' : themeMode[0].toUpperCase() + themeMode.slice(1);
  }

  function syncThemeButtons() {
    const label = themeLabel();
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.textContent = label;
      btn.setAttribute('aria-label', `Theme: ${label}. Click to change.`);
    });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = effectiveTheme();
    document.documentElement.dataset.themeMode = themeMode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme() === 'light' ? '#f4f6f8' : '#080b13');
    syncThemeButtons();
  }

  function cycleTheme() {
    const next = THEME_MODES[(THEME_MODES.indexOf(themeMode) + 1) % THEME_MODES.length];
    themeMode = next;
    try { localStorage.setItem(THEME_KEY, themeMode); } catch (e) {}
    applyTheme();
  }

  applyTheme();
  try {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (themeMode === 'system') applyTheme();
    });
  } catch (e) {}

  function quality() {
    return qualityTiers[perfState.tier];
  }

  function snapshotPerf() {
    return {
      fps: perfState.fps,
      frameMs: perfState.frameMs,
      quality: quality().name,
      tier: perfState.tier,
      reason: perfState.reason,
    };
  }

  function setQualityTier(tier, reason) {
    const next = Math.max(0, Math.min(qualityTiers.length - 1, tier));
    if (next === perfState.tier) return;
    perfState.tier = next;
    perfState.reason = reason || 'auto';
    document.documentElement.dataset.quality = quality().name;
    canvasFits.forEach(fit => fit());
  }

  function ensurePerfOverlay() {
    if (!perfState.debug) {
      if (perfState.overlay) perfState.overlay.hidden = true;
      return null;
    }
    if (!perfState.overlay) {
      perfState.overlay = document.createElement('div');
      perfState.overlay.id = 'perf-overlay';
      perfState.overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(perfState.overlay);
    }
    perfState.overlay.hidden = false;
    return perfState.overlay;
  }

  function updatePerf(rawDt, now) {
    const sample = Math.max(1, Math.min(rawDt, 120));
    perfState.frameMs = perfState.frameMs * 0.94 + sample * 0.06;
    perfState.fps = 1000 / Math.max(1, perfState.frameMs);
    if (rawDt > 34) perfState.dropped++;
    if (perfState.frameMs < 18.5 && perfState.dropped < 2) perfState.goodMs += sample;
    else perfState.goodMs = Math.max(0, perfState.goodMs - sample * 1.5);

    if (now - perfState.lastAdjust > 1600) {
      if ((perfState.frameMs > 25 || perfState.dropped > 8) && perfState.tier > 0) {
        setQualityTier(perfState.tier - 1, 'frame pressure');
        perfState.goodMs = 0;
      } else if (perfState.goodMs > 6500 && perfState.tier < qualityTiers.length - 1) {
        setQualityTier(perfState.tier + 1, 'stable frames');
        perfState.goodMs = 0;
      }
      perfState.dropped = 0;
      perfState.lastAdjust = now;
    }

    const ov = ensurePerfOverlay();
    if (ov && now - perfState.lastOverlay > 180) {
      const q = quality();
      ov.textContent = `${Math.round(perfState.fps)} fps | ${perfState.frameMs.toFixed(1)} ms | ${q.name}`;
      perfState.lastOverlay = now;
    }
  }

  document.documentElement.dataset.quality = quality().name;

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
    onCleanup(fn) {
      if (typeof fn === 'function') cleanupFns.push(fn);
    },
    loop(cb) {
      let last = performance.now();
      const tick = (now) => {
        const rawDt = now - last;
        last = now;
        if (document.hidden) {
          raf = requestAnimationFrame(tick);
          return;
        }
        updatePerf(rawDt, now);
        const dt = Math.min(rawDt, 60);
        cb(dt, now, rawDt, snapshotPerf());
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    perf: {
      quality,
      snapshot: snapshotPerf,
      particleCount(n, min = 0) {
        return Math.max(min, Math.round(n * quality().particles));
      },
      particleLimit(n, min = 24) {
        return Math.max(min, Math.round(n * quality().particleLimit));
      },
      trailLimit(n, min = 12) {
        return Math.max(min, Math.round(n * quality().trail));
      },
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
        view.dpr = Math.min(window.devicePixelRatio || 1, quality().dprCap);
        canvas.width = view.w * view.dpr;
        canvas.height = view.h * view.dpr;
        canvas.style.width = view.w + 'px';
        canvas.style.height = view.h + 'px';
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        if (opts.onResize) opts.onResize(view);
      }
      fit();
      canvasFits.add(fit);
      api.on(window, 'resize', fit);
      return view;
    },
    backToMenu: () => showMenu(),
  };

  const menu = document.getElementById('menu');
  const stage = document.getElementById('stage');
  const gameRoot = document.getElementById('game-root');
  const gameName = document.getElementById('game-name');
  const stageThemeBtn = document.getElementById('stage-theme-btn');

  function bestFor(app) {
    if (app.scoreKey === false) return 0;
    return api.getBest(app.scoreKey || app.id);
  }

  function appAccent(app) {
    return app.accent || app.color || 'var(--accent)';
  }

  function statusLabel(app) {
    return (app.status || app.kind || 'app').replace(/-/g, ' ').toUpperCase();
  }

  function recentIds() {
    const list = readJSON(RECENTS_KEY, []);
    return Array.isArray(list) ? list.filter(id => appById.has(id)).slice(0, 6) : [];
  }

  function recordRecent(app) {
    const list = recentIds().filter(id => id !== app.id);
    list.unshift(app.id);
    writeJSON(RECENTS_KEY, list.slice(0, 6));
  }

  function sortApps(list) {
    return list.slice().sort((a, b) => {
      const ap = Number.isFinite(a.priority) ? a.priority : 99;
      const bp = Number.isFinite(b.priority) ? b.priority : 99;
      if (ap !== bp) return ap - bp;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  function cardHTML(app, featured) {
    const best = bestFor(app);
    const cover = app.cover ? `<img src="${esc(app.cover)}" alt="" loading="lazy">` : '';
    const kind = statusLabel(app);
    const group = GROUPS.find(g => g.id === (app.group || 'games'));
    return `<button class="app-card${featured ? ' is-featured' : ''}" type="button" data-launch="${esc(app.id)}" style="--app-accent:${esc(appAccent(app))}" aria-label="Open ${esc(app.name)}. ${esc(app.desc)}">
      <div class="app-cover">${cover}</div>
      <div class="app-body">
        <div class="app-card-top">
          <div>
            <h3>${esc(app.name)}</h3>
            <p>${esc(app.desc || '')}</p>
          </div>
          <span class="app-mark">${esc(app.emoji || app.name.slice(0, 2).toUpperCase())}</span>
        </div>
        <div class="app-meta">
          <span class="app-pill accent">${esc(kind)}</span>
          ${group ? `<span class="app-pill">${esc(group.name)}</span>` : ''}
          ${best ? `<span class="app-pill">Best ${best}</span>` : ''}
        </div>
      </div>
    </button>`;
  }

  function buildMenu() {
    const q = homeQuery.trim().toLowerCase();
    const visible = sortApps(apps.filter(app => {
      if (!q) return true;
      return [app.name, app.desc, app.kind, app.status, app.group].join(' ').toLowerCase().includes(q);
    }));
    const recent = recentIds().map(id => appById.get(id)).filter(Boolean);
    const featured = visible.filter(app => app.featured);
    const featuredHTML = featured.length ? `<section class="hub-section">
      <div class="hub-section-head">
        <div><h2>Featured</h2><p>The things you are building and using most right now.</p></div>
        <span class="hub-chip">${featured.length} app${featured.length === 1 ? '' : 's'}</span>
      </div>
      <div class="hub-grid featured">${featured.map(app => cardHTML(app, true)).join('')}</div>
    </section>` : '';
    const groupHTML = GROUPS.map(group => {
      const list = visible.filter(app => (app.group || 'games') === group.id);
      if (!list.length) return '';
      return `<section class="hub-section">
        <div class="hub-section-head">
          <div><h2>${esc(group.name)}</h2><p>${esc(group.hint)}</p></div>
          <span class="hub-chip">${list.length} app${list.length === 1 ? '' : 's'}</span>
        </div>
        <div class="hub-grid">${list.map(app => cardHTML(app, false)).join('')}</div>
      </section>`;
    }).join('');

    menu.innerHTML = `<div class="hub-shell">
      <section class="hub-hero">
        <div>
          <div class="hub-kicker">Personal app space</div>
          <div class="hub-title">Mini Hub</div>
          <p class="hub-subtitle">Games, strategy toys, job-search tools, and experiments in one fast local-first web app.</p>
        </div>
        <div class="hub-actions">
          <button class="hub-btn primary" type="button" data-launch="${esc((apps.find(a => a.id === 'stickrun') || apps[0] || {}).id || '')}">Play Stick Arena</button>
          <button class="hub-btn" type="button" data-launch="${esc((apps.find(a => a.id === 'jobtracker') || apps[0] || {}).id || '')}">Open Career Desk</button>
          <button class="theme-btn" type="button" data-theme-toggle>Theme</button>
        </div>
      </section>
      <section class="hub-toolbar" aria-label="Mini Hub search and filters">
        <input class="hub-search" type="search" value="${esc(homeQuery)}" placeholder="Search apps, tools, experiments..." aria-label="Search Mini Hub apps">
        <div class="hub-quick">
          <span class="hub-chip">${apps.length} apps</span>
          <span class="hub-chip">${effectiveTheme()} theme</span>
        </div>
      </section>
      ${recent.length && !q ? `<section class="hub-section">
        <div class="hub-section-head"><div><h2>Recently opened</h2><p>Jump back into what you used last.</p></div></div>
        <div class="hub-grid">${recent.map(app => cardHTML(app, false)).join('')}</div>
      </section>` : ''}
      ${featuredHTML}${groupHTML || '<div class="hub-empty">No apps match that search.</div>'}
      <div class="footer">Press Esc or use the Menu button to return here. Theme follows your setting across the hub.</div>
    </div>`;

    const input = menu.querySelector('.hub-search');
    if (input) {
      input.addEventListener('input', e => {
        homeQuery = e.target.value;
        buildMenu();
        const next = menu.querySelector('.hub-search');
        if (next) {
          next.focus();
          next.setSelectionRange(homeQuery.length, homeQuery.length);
        }
      });
    }
    menu.querySelectorAll('[data-launch]').forEach(btn => {
      btn.addEventListener('click', () => {
        const app = appById.get(btn.dataset.launch);
        if (app) launch(app);
      });
    });
    menu.querySelectorAll('[data-theme-toggle]').forEach(btn => btn.addEventListener('click', cycleTheme));
    syncThemeButtons();
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
    while (cleanupFns.length) {
      try { cleanupFns.pop()(); } catch (e) {}
    }
    while (listeners.length) {
      const l = listeners.pop();
      l.target.removeEventListener(l.type, l.fn, l.opts);
    }
    if (current && current.stop) { try { current.stop(); } catch (e) {} }
    current = null;
    canvasFits.clear();
    gameRoot.innerHTML = '';
  }

  async function launch(app) {
    cleanupCurrent();
    recordRecent(app);
    const loadId = ++activeLoadId;
    gameName.textContent = app.name;
    menu.classList.add('hidden');
    stage.classList.add('active');
    showStageMessage(app.name, 'Opening...', { busy: true });

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
  if (stageThemeBtn) {
    stageThemeBtn.setAttribute('data-theme-toggle', '1');
    stageThemeBtn.addEventListener('click', cycleTheme);
  }
  syncThemeButtons();
  window.addEventListener('keydown', e => {
    if (e.key === 'F2') {
      perfState.debug = !perfState.debug;
      ensurePerfOverlay();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && (current || stage.classList.contains('active'))) showMenu();
  });

  window.addEventListener('load', buildMenu);
})();

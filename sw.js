/* Service worker: precache the whole arcade so it runs fully offline once
   installed. Bump CACHE when assets change to roll out a fresh copy. */
const CACHE = 'mini-arcade-v154';
const ASSETS = [
  './',
  './index.html',
  './css/style.css?v=61',
  './js/arcade.js?v=60',
  './js/app-manifest.js?v=149',
  './js/games/deckbound.js?v=62',
  './js/games/stardrifter.js?v=59',
  './js/games/snake.js?v=58',
  './js/games/breakout.js?v=59',
  './js/games/memory.js?v=57',
  './js/games/reaction.js?v=59',
  './js/games/tictactoe.js?v=57',
  './js/games/stickrun.js?v=133',
  './js/games/pinball.js?v=59',
  './js/games/orbit.js?v=60',
  './js/games/twenty48.js?v=58',
  './js/games/connect4.js?v=68',
  './js/games/connect4-worker.js?v=1',
  './js/games/connect4-weights.json',
  './js/games/gambit.js?v=1',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app shell so deploys show up quickly, cache-first for assets.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

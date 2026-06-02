/* Service worker: precache the whole arcade so it runs fully offline once
   installed. Bump CACHE when assets change to roll out a fresh copy. */
const CACHE = 'mini-arcade-v4';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/arcade.js',
  './js/games/stardrifter.js',
  './js/games/snake.js',
  './js/games/breakout.js',
  './js/games/memory.js',
  './js/games/reaction.js',
  './js/games/tictactoe.js',
  './js/games/stickrun.js',
  './manifest.webmanifest',
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

// Cache-first for our own assets, network fallback otherwise.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

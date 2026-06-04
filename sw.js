/* Service worker: precache the whole arcade so it runs fully offline once
   installed. Bump CACHE when assets change to roll out a fresh copy. */
const CACHE = 'mini-arcade-v58';
const ASSETS = [
  './',
  './index.html',
  './css/style.css?v=57',
  './js/arcade.js?v=57',
  './js/app-manifest.js?v=57',
  './js/games/stardrifter.js?v=57',
  './js/games/snake.js?v=57',
  './js/games/breakout.js?v=57',
  './js/games/memory.js?v=57',
  './js/games/reaction.js?v=57',
  './js/games/tictactoe.js?v=57',
  './js/games/stickrun.js?v=57',
  './js/games/pinball.js?v=57',
  './js/games/orbit.js?v=57',
  './js/games/twenty48.js?v=57',
  './js/games/connect4.js?v=57',
  './js/games/connect4-weights.json',
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

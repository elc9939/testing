self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => /^mini-hub-v\d+$/u.test(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Modern Mini Hub uses API/local-first storage directly. Do not cache-intercept
// app or localhost requests from the legacy arcade service worker scope.

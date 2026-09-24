// Minimal service worker - exists mainly to satisfy PWA installability checks
// (a registered service worker with a fetch handler). No offline caching is
// attempted: video/audio libraries are large and change constantly, so this
// just passes every request straight through to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

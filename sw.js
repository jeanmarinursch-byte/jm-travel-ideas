// JM Travel List — Service Worker
// Minimal SW required for PWA installability + share target registration.
// No caching strategy — always fetch fresh from network.

const VERSION = 'v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  // Pass all requests straight to the network
  event.respondWith(fetch(event.request));
});

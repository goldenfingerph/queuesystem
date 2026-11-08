const CACHE_NAME = 'infinity-queue-shell-v1';
const APP_SHELL = ['/','/index.html','/manifest.webmanifest','/pwa-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL);
        // Precache Vite's hashed entry bundle and stylesheet so the first
        // installed launch can render offline without an extra online reload.
        const page = await cache.match('/index.html');
        if (page) {
          const html = await page.text();
          const assets = [...html.matchAll(/(?:src|href)="([^"]+\\/assets\\/[^"]+)"/g)]
            .map((match) => match[1]);
          await Promise.all(assets.map((asset) => cache.add(asset).catch(() => undefined)));
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/api' ||
      url.pathname === '/health' || url.pathname === '/ws' ||
      url.pathname.startsWith('/ws/') || url.pathname.startsWith('/api/media/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
        }
        return response;
      }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/')))
    );
    return;
  }

  if (['script','style','image','font'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});

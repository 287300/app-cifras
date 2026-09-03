// Gerado por scripts/build.ts — versão 9b238de11a54
const VERSION = 'cifras-9b238de11a54';
const PRECACHE = ["./","./styles.css","./assets/app.js","./index.html","./manifest.json","./icons/icon-192.png","./icons/apple-touch-icon.png","./icons/icon-512.png"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // varre TODAS as caixas antigas, inclusive a que o app deixou na raiz
      // antes da mudança de endereço
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: 'sw-ativado', version: VERSION })))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // marca de versão sempre da rede: é ela que denuncia cache pela metade
  if (/(version|versao)\.txt$/.test(url.pathname)) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html').then((page) => page || fetch(req));
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});

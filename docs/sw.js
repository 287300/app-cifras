// Gerado por scripts/build.ts — versão 5c943df5c69c
const VERSION = 'cifras-5c943df5c69c';
const PRECACHE = ["./","./assets/app.js","./comecar.html","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./index.html","./manifest.json","./styles.css"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
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
      if (req.mode === 'navigate') {
        // A página de venda tem endereço próprio e NÃO é a casca do app. Sem
        // esta exceção o service worker devolvia o app para /comecar, e o
        // anúncio caía num app vazio dizendo "Nenhum show ainda" — exatamente
        // o problema que a página existe para resolver.
        if (/\/comecar\/?$/.test(url.pathname)) {
          return caches.match('./comecar.html').then((p) => p || fetch(req));
        }
        return caches.match('./index.html').then((page) => page || fetch(req));
      }
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

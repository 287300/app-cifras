// Gerado por scripts/build.ts — desmonta a instalação antiga da raiz (versão 7d2b69d421a2)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} }))
      .catch(() => {})
  );
});

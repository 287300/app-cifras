// Gerado por scripts/build.ts — desmonta a instalação antiga da raiz (versão 9f74a73df1f0)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} }))
      .catch(() => {})
  );
});

// Gerado por scripts/build.ts — desmonta a instalação antiga da raiz (versão e75692be91ca)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} }))
      .catch(() => {})
  );
});

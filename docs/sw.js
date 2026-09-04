// Gerado por scripts/build.ts — desmonta a instalação antiga da raiz (versão 43e78979bbb4)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} }))
      .catch(() => {})
  );
});

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando Service Worker...', event);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activando Service Worker...', event);
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Estrategia básica: Solo pasa las peticiones al network
  // Obligatorio para cumplir con los criterios de instalación de PWA
  event.respondWith(fetch(event.request));
});

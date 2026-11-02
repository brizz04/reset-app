const CACHE = 'reset-shell-v8';
const SHELL = ['/', '/styles.css', '/app.js', '/fx.js', '/offline.js', '/modal.js', '/i18n.js', '/locales/en.json', '/manifest.webmanifest', '/icons/icon-192.png', '/fonts/fonts.css', '/fonts/anton-400.woff2', '/fonts/chakra-petch-500.woff2', '/fonts/chakra-petch-700.woff2'];
const NET_TIMEOUT = 4000; // si la red no responde en 4 s y hay copia guardada, se usa la copia (VPN caída, mala cobertura...)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Red primero (para recibir siempre la versión nueva); si falla o tarda, la copia guardada
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (!hit) return net.catch(() => cache.match('/') || Response.error());
  const timeout = new Promise((resolve) => setTimeout(() => resolve(hit), NET_TIMEOUT));
  return Promise.race([net.catch(() => hit), timeout]);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(e.request));
});

self.addEventListener('push', (e) => {
  let data = { title: 'Reset', body: '', url: '/' };
  try { data = { ...data, ...e.data.json() }; } catch { /* sin datos */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: data.url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});

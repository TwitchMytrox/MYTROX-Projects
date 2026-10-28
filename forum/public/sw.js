/* turkac.org – Service Worker: schnelle Oberfläche + Offline-Seite.
   Bewusst KEIN Caching von /api/ und Uploads (Privatsphäre, immer aktuell). */
const VERSION = 'nx-v1';
const SHELL = ['/offline.html', '/css/style.css', '/css/pages.css', '/js/app.js', '/js/account.js', '/js/dm.js', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/avatars/') || url.pathname.startsWith('/admin')) return;
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('/offline.html'))); return; }
  // Statische Dateien: erst Netz (aktuell), bei Ausfall Cache
  e.respondWith(fetch(req).then((r) => { if (r.ok && /\.(css|js|png|svg)$/.test(url.pathname)) { const c = r.clone(); caches.open(VERSION).then((x) => x.put(req, c)); } return r; }).catch(() => caches.match(req)));
});

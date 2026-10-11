/* Naive: keeps the app on the phone so it opens instantly. Pages, pictures and fonts load from the phone first and refresh quietly in the background.
   Downloads, searches and live updates (/api/...) are never stored. After you edit a file, open the app twice to see the change (or bump VERSION). */
const VERSION = 'naive-5';
const SHELL = ['/', '/stt.css', '/stt.js', '/manifest.webmanifest', '/logo-128.webp', '/fonts/bricolage-grotesque.woff2', '/fonts/crimson-pro.woff2', '/img/tree.webp', '/terms.html'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || r.headers.has('range')) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(r, { ignoreSearch: false });
    const net = fetch(r).then(res => { if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

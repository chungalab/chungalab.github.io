// Bump VERSION whenever you change a file.
const VERSION = 'v1';
const CACHE = 'reading-tracker-' + VERSION;
const COVERS = 'reading-covers';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const EXTRA = ['https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c =>
  c.addAll(FILES).then(() => Promise.all(EXTRA.map(u => c.add(u).catch(() => {}))))
)));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('reading-tracker-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('./')));
});

function cacheFirst(req, name) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(name).then(c => c.put(req, copy)); }
    return res;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fonts and the barcode library: keep a copy so the app works offline.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net') { e.respondWith(cacheFirst(req, CACHE)); return; }
  // Book covers: keep a copy so your shelves show covers offline.
  if (req.destination === 'image' && url.origin !== location.origin) { e.respondWith(cacheFirst(req, COVERS)); return; }
  if (url.origin !== location.origin) return; // book lookups go straight to the network
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return res; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(cacheFirst(req, CACHE));
});

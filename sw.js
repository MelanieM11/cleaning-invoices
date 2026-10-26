// Offline support: cache the app shell and libraries, serve cache first, refresh in background.
const CACHE = 'cleaning-invoices-v4';
const FILES = [
  './', 'index.html', 'css/style.css', 'js/rates.js', 'js/app.js', 'js/invoice.js', 'js/agreement.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/exceljs.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

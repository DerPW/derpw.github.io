// Service Worker: macht Formwerk offline-fähig.
// Eigene Dateien: erst Netz (damit Updates sofort ankommen), sonst Cache.
// Bibliotheken von jsDelivr: versioniert und unveränderlich → erst Cache.

const CACHE = 'formwerk-fae3c1b';
const LIB_CACHE = 'formwerk-libs-v1';

const SHELL = [
  './', 'index.html', 'css/app.css', 'css/apple.css', 'manifest.webmanifest', 'assets/icon.svg',
  'js/app.js', 'js/ui.js', 'js/runner.js', 'js/worker.js', 'js/engine.js', 'js/off.js', 'js/viewer.js', 'js/editor.js',
  'js/customizer.js', 'js/logparse.js', 'js/examples.js', 'js/fonts.js', 'js/libraries.js', 'js/share.js', 'js/store.js',
  'js/scad-lang.js', 'js/apple.js', 'js/motion.js', 'js/viewcube.js', 'js/blocks/blocks.js', 'js/blocks/generator.js',
  'vendor/openscad/openscad.js', 'vendor/openscad/openscad.wasm', 'vendor/openscad/version.js',
  'vendor/three/three.js', 'vendor/codemirror/codemirror.js', 'vendor/codemirror/codemirror.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (![CACHE, LIB_CACHE].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // no-cache: immer beim Server nachfragen (ETag → meist nur 304), damit Updates sofort ankommen
      // (Navigations-Anfragen dürfen nicht mit Optionen kopiert werden → über die URL)
      const res = await (req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' }));
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
      return Response.error();
    }
  })());
});

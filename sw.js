// Service worker: guarda la app para jugar sin conexión.
const CACHE = 'frets-v33';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/core.js', 'js/chart-parser.js', 'js/midi-parser.js', 'js/importer.js',
  'js/storage.js', 'js/audio.js', 'js/render.js', 'js/game.js', 'js/stage3d.js', 'js/musician.js',
  'vendor/three/three.module.min.js', 'vendor/three/addons/loaders/GLTFLoader.js', 'vendor/three/addons/utils/BufferGeometryUtils.js', 'js/sample.js', 'vendor/peerjs/peerjs.min.js', 'js/net.js', 'js/app.js',
  'assets/musicians/body.gltf', 'assets/musicians/body.bin', 'assets/musicians/skin.webp', 'assets/musicians/skin_n.webp', 'assets/musicians/skin_r.webp', 'assets/musicians/eye.webp', 'assets/musicians/eye_n.webp', 'assets/musicians/hair1.webp', 'assets/musicians/hair1_n.webp', 'assets/musicians/hair2.webp', 'assets/musicians/hair2_n.webp', 'assets/musicians/hair_buzzed.gltf', 'assets/musicians/hair_buzzed.bin', 'assets/musicians/hair_simpleparted.gltf', 'assets/musicians/hair_simpleparted.bin', 'assets/musicians/hair_long.gltf', 'assets/musicians/hair_long.bin', 'assets/musicians/hair_beard.gltf', 'assets/musicians/hair_beard.bin', 'assets/musicians/hair_buns.gltf', 'assets/musicians/hair_buns.bin',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para recibir actualizaciones) y caché si no hay conexión.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

const CACHE = 'goth-p7-30';
const ASSETS = [
 "./",
 "./apple-touch-icon.png",
 "./bg-dungeon.jpg",
 "./bg-home.jpg",
 "./building-garden.jpg",
 "./building-harbor.jpg",
 "./building-home.jpg",
 "./building-ruins.jpg",
 "./building-sanctuary.jpg",
 "./building-workshop.jpg",
 "./chest-open.jpg",
 "./chest.jpg",
 "./dungeon-ember.jpg",
 "./dungeon-glade.jpg",
 "./dungeon-sky.jpg",
 "./dungeon-tide.jpg",
 "./dungeon-void.jpg",
 "./guardian-dragon.jpg",
 "./guardian-fox.jpg",
 "./guardian-owl.jpg",
 "./guardian-phoenix.jpg",
 "./guardian-turtle.jpg",
 "./guardian-wolf.jpg",
 "./icon-192.png",
 "./icon-512.png",
 "./index.html",
 "./logo.jpg",
 "./manifest.json",
 "https://unpkg.com/react@18/umd/react.production.min.js",
 "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
 "https://unpkg.com/@babel/standalone/babel.min.js"
];
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.allSettled(ASSETS.map(function (u) { return c.add(u); }));
    }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (r) {
        const copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return r;
      }).catch(function () {
        return caches.match('./index.html').then(function (m) { return m || caches.match('./'); });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (m) {
      if (m) return m;
      return fetch(e.request).then(function (r) {
        if (r && (r.status === 200 || r.type === 'opaque')) {
          const copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return r;
      });
    })
  );
});

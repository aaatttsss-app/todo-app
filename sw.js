// Service Worker — オフラインでも動くようにファイルをキャッシュする
var CACHE_NAME = 'todo-v5';
var FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/qrcode.min.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './archive/index.html',
  './archive/archive.css',
  './archive/archive.js',
  './archive/archive-chart.js',
  './archive/archive-sample-data.js',
  './memo/index.html',
  './memo/memo.css',
  './memo/memo.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
            .map(function(name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    // ignoreSearch: style.css?v=16 のようなバージョン付きリクエストもキャッシュに当てる
    caches.match(event.request, { ignoreSearch: true }).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

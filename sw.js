// Service Worker — オフラインでも動くようにファイルをキャッシュする
var CACHE_NAME = 'todo-v18';
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

// 「通信を優先し、つながらない時だけキャッシュを使う」方式。
//
// 以前は逆（キャッシュ最優先）だったため、一度キャッシュに入った古いファイルが
// 更新後も配られ続け、「直したのに古い画面のまま」「操作が効かない」という
// 原因の分かりにくい不具合が繰り返し起きた。
// この方式なら、オンラインなら常に最新が届き、オフラインでも従来どおり動く。
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  // 自分のサイト内のファイルだけを扱う（クラウド同期など外部への通信には一切干渉しない）
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    // cache:'no-store' でブラウザ本体のキャッシュも迂回し、必ず最新を取りに行く
    fetch(event.request.url, { cache: 'no-store' }).then(function(response) {
      // 取得できたら、次のオフライン用にキャッシュを最新へ更新しておく
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, copy);
        }).catch(function() { /* 保存できなくても表示は続行 */ });
      }
      return response;
    }).catch(function() {
      // オフライン等で通信できない時はキャッシュから返す
      // ignoreSearch: style.css?v=21 のようなバージョン付きURLもキャッシュに当てる
      return caches.match(event.request, { ignoreSearch: true }).then(function(cached) {
        if (cached) return cached;
        // ページ遷移の要求なら、最低限トップページを返して真っ白を避ける
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html', { ignoreSearch: true });
        }
        return Response.error();
      });
    })
  );
});

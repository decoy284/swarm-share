/* ---------------------------------------------------------------
   Service Worker
   ネットワーク優先。つながっていれば必ず最新、切れていればキャッシュ。
   キャッシュ名は接頭辞でスコープする（同一オリジンの他アプリを消さない）。
----------------------------------------------------------------*/

const CACHE_PREFIX = 'imsat-';
const CACHE_NAME = CACHE_PREFIX + 'v1';

/* ナビゲーションは "/" を要求するので、正規URLで登録する */
const ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* 同一オリジン以外（Foursquare API・Google Fonts）は素通し */
  if (url.origin !== self.location.origin) return;

  /* トークン交換と設定は必ずネットワークへ */
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    /* 元の Request をそのまま渡す。作り直すと redirect:"follow" になって
       ナビゲーションに redirected なレスポンスを返してしまう */
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic' && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => { /* noop */ });
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/')))
  );
});

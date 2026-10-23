/* 오프라인에서도 열리게: 앱 파일만 보관 (구글 로그인·드라이브 통신은 보관하지 않음) */
const CACHE = 'deskcal-9f5b564a25';
const FILES = ['./',
  './app.js',
  './apple-touch-icon.png',
  './config.js',
  './fonts/Pretendard-Bold.subset.woff2',
  './fonts/Pretendard-Medium.subset.woff2',
  './fonts/Pretendard-Regular.subset.woff2',
  './fonts/Pretendard-SemiBold.subset.woff2',
  './holidays.js',
  './icon-192.png',
  './icon-512.png',
  './importer.js',
  './index.html',
  './manifest.json',
  './recur.js',
  './style.css',
  './web.css',
  './webapi.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 먼저 인터넷에서 새 파일을 받고, 안 되면 보관본
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});

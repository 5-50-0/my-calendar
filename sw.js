// 앱 파일 캐시
// 인터넷이 되면 항상 서버의 최신 파일을 먼저 쓰고, 안 될 때만 저장해 둔 파일로 실행한다.
// (일정 데이터는 여기와 상관없이 따로 저장되므로 업데이트해도 지워지지 않는다)
const VERSION = 'v1.0.3';
const CACHE = 'mycal-' + VERSION;
const FILES = [
  './', 'index.html', 'css/app.css', 'js/lunar-data.js', 'js/holidays.js', 'js/store.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mycal-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// 앱 파일 캐시 (오프라인 실행 + 업데이트 알림)
// 앱을 고칠 때마다 VERSION을 올리면, 열려 있는 앱에 "새 버전이 있어요"가 뜬다.
const VERSION = 'v1.0.0';
const CACHE = 'mycal-' + VERSION;
const FILES = [
  './', 'index.html', 'css/app.css', 'js/lunar-data.js', 'js/holidays.js', 'js/store.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mycal-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});

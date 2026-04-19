// ══════════════════════════════════════════
//  세금계산기.zip — Service Worker v1
// ══════════════════════════════════════════

const CACHE_NAME = 'taxcalc-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/property.html',
  '/comprehensive.html',
  '/capital.html',
  '/capitalhigh.html',
  '/capitalheavy.html',
  '/capital-low.html',
  '/gift.html',
  '/biz.html',
  '/obligation.html',
  '/salary.html',
  '/salary-gross.html',
  '/age.html',
  '/realtytrade.html',
  '/building.html',
  '/stocklookup.html',
  '/indexlookup.html',
  '/weather.html',
  '/calendar.html',
  '/lotto.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 설치: 핵심 파일 캐시
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] 캐시 실패:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 활성화: 이전 캐시 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: 캐시 우선 → 네트워크 fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // 외부 요청은 패스

  event.respondWith(
    caches.match(event.request).then(cached => {
      // 백그라운드 갱신 (Stale-While-Revalidate)
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => null);

      return cached || fetchPromise || caches.match('/index.html');
    })
  );
});

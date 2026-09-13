/* 玄剑公会 PWA Service Worker
 *
 * 策略（多端适配）：
 *   - /api/      ：一律走网络，绝不缓存（避免串号/过期数据；接口本身已有服务端缓存策略）
 *   - /assets/   ：缓存优先（Vite 产物带 hash，内容不可变）
 *   - 页面导航    ：网络优先，离线时回退应用壳
 *   - 其它同源静态：缓存优先 + 后台更新
 * 版本号变更会在 activate 阶段清空旧缓存。
 */
const CACHE_NAME = 'xuanjian-pwa-v2';

// 应用壳（安装时预缓存）
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* 单个资源失败不阻塞安装 */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 仅同源、GET、非 API 的请求才进入缓存逻辑 */
function isCacheable(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/uploads/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跨域请求（七牛 CDN 等）直接交给浏览器，不介入
  if (url.origin !== self.location.origin) return;

  // API / 上传：只走网络，不缓存
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // 带 hash 的构建产物：缓存优先（内容不可变）
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }))
    );
    return;
  }

  // 页面导航：网络优先，离线回退应用壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((c) => c || caches.match('/')))
    );
    return;
  }

  if (!isCacheable(request, url)) return;

  // 其它同源静态资源：缓存优先 + 后台更新
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// ===== Web Push（站外系统级浏览器通知）=====

self.addEventListener('push', (event) => {
  let data = { title: '玄剑公会', body: '', url: '/' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) { /* 非 JSON 推送忽略 */ }
  event.waitUntil(
    self.registration.showNotification(data.title || '玄剑公会', {
      body: data.body || '',
      icon: data.icon || '/icon.png',
      badge: data.badge || '/icon.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/notifications' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          try { client.navigate(url); } catch (e) { /* 部分环境不支持 navigate */ }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

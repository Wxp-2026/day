const CACHE_VERSION = 'riji-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;   // 应用外壳
const FONT_CACHE  = `${CACHE_VERSION}-font`;    // Web 字体（运行时缓存）
const CDN_CACHE   = `${CACHE_VERSION}-cdn`;     // 其他 CDN 资源

/* 预缓存：只放必需的应用外壳，不预缓存字体分片 */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

/* 字体 CDN 的 CSS 入口（预缓存 CSS，分片留待运行时按需缓存） */
const FONT_CSS = [
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.0.0/400.css',
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.0.0/700.css',
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css'
];

const LUNAR_CDN = 'https://cdn.jsdelivr.net/npm/lunar-javascript@2.0.4/dist/lunar.min.js';

/* ---------- 安装：预缓存外壳 ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);

    // 逐项缓存，避免单个失败导致整体安装失败
    await Promise.all(SHELL_ASSETS.map(async url => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) {
        console.warn('[SW] 预缓存失败:', url, e);
      }
    }));

    // 农历库与字体 CSS 预缓存（CORS 模式）
    const cdnTargets = [LUNAR_CDN, ...FONT_CSS];
    await Promise.all(cdnTargets.map(async url => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res && res.ok) await cache.put(url, res);
      } catch (e) {
        console.warn('[SW] CDN 预缓存失败:', url, e);
      }
    }));

    await self.skipWaiting();
  })());
});

/* ---------- 激活：清理旧版本缓存 ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => !k.startsWith(CACHE_VERSION))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- 请求拦截 ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // 只处理 GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) 同源应用外壳：cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // 2) 字体文件（woff2/woff/ttf）与字体 CSS：stale-while-revalidate
  if (isFontAsset(url)) {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  // 3) 其他 CDN（农历库等）：stale-while-revalidate
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // 其他跨域请求走网络
});

/* ---------- 缓存策略 ---------- */

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // 离线兜底：导航请求回退到 index.html
    if (req.mode === 'navigate') {
      const shell = await caches.open(SHELL_CACHE);
      const fallback = await shell.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('离线不可用', {
      status: 503,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const network = fetch(req)
    .then(res => {
      // 允许 opaque 响应（跨域无 CORS 情况）也缓存
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    // 后台更新，不阻塞返回
    network.catch(() => {});
    return cached;
  }

  const res = await network;
  if (res) return res;

  // 完全离线且无缓存
  return new Response('', { status: 504 });
}

/* ---------- 工具 ---------- */

function isFontAsset(url) {
  // 字体分片通常在 /files/ 或带 .woff2/.woff/.ttf
  if (/\.(woff2?|ttf|otf)(\?.*)?$/i.test(url.pathname)) return true;
  // 字体 CSS：@fontsource / lxgw-wenkai-webfont 下的 .css
  if (/\.css$/i.test(url.pathname) &&
      /(@fontsource|lxgw-wenkai-webfont)/.test(url.pathname)) {
    return true;
  }
  return false;
}

/* ---------- 允许页面触发更新 ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
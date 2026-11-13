/* ============================================================
   日迹 PWA Service Worker
   缓存分层：
   - shell：应用外壳，cache-first
   - font ：Web 字体，stale-while-revalidate
   - cdn  ：第三方脚本，stale-while-revalidate
   ============================================================ */

const CACHE_VERSION = 'riji-v5';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const FONT_CACHE  = `${CACHE_VERSION}-font`;
const CDN_CACHE   = `${CACHE_VERSION}-cdn`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

const LUNAR_CDNS = [
  'https://unpkg.com/lunar-javascript@2.0.4/dist/lunar.min.js',
  'https://npm.elemecdn.com/lunar-javascript@2.0.4/dist/lunar.min.js',
  'https://cdn.jsdelivr.net/npm/lunar-javascript@2.0.4/dist/lunar.min.js',
  'https://lib.baomitu.com/lunar-javascript/1.7.2/lunar.min.js'
];

const FONT_CSS = [
  'https://npm.elemecdn.com/lxgw-wenkai-webfont@1.7.0/style.css',
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css',
  'https://npm.elemecdn.com/@fontsource/ma-shan-zheng@5.0.0/400.css',
  'https://cdn.jsdelivr.net/npm/@fontsource/ma-shan-zheng@5.0.0/400.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);

    await Promise.all(SHELL_ASSETS.map(async url => {
      try { await shell.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[SW] 外壳预缓存失败:', url, e); }
    }));

    await cacheFirstAvailable(LUNAR_CDNS, CDN_CACHE, '[SW] 农历库预缓存');

    await Promise.all(FONT_CSS.map(async url => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res && (res.ok || res.type === 'opaque')) {
          const cache = await caches.open(FONT_CACHE);
          await cache.put(url, res);
        }
      } catch (e) { console.warn('[SW] 字体 CSS 预缓存失败:', url); }
    }));

    await self.skipWaiting();
  })());
});

async function cacheFirstAvailable(urls, cacheName, logTag) {
  const cache = await caches.open(cacheName);
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res && (res.ok || res.type === 'opaque')) {
        await cache.put(url, res);
        console.log(`${logTag} 成功:`, url);
        return url;
      }
    } catch (e) { console.warn(`${logTag} 失败:`, url); }
  }
  console.warn(`${logTag} 全部失败，将依赖页面内兜底算法`);
  return null;
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  if (isFontAsset(url)) {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }
  if (isKnownCDN(url)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    if (req.mode === 'navigate') {
      const shell = await caches.open(SHELL_CACHE);
      const fallback = (await shell.match('./index.html')) || (await shell.match('./'));
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
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const res = await network;
  if (res) return res;
  return new Response('', { status: 504 });
}

const KNOWN_CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'npm.elemecdn.com',
  'lib.baomitu.com',
  'cdnjs.cloudflare.com',
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net'
];

function isKnownCDN(url) {
  return KNOWN_CDN_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}

function isFontAsset(url) {
  if (/\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(url.pathname)) return true;
  if (/\.css$/i.test(url.pathname) && /(@fontsource|lxgw-wenkai-webfont)/.test(url.pathname)) return true;
  if (/\/files\//.test(url.pathname) && /\.(woff2?|ttf)(\?.*)?$/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      console.log('[SW] 所有缓存已清空');
    })());
  }
});
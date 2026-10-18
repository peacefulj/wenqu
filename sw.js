/* 文渠科研平台 · Service Worker
 * 策略：同源静态资产 cache-first（命中即离线可用）；跨域 API（OpenAlex/Crossref/Unpaywall/AI 中转）
 * 一律直连不缓存；页面导航离线时回退 studio.html。
 * 更新方式：改代码后把 CACHE 版本号 +1，旧缓存自动清理；用户刷新即得新版。
 */
"use strict";
const CACHE = "wenqu-v40";
const SHELL = [
  "./",
  "index.html",
  "quick.html",
  "studio.html",
  "tools.html",
  "workbench.html",
  "map.html",
  "manifest.webmanifest",
  "assets/style.css",
  "assets/map.css",
  "assets/wq-map.js",
  "assets/vendor/cytoscape.min.js",
  "assets/wb.css",
  "assets/studio.js",
  "assets/wq-core.js",
  "assets/wq-pptx.js",
  "assets/wq-ui.js",
  "assets/wq-quick.js",
  "assets/paradigms.js",
  "assets/wb.js",
  "assets/tools.js",
  "assets/vendor/marked.min.js",
  "assets/vendor/purify.min.js",
  "assets/vendor/pdf.min.js",
  "assets/vendor/pdf.worker.min.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => null)) // 单个资源失败不阻塞安装
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // AI POST 等直连
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // 官方 API / AI 中转一律直连
  if (url.pathname.endsWith("/sw.js")) return;            // SW 自身永远走网络

  // 页面导航：网络优先，失败回退缓存（离线可用）
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("studio.html")))
    );
    return;
  }

  // 同源静态资产：cache-first，后台更新缓存
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

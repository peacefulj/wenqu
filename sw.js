/* 研墨 · Service Worker
 * 策略：同源静态资产 cache-first（命中即离线可用）；跨域 API（OpenAlex/Crossref/Unpaywall/AI 中转）
 * 一律直连不缓存；页面导航网络优先，离线时回退缓存 / studio.html。
 * 版本：VERSION 必须与 assets/version.js 一致——发布时运行 node scripts/release.mjs <版本号>，会一起改。
 *       版本一变缓存名就变：新 SW 安装时重新下载全部资源，激活后清理旧缓存，页面上会提示「刷新」。
 */
"use strict";
const VERSION = "1.2.0";
const CACHE = "yanmo-v" + VERSION;
const OWN = /^(wenqu|yanmo)-v/;   // 只清理研墨自己的旧缓存：github.io 同源下可能还有别的项目
const SHELL = [
  "./",
  "index.html",
  "quick.html",
  "studio.html",
  "tools.html",
  "workbench.html",
  "map.html",
  "try.html",
  "manifest.webmanifest",
  "assets/version.js",
  "assets/style.css",
  "assets/map.css",
  "assets/wb.css",
  "assets/ym.css",
  "assets/wq-core.js",
  "assets/paradigms.js",
  "assets/studio.js",
  "assets/wb.js",
  "assets/wq-ui.js",
  "assets/wq-pptx.js",
  "assets/wq-quick.js",
  "assets/wq-map.js",
  "assets/ym-bib.js",
  "assets/ym-refs.js",
  "assets/ym-pdf.js",
  "assets/ym-export.js",
  "assets/ym-sync.js",
  "assets/ym-selftest.js",
  "assets/ym-try.js",
  "assets/demo/sample.bib",
  "assets/demo/sample.ris",
  "assets/demo/sample-csl.json",
  "assets/demo/demo-paper.pdf",
  "assets/vendor/marked.min.js",
  "assets/vendor/purify.min.js",
  "assets/vendor/pdf.min.js",
  "assets/vendor/pdf.worker.min.js",
  "assets/vendor/cytoscape.min.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      /* 逐个缓存：单个失败不影响其他（addAll 一个失败就全部作废）；cache:"reload" 绕过 HTTP 缓存，免得把旧版文件存进新版缓存 */
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && OWN.test(k)).map((k) => caches.delete(k))))
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
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
        }
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

/* 研墨 · 版本号（唯一来源）
 * 发布新版本请运行：node scripts/release.mjs <版本号>，它会同步修改本文件、sw.js 和各页面页脚。
 * 版本规则见 CONTRIBUTING.md，变更记录见 CHANGELOG.md。
 * 本文件也会被 Node（scripts/、mcp/）读取，所以不能依赖 DOM。
 */
(function (g) {
  "use strict";
  var INFO = { version: "1.2.0", date: "2026-10-30", repo: "https://github.com/peacefulj/wenqu" };
  var Y = g.YANMO = g.YANMO || {};
  Y.version = INFO.version;
  Y.date = INFO.date;
  Y.repo = INFO.repo;
  Y.label = "研墨 v" + INFO.version;
  Y.changelog = INFO.repo + "/blob/main/CHANGELOG.md";
  if (typeof document === "undefined") return;

  function paint() {
    var i, els = document.querySelectorAll("[data-ym-version]");
    for (i = 0; i < els.length; i++) els[i].textContent = "v" + INFO.version;
    var links = document.querySelectorAll("a[data-ym-changelog]");
    for (i = 0; i < links.length; i++) links[i].href = Y.changelog;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();

  /* 新版本上线后，Service Worker 换代会触发 controllerchange：提示刷新（首次安装不提示） */
  function showUpdate() {
    if (document.getElementById("ymUpdate")) return;
    var bar = document.createElement("div");
    bar.id = "ymUpdate";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:400;background:#1b2434;color:#fff;" +
      "border-radius:12px;padding:10px 14px;font-size:13.5px;box-shadow:0 10px 30px rgba(2,6,23,.3);display:flex;gap:10px;align-items:center";
    var t = document.createElement("span");
    t.textContent = "研墨已更新到新版本，刷新页面后生效";
    var ok = document.createElement("button");
    ok.textContent = "刷新";
    ok.style.cssText = "border:none;border-radius:8px;padding:5px 12px;background:#2456e6;color:#fff;font-weight:600;cursor:pointer";
    ok.onclick = function () { location.reload(); };
    var later = document.createElement("button");
    later.textContent = "稍后";
    later.style.cssText = "border:1px solid #4b5563;border-radius:8px;padding:5px 10px;background:transparent;color:#d1d5db;cursor:pointer";
    later.onclick = function () { bar.remove(); };
    bar.appendChild(t); bar.appendChild(ok); bar.appendChild(later);
    document.body.appendChild(bar);
  }
  if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; }
      showUpdate();
    });
  }
  try { console.info("%c" + Y.label + "（" + INFO.date + "）", "color:#2456e6;font-weight:700", "更新日志：" + Y.changelog); } catch (e) {}
})(typeof self !== "undefined" ? self : this);

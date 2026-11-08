/* 构建研墨免安装 exe
 *
 *   node desktop/build.mjs            → dist/研墨-v<版本>-免安装.exe（Windows x64）
 *   node desktop/build.mjs --linux    → /tmp/yanmo-desktop-linux（本机冒烟测试用）
 *
 * 只依赖 Node 与 Go（不装任何 npm 包、不需要 Wine、不联网）。
 */
import { readFileSync, rmSync, mkdirSync, cpSync, existsSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const WEB = join(HERE, "web");
const DIST = join(ROOT, "dist");

const version = (readFileSync(join(ROOT, "assets/version.js"), "utf8").match(/version:\s*"([^"]+)"/) || [])[1];
if (!version) throw new Error("读不到 assets/version.js 里的版本号");

/* 1. 同步要嵌入的静态文件 */
rmSync(WEB, { recursive: true, force: true });
mkdirSync(WEB, { recursive: true });

const pages = ["index.html", "studio.html", "quick.html", "map.html", "try.html", "ai.html", "prompts.html", "tools.html", "workbench.html", "manifest.webmanifest", "sw.js"];
for (const f of pages) {
  const src = join(ROOT, f);
  if (!existsSync(src)) throw new Error("缺少文件：" + f);
  cpSync(src, join(WEB, f));
}
cpSync(join(ROOT, "assets"), join(WEB, "assets"), {
  recursive: true,
  filter: (src) => !/[\\/]screenshots([\\/]|$)/.test(src),
});

/* 桌面版不需要 Service Worker 的离线缓存（由 exe 内的 /sw.js 兜底），
   这里把页面里的注册调用改成静默尝试，避免旧缓存盖住新版本。 */
for (const f of pages.filter((x) => x.endsWith(".html"))) {
  const p = join(WEB, f);
  const s = readFileSync(p, "utf8")
    .replace(/navigator\.serviceWorker\.register\((?:'sw\.js'|"sw\.js")\)\.catch\(\(\) => \{\}\)/g,
      "navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){})")
    /* 窗口标题带上版本号：一眼就能确认自己开的是不是新版 */
    .replace(/<title>([^<]*)<\/title>/i, (m, t) => `<title>${t} · v${version}</title>`);
  writeFileSync(p, s);
}

/* 1.5 预置 AI 配置：desktop/preset.json → 内置 assets/ym-preset.js
   浏览器带 Authorization 直连第三方常被 CORS 预检拦掉（服务商 OPTIONS 返回 405），
   桌面版统一走本机同源中转 /__ai/v1，不再受跨域限制。 */
const presetPath = join(HERE, "preset.json");
let presetNote = "（未配置）";
let upstream = "";
if (existsSync(presetPath)) {
  const pj = JSON.parse(readFileSync(presetPath, "utf8"));
  const conf = pj.conf || {};
  upstream = String(pj.upstream || "").replace(/\/+$/, "");
  const js = `/* 研墨桌面版 · 预置 AI 配置
 * 默认服务商是「研墨」（yingcompute）；腾讯 TokenHub 只作为可切换的测试通道，
 * 其 Key 单独存在 wenqu_ai_keys.tokenhub，切到该服务商时才带出。 */
window.__YM_DESKTOP__ = true;
(function () {
  var DEF = ${JSON.stringify({ ...conf, base: (pj.defaultBase || "https://api.yingcompute.com/api/v1"), key: "" })};
  var TESTKEY = ${JSON.stringify(pj.testKey || conf.key || "")};
  var K = "wenqu_ai", KM = "wenqu_ai_keys", KL = "wenqu_ai_models";
  try {
    var raw = localStorage.getItem(K);
    var cur = {};
    try { cur = JSON.parse(raw || "{}") || {}; } catch (e) { cur = {}; }
    var map = {};
    try { map = JSON.parse(localStorage.getItem(KM) || "{}") || {}; } catch (e) {}
    var b = String(cur.base || "");
    /* 只有在「完全没有配置」时才写默认值；已有配置一律不覆盖（否则每次换页都会把用户填的地址和 Key 清掉）。
       旧版桌面默认地址 /__ai/v1 只迁移一次：仅当还没有模型列表（v1.6 之前的配置）时才迁到研墨。 */
    if (!raw || !b) {
      cur = Object.assign({}, DEF, cur, { base: b || DEF.base });
      if (!cur.model) cur.model = DEF.model;
    } else if (b === "/__ai/v1" && !localStorage.getItem(KL)) {
      if (cur.key && !map.desktop) map.desktop = cur.key;
      cur = Object.assign({}, cur, DEF);
    }
    if (!cur.model) cur.model = DEF.model;
    localStorage.setItem(K, JSON.stringify(cur));
    if (TESTKEY) {
      if (!map.tokenhub) map.tokenhub = TESTKEY;
      if (!map.desktop) map.desktop = TESTKEY;
    }
    localStorage.setItem(KM, JSON.stringify(map));
  } catch (e) {}
})();
`;
  writeFileSync(join(WEB, "assets/ym-preset.js"), js);
  for (const f of pages.filter((x) => x.endsWith(".html"))) {
    const p = join(WEB, f);
    const tag = '<script src="assets/ym-preset.js"></script>';
    const s = readFileSync(p, "utf8");
    const withTag = /<meta charset="[^"]*">/i.test(s)
      ? s.replace(/<meta charset="[^"]*">/i, (m) => m + "\n" + tag)
      : s.replace(/<head>/i, "<head>\n" + tag);
    writeFileSync(p, withTag);
  }
  presetNote = `默认研墨 ${conf.model || "glm-5.3-flash"}；TokenHub 测试通道 ${upstream || "（无上游）"}`;
}

/* 2. 生成 exe */
mkdirSync(DIST, { recursive: true });
const isLinux = process.argv.includes("--linux");
const out = isLinux
  ? "/tmp/yanmo-desktop-linux"
  : join(DIST, `研墨-v${version}-免安装.exe`);

const env = {
  ...process.env,
  CGO_ENABLED: "0",
  GOOS: isLinux ? "linux" : "windows",
  GOARCH: isLinux ? "amd64" : "amd64",
  GOFLAGS: "-mod=mod",
};
const ldflags = ["-s", "-w", `-X main.appVersion=${version}`];
if (upstream) ldflags.push(`-X main.aiUpstream=${upstream}`);
if (!isLinux) ldflags.push("-H", "windowsgui");

execFileSync("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags", ldflags.join(" "), "-o", out, "."], {
  cwd: HERE,
  env,
  stdio: "inherit",
});

const size = statSync(out).size;
console.log(`\n✓ 研墨 v${version} ${isLinux ? "Linux 测试版" : "免安装版"}`);
console.log("  " + out);
console.log("  " + (size / 1024 / 1024).toFixed(1) + " MB");
console.log("  预置 AI：" + presetNote);

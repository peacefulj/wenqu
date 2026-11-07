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

const pages = ["index.html", "studio.html", "quick.html", "map.html", "try.html", "tools.html", "workbench.html", "manifest.webmanifest", "sw.js"];
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
      "navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){})");
  writeFileSync(p, s);
}

/* 1.5 预置 AI 配置：desktop/preset.json → 内置 assets/ym-preset.js
   只在用户本机还没填过 Key 时写入，不会覆盖用户自己的配置。 */
const presetPath = join(HERE, "preset.json");
let presetNote = "（未配置）";
if (existsSync(presetPath)) {
  const conf = JSON.parse(readFileSync(presetPath, "utf8")).conf || {};
  const js = `/* 研墨桌面版 · 预置 AI 配置（仅首次运行写入，之后以你在设置里保存的为准） */
(function () {
  var P = ${JSON.stringify(conf)};
  var K = "wenqu_ai";
  try {
    var cur = {};
    try { cur = JSON.parse(localStorage.getItem(K) || "{}") || {}; } catch (e) {}
    if (cur.key) return;
    localStorage.setItem(K, JSON.stringify(Object.assign({}, cur, P)));
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
  presetNote = `${conf.model} @ ${conf.base}`;
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

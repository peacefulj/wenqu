#!/usr/bin/env node
/* 研墨 · 发版脚本 scripts/release.mjs
 * 用法：node scripts/release.mjs <新版本号> [--date YYYY-MM-DD] [--dry-run]
 *       node scripts/release.mjs --notes [版本号] [--out 文件]     输出某个版本的更新说明（给 gh release 用）
 * 发版时做的事（规则见 CONTRIBUTING.md）：
 *   1. 校验：语义化版本号、比当前版本大、CHANGELOG「## [未发布]」下面有内容
 *   2. 同步改版本号：assets/version.js（含日期）、sw.js、package.json、README、各页面页脚
 *   3. CHANGELOG：「[未发布]」的内容归到「[新版本] - 日期」，顶部留一个空的「[未发布]」，更新底部对比链接
 *   4. 打印接下来的 git / gh 命令——不会自动提交、打标签或推送
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/peacefulj/wenqu";
const PAGES = "https://peacefulj.github.io/wenqu/";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const die = (m) => { console.error("✗ " + m); process.exit(1); };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const optOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function cmp(a, b) {
  const A = a.match(SEMVER), B = b.match(SEMVER);
  for (let i = 1; i <= 3; i++) { const d = (+A[i]) - (+B[i]); if (d) return d; }
  if (A[4] === B[4]) return 0;
  if (!A[4]) return 1;          // 1.2.0 > 1.2.0-beta
  if (!B[4]) return -1;
  return A[4] < B[4] ? -1 : 1;
}
function localDay() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
const curVersion = () => (read("assets/version.js").match(/version:\s*"([^"]+)"/) || [])[1];
/* 取 CHANGELOG 里某一节的正文（到下一个「## [」或底部链接为止） */
function sectionOf(cl, ver) {
  const m = cl.match(new RegExp("^## \\[" + reEsc(ver) + "\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]:\\s|(?![\\s\\S]))", "m"));
  return m ? m[1] : null;
}

/* ---------------- --notes：输出更新说明 ---------------- */
if (args[0] === "--notes") {
  const ver = (args[1] && !args[1].startsWith("--")) ? args[1] : curVersion();
  const body = sectionOf(read("CHANGELOG.md"), ver);
  if (body == null || !body.trim()) die("CHANGELOG.md 里没有 [" + ver + "] 的内容");
  const text = body.trim() + "\n\n---\n" +
    "**在线试用**：[试用与测试](" + PAGES + "try.html)（一键演示项目 + 示例文件 + 浏览器检测） · [科研工作台](" + PAGES + "studio.html) · [参考稿](" + PAGES + "quick.html) · [项目导图](" + PAGES + "map.html)\n\n" +
    "完整更新日志：" + REPO + "/blob/main/CHANGELOG.md\n";
  const out = optOf("--out");
  if (out) { writeFileSync(resolve(out), text); console.error("已写入 " + resolve(out)); }   // PowerShell 5.1 的「>」会存成 UTF-16，所以提供 --out
  else process.stdout.write(text);
  process.exit(0);
}

/* ---------------- 发版 ---------------- */
const next = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--date");
if (!next || !SEMVER.test(next)) die("用法：node scripts/release.mjs <新版本号，如 1.2.0> [--date YYYY-MM-DD] [--dry-run]");
const prev = curVersion();
if (!prev || !SEMVER.test(prev)) die("读不到 assets/version.js 里的当前版本号");
if (cmp(next, prev) <= 0) die("新版本 " + next + " 必须大于当前版本 " + prev);
const date = optOf("--date") || localDay();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die("日期格式应为 YYYY-MM-DD：" + date);

const changes = [];   // [文件, 新内容]——全部算好、校验通过后再一起写
function plan(file, fn, what) {
  const old = read(file), now = fn(old);
  if (now === old) die(file + "：没找到要改的" + what + "（文件格式变了？）");
  changes.push([file, now]);
}

let cl = read("CHANGELOG.md");
const unreleased = sectionOf(cl, "未发布");
if (unreleased == null) die("CHANGELOG.md 缺少「## [未发布]」一节");
if (!unreleased.trim()) die("CHANGELOG.md 的「## [未发布]」下面还是空的——先把这次的改动写进去");
if (new RegExp("^## \\[" + reEsc(next) + "\\]", "m").test(cl)) die("CHANGELOG.md 里已经有 [" + next + "]");
plan("CHANGELOG.md", (s) => {
  s = s.replace(/^## \[未发布\][^\n]*\n/m, "## [未发布]\n\n## [" + next + "] - " + date + "\n");
  const unrelLink = "[未发布]: " + REPO + "/compare/v" + next + "...HEAD";
  const verLink = "[" + next + "]: " + REPO + "/compare/v" + prev + "...v" + next;
  if (/^\[未发布\]:.*$/m.test(s)) s = s.replace(/^\[未发布\]:.*$/m, unrelLink + "\n" + verLink);
  else s = s.replace(/\s*$/, "\n\n" + unrelLink + "\n" + verLink + "\n");
  return s;
}, "「## [未发布]」");
plan("assets/version.js", (s) => s.replace(/version:\s*"[^"]+"/, 'version: "' + next + '"').replace(/date:\s*"[^"]+"/, 'date: "' + date + '"'), "版本号");
plan("sw.js", (s) => s.replace(/const VERSION = "[^"]+";/, 'const VERSION = "' + next + '";'), "VERSION");
plan("package.json", (s) => s.replace(/("version"\s*:\s*)"[^"]+"/, '$1"' + next + '"'), "version");
plan("README.md", (s) => s.replace(/(当前版本：\*\*v)[^*]+(\*\*)/, "$1" + next + "$2"), "「当前版本：**v…**」");
for (const h of readdirSync(ROOT).filter(f => f.endsWith(".html"))) {
  const t = read(h);
  if (/data-ym-version>/.test(t)) plan(h, (s) => s.replace(/(data-ym-version>)v[^<]*(<)/g, "$1v" + next + "$2"), "页脚版本号");
}

console.log((DRY ? "（演练，不写文件）" : "") + "研墨 v" + prev + " → v" + next + "（" + date + "）");
for (const [f, s] of changes) { if (!DRY) writeFileSync(join(ROOT, f), s); console.log("  ✎ " + f); }
console.log(`
下一步：
  1. node scripts/check.mjs                              # 自检，全部通过再继续
  2. git add -A
     git commit -m "release: v${next}"
  3. git tag -a v${next} -m "研墨 v${next}"
  4. git push origin main
     git push origin v${next}
  5. node scripts/release.mjs --notes ${next} --out release-notes.md
     gh release create v${next} --title "研墨 v${next}" --notes-file release-notes.md
     （发完删掉 release-notes.md）`);

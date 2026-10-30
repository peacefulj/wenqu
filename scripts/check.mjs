#!/usr/bin/env node
/* 研墨 · 发布前自检 scripts/check.mjs —— node scripts/check.mjs（或 npm run check）
 * 全部通过才可以打版本标签。检查内容：
 *   1 脚本语法（含页面内联脚本）  2 版本号一致  3 页面引用的文件都存在、都在 SW 离线缓存清单里
 *   4 ym-bib 文献格式自测  5 ym-export Markdown / LaTeX 自测  6 MCP 服务冒烟测试  7 文档与源码卫生
 * 零依赖，Node.js 18+。
 */
import { spawnSync, spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const list = (dir, re) => existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter(f => re.test(f)).map(f => (dir === "." ? "" : dir + "/") + f) : [];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let fails = 0, passes = 0;
const check = (cond, msg, detail) => {
  if (cond) { passes++; console.log("  ✓ " + msg); }
  else { fails++; console.log("  ✗ " + msg + (detail ? "\n      " + String(detail).replace(/\n/g, "\n      ") : "")); }
};
const section = (t) => console.log("\n" + t);

/* ---------------- 1 语法 ---------------- */
section("1. 脚本语法");
const jsFiles = [...list("assets", /\.js$/), "sw.js", ...list("mcp", /\.m?js$/), ...list("scripts", /\.m?js$/)];
const syntaxBad = [];
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ["--check", join(ROOT, f)], { encoding: "utf8" });
  if (r.status !== 0) syntaxBad.push(f + "：" + (r.stderr || "").trim().split("\n").slice(0, 5).join(" / "));
}
check(!syntaxBad.length, jsFiles.length + " 个脚本 node --check 通过", syntaxBad.join("\n"));
const htmls = list(".", /\.html$/);
const inlineBad = [];
let inlineN = 0;
for (const h of htmls) {
  for (const m of read(h).matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/type="(?!text\/javascript|module)/.test(m[1])) continue;
    inlineN++;
    try { new vm.Script(m[2], { filename: h }); } catch (e) { inlineBad.push(h + "：" + e.message); }
  }
}
check(!inlineBad.length, htmls.length + " 个页面的 " + inlineN + " 段内联脚本语法正确", inlineBad.join("\n"));

/* ---------------- 2 版本号 ---------------- */
section("2. 版本号一致");
const Y = require(join(ROOT, "assets/version.js")).YANMO;
const ver = Y.version;
check(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ver) && /^\d{4}-\d{2}-\d{2}$/.test(Y.date), "assets/version.js：v" + ver + "（" + Y.date + "）");
const swVer = (read("sw.js").match(/const VERSION = "([^"]+)"/) || [])[1];
check(swVer === ver, "sw.js 的 VERSION 与之一致", "sw.js 是 " + swVer);
const pkg = JSON.parse(read("package.json"));
check(pkg.version === ver, "package.json 的 version 与之一致", "package.json 是 " + pkg.version);
const cl = read("CHANGELOG.md");
const clDate = (cl.match(new RegExp("^## \\[" + reEsc(ver) + "\\] - (\\d{4}-\\d{2}-\\d{2})", "m")) || [])[1];
check(!!clDate, "CHANGELOG.md 有「## [" + ver + "] - 日期」一节");
check(clDate === Y.date, "CHANGELOG 里的发布日期与 version.js 一致", clDate + " ≠ " + Y.date);
check(/^## \[未发布\]/m.test(cl), "CHANGELOG.md 顶部保留「## [未发布]」");
const staleVer = [];
for (const h of htmls) for (const m of read(h).matchAll(/data-ym-version>v([^<]*)</g)) if (m[1] !== ver) staleVer.push(h + "：v" + m[1]);
check(!staleVer.length, "页面页脚的版本号都是 v" + ver, staleVer.join("，"));

/* ---------------- 3 引用与离线缓存 ---------------- */
section("3. 页面引用与离线缓存清单");
const shellSrc = (read("sw.js").match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || "";
const shell = JSON.parse("[" + shellSrc.replace(/,\s*$/, "") + "]");
const missingShell = shell.filter(u => u !== "./" && !existsSync(join(ROOT, u)));
check(shell.length > 10 && !missingShell.length, "SW 预缓存清单 " + shell.length + " 项都存在", missingShell.join("，"));
const refs = new Set(), orderBad = [];
for (const h of htmls) {
  const t = read(h), scripts = [];
  for (const m of t.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)="([^"#?]+)"/g)) {
    const u = m[2];
    if (/^(https?:|mailto:|data:|\/\/)/.test(u) || !/\.(js|css|webmanifest|png)$/.test(u)) continue;
    refs.add(u);
    if (m[1] === "script") scripts.push(u);
  }
  const at = (u) => scripts.indexOf("assets/" + u);
  if (at("wq-core.js") >= 0 && !(at("version.js") >= 0 && at("version.js") < at("wq-core.js"))) orderBad.push(h + "：version.js 要在 wq-core.js 之前");
  if (at("studio.js") >= 0 && !(at("ym-bib.js") >= 0 && at("ym-bib.js") < at("studio.js"))) orderBad.push(h + "：ym-bib.js 要在 studio.js 之前");
  ["ym-refs.js", "ym-pdf.js", "ym-export.js"].forEach(m => { if (at(m) >= 0 && at(m) < at("wb.js")) orderBad.push(h + "：" + m + " 要在 wb.js 之后"); });
  if (at("ym-sync.js") >= 0 && at("ym-sync.js") < at("wq-core.js")) orderBad.push(h + "：ym-sync.js 要在 wq-core.js 之后");
}
const missingRef = [...refs].filter(u => !existsSync(join(ROOT, u)));
check(!missingRef.length, "页面引用的 " + refs.size + " 个本地文件都存在", missingRef.join("，"));
const notCached = [...refs].filter(u => !shell.includes(u));
check(!notCached.length, "页面引用的本地文件都在预缓存清单里（离线可用）", notCached.join("，"));
const strays = list("assets", /\.(js|css)$/).filter(u => !shell.includes(u));
check(!strays.length, "assets/ 下的脚本和样式都在预缓存清单里", strays.join("，"));
check(!orderBad.length, "脚本加载顺序正确", orderBad.join("\n"));

/* ---------------- 4 ym-bib ---------------- */
section("4. ym-bib：文献格式");
const Bib = require(join(ROOT, "assets/ym-bib.js"));
const bibText = `@string{jfe = "Journal of Financial Economics"}
@article{fama2015five,
  title = {A five-factor asset pricing model},
  author = {Fama, Eugene F. and French, Kenneth R.},
  journal = jfe, volume = {116}, number = {1}, pages = {1--22}, year = {2015},
  doi = {10.1016/j.jfineco.2014.10.010}
}
@phdthesis{zhang2021,
  author = {张三 and 李四},
  title = {数字经济与农村共同富裕研究},
  school = {北京大学}, address = {北京}, year = {2021}
}`;
const r1 = Bib.parse(bibText);
check(r1.format === "bibtex" && r1.items.length === 2 && !r1.errors.length, "BibTeX 解析（含 @string 宏）", JSON.stringify({ format: r1.format, n: r1.items.length, errors: r1.errors }));
const ps1 = r1.items.map((c, i) => Object.assign(Bib.cslToPaper(c, "bibtex"), { id: "f" + i }));
const gb1 = Bib.gbList(ps1);
check(gb1[0] === "[1] FAMA E F, FRENCH K R. A five-factor asset pricing model[J]. Journal of Financial Economics, 2015, 116(1): 1-22. DOI: 10.1016/j.jfineco.2014.10.010.", "GB/T 7714 期刊条目", gb1[0]);
check(gb1[1] === "[2] 张三, 李四. 数字经济与农村共同富裕研究[D]. 北京: 北京大学, 2021.", "GB/T 7714 学位论文条目", gb1[1]);
const bibOut = Bib.toBibTeX(ps1);
check(/@article\{fama2015five,/.test(bibOut) && /pages\s*=\s*\{1--22\}/.test(bibOut), "BibTeX 输出保留引用键与页码");
check(/language\s*=\s*\{chinese\}/.test(bibOut) && !/language\s*=\s*\{zh\}/.test(bibOut), "中文条目 language = {chinese}（gbt7714 不认 zh）");
const back = Bib.parse(bibOut);
check(back.items.length === 2 && back.items[1].language === "zh", "BibTeX 往返：language 转回 CSL 的 zh", JSON.stringify(back.items.map(x => x.language)));
const ris = "TY  - JOUR\nAU  - Harris, Charles R.\nTI  - Array programming with NumPy\nT2  - Nature\nPY  - 2020\nVL  - 585\nIS  - 7825\nSP  - 357\nEP  - 362\nDO  - 10.1038/s41586-020-2649-2\nER  - \n";
const r2 = Bib.parse(ris);
check(r2.format === "ris" && r2.items.length === 1 && Bib.gbList(r2.items.map(c => Bib.cslToPaper(c, "ris")))[0] === "[1] HARRIS C R. Array programming with NumPy[J]. Nature, 2020, 585(7825): 357-362. DOI: 10.1038/s41586-020-2649-2.", "RIS 解析 → GB/T 7714");
const r3 = Bib.parse(Bib.toCSLJSON(ps1));
check(r3.format === "csl" && r3.items.length === 2, "CSL-JSON 往返");
const plan = Bib.planImport(ps1, r1.items.map(c => Bib.cslToPaper(c, "bibtex")));
check(plan.add.length === 0 && plan.dup.length === 2, "按 DOI / 题名查重", JSON.stringify({ add: plan.add.length, dup: plan.dup.length }));

/* ---------------- 5 ym-export ---------------- */
section("5. ym-export：Markdown / LaTeX");
const X = require(join(ROOT, "assets/ym-export.js"));
const ctx = X.newCtx(["ka", "kb", "kc", "kd"]);
const inl = X.inlineTex("见[1,2]与[3-4]、[1][4]，$x_1$ 增长 50% a_b #3 {x}", ctx);
check(inl === "见\\cite{ka,kb}与\\cite{kc,kd}、\\cite{ka,kd}，$x_1$ 增长 50\\% a\\_b \\#3 \\{x\\}", "正文 [n] → \\cite，特殊字符转义，公式原样保留", inl);
X.inlineTex("超出编号[9]", ctx);
check(ctx.unresolved.length === 1 && ctx.unresolved[0] === "[9]", "对不上文献库的 [n] 原样保留并报告");
check(X.inlineTex("约 $5 到 $10", X.newCtx()) === "约 \\$5 到 \\$10", "金额里的 $ 不当成公式");
const tbl = X.mdToTex("## 数据\n| 变量 | 来源 |\n| --- | --- |\n| x | [2] |\n- 第一点\n- 第二点", X.newCtx(["ka", "kb"]));
check(/\\subsection\{数据\}/.test(tbl) && /\\begin\{tabularx\}/.test(tbl) && /x & \\cite\{kb\} \\\\/.test(tbl) && /\\begin\{itemize\}/.test(tbl), "标题 / 表格 / 列表转换", tbl);
const papersX = [{ id: "f1", title: "Digital finance", author: "Smith J", year: "2021", venue: "JF", type: "J" }, { id: "f2", title: "数字普惠金融", author: "张三", year: "2020", venue: "经济研究", type: "J" }];
const envX = (md) => ({ YMBib: Bib, secs: [{ name: "引言", md: md }], paradigm: "定量", level: "期刊", ledger: null, checks: [], model: "m", stamp: "2026-10-30 12:00:00", day: "2026-10-30", label: "研墨 v" + ver, en: false });
const tex1 = X.buildLatex({ name: "P", topic: "T", papers: JSON.parse(JSON.stringify(papersX)) }, envX("正文[1]。"));
check(tex1.text.includes("\\begin{filecontents*}[overwrite]{yanmo-refs.bib}") && tex1.text.includes("\\bibliographystyle{gbt7714-numerical}") && tex1.cited === 1 && /^% \\nocite\{\*\}/m.test(tex1.text), "LaTeX：内嵌 .bib、gbt7714、有引用时 \\nocite 注释掉");
const tex2 = X.buildLatex({ name: "P", topic: "T", papers: JSON.parse(JSON.stringify(papersX)) }, envX("没有引用。"));
check(/^\\nocite\{\*\}/m.test(tex2.text) && tex2.cited === 0, "LaTeX：正文没有引用时列出全部文献（\\nocite{*}）");
const md1 = X.buildMarkdown({ name: "P", topic: "T", papers: papersX }, envX("第一段[1]\n第二段\n## 小节\n内容"));
check(md1.text.startsWith("---\ntitle: \"T\"") && md1.text.includes("第一段[1]\n\n第二段") && md1.text.includes("### 小节") && md1.text.includes("## 参考文献"), "Markdown：front matter、每行一段、节内标题降级、参考文献");

/* ---------------- 6 MCP ---------------- */
section("6. MCP 服务冒烟测试");
await (async function mcpSmoke() {
  const dir = mkdtempSync(join(tmpdir(), "yanmo-check-"));
  const file = join(dir, "yanmo-sync.json");
  const sample = {
    format: "yanmo-backup", formatVersion: 2, app: "研墨", appVersion: ver, exportedAt: "2026-10-30 12:00:00", cur: "p1",
    projects: [{
      id: "p1", name: "测试项目", topic: "数字金融与农户创业", status: "写作中", paradigm: "quant", level: "journal",
      selection: "选题卡：数字金融对农户创业的影响", outline: "1 引言\n2 文献综述",
      draft: { "引言": "数字金融发展迅速[1]，农户创业受到关注[2]。" },
      ref: { order: ["引言", "文献综述"], sections: { "引言": "参考稿引言", "文献综述": { text: "参考稿综述：普惠金融" } } },
      papers: [
        { id: "f1", title: "Digital finance and entrepreneurship", author: "Smith J，Lee K", year: "2021", venue: "Journal of Finance", doi: "10.1111/jofi.13000", type: "J", abs: "We study digital finance.",
          pdf: { name: "smith.pdf", pages: 30 }, annots: [{ id: "a1", page: 3, text: "digital finance increases entrepreneurship", note: "核心结论", color: "y", rects: [[0.1, 0.2, 0.3, 0.02]] }],
          reading: { ts: "2026-10-30 10:00:00", model: "glm", md: "## 一句话概括\n数字金融促进创业（第3页）" } },
        { id: "f2", title: "数字普惠金融与农村创业", author: "张三，李四", year: "2020", venue: "经济研究", type: "J" }
      ],
      trail: [{ ts: "2026-10-30 11:00:00", type: "ai", label: "AI 精读", note: "Smith" }], versions: []
    }, { id: "p2", name: "另一个项目", topic: "", papers: [], draft: {} }],
    archives: {}
  };
  writeFileSync(file, "\uFEFF" + JSON.stringify(sample));   // 带 BOM：服务要能去掉
  const child = spawn(process.execPath, [join(ROOT, "mcp/yanmo-mcp.mjs"), "--file", file], { stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map(), junk = [];
  let buf = "", nextId = 1;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { junk.push(line); continue; }
      const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w(msg); }
    }
  });
  const call = (method, params) => new Promise((res, rej) => {
    const id = nextId++;
    const t = setTimeout(() => { waiting.delete(id); rej(new Error("等待 " + method + " 超时")); }, 10000);
    waiting.set(id, (m) => { clearTimeout(t); res(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const tool = async (name, args) => (await call("tools/call", { name, arguments: args || {} })).result || {};
  const text = (r) => (r.content && r.content[0] && r.content[0].text) || "";
  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "0" } });
    check(init.result && init.result.protocolVersion === "2025-06-18" && init.result.serverInfo.version === ver && init.result.capabilities.tools, "initialize：协议 2025-06-18，服务版本 v" + ver, JSON.stringify(init));
    const old = await call("initialize", { protocolVersion: "2024-11-05" });
    check(old.result && old.result.protocolVersion === "2024-11-05", "兼容旧协议 2024-11-05");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const tl = await call("tools/list", {});
    const names = ((tl.result && tl.result.tools) || []).map(t => t.name);
    const want = ["list_projects", "get_project", "read_section", "list_papers", "get_paper", "search", "export_references", "get_annotations"];
    check(want.every(n => names.includes(n)) && tl.result.tools.every(t => t.inputSchema && t.inputSchema.type === "object" && t.annotations && t.annotations.readOnlyHint), "tools/list：" + names.length + " 个只读工具");
    let r = await tool("list_projects");
    check(!r.isError && /\* \[当前\] 测试项目/.test(text(r)) && /另一个项目/.test(text(r)), "list_projects", text(r));
    r = await tool("get_project", { project: "测试" });
    check(!r.isError && /## 各节/.test(text(r)) && /引言：我的稿/.test(text(r)) && /AI 精读/.test(text(r)), "get_project（按名称片段找项目）", text(r));
    r = await tool("read_section", { section: "引言" });
    check(!r.isError && text(r).includes("数字金融发展迅速[1]"), "read_section 我的稿", text(r));
    r = await tool("read_section", { section: "综述", source: "ref" });
    check(!r.isError && text(r).includes("普惠金融"), "read_section 参考稿（节名片段）", text(r));
    r = await tool("list_papers", { query: "digital" });
    check(!r.isError && text(r).includes("[1] Digital finance") && !text(r).includes("[2]"), "list_papers 筛选", text(r));
    r = await tool("get_paper", { n: 1 });
    check(!r.isError && text(r).includes("SMITH J, LEE K") && text(r).includes("核心结论") && text(r).includes("一句话概括"), "get_paper：GB/T 引文 + 批注 + 精读", text(r));
    r = await tool("get_paper", { title: "普惠" });
    check(!r.isError && text(r).startsWith("[2] 数字普惠金融与农村创业"), "get_paper 按题名关键词", text(r));
    r = await tool("search", { query: "核心结论" });
    check(!r.isError && text(r).includes("批注 [1] 第 3 页"), "search 搜到 PDF 批注笔记", text(r));
    r = await tool("export_references", { format: "bibtex" });
    check(!r.isError && /@article\{smith2021digital,/.test(text(r)) && /language\s*=\s*\{chinese\}/.test(text(r)), "export_references BibTeX", text(r));
    r = await tool("export_references", {});
    check(!r.isError && text(r).includes("[2] 张三, 李四. 数字普惠金融与农村创业[J]. 经济研究, 2020."), "export_references GB/T 7714（默认）", text(r));
    r = await tool("get_annotations", {});
    check(!r.isError && text(r).includes("第 3 页") && text(r).includes("笔记：核心结论"), "get_annotations", text(r));
    r = await tool("get_project", { project: "不存在的项目" });
    check(r.isError === true && text(r).includes("找不到项目"), "找不到项目时返回 isError", text(r));
    const unk = await call("tools/call", { name: "no_such_tool", arguments: {} });
    check(unk.error && unk.error.code === -32602, "未知工具返回 -32602");
    const um = await call("no/such/method", {});
    check(um.error && um.error.code === -32601, "未知方法返回 -32601");
    sample.projects[0].name = "测试项目（已改名）";
    writeFileSync(file, JSON.stringify(sample));
    r = await tool("list_projects");
    check(text(r).includes("测试项目（已改名）"), "数据文件更新后立即读到新内容", text(r));
    check(!junk.length, "stdout 只有协议消息（日志都在 stderr）", junk.join("\n"));
  } catch (e) {
    check(false, "MCP 冒烟测试运行", e.message);
  } finally {
    child.stdin.end(); child.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
})();

/* ---------------- 7 卫生 ---------------- */
section("7. 文档与源码卫生");
const mds = list(".", /\.md$/);
const liquid = mds.filter(f => /\{\{|\{%/.test(read(f)));
check(!liquid.length, mds.length + " 个 Markdown 文档里没有 {{ / {%（GitHub Pages 的 Jekyll 会把它们当模板）", liquid.join("，"));
const oddChar = [...jsFiles.filter(f => !f.startsWith("assets/vendor")), ...htmls].filter(f => /[\uFFFE\uFFFF]/.test(read(f)));
check(!oddChar.length, "源码里没有 U+FFFE / U+FFFF 这类不可见字符", oddChar.join("，"));
const placeholder = htmls.filter(h => /feedback@example\.com/.test(read(h)));
check(!placeholder.length, "页面里没有占位邮箱", placeholder.join("，"));

console.log("\n" + (fails ? "✗ " + fails + " 项未通过，" + passes + " 项通过" : "✓ 全部 " + passes + " 项通过（v" + ver + "）"));
process.exit(fails ? 1 : 0);

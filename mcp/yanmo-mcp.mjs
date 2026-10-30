#!/usr/bin/env node
/* 研墨 MCP 服务（只读）mcp/yanmo-mcp.mjs —— v1.1.0 新增
 * 让 Claude Desktop / Cursor / Cherry Studio 等支持 MCP 的 AI 客户端读取你的研墨项目：
 *   项目概况、各节正文、文献库、PDF 批注与 AI 精读、全文搜索、参考文献导出（BibTeX / RIS / CSL-JSON / GB/T 7714）。
 * 数据来源：研墨工作台「🔄 本地同步」写出的 .json，或「⤓ 备份全部」导出的备份文件。
 * 只读：不改任何文件、不联网。零依赖，Node.js 18+。协议：MCP over stdio（JSON-RPC 2.0，每行一条消息）。
 * 用法：node mcp/yanmo-mcp.mjs --file "D:/研墨/yanmo-sync.json"     （也可以用环境变量 YANMO_FILE）
 */
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const B = require(resolve(HERE, "../assets/ym-bib.js"));
const VERSION = (() => {
  try { return require(resolve(HERE, "../assets/version.js")).YANMO.version; }
  catch (e) {
    try { return (readFileSync(resolve(HERE, "../assets/version.js"), "utf8").match(/version:\s*"([^"]+)"/) || [])[1] || "0.0.0"; } catch (e2) { return "0.0.0"; }
  }
})();
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/* ---------------- 参数 ---------------- */
function argOf(name) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1];
    if (argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1);
  }
  return undefined;
}
const FILE = argOf("--file") || process.env.YANMO_FILE || "";
const USAGE = `研墨 MCP 服务 v${VERSION}（只读）

用法：node mcp/yanmo-mcp.mjs --file <研墨同步文件或备份文件.json>
      也可以设置环境变量 YANMO_FILE

数据文件怎么来：研墨工作台左侧「🔄 开启本地同步」选一个位置（推荐，自动保持最新），
               或「⤓ 备份全部」导出的 yanmo-backup-日期.json。

Claude Desktop 配置示例（claude_desktop_config.json）：
{
  "mcpServers": {
    "yanmo": { "command": "node", "args": ["<仓库路径>/mcp/yanmo-mcp.mjs", "--file", "D:/研墨/yanmo-sync.json"] }
  }
}`;
if (process.argv.includes("--help") || process.argv.includes("-h")) { process.stdout.write(USAGE + "\n"); process.exit(0); }
if (process.argv.includes("--version")) { process.stdout.write(VERSION + "\n"); process.exit(0); }
const log = (...a) => process.stderr.write("[yanmo-mcp] " + a.join(" ") + "\n");   // stdout 只能走协议消息

/* ---------------- 读数据（文件变了才重读，同步文件更新后立即可见） ---------------- */
let cache = { mtime: -1, size: -1, data: null };
function load() {
  if (!FILE) throw new Error("没有指定数据文件：启动参数加 --file <研墨同步文件.json>（或设置环境变量 YANMO_FILE）。同步文件在研墨工作台左侧「🔄 开启本地同步」里创建。");
  let st;
  try { st = statSync(FILE); } catch (e) { throw new Error("找不到数据文件：" + FILE + "。请确认路径；同步文件在研墨工作台左侧「🔄 开启本地同步」里创建。"); }
  if (cache.data && st.mtimeMs === cache.mtime && st.size === cache.size) return cache.data;
  const raw = readFileSync(FILE, "utf8").replace(/^\uFEFF/, "");
  let d;
  try { d = JSON.parse(raw); } catch (e) { throw new Error("数据文件不是有效的 JSON（可能正在写入，稍后重试）：" + e.message); }
  const projects = Array.isArray(d && d.projects) ? d.projects : null;
  if (!projects) throw new Error("数据文件里没有 projects 列表——请使用研墨「本地同步」或「⤓ 备份全部」生成的文件");
  cache = {
    mtime: st.mtimeMs, size: st.size,
    data: {
      projects: projects.filter(p => p && typeof p === "object" && !Array.isArray(p)).map(p => { p.papers = Array.isArray(p.papers) ? p.papers.filter(f => f && typeof f === "object") : []; return p; }),
      cur: typeof d.cur === "string" ? d.cur : null,
      exportedAt: str(d.exportedAt), appVersion: str(d.appVersion)
    }
  };
  return cache.data;
}

/* ---------------- 工具函数 ---------------- */
function str(x) { return x == null ? "" : String(x); }
const len = (s) => str(s).replace(/\s+/g, "").length;
const EMOJI = { y: "🟨", g: "🟩", b: "🟦", r: "🟥" };
function pickProject(data, q) {
  const ps = data.projects;
  if (!ps.length) throw new Error("数据文件里还没有项目");
  if (q == null || str(q).trim() === "") return ps.find(p => p.id === data.cur) || ps[0];
  const s = str(q).trim(), low = s.toLowerCase();
  const hit = ps.find(p => p.id === s) || ps.find(p => str(p.name) === s) || ps.find(p => str(p.topic) === s);
  if (hit) return hit;
  const many = ps.filter(p => (str(p.name) + " " + str(p.topic)).toLowerCase().includes(low));
  if (many.length === 1) return many[0];
  const names = (list) => list.map(p => "「" + str(p.name) + "」（id: " + p.id + "）").join("、");
  if (many.length > 1) throw new Error("「" + s + "」匹配到多个项目：" + names(many) + "——请改用项目 id");
  throw new Error("找不到项目「" + s + "」。现有项目：" + names(ps));
}
function refText(p, s) {
  const e = p.ref && p.ref.sections && p.ref.sections[s];
  return typeof e === "string" ? e : str(e && e.text);
}
function sectionNames(p) {
  const seen = new Set(), out = [];
  const push = (x) => { x = str(x).trim(); if (x && !seen.has(x)) { seen.add(x); out.push(x); } };
  ((p.ref && p.ref.order) || []).forEach(push);
  Object.keys(p.draft || {}).forEach(push);
  Object.keys((p.ref && p.ref.sections) || {}).forEach(push);
  return out;
}
function pickPaper(p, a) {
  const list = p.papers;
  if (a.n != null && a.n !== "") {
    const i = parseInt(a.n, 10);
    if (i >= 1 && i <= list.length) return { f: list[i - 1], n: i };
    throw new Error("文献编号超出范围：文献库共 " + list.length + " 篇");
  }
  const find = (pred) => { const i = list.findIndex(pred); return i >= 0 ? { f: list[i], n: i + 1 } : null; };
  let r = null;
  if (a.id) r = find(f => f.id === a.id);
  if (!r && a.key) { B.ensureKeys(list); r = find(f => f.key === a.key); }
  if (!r && a.title) {
    const t = str(a.title).toLowerCase();
    const hits = list.map((f, i) => ({ f, n: i + 1 })).filter(x => str(x.f.title).toLowerCase().includes(t));
    if (hits.length > 1) throw new Error("题名包含「" + a.title + "」的有 " + hits.length + " 篇：" + hits.slice(0, 8).map(x => "[" + x.n + "] " + str(x.f.title).slice(0, 40)).join("；") + "——请用编号 n");
    r = hits[0] || null;
  }
  if (!r) throw new Error("没找到这篇文献：请用 n（编号）、id、key（引用键）或 title（题名关键词）指定");
  return r;
}
function paperLine(f, n) {
  const flags = [f.doi ? "DOI " + f.doi : "", f.key ? "键 " + f.key : "", f.abs ? "有摘要" : "", f.pdf ? "PDF" : "", (f.annots || []).length ? (f.annots.length + " 条批注") : "", f.reading ? "AI 精读" : ""].filter(Boolean).join(" · ");
  return "[" + n + "] " + str(f.title || "（无题名）") + " — " + (str(f.author) || "作者待补") + (f.year ? "（" + f.year + "）" : "") + (f.venue ? " · " + f.venue : "") + (flags ? "\n    " + flags : "");
}
function sortAnnots(list) {
  return (list || []).slice().sort((a, b) => ((+a.page || 0) - (+b.page || 0)) || ((((a.rects || [])[0] || [0, 0])[1]) - (((b.rects || [])[0] || [0, 0])[1])));
}
function annotsMd(f, n) {
  const list = sortAnnots(f.annots);
  if (!list.length) return "";
  let md = "## [" + n + "] " + str(f.title) + "\n", page = null;
  list.forEach(a => {
    if (a.page !== page) { page = a.page; md += "\n第 " + (page || "?") + " 页\n"; }
    md += "- " + (EMOJI[a.color] || "🟨") + " “" + str(a.text).replace(/\s+/g, " ") + "”" + (a.note ? "\n  笔记：" + str(a.note).replace(/\n/g, " ") : "") + "\n";
  });
  return md;
}
function cut(s, max) { s = str(s); return s.length > max ? s.slice(0, max) + "\n…（共 " + s.length + " 字，已截断；用 read_section 读全文）" : s; }

/* ---------------- 工具实现 ---------------- */
const IMPL = {
  list_projects() {
    const d = load();
    const head = "共 " + d.projects.length + " 个项目" + (d.exportedAt ? "（数据写入时间 " + d.exportedAt + (d.appVersion ? " · 研墨 v" + d.appVersion : "") + "）" : "");
    return [head].concat(d.projects.map(p => {
      const drafted = Object.keys(p.draft || {}).filter(k => str(p.draft[k]).trim()).length;
      return (p.id === d.cur ? "* [当前] " : "* ") + str(p.name) + "（id: " + p.id + "）" + "\n    主题：" + (str(p.topic) || "未填") + " · 状态：" + (str(p.status) || "—") +
        " · 文献 " + p.papers.length + " 篇 · 我的稿 " + drafted + " 节" + (p.ref ? " · 有参考稿" : "") + " · 范式 " + str(p.paradigm || "quant") + " · 层级 " + str(p.level || "journal");
    })).join("\n");
  },

  get_project(a) {
    const p = pickProject(load(), a.project);
    const L = ["# " + str(p.name), "id: " + p.id + " · 主题：" + (str(p.topic) || "未填") + " · 状态：" + str(p.status) + " · 范式 " + str(p.paradigm || "quant") + " · 层级 " + str(p.level || "journal") + (p.createdAt ? " · 创建于 " + p.createdAt : "")];
    if (p.selection) L.push("", "## 选题卡", cut(p.selection, 4000));
    if (p.outline) L.push("", "## 大纲", cut(p.outline, 4000));
    const secs = sectionNames(p);
    L.push("", "## 各节（read_section 读全文）");
    if (!secs.length) L.push("（还没有正文）");
    secs.forEach(s => L.push("- " + s + "：我的稿 " + len((p.draft || {})[s]) + " 字" + (p.ref ? " · 参考稿 " + len(refText(p, s)) + " 字" : "")));
    const fs = p.papers;
    L.push("", "## 文献库", fs.length + " 篇（带摘要 " + fs.filter(f => f.abs).length + " · 有 PDF " + fs.filter(f => f.pdf).length + " · 批注 " + fs.reduce((n, f) => n + (f.annots || []).length, 0) + " 条 · AI 精读 " + fs.filter(f => f.reading).length + " 篇）");
    if (Array.isArray(p.datacards) && p.datacards.length) {
      L.push("", "## 数据卡");
      p.datacards.forEach(c => L.push("- " + str(c && c.name) + "｜来源：" + (str(c && c.source) || "未填") + (c && c.vars ? "｜变量：" + str(c.vars).replace(/\n/g, "；") : "")));
    }
    if (Array.isArray(p.checks) && p.checks.length) {
      const latest = {};
      p.checks.forEach(c => { if (c && c.kind && !latest[c.kind]) latest[c.kind] = c; });
      L.push("", "## 校验记录（各类最近一次）");
      Object.keys(latest).forEach(k => { const c = latest[k]; L.push("- " + str(c.label || k) + "：" + (c.stats && c.stats.problem != null ? (c.stats.problem ? c.stats.problem + " 项待处理" : "通过") : "") + "（" + str(c.ts) + "）"); });
    }
    const tr = Array.isArray(p.trail) ? p.trail.slice(0, 15) : [];
    if (tr.length) {
      L.push("", "## 最近的项目轨迹");
      tr.forEach(t => L.push("- " + str(t.ts) + " · " + str(t.label) + (t.note ? " — " + str(t.note) : "")));
    }
    L.push("", "版本档案：" + (Array.isArray(p.versions) ? p.versions.length : 0) + " 版");
    return L.join("\n");
  },

  read_section(a) {
    const p = pickProject(load(), a.project);
    const secs = sectionNames(p);
    const src = a.source === "ref" ? "ref" : "mine";
    if (!a.section) return "「" + str(p.name) + "」的各节：\n" + (secs.map(s => "- " + s + "（我的稿 " + len((p.draft || {})[s]) + " 字" + (p.ref ? " / 参考稿 " + len(refText(p, s)) + " 字" : "") + "）").join("\n") || "（还没有正文）");
    const want = str(a.section).trim();
    const name = secs.find(s => s === want) || secs.find(s => s.includes(want)) || secs.find(s => want.includes(s));
    if (!name) throw new Error("没有「" + want + "」这一节。现有：" + (secs.join("、") || "（无）"));
    const text = src === "ref" ? refText(p, name) : str((p.draft || {})[name]);
    if (!text.trim()) return "「" + name + "」的" + (src === "ref" ? "参考稿" : "我的稿") + "还是空的" + (src === "mine" && refText(p, name) ? "（有参考稿，可用 source=ref 读取）" : "");
    return "# " + name + "（" + (src === "ref" ? "AI 参考稿" : "我的稿") + " · " + len(text) + " 字）\n正文中的 [n] 对应文献库编号（list_papers / get_paper）\n\n" + text;
  },

  list_papers(a) {
    const p = pickProject(load(), a.project);
    const q = str(a.query).trim().toLowerCase();
    let rows = p.papers.map((f, i) => ({ f, n: i + 1 }));
    if (q) rows = rows.filter(({ f }) => [f.title, f.author, (f.authors || []).join(" "), f.venue, f.year, f.doi, f.key].map(str).join(" ").toLowerCase().includes(q));
    const off = Math.max(0, parseInt(a.offset, 10) || 0), lim = Math.min(500, Math.max(1, parseInt(a.limit, 10) || 100));
    const page = rows.slice(off, off + lim);
    return "「" + str(p.name) + "」文献库：" + (q ? "匹配「" + a.query + "」" + rows.length + " 篇" : "共 " + rows.length + " 篇") +
      (rows.length > page.length ? "，显示第 " + (off + 1) + "–" + (off + page.length) + " 篇" : "") + "\n\n" + (page.map(x => paperLine(x.f, x.n)).join("\n") || "（没有）");
  },

  get_paper(a) {
    const p = pickProject(load(), a.project);
    B.ensureKeys(p.papers);
    const { f, n } = pickPaper(p, a);
    const L = ["[" + n + "] " + str(f.title)];
    const authors = Array.isArray(f.authors) && f.authors.length ? f.authors.join("；") : str(f.author);
    L.push("作者：" + (authors || "待补"));
    L.push("年份：" + (str(f.year) || "—") + " · 出处：" + (str(f.venue) || "—") + " · 类型：" + (str(f.type) || "J"));
    if (f.doi || f.url) L.push((f.doi ? "DOI：" + f.doi : "") + (f.doi && f.url ? " · " : "") + (f.url ? "URL：" + f.url : ""));
    L.push("引用键：" + str(f.key), "GB/T 7714：" + B.gbEntry(B.paperToCSL(f), n));
    if (f.abs) L.push("", "摘要：" + str(f.abs));
    if (f.pdf) L.push("", "PDF：" + str(f.pdf.name) + (f.pdf.pages ? " · " + f.pdf.pages + " 页" : "") + "（原文件只在用户浏览器里，MCP 读不到；下面是批注与精读）");
    const am = annotsMd(f, n);
    if (am) L.push("", "批注（" + f.annots.length + " 条）：", am.replace(/^## [^\n]*\n/, ""));
    if (f.reading && f.reading.md) L.push("", "AI 精读（" + str(f.reading.ts) + (f.reading.model ? " · " + f.reading.model : "") + "，页码标注来自 PDF，可能有误）：", str(f.reading.md));
    return L.join("\n");
  },

  search(a) {
    const d = load();
    const terms = str(a.query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) throw new Error("请提供关键词 query");
    const lim = Math.min(200, Math.max(1, parseInt(a.limit, 10) || 30));
    const ps = a.project ? [pickProject(d, a.project)] : d.projects;
    const hits = [];
    const look = (p, where, text) => {
      const t = str(text); if (!t) return;
      const low = t.toLowerCase();
      if (!terms.every(w => low.includes(w))) return;
      const i = low.indexOf(terms[0]), s = Math.max(0, i - 50), e = Math.min(t.length, i + terms[0].length + 80);
      hits.push("· 「" + str(p.name) + "」" + where + "：" + (s ? "…" : "") + t.slice(s, e).replace(/\s+/g, " ") + (e < t.length ? "…" : ""));
    };
    for (const p of ps) {
      look(p, "项目名 / 主题", str(p.name) + " " + str(p.topic));
      look(p, "选题卡", p.selection); look(p, "大纲", p.outline); look(p, "研究设计", p.design); look(p, "文献矩阵", p.matrix);
      sectionNames(p).forEach(s => { look(p, "我的稿·" + s, (p.draft || {})[s]); if (p.ref) look(p, "参考稿·" + s, refText(p, s)); });
      Object.keys(p.outs || {}).forEach(k => { if (typeof p.outs[k] === "string") look(p, "产出·" + k, p.outs[k]); });
      p.papers.forEach((f, i) => {
        look(p, "文献 [" + (i + 1) + "]", [f.title, f.author, f.venue, f.year].map(str).join(" · "));
        look(p, "文献 [" + (i + 1) + "] 摘要", f.abs);
        (f.annots || []).forEach(an => look(p, "批注 [" + (i + 1) + "] 第 " + an.page + " 页", str(an.text) + (an.note ? " 〔笔记〕" + an.note : "")));
        if (f.reading) look(p, "AI 精读 [" + (i + 1) + "]", f.reading.md);
      });
      (Array.isArray(p.datacards) ? p.datacards : []).forEach(c => look(p, "数据卡", [c && c.name, c && c.source, c && c.vars].map(str).join(" ")));
      if (hits.length >= lim) break;
    }
    if (!hits.length) return "没有找到「" + a.query + "」";
    return "找到 " + (hits.length > lim ? lim + "+" : hits.length) + " 处「" + a.query + "」：\n" + hits.slice(0, lim).join("\n");
  },

  export_references(a) {
    const p = pickProject(load(), a.project);
    if (!p.papers.length) return "「" + str(p.name) + "」的文献库是空的";
    const fmt = str(a.format || "gbt7714").toLowerCase();
    if (fmt === "bibtex" || fmt === "bib") return B.toBibTeX(p.papers);
    if (fmt === "ris") return B.toRIS(p.papers);
    if (fmt === "csl-json" || fmt === "csl" || fmt === "json") return B.toCSLJSON(p.papers);
    if (fmt === "gbt7714" || fmt === "gb" || fmt === "gbt") return B.gbList(p.papers).join("\n");
    throw new Error("不支持的格式：" + a.format + "（可选 bibtex / ris / csl-json / gbt7714）");
  },

  get_annotations(a) {
    const p = pickProject(load(), a.project);
    if (a.n != null && a.n !== "") {
      const { f, n } = pickPaper(p, { n: a.n });
      return annotsMd(f, n) || "[" + n + "] 还没有批注";
    }
    const parts = p.papers.map((f, i) => annotsMd(f, i + 1)).filter(Boolean);
    return parts.length ? "# 「" + str(p.name) + "」的 PDF 批注\n\n" + parts.join("\n") : "「" + str(p.name) + "」还没有 PDF 批注（在研墨文献库「全文」列上传 PDF 后，选中文字即可高亮、写笔记）";
  }
};

const PROJECT = { type: "string", description: "项目 id 或名称（可只写一部分）；不填用研墨里当前打开的项目" };
const obj = (props, required) => Object.assign({ type: "object", properties: props, additionalProperties: false }, required ? { required } : {});
const TOOLS = [
  { name: "list_projects", description: "列出研墨里的全部研究项目：id、名称、主题、状态、文献数、已写节数", inputSchema: obj({}) },
  { name: "get_project", description: "查看一个项目的概况：选题卡、大纲、各节字数、文献库规模、数据卡、校验记录、最近的项目轨迹", inputSchema: obj({ project: PROJECT }) },
  { name: "read_section", description: "读取一节正文全文（不填 section 则列出所有节）。source=mine 是作者自己的稿（默认），ref 是 AI 参考稿。正文里的 [n] 对应文献库编号", inputSchema: obj({ project: PROJECT, section: { type: "string", description: "节名，如「引言」，可只写一部分" }, source: { type: "string", enum: ["mine", "ref"], description: "mine=我的稿（默认），ref=AI 参考稿" } }) },
  { name: "list_papers", description: "列出项目文献库（编号 [n] 与正文引用一致），可按题名 / 作者 / 期刊 / 年份 / DOI 筛选", inputSchema: obj({ project: PROJECT, query: { type: "string", description: "筛选关键词" }, limit: { type: "integer", minimum: 1, maximum: 500, description: "最多返回多少篇，默认 100" }, offset: { type: "integer", minimum: 0, description: "从第几篇开始（分页）" } }) },
  { name: "get_paper", description: "查看一篇文献的完整信息：题录、摘要、GB/T 7714 引文、PDF 批注、AI 精读笔记。用 n（编号）、id、key（引用键）或 title（题名关键词）指定", inputSchema: obj({ project: PROJECT, n: { type: "integer", minimum: 1, description: "文献编号 [n]" }, id: { type: "string", description: "文献 id" }, key: { type: "string", description: "BibTeX 引用键" }, title: { type: "string", description: "题名关键词" } }) },
  { name: "search", description: "全文搜索：正文各节、参考稿、选题卡、大纲、文献题名与摘要、PDF 批注与笔记、AI 精读、数据卡。多个词用空格分开（同时包含）", inputSchema: obj({ query: { type: "string", description: "关键词" }, project: { type: "string", description: "只搜这个项目；不填搜全部项目" }, limit: { type: "integer", minimum: 1, maximum: 200, description: "最多返回多少条，默认 30" } }, ["query"]) },
  { name: "export_references", description: "导出项目文献库的参考文献：BibTeX、RIS、CSL-JSON 或 GB/T 7714-2015 文本（默认）", inputSchema: obj({ project: PROJECT, format: { type: "string", enum: ["bibtex", "ris", "csl-json", "gbt7714"], description: "默认 gbt7714" } }) },
  { name: "get_annotations", description: "导出 PDF 批注（高亮原文 + 页码 + 笔记），按文献、页码排列；可只看第 n 篇", inputSchema: obj({ project: PROJECT, n: { type: "integer", minimum: 1, description: "只看第 n 篇" } }) }
];
TOOLS.forEach(t => { t.annotations = { readOnlyHint: true, openWorldHint: false }; });
const INSTRUCTIONS = "研墨（yanmo）是一个本地优先的论文写作工作台。这个服务只读地提供用户的研究项目：先用 list_projects / get_project 了解项目，read_section 读正文，list_papers / get_paper 查文献（正文里的 [n] 就是文献库编号），search 全文搜索，get_annotations 看 PDF 批注，export_references 导出参考文献。数据来自用户本机的同步文件，可能比浏览器里的稍旧。";

/* ---------------- JSON-RPC over stdio ---------------- */
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function handle(msg) {
  if (!msg || typeof msg !== "object") return send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  if (typeof method !== "string") return;   // 客户端发来的响应（本服务不发请求），忽略
  const reply = (result) => { if (isReq) send({ jsonrpc: "2.0", id, result }); };
  const fail = (code, message) => { if (isReq) send({ jsonrpc: "2.0", id, error: { code, message } }); };
  try {
    switch (method) {
      case "initialize": {
        const v = params && params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(v) ? v : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "yanmo", title: "研墨", version: VERSION },
          instructions: INSTRUCTIONS
        });
      }
      case "ping": return reply({});
      case "tools/list": return reply({ tools: TOOLS });
      case "tools/call": {
        const name = params && params.name, args = (params && params.arguments) || {};
        const fn = Object.prototype.hasOwnProperty.call(IMPL, name) ? IMPL[name] : null;
        if (!fn) return fail(-32602, "Unknown tool: " + name);
        try { return reply({ content: [{ type: "text", text: fn(args) }], isError: false }); }
        catch (e) { return reply({ content: [{ type: "text", text: "⚠ " + (e && e.message || e) }], isError: true }); }
      }
      case "resources/list": return reply({ resources: [] });
      case "resources/templates/list": return reply({ resourceTemplates: [] });
      case "prompts/list": return reply({ prompts: [] });
      default:
        if (method.startsWith("notifications/")) return;
        return fail(-32601, "Method not found: " + method);
    }
  } catch (e) { fail(-32603, (e && e.message) || String(e)); }
}
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
rl.on("close", () => process.exit(0));
log("v" + VERSION + " 已启动 · 数据文件：" + (FILE || "（未指定，用 --file 或 YANMO_FILE）"));

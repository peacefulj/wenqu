/* 文渠 · 文献工具箱 — 纯前端，官方公开 API（OpenAlex / Crossref / Unpaywall）+ 萤算 OpenAI 兼容接口 */
"use strict";

/* ---------- 通用 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function fetchJSON(url, opts = {}, timeout = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- 标签页 ---------- */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b === btn));
    document.querySelectorAll(".tabpane").forEach(p => p.hidden = p.id !== "tab-" + btn.dataset.tab);
  });
});

/* ============ Tab 1 找文献（OpenAlex） ============ */
const OA = "https://api.openalex.org/works";
const OA_SELECT = "id,display_name,publication_year,doi,open_access,best_oa_location,primary_location,authorships,type";
let oaMail = localStorage.getItem("wenqu_email") || "wenqu@users.noreply.github.com";

function oaLink(w) {
  const oa = w.open_access || {};
  const loc = w.best_oa_location || {};
  return oa.oa_url || loc.pdf_url || loc.landing_page_url || null;
}

async function doSearch() {
  const q = $("q").value.trim();
  const out = $("searchOut");
  if (!q) { out.innerHTML = '<p class="hint">请输入关键词或 DOI</p>'; return; }
  out.innerHTML = '<p class="hint">检索中…</p>';

  // 中文关键词 → 展示官方站跳转
  if (/[\u4e00-\u9fff]/.test(q)) {
    $("zhJump").hidden = false;
    $("jWf").href = "https://s.wanfangdata.com.cn/paper?q=" + encodeURIComponent(q);
    $("jBd").href = "https://xueshu.baidu.com/s?wd=" + encodeURIComponent(q);
  } else { $("zhJump").hidden = true; }

  try {
    let url;
    if (/^10\./.test(q)) url = `${OA}?filter=doi:https://doi.org/${encodeURIComponent(q)}&select=${OA_SELECT}&mailto=${oaMail}`;
    else url = `${OA}?search=${encodeURIComponent(q)}&per-page=10&select=${OA_SELECT}&mailto=${oaMail}`;
    const d = await fetchJSON(url);
    const rows = d.results || [];
    if (!rows.length) { out.innerHTML = '<p class="hint">没有命中。试试更宽的关键词，中文文献用上方官方站跳转。</p>'; return; }
    out.innerHTML = rows.map((w, i) => {
      const authors = (w.authorships || []).slice(0, 4).map(a => esc(a.author?.display_name || "")).join(", ");
      const venue = esc(w.primary_location?.source?.display_name || "");
      const pdf = oaLink(w);
      const doi = w.doi ? w.doi.replace("https://doi.org/", "") : "";
      return `<div class="rcard">
        <div class="rt"><a href="${esc(w.doi || w.id)}" target="_blank" rel="noopener">${i + 1}. ${esc(w.display_name)}</a></div>
        <div class="rmeta">${esc(w.publication_year || "")} · ${venue} · ${authors}${(w.authorships || []).length > 4 ? " 等" : ""}</div>
        <div class="rbtns">
          ${pdf ? `<a class="pill ok" href="${esc(pdf)}" target="_blank" rel="noopener">📥 免费 PDF</a>` : `<span class="pill no">无免费版</span>`}
          ${doi ? `<a class="pill" href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">DOI</a>` : ""}
          <a class="pill" href="${esc(w.id)}" target="_blank" rel="noopener">详情</a>
        </div>
      </div>`;
    }).join("") + `<p class="hint">免费 PDF = 出版社或机构仓库的合法开放版本。无免费版时可走兜底：向作者索要 / NSTL 传递 / 官方平台检索（科研工作台·工具台内有「求助」面板与数据库导航）。</p>`;
  } catch (e) {
    out.innerHTML = `<p class="hint">检索失败（${esc(e.message)}）。OpenAlex 偶发限流，稍等几秒重试。</p>`;
  }
}
$("btnSearch").addEventListener("click", doSearch);
$("q").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

/* ============ Tab 2 AI 读文献 ============ */
const AI_DEF = { base: "https://yingcompute.com/v1", model: "glm-5.3-flash" };
function loadAI() {
  try {
    const s = JSON.parse(localStorage.getItem("wenqu_ai") || "{}");
    $("aiBase").value = s.base || AI_DEF.base;
    $("aiKey").value = s.key || "";
    $("aiModel").value = s.model || AI_DEF.model;
  } catch { $("aiBase").value = AI_DEF.base; $("aiModel").value = AI_DEF.model; }
}
$("aiSave").addEventListener("click", () => {
  localStorage.setItem("wenqu_ai", JSON.stringify({
    base: $("aiBase").value.trim() || AI_DEF.base,
    key: $("aiKey").value.trim(),
    model: $("aiModel").value.trim() || AI_DEF.model,
  }));
  $("aiSave").textContent = "已保存 ✓"; setTimeout(() => $("aiSave").textContent = "保存设置", 1500);
});
loadAI();

/* PDF 提取 */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdf.worker.min.js";

let docText = "";
function setStat(n) { $("docStat").textContent = n ? `已导入 ${n} 字符（约 ${(n / 1000).toFixed(1)}k），可开始分析` : "未导入文档"; }

async function handleFile(f) {
  if (!f) return;
  $("docStat").textContent = `正在解析 ${f.name} …`;
  try {
    if (f.name.toLowerCase().endsWith(".pdf")) {
      if (!window.pdfjsLib) throw new Error("PDF 组件未加载（CDN 被拦截？请改用下方粘贴文本）");
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let parts = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        parts.push(tc.items.map(it => it.str).join(" "));
      }
      docText = parts.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    } else {
      docText = await f.text();
    }
    if (docText.length < 50) { docText = ""; throw new Error("没提取到文本（扫描版 PDF 无文字层）。请改用粘贴文本或换文字版 PDF"); }
    $("docText").value = docText;
    setStat(docText.length);
  } catch (e) {
    $("docStat").textContent = `解析失败：${e.message}`;
  }
}
$("file").addEventListener("change", e => handleFile(e.target.files[0]));
const dz = $("drop");
dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); handleFile(e.dataTransfer.files[0]); });
$("docText").addEventListener("input", () => { docText = $("docText").value; setStat(docText.length); });

/* 分析模板 */
const TMPL = {
  sum: "你是学术阅读助手。请对以下文献内容输出：1) 一句话概括；2) 研究问题与动机；3) 核心方法与数据；4) 主要发现（分点，保留关键数字）；5) 局限与可引用的结论。用简体中文，专业术语保留英文原文。",
  method: "你是学术阅读助手。请聚焦方法部分，输出：1) 研究设计框架；2) 数据来源与样本；3) 关键变量与模型设定（公式用文字描述）；4) 稳健性检验；5) 主要实证结果（保留系数与显著性）。用简体中文，术语保留英文。",
  crit: "你是审稿人视角的学术助手。请输出：1) 论文的核心贡献；2) 主要优点；3) 潜在弱点与隐含假设；4) 识别策略中可能的内生性问题；5) 如果我要在综述中引用它，适合用来支撑什么论点。用简体中文。",
  review: "你是综述写作助手。请把这篇文献整理成一张综述素材卡：1) 主题定位（一句话）；2) 可直接引用的论点清单（每条注明出现位置/章节）；3) 与同领域其他文献可能的对话点或分歧点；4) 检索关键词（中英）。用简体中文。",
  rev: "你是严格但建设性的期刊审稿人（ChatPaper审稿模式）。请对以下稿件模拟一份审稿意见：1) Summary（英文3句）；2) Strengths（3条）；3) Major Concerns（2-4条，具体到可操作）；4) Minor Issues（3-5条，语言/格式/图表）；5) Recommendation（Accept/Minor/Major/Reject 之一+一句理由）。中文撰写，术语保留英文。",
  trans: "你是学术翻译。请把以下内容完整翻译成学术简体中文：术语首次出现时括注英文原文；保留数字、公式、引用编号原样；长句按中文习惯拆分；不增删任何信息。译文后附「术语对照表」（5-10个关键术语）。",
};

async function callAI(userMsg) {
  const s = JSON.parse(localStorage.getItem("wenqu_ai") || "{}");
  const base = (s.base || AI_DEF.base).replace(/\/+$/, "");
  const key = s.key || "";
  const model = s.model || AI_DEF.model;
  if (!key) throw new Error("未配置 API Key：上方填入萤算 Key 并点保存设置");
  const r = await fetchJSON(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model, temperature: 0.3, max_tokens: 4096,
      messages: [{ role: "user", content: userMsg }],
    }),
  }, 180000);
  const txt = r.choices?.[0]?.message?.content;
  if (!txt) throw new Error("模型返回为空（检查 Key/模型名，或余额）");
  return txt;
}

async function analyze(prompt, label) {
  const text = docText || $("docText").value;
  if (!text || text.length < 50) { $("aiProg").textContent = "请先导入文档或粘贴至少 50 字文本"; return; }
  const out = $("aiOut"), prog = $("aiProg");
  out.hidden = false; $("btnCopy").hidden = true; out.textContent = "";
  const CHUNK = 6000;
  const chunks = text.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g")) || [];
  try {
    let result;
    if (chunks.length === 1) {
      prog.textContent = `正在分析（${label}）…`;
      result = await callAI(prompt + "\n\n【文献内容】\n" + chunks[0]);
    } else {
      const maps = [];
      for (let i = 0; i < chunks.length; i++) {
        prog.textContent = `长文分 ${chunks.length} 段，正在处理第 ${i + 1} 段（${label}）…`;
        maps.push(await callAI(prompt + "\n\n【文献内容·第" + (i + 1) + "段】\n" + chunks[i]));
      }
      prog.textContent = "正在合成整体分析…";
      result = await callAI("以下是一篇长文献分段处理后的结果，请合并为一份连贯、完整、去重的分析报告。\n\n" + maps.map((m, i) => `【第${i + 1}段结果】\n${m}`).join("\n\n"));
    }
    prog.textContent = `完成 ✓（${label} · ${text.length} 字符 · ${chunks.length} 段）`;
    out.textContent = result;
    $("btnCopy").hidden = false;
  } catch (e) {
    prog.textContent = "分析失败：" + e.message;
  }
}

document.querySelectorAll(".tp").forEach(b => b.addEventListener("click", () => analyze(TMPL[b.dataset.p], b.textContent.trim())));
$("customP").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.value.trim()) analyze(e.target.value.trim(), "自定义指令");
});
$("btnCopy").addEventListener("click", () => {
  navigator.clipboard.writeText($("aiOut").textContent).then(() => { $("btnCopy").textContent = "已复制 ✓"; setTimeout(() => $("btnCopy").textContent = "复制结果", 1500); });
});

/* ============ Tab 3 参考文献追踪 ============ */
const CROSSREF = "https://api.crossref.org/works";

/* citation.js（MIT，本地自托管）：识别 BibTeX / RIS 粘贴块并转为 APA 行，进统一追踪链。
   自由文本行仍走正则+Crossref（浏览器版 citation.js 不含自由文本解析插件）。 */
function getCiteLib() {
  try {
    const C = window.require && window.require("citation-js");
    return (typeof C === "function") ? C : null;
  } catch { return null; }
}

function looksLikeBibTeX(s) { return /@\w+\s*\{/.test(s); }
function looksLikeRIS(s) { return /^\s*TY\s{2}-\s/m.test(s); }

function normalizeRefs(raw) {
  raw = raw.trim();
  if (looksLikeBibTeX(raw) || looksLikeRIS(raw)) {
    const Cite = getCiteLib();
    if (Cite) {
      try {
        // 整块解析（多条 BibTeX/RIS 一次吃下），逐条输出 APA 文本行
        const c = new Cite(raw);
        const lines = c.format("bibliography", { format: "text", template: "apa" })
          .split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 12);
        if (lines.length) return { lines, via: "citation.js" };
      } catch { /* 落回正则 */ }
    }
    // citation.js 不可用/失败时：极简正则兜底（BibTeX 抽 title 字段，RIS 抽 TI 字段）
    const fallback = [];
    if (looksLikeBibTeX(raw)) {
      raw.replace(/@\w+\s*\{[^@]+\}/g, blk => {
        const t = blk.match(/title\s*=\s*[{"]([^}"]+)/i);
        const j = blk.match(/journal\s*=\s*[{"]([^}"]+)/i);
        const y = blk.match(/year\s*=\s*[{"]?(\d{4})/i);
        if (t) fallback.push([t[1], j && j[1], y && y[1]].filter(Boolean).join(". "));
        return blk;
      });
    } else {
      raw.split(/ER\s{2}-/).forEach(rec => {
        const t = rec.match(/TI\s{2}-\s*([^\n]+)/), j = rec.match(/(JO|T2|JA)\s{2}-\s*([^\n]+)/), y = rec.match(/PY\s{2}-\s*(\d{4})/);
        if (t) fallback.push([t[1].trim(), j && j[2].trim(), y && y[1]].filter(Boolean).join(". "));
      });
    }
    if (fallback.length) return { lines: fallback, via: "fallback" };
  }
  return { lines: parseRefs(raw), via: "line" };
}

function parseRefs(raw) {
  return raw.split(/\r?\n/)
    .map(l => l.replace(/^\s*\[\d+\]\s*/, "").replace(/^\s*\d+[.、)]\s*/, "").trim())
    .filter(l => l.length > 12);
}

function extractDOI(ref) {
  const m = ref.match(/10\.\d{4,9}\/[^\s"<>，。；]+/);
  if (!m) return null;
  return m[0].replace(/[.,;)\]]+$/, "");
}

async function oaByDOI(doi) {
  const d = await fetchJSON(`${OA}/https://doi.org/${encodeURIComponent(doi)}?select=display_name,publication_year,open_access,best_oa_location&mailto=${oaMail}`);
  return d;
}

async function upwByDOI(doi, email) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  try { return await fetchJSON(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`); }
  catch { return null; }
}

$("upEmail").value = localStorage.getItem("wenqu_email") || "";

async function runRefs() {
  const norm = normalizeRefs($("refs").value);
  const refs = norm.lines.slice(0, 30);
  const out = $("refOut"), prog = $("refProg");
  if (!refs.length) { out.innerHTML = '<p class="hint">请先粘贴参考文献（一行一条；也支持整段 BibTeX / RIS，自动识别）</p>'; return; }
  const email = $("upEmail").value.trim();
  if (email) { localStorage.setItem("wenqu_email", email); oaMail = email; }
  if (norm.via === "citation.js") prog.textContent = "已识别 BibTeX/RIS 格式（citation.js 解析 ✓）";

  document.querySelector(".prog").hidden = false;
  out.innerHTML = "";
  const rows = [];
  let found = 0;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    $("refBar").style.width = `${((i + 1) / refs.length) * 100}%`;
    prog.textContent = `第 ${i + 1}/${refs.length} 条：${ref.slice(0, 40)}…`;
    let doi = extractDOI(ref), matched = null, oaPdf = null, year = "";
    try {
      if (!doi) {
        const cr = await fetchJSON(`${CROSSREF}?query.bibliographic=${encodeURIComponent(ref.slice(0, 300))}&rows=1&mailto=${oaMail}`);
        const it = cr?.message?.items?.[0];
        if (it?.DOI) { doi = it.DOI; matched = it.title?.[0]; year = (it.issued?.["date-parts"]?.[0]?.[0]) || ""; }
      }
      if (doi) {
        const oa = await oaByDOI(doi);
        if (oa && !oa.error) {
          matched = matched || oa.display_name;
          year = year || oa.publication_year || "";
          const loc = oa.best_oa_location || {};
          oaPdf = (oa.open_access && oa.open_access.oa_url) || loc.pdf_url || loc.landing_page_url || null;
        }
        if (!oaPdf) {
          const u = await upwByDOI(doi, email);
          if (u && u.is_oa) oaPdf = (u.best_oa_location || {}).url_for_pdf || (u.best_oa_location || {}).url;
        }
      }
    } catch (e) { /* 单条失败不中断 */ }
    if (oaPdf) found++;
    rows.push(`
      <tr>
        <td>${i + 1}</td>
        <td class="mono">${esc(ref.slice(0, 90))}${ref.length > 90 ? "…" : ""}</td>
        <td>${matched ? esc(matched.slice(0, 60)) + (year ? ` <span class="yr">(${esc(year)})</span>` : "") : '<span class="hint">未匹配</span>'}</td>
        <td>${doi ? `<a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">DOI</a>` : "—"}</td>
        <td>${oaPdf ? `<a class="pill ok" href="${esc(oaPdf)}" target="_blank" rel="noopener">📥 免费</a>` : `<a class="pill no" href="https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent((matched || ref).slice(0, 60))}" target="_blank" rel="noopener">图书馆通道</a>`}</td>
      </tr>`);
    rows.push({ ref, matched, year, doi, oaPdf });
    out.innerHTML = `<table class="tb"><tr><th>#</th><th>你粘贴的条目</th><th>匹配论文</th><th>DOI</th><th>免费全文</th></tr>${rows.join("")}</table>`;
    await sleep(400); // 对官方接口保持礼貌限速
  }
  prog.innerHTML = `完成：${found}/${refs.length} 条找到合法免费版（${Math.round(found / refs.length * 100)}%）。其余走各条「图书馆通道」按钮到万方/百度学术检索。`;
  window.__lastRefRows = rows; // 供APA导出
}
$("btnRefs").addEventListener("click", runRefs);

/* APA 导出：把本次追踪的匹配结果（含 DOI）格式化为 APA 参考文献表 */
$("btnApa").addEventListener("click", async () => {
  const rows = window.__lastRefRows;
  const out = $("refOut"), prog = $("refProg");
  if (!rows || !rows.length) { prog.textContent = "先跑一次「开始追踪」再导出"; return; }
  const Cite = getCiteLib();
  if (!Cite) { prog.textContent = "citation.js 未加载（检查 assets/vendor/citation.min.js）"; return; }
  prog.textContent = "正在用追踪结果生成 APA 表…";
  const cites = [];
  for (const r of rows) {
    const doi = r.doi, title = r.matched || r.ref.slice(0, 80), year = r.year || "";
    if (doi) {
      try {
        const c = await Cite.async(doi);
        cites.push(c); await sleep(250); continue;
      } catch { /* 落回手工条目 */ }
    }
    cites.push(new Cite(`${title}. ${year}.`));
  }
  try {
    const merged = cites.reduce((a, b) => { a.add(b); return a; }, cites.shift());
    const apa = merged.format("bibliography", { format: "text", template: "apa", appendPlatform: false });
    const box = document.createElement("div");
    box.className = "aiout";
    box.style.marginTop = "10px";
    box.textContent = "APA 参考文献表（按追踪结果生成，作者大小写请人工复核）\n\n" + apa.trim().split(/\r?\n/).filter(Boolean).map((l, i) => `[${i + 1}] ${l}`).join("\n");
    out.appendChild(box);
    prog.textContent = "APA 导出完成 ✓";
  } catch (e) { prog.textContent = "导出失败：" + e.message; }
});

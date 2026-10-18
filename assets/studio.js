/* 文渠 · 科研工作台（合并平台）— 纯前端：项目存储(localStorage) + OpenAlex/Crossref + 萤算AI
 * v0.3：学科范式包×学位层级×个人写作档案（见 assets/paradigms.js）；含评审 P0 修复。
 */
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, opts = {}, timeout = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("请求超时");
    throw e;
  } finally { clearTimeout(t); }
}
function dlText(name, text, mime = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff", text], { type: mime + ";charset=utf-8" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- 存储与安全 ---------- */
const KEY = "wenqu_studio";
function loadDB() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { projects: [], cur: null };
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.projects)) return d;
      throw new Error("结构异常");
    } catch {
      const bk = KEY + ".bak-" + Date.now(); // 损坏原文先备份，绝不静默丢弃
      try { localStorage.setItem(bk, raw); } catch {}
      console.warn("studio 数据损坏，原文已备份到", bk);
      return { projects: [], cur: null };
    }
  } catch { return { projects: [], cur: null }; }
}
let DB = loadDB();
const save = () => {
  try {
    DB.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(DB));
    if (window.WQStore) window.WQStore.mirror(DB); // v1.0：全量镜像到 IndexedDB（防丢+可自愈）
  } catch (e) {
    /* v1.0 配额自愈：先把版本正文归档到 IndexedDB 减重，再重试一次 */
    if (window.WQStore && !save._healing) {
      save._healing = true;
      window.WQStore.archiveVersions(DB).then((r) => {
        save._healing = false;
        if (r && r.moved) {
          try { localStorage.setItem(KEY, JSON.stringify(DB)); wqNotice("存储空间已满：已把 " + r.moved + " 条版本正文归档到 IndexedDB（腾出约 " + Math.round(r.freedChars / 10000 * 10) / 10 + " 万字符），已自动保存。"); }
          catch (e2) { wqNotice("减重后仍保存失败：" + (e2?.message || e2) + "，请立即「⤓ 备份全部」。"); }
        } else {
          wqNotice("保存失败（存储空间已满或被禁用）：" + (e?.message || e) + "\n建议先「⤓ 备份全部」导出 JSON，再清理旧数据。");
        }
      });
      return;
    }
    wqNotice("保存失败（存储空间已满或被禁用）：" + (e?.message || e) + "\n建议先「⤓ 备份全部」导出 JSON，再清理旧数据。");
  }
};
const cur = () => DB.projects.find(p => p.id === DB.cur);

/* 范式 / 层级 */
const PQ = (p) => window.WQ_PARADIGMS.find(x => x.id === (p?.paradigm || "quant")) || window.WQ_PARADIGMS[0];
const LV = (p) => window.WQ_LEVELS.find(x => x.id === (p?.level || "journal")) || window.WQ_LEVELS[0];
(function migrate() { (DB.projects || []).forEach(p => {
  p.paradigm = p.paradigm || "quant"; p.level = p.level || "journal";
  /* v0.8：旧 processLog（「未留存」摘要）并入统一的项目轨迹 trail */
  if (p.processLog && p.processLog.length) {
    p.trail = (p.trail || []).concat(p.processLog.map(e => ({ ts: e.ts || "", type: "note", label: e.kind || "记录", note: e.note || "" })));
    if (p.trail.length > 200) p.trail.length = 200;
  }
  delete p.processLog;
  /* v1.0.1（QA P1-6 存量修正） */
  if (p.pipeline && p.pipeline.status === "failed" && p.status === "参考稿生成中") p.status = "参考稿中断（可续跑）";
}); })();

const newProject = (name, paradigm, level) => {
  const p = { id: "p" + Date.now(), name, topic: "", status: "选题中", createdAt: new Date().toISOString().slice(0, 10), selection: "", trend: null, papers: [], matrix: "", outline: "", design: "", draft: {}, paradigm: paradigm || "quant", level: level || "journal" };
  DB.projects.unshift(p); DB.cur = p.id; save(); return p;
};

/* ---------- 个人写作档案（跨项目共用，只存本机） ---------- */
const SKEY = "wenqu_style";
const getStyle = () => { try { return JSON.parse(localStorage.getItem(SKEY) || "{}"); } catch { return {}; } };
const setStyle = (o) => { try { localStorage.setItem(SKEY, JSON.stringify(o)); return true; } catch { return false; } };
function withMeta(txt, source) {
  const c = aiConf();
  return txt + "\n\n〔生成：" + (c.model || "未知名") + " · " + new Date().toISOString().slice(0, 10) + " · 依据：" + source + "〕";
}
function styleBlock() {
  const s = getStyle();
  const parts = [s.profileText, s.prefs].filter(Boolean);
  return parts.length ? "\n\n【作者写作档案——起草风格必须贴近此档案，这是「辅助写作」而非代写】\n" + parts.join("\n") : "";
}

/* ---------- AI ---------- */
const AI_DEF = { base: "https://yingcompute.com/v1", model: "glm-5.3-flash" };
function aiConf() { try { return { ...AI_DEF, ...JSON.parse(localStorage.getItem("wenqu_ai") || "{}") }; } catch { return { ...AI_DEF }; } }
async function callAI(userMsg, maxTokens = 4096) {
  const c = aiConf();
  if (!c.key) throw new Error("未配置 API Key（页头「AI / 接口设置」里填好并保存）");
  const r = await fetchJSON((c.base || AI_DEF.base).replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key },
    body: JSON.stringify({ model: c.model || AI_DEF.model, temperature: 0.3, max_tokens: maxTokens, messages: [{ role: "user", content: userMsg }] }),
  }, 180000);
  const ch = r.choices?.[0];
  const txt = ch?.message?.content;
  if (!txt) {
    if (ch?.message?.reasoning_content) throw new Error("模型把 token 花在思维链上、正文为空——换非推理模型或降低任务量");
    throw new Error("模型返回为空（检查 Key/模型/余额）");
  }
  return txt;
}

/* 防重入包装：所有 AI 按钮统一走这里 */
function withBusy(btn, fn) {
  if (!btn || btn._busy) return;
  btn._busy = true; btn.disabled = true;
  Promise.resolve(fn()).catch(e => { console.warn("withBusy:", e && e.message); }).finally(() => { btn._busy = false; btn.disabled = false; refreshAIButtons(); });
  /* v1.0.1（QA P0-1 兜底）：promise 永久挂起时 10 分钟后自动解锁 */
  const __wbT0 = Date.now();
  setTimeout(() => { if (btn && btn._busy && Date.now() - __wbT0 > 595000) { btn._busy = false; btn.disabled = false; try { refreshAIButtons(); } catch (e) {} toast("操作超时已解锁，请重试"); } }, 600000);
}
/* await 后重取项目：防止期间删除/切换导致结果写丢 */
function liveProj(pid) {
  const p = DB.projects.find(x => x.id === pid);
  if (!p) return null;
  return p;
}
if (typeof window.wqNotice !== "function") { window.wqNotice = function (t) { console.warn("[notice] " + t); }; } // app.js 加载后会被真实弹窗覆盖
/* v0.5.1：前置缺口检查（在确认框中列给用户，花钱前可见） */
function wqGaps(p) {
  const g = [];
  if (!p || !p.topic) g.push("注意：研究主题未保存（在阶段①输入主题并跑趋势或 AI 评估即可保存）");
  const n = (p && p.papers.length) || 0;
  const abs = p ? p.papers.filter(f => f.abs).length : 0;
  if (!n) g.push("注意：文献库为空——生成内容将缺乏依据");
  else if (!p.matrix) {
    if (p.mode === "quick" && p.ref) g.push("提示：参考稿已含 " + n + " 篇真实文献（矩阵可选——生成后可深化引用核对）");
    else g.push("注意：文献矩阵未生成（现有 " + n + " 篇，其中 " + abs + " 篇带摘要）");
  }
  return g;
}
/* v0.5：AI 操作前统一确认（复用工具台弹窗；可在 AI 设置中关闭）
 * v0.8：确认/取消同步记入项目轨迹（决策留痕） */
async function askAI(title, lines, okText) {
  let ok;
  if (typeof window.wqConfirmAI === "function") ok = await window.wqConfirmAI({ title: title, lines: lines || [], okText: okText || "开始" });
  else ok = confirm(title + "\n" + (lines || []).join("\n"));
  try {
    const p = cur(); if (p) {
      trailAdd(p, ok ? "act" : "cancel", (ok ? "发起：" : "取消：") + String(title).replace(/[？?]+$/, ""), "");
      save(); renderProcessLog();
    }
  } catch (e) { /* 轨迹失败不阻断主流程 */ }
  return ok;
}

/* ---------- v0.8 项目轨迹（思维链与决策过程） ---------- */
const TRAIL_ICON = { ai: "⚡", act: "▶", cancel: "✖", keep: "📌", note: "📝", load: "↻", importT: "📥", export: "⤓", ver: "🧩", misc: "🖊" };
function trailAdd(p, type, label, note) {
  if (!p) return;
  p.trail = p.trail || [];
  p.trail.unshift({ ts: vStamp(), type: type || "misc", label: String(label || ""), note: String(note || "").replace(/\s+/g, " ").slice(0, 300) });
  if (p.trail.length > 200) p.trail.length = 200;
}
window.wqTrail = function (type, label, note) {
  const p = cur(); if (!p) return;
  trailAdd(p, type, label, note); save(); renderProcessLog();
};

/* ---------- 页面切换（工作流/工具台由 index 内联脚本管；此处管五阶段） ---------- */
document.querySelectorAll(".stage[data-s]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".stage[data-s]").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".stagepane").forEach(p => p.hidden = p.id !== "s" + b.dataset.s);
  if (typeof renderStageBadges === "function") renderStageBadges();
  if (typeof renderNumBar === "function") renderNumBar();
}));

/* ---------- 项目栏 ---------- */
function renderProjects() {
  $("projList").innerHTML = DB.projects.map(p => `
    <div class="proj ${p.id === DB.cur ? "on" : ""}" data-id="${p.id}">
      <div class="pname" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="pmeta">${esc(p.status)} · ${p.papers.length}篇 · ${esc(PQ(p).name)} · ${esc(LV(p).name)}</div>
      <button class="pdel" data-del="${p.id}" title="删除">✕</button>
    </div>`).join("") || '<p class="hint">还没有项目，点上方新建</p>';
  document.querySelectorAll(".proj").forEach(el => el.addEventListener("click", async e => {
    if (e.target.dataset.del) {
      if (!(await wqConfirmAI({ title: "删除该项目？", lines: ["此操作不可撤销；建议先「⤓ 备份全部」"], okText: "删除" }))) return;
      DB.projects = DB.projects.filter(p => p.id !== e.target.dataset.del);
      if (DB.cur === e.target.dataset.del) DB.cur = DB.projects[0]?.id || null;
      save(); renderProjects(); renderAll(); return;
    }
    DB.cur = el.dataset.id; save(); renderProjects(); renderAll();
  }));
}

/* 新建项目：表单弹窗（替代 prompt），带范式/层级选择 */
$("btnNewProj").addEventListener("click", () => {
  $("npName").value = "研究项目 " + (DB.projects.length + 1);
  $("npParadigm").value = "quant"; $("npLevel").value = "journal";
  $("npModal").hidden = false; $("npName").focus();
});
$("npCancel").addEventListener("click", () => { $("npModal").hidden = true; });
$("npOk").addEventListener("click", () => {
  const name = $("npName").value.trim();
  if (!name) { $("npName").focus(); return; }
  newProject(name, $("npParadigm").value, $("npLevel").value);
  $("npModal").hidden = true;
  renderProjects(); renderAll();
});

/* 备份导出/导入 */
$("btnExportAll").addEventListener("click", () => {
  dlText("wenqu-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(DB, null, 2));
  try { localStorage.setItem("wenqu_lastBackup", new Date().toISOString()); } catch {}
  const p = cur(); if (p) { trailAdd(p, "export", "备份全部", DB.projects.length + " 个项目"); save(); renderProcessLog(); }
  renderBackupHint();
});
$("importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.projects)) throw new Error("不是本平台的备份文件");
    let n = 0;
    for (const pr of d.projects) {
      const i = DB.projects.findIndex(x => x.id === pr.id);
      if (i >= 0) DB.projects[i] = pr; else { DB.projects.unshift(pr); n++; }
    }
    if (d.cur) DB.cur = DB.cur || d.cur;
    save(); renderProjects(); renderAll();
    const p = cur(); if (p) { trailAdd(p, "importT", "导入备份", "合并 " + d.projects.length + " 个项目（新导入 " + n + " 个）"); save(); renderProcessLog(); }
    wqNotice(`导入完成：合并 ${d.projects.length} 个项目（其中新导入 ${n} 个）`);
  } catch (err) { wqNotice("导入失败：" + err.message); }
  finally { e.target.value = ""; }
});

/* ---------- 项目范式/层级配置（阶段1顶部，随时可改） ---------- */
$("cfgParadigm").innerHTML = window.WQ_PARADIGMS.map(x => `<option value="${x.id}">${x.name}（${x.desc}）</option>`).join("");
$("cfgLevel").innerHTML = window.WQ_LEVELS.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
$("npParadigm").innerHTML = $("cfgParadigm").innerHTML;
$("npLevel").innerHTML = $("cfgLevel").innerHTML;
$("cfgParadigm").addEventListener("change", () => { const p = cur(); if (!p) return; p.paradigm = $("cfgParadigm").value; save(); renderProjects(); renderSecBtns(); renderDefense(); renderStageCards(); toast("已切换范式：" + PQ(p).name); });
$("cfgLevel").addEventListener("change", () => { const p = cur(); if (!p) return; p.level = $("cfgLevel").value; save(); renderProjects(); renderDefense(); renderStageCards(); toast("已切换层级：" + LV(p).name); });

/* ---------- OpenAlex 件 ---------- */
const OA = "https://api.openalex.org/works";
const MAIL = () => { const e = localStorage.getItem("wenqu_email"); return e ? "&mailto=" + encodeURIComponent(e) : ""; };

function abstractFromInverted(inv) {
  if (!inv) return "";
  const pos = [];
  for (const [word, idxs] of Object.entries(inv)) idxs.forEach(i => pos[i] = word);
  return (pos.join(" ") || "").slice(0, 2500);
}

/* ---------- 阶段1 选题 ---------- */
$("btnTrend").addEventListener("click", () => withBusy($("btnTrend"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const topic = $("topic").value.trim(); if (!topic) { $("selProg").textContent = "请先输入研究主题"; $("topic").focus(); return; }
  const pid = p0.id;
  $("topic").value = topic;
  const box = $("trendBox"); box.hidden = false; box.innerHTML = '<p class="hint">拉取趋势中…</p>';
  try {
    let d;
    try {
      d = await fetchJSON(`${OA}?filter=title_and_abstract.search:${encodeURIComponent(topic)},from_publication_date:2021-01-01&group_by=publication_year${MAIL()}`);
    } catch { d = { group_by: [] }; }
    let groups = (d.group_by || []).sort((a, b) => a.key.localeCompare(b.key));
    if (!groups.length) {
      const d2 = await fetchJSON(`${OA}?search=${encodeURIComponent(topic)}&filter=from_publication_date:2021-01-01&group_by=publication_year${MAIL()}`);
      groups = (d2.group_by || []).sort((a, b) => a.key.localeCompare(b.key));
    }
    const p = liveProj(pid); if (!p) return;
    p.topic = topic; p.trend = groups; save(); // v0.5.1：趋势也保存主题，避免下游显示「未定」
    drawTrend(groups, topic);
  } catch (e) { box.innerHTML = `<p class="hint">趋势获取失败：${esc(e.message)}</p>`; }
}));

function drawTrend(groups, topic) {
  const max = Math.max(...groups.map(g => g.count), 1);
  const bars = groups.map(g => `
    <div class="tcol">
      <div class="tbar" style="height:${Math.max(6, Math.round(g.count / max * 110))}px"></div>
      <div class="tnum">${g.count > 9999 ? (g.count / 10000).toFixed(1) + "万" : g.count}</div>
      <div class="tyr">${esc(g.key)}</div>
    </div>`).join("");
  const first = groups[0]?.count || 0;
  const lastG = groups.findLast(g => g.key < "2026");        // 修复：原 find 恒取最早年份，增幅恒 0
  const last = lastG?.count || groups[groups.length - 1]?.count || 0;
  const growth = first ? Math.round((last - first) / first * 100) : 0;
  $("trendBox").innerHTML = `
    <b>「${esc(topic)}」近年发文量</b>（题名+摘要匹配；当前年份不完整）
    <div class="tchart">${bars}</div>
    <p class="hint">2021→最新完整年变化：<b style="color:${growth >= 0 ? "var(--ok)" : "var(--bad)"}">${growth >= 0 ? "+" : ""}${growth}%</b> ${growth > 20 ? "（快速升温赛道）" : growth < -20 ? "（热度回落，注意选题必要性）" : "（平稳领域）"}</p>`;
}

$("btnEval").addEventListener("click", () => withBusy($("btnEval"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const topic = $("topic").value.trim() || p0.topic;
  if (!topic) { $("selProg").textContent = "请先在上方输入研究主题再评估"; $("topic").focus(); return; }
  if (!(await askAI("开始 AI 选题评估？", [topic.slice(0, 50), "调用 AI 1 次，约 30-60 秒"], "开始评估"))) { $("selProg").textContent = "已取消"; return; }
  const prog = $("selProg"), out = $("selOut");
  prog.textContent = "AI 评估中（约 30-60 秒）…"; out.hidden = true;
  try {
    const pq = PQ(p0), lv = LV(p0);
    const trendTxt = (p0.trend || []).map(g => `${g.key}:${g.count}`).join(", ") || "未跑趋势";
    const txt = await callAI(`你是科研选题评审专家（${pq.name}范式，${pq.venueHint}）。研究主题：「${topic}」。全球发文趋势（年份:篇数）：${trendTxt}。
${pq.evalFocus}
用户层级：${lv.name}——创新标尺：${lv.innovation} 文献规模预期：${lv.lit}。

请输出一份选题评估报告，包含：
一、三个候选题目（每题一句话说明研究角度与创新点，编号1-3）
二、每个题目打分：新颖性(1-10)、可行性(1-10)、数据/材料可得性(1-10)，各一句理由
三、数据与文献可得性清单：这个题目需要什么数据或材料、核心文献大概在哪些库
四、主要风险与规避建议（2-3条）
用简体中文，条理清晰，可直接作为选题报告使用。`, 6000);
    const p = liveProj(pid); if (!p) { prog.textContent = "项目已被删除，结果丢弃"; return; }
    p.topic = topic; p.selection = withMeta(txt, "OpenAlex 趋势 + 摘要级证据"); addVersion(p, "选题评估", p.selection, "selection"); save();
    out.hidden = false; setMD(out, txt);
    prog.textContent = "完成 ✓ 已存入项目（阶段4写大纲时会用到）";
  } catch (e) { prog.textContent = "评估失败：" + e.message; }
}));

/* ---------- 阶段2 文献库 ---------- */
$("btnAddPaper").addEventListener("click", () => {
  const p = cur(); if (!p) return wqNotice("先新建项目");
  const t = $("pTitle").value.trim(); if (!t) return;
  p.papers.push({ id: "f" + Date.now(), title: t, year: $("pYear").value.trim(), doi: $("pDoi").value.trim().replace(/^https?:\/\/doi\.org\//, ""), venue: $("pVenue").value.trim(), type: $("pType").value, author: $("pAuth").value.trim(), abs: $("pAbs").value.trim().slice(0, 2500) });
  save(); ["pTitle", "pYear", "pDoi", "pVenue", "pAuth", "pAbs"].forEach(i => $(i).value = "");
  renderPapers(); renderProjects();
});

/* 批量 DOI 导入（Crossref 逐条拉题录，含作者） */
const CR_TYPE2J = { "journal-article": "J", "proceedings-article": "C", "book": "M", "book-chapter": "M", "report": "R", "posted-content": "EB", "preprint": "EB" };
$("btnDoiBatch").addEventListener("click", () => withBusy($("btnDoiBatch"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const raw = $("doiBatch").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const dois = raw.map(l => { const m = l.match(/(10\.\d{4,9}\/[^\s"<>，。；]+)/); return m ? m[1].replace(/[.,;)\]]+$/, "") : (/^10\.\d{4,9}\//.test(l) ? l : null); }).filter(Boolean).slice(0, 25);
  const prog = $("doiProg");
  if (!dois.length) { prog.textContent = "没识别到 DOI（每行一个 10.xxxx/…）"; return; }
  let ok = 0, dup = 0, fail = 0;
  for (let i = 0; i < dois.length; i++) {
    prog.textContent = `导入中 ${i + 1}/${dois.length}…`;
    const p = liveProj(pid);
    if (!p) { prog.textContent = "项目已被删除，中止"; return; }
    if (p.papers.some(f => f.doi === dois[i])) { dup++; continue; }
    try {
      const cr = (await fetchJSON(`https://api.crossref.org/works/${encodeURIComponent(dois[i])}${MAIL().replace("&", "?")}`))?.message;
      const year = cr?.issued?.["date-parts"]?.[0]?.[0] || "";
      const authors = (cr?.author || []).slice(0, 3).map(a => (a.family || a.name || "") + (a.given ? " " + a.given : "")).join("，") + ((cr?.author || []).length > 3 ? "，等" : "");
      p.papers.push({
        id: "f" + Date.now() + "_" + i, doi: dois[i],
        title: (Array.isArray(cr?.title) ? cr.title[0] : cr?.title) || dois[i],
        year: String(year), venue: (Array.isArray(cr?.["container-title"]) ? cr["container-title"][0] : cr?.["container-title"]) || "",
        author: authors, type: CR_TYPE2J[cr?.type] || "J", abs: ""
      });
      ok++; save(); renderPapers(); renderProjects();
    } catch { fail++; }
    await sleep(350); // 对 Crossref 保持礼貌
  }
  prog.textContent = `完成 ✓ 成功 ${ok} · 重复跳过 ${dup} · 失败 ${fail}（识别 ${dois.length}/${raw.length} 行）`;
  { const pp = liveProj(pid); if (pp) { addVersion(pp, "文献批量导入（" + ok + " 篇）", ok ? pp.papers.map((f, i) => "[" + (i + 1) + "] " + f.title).join("\n") : "（无新增）", "tool"); save(); } }
  $("doiBatch").value = "";
}));

/* 从工具台收藏篮导入（v0.5 修复：v0.3 重写时处理器丢失） */
$("btnImportBasket").addEventListener("click", () => {
  const p = cur(); if (!p) return wqNotice("先新建项目");
  let basket = [];
  try { basket = JSON.parse(localStorage.getItem("wenqu_basket") || "[]"); } catch (e) {}
  if (!basket.length) { wqNotice("收藏篮是空的：先切到「🧰 工具台」检索并【➕收藏】，回来一键导入。"); return; }
  const exist = new Set(p.papers.map(f => ((f.doi || "") + (f.title || "")).toLowerCase()));
  let n = 0;
  basket.forEach((b, i) => {
    const key = ((b.doi || "") + (b.title || "")).toLowerCase();
    if (!key || exist.has(key)) return;
    exist.add(key);
    p.papers.push({ id: "f" + Date.now() + "_" + i, title: b.title || "", year: b.year || "", doi: b.doi || "", venue: b.venue || "", author: (b.authors || []).slice(0, 3).join("，") + ((b.authors || []).length > 3 ? "，等" : ""), type: "J", abs: "" });
    n++;
  });
  save(); renderPapers(); renderProjects(); renderStageCards();
  if (n) addVersion(p, "收藏篮导入（" + n + " 篇）", p.papers.map((f, i) => "[" + (i + 1) + "] " + f.title).join("\n"), "tool"); save();
  wqNotice(n ? "已导入 " + n + " 篇（收藏篮保留；带 DOI 的可点【补摘要】）" : "收藏篮条目都已存在于文献库");
});

function renderPapers() {
  const p = cur();
  $("paperList").innerHTML = !p ? '<p class="hint">先新建项目</p>' :
    (p.papers.length ? `<table class="tb"><tr><th>#</th><th>标题</th><th>年份</th><th>出处</th><th>摘要</th><th></th></tr>` +
      p.papers.map((f, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(f.title.slice(0, 55))}${f.title.length > 55 ? "…" : ""}${f.doi ? `<br><a href="https://doi.org/${esc(f.doi)}" target="_blank" rel="noopener" class="mono">DOI</a>` : ""}</td>
        <td>${esc(f.year || "—")}</td><td>${esc(f.venue || "—")}</td>
        <td>${f.abs ? '<span class="badge b-ok">✓</span>' : `<button class="btn2 btn-sm" data-abs="${f.id}">补摘要</button>`}${(!f.doi && f.verify && f.verify.doiSuggest) ? `<br><button class="btn2 btn-sm" data-adoptdoi="${f.id}" title="核验匹配 ${esc(f.verify.doiSuggest)}（匹配度 ${f.verify.score}）">采纳DOI</button>` : ""}</td>
        <td><button class="btn2 btn-sm warn" data-rm="${f.id}">删</button></td>
      </tr>`).join("") + "</table>"
      : '<p class="hint">文献库为空。可单条添加、批量粘贴 DOI，或从收藏篮导入。</p>');
  document.querySelectorAll("[data-abs]").forEach(b => b.addEventListener("click", () => withBusy(b, () => fillAbs(b.dataset.abs))));
  document.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", async () => {
    const p2 = cur(); if (!p2) return;
    /* v1.0.1（编号双轨）：快速稿的 [n] 与文献库顺序绑定，删除会使既有编号错位——先警告 */
    if (p2.mode === "quick" && p2.ref) {
      const ok = await (window.wqConfirmAI ? wqConfirmAI({ title: "删除文献会使参考稿引用编号错位？", lines: ["参考稿各节的 [n] 编号与文献库顺序一致", "删除后请到④工作台重核相关引用（或改用「保留条目、仅修订题录」）"], okText: "仍要删除" }) : confirm("删除会使参考稿引用编号错位，仍要删除？"));
      if (!ok) return;
    }
    p2.papers = p2.papers.filter(f => f.id !== b.dataset.rm);
    save(); renderPapers(); renderProjects();
  }));
  /* v1.0.1（QA P1-9）：核验匹配到的 DOI 一键采纳 */
  document.querySelectorAll("[data-adoptdoi]").forEach(b => b.addEventListener("click", () => {
    const p2 = cur(); if (!p2) return;
    const f = p2.papers.find(x => x.id === b.dataset.adoptdoi);
    if (f && f.verify && f.verify.doiSuggest) {
      f.doi = f.verify.doiSuggest;
      save(); renderPapers(); toast("已采纳 DOI：" + f.doi);
      trailAdd(p2, "act", "采纳核验 DOI", f.title.slice(0, 40) + " → " + f.doi); save();
    }
  }));
}

async function fillAbs(fid) {
  const p0 = cur(); const f0 = p0?.papers.find(x => x.id === fid); if (!f0) return;
  const pid = p0.id;
  try {
    let d = null;
    if (f0.doi) d = await fetchJSON(`${OA}/https://doi.org/${encodeURIComponent(f0.doi)}?select=title,abstract_inverted_index${MAIL()}`).catch(() => null);
    f0.abs = abstractFromInverted(d?.abstract_inverted_index) || f0.abs;
    if (d?.doi && !f0.doi) f0.doi = d.doi.replace("https://doi.org/", "");
    if (!f0.abs) {
      const s = await fetchJSON(`${OA}?search=${encodeURIComponent(f0.title.slice(0, 120))}&per-page=1&select=title,abstract_inverted_index,doi${MAIL()}`);
      const w = s.results?.[0];
      if (w) {
        f0.abs = abstractFromInverted(w.abstract_inverted_index) || f0.abs;
        if (w.doi && !f0.doi) f0.doi = w.doi.replace("https://doi.org/", "");
        if (w.title) f0._t = w.title;
      }
    }
    if (!f0.abs && f0.doi) {
      const cr = await fetchJSON(`https://api.crossref.org/works/${encodeURIComponent(f0.doi)}${MAIL().replace("&", "?")}`).catch(() => null);
      const ab = cr?.message?.abstract;
      if (ab) f0.abs = ab.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2500);
    }
    const p = liveProj(pid); if (!p) return;
    const f = p.papers.find(x => x.id === fid); if (!f) return;
    if (!f.abs) throw new Error("OpenAlex 与 Crossref 均未收录该文献摘要（部分订阅刊如此，中文文献尤其常见）。请在摘要框手工粘贴。");
    save(); renderPapers();
  } catch (e) { wqNotice("补摘要失败：" + e.message); }
}

/* ---------- 阶段3 文献矩阵（栏目由范式决定；编号=全库顺序，与校验/文献表同源） ---------- */
$("btnMatrix").addEventListener("click", () => withBusy($("btnMatrix"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const ready = p0.papers.filter(f => f.abs);
  if (!ready.length) { $("mxProg").textContent = "文献库还没有带摘要的条目：先在阶段2用【补摘要】、批量导入或手工粘贴摘要。"; return; }
  if (!(await askAI("开始生成文献矩阵？", [ready.length + " 篇将逐篇提炼（调用 AI " + ready.length + " 次）", "逐条自动落盘，中断不白花钱"], "开始生成"))) { $("mxProg").textContent = "已取消"; return; }
  const prog = $("mxProg"), out = $("matrixOut");
  out.hidden = false;
  const cols = PQ(p0).matrixCols;
  const rows = [];
  for (let i = 0; i < ready.length; i++) {
    const p = liveProj(pid); if (!p) { prog.textContent = "项目已被删除，中止"; return; }
    const f = ready[i];
    prog.textContent = `AI 提炼中 ${i + 1}/${ready.length}：${f.title.slice(0, 30)}…`;
    try {
      const txt = await callAI(`根据下面这篇文献的信息，按栏目输出要点，每行以「栏目名：」开头（栏目：${cols.join("、")}），每行不超过60字。信息不足的栏目明确写「未提及」，禁止根据题目推断编造。\n标题：${f.title}\n年份：${f.year || "未知"}\n摘要：${(f.abs || "").slice(0, 1200)}`, 2000);
      rows.push({ f, txt });
      const pp = liveProj(pid);
      if (pp) { pp.matrix = rows.map(r => `${r.f.title}||${r.txt}`).join("\n====\n"); save(); } // 逐条落盘：中断不白花钱
    } catch (e) { rows.push({ f, txt: "（本篇处理失败：" + e.message + "）" }); }
    await sleep(300);
  }
  const p = liveProj(pid); if (!p) return;
  addVersion(p, "文献矩阵（" + rows.length + " 篇）", p.matrix, "matrix"); save();
  drawMatrix(rows);
  prog.textContent = `完成 ✓ ${rows.length} 篇入库（编号与文献库顺序一致，阶段4生成大纲时自动引用）`;
}));

function drawMatrix(rows) {
  const p = cur();
  const cols = PQ(p).matrixCols;
  $("matrixOut").hidden = false;
  $("matrixOut").innerHTML = `<p class="hint" style="margin:0 0 6px">依据：各文献<b>摘要</b>（摘要级证据）——重要结论请回原文核对；可用「AI 读论文」精读后人工修订。</p><table class="tb"><tr><th>文献</th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr>` +
    rows.map(r => {
      const cell = (k) => { const m = (r.txt || "").match(new RegExp(k + "[：:]\\s*([^\\n]+)")); return esc((m?.[1] || "—").slice(0, 80)); };
      return `<tr><td style="min-width:150px">${esc(r.f.title.slice(0, 50))}<br><span class="yr">${esc(r.f.year || "")}</span></td>${cols.map(c => `<td>${cell(c)}</td>`).join("")}</tr>`;
    }).join("") + "</table>";
}

/* ---------- 写作上下文：全库统一编号（矩阵/校验/参考文献三处同源） ---------- */
function outlineCtx(p) {
  const rows = (p?.matrix || "").split("\n====\n").filter(Boolean);
  const map = {};
  rows.forEach(r => { const [t, body] = r.split("||"); if (t) map[t.trim()] = body || ""; });
  const lines = p.papers.map((f, i) => {
    const mx = map[f.title.trim()];
    const note = mx ? mx.replace(/\n/g, " ").slice(0, 110) : (f.abs ? "（矩阵未生成；仅题录，谨慎引用）" : "（⚠仅题录，内容未提供——禁止引用）");
    return `[${i + 1}] ${f.title} — ${note}`;
  }).join("\n");
  return `选题主题：${p?.topic || "（未定）"}\n选题报告要点：${(p?.selection || "（未做评估，可回阶段1）").slice(0, 1200)}\n\n文献矩阵（编号=文献库顺序，正文引用 [n] 必须与此编号一致；未生成矩阵的条目仅有题录信息，引用时须谨慎）：\n${lines || "（文献库为空）"}`;
}

$("btnOutline").addEventListener("click", () => withBusy($("btnOutline"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const prog = $("wProg"), out = $("wOut");
  if (!(await askAI("生成论文大纲？", ["调用 AI 1 次，约 30-60 秒"].concat(wqGaps(p0)), "开始生成"))) { prog.textContent = "已取消"; return; }
  prog.textContent = "生成大纲中（多视角合成，约 1-2 分钟）…"; out.hidden = true;
  try {
    const pq = PQ(p0), lv = LV(p0);
    const txt = await callAI(`你是学术写作教练（${pq.name}范式，${pq.venueHint}）。请基于以下选题与文献矩阵，生成一篇${lv.name}论文的完整大纲（多视角综合）：
1. 章节结构（可参考本范式推荐章节：${pq.sections.join(" / ")}；按学科惯例微调），每节配 3-5 条要点
2. 每条要点后标注应引用的文献编号（如[2][5]），编号必须来自文献矩阵；标注「禁止引用」的编号一律不得使用
3. 单独给出「创新点陈述」（2-3条）与「预计投稿/答辩方向」（1-2类）
创新标尺（${lv.name}）：${lv.innovation}
${styleBlock()}

${outlineCtx(p0)}`, 4096);
    const p = liveProj(pid); if (!p) { prog.textContent = "项目已被删除，结果丢弃"; return; }
    p.outline = withMeta(txt, "文献矩阵 + 选题卡");
    p.outs = p.outs || {}; p.outs.outline = p.outline; p.showW = "outline"; addVersion(p, "论文大纲", p.outline, "outline"); save();
    out.hidden = false; setMD(out, txt); $("btnWCopy").hidden = false;
    prog.textContent = "完成 ✓ 大纲已存入项目，点分节按钮可逐节起草";
  } catch (e) { prog.textContent = "失败：" + e.message; }
}));

/* 研究设计审查：提示词来自范式包（不同范式审查内容完全不同） */
$("btnDesign").addEventListener("click", () => withBusy($("btnDesign"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const prog = $("wProg"), out = $("wOut");
  if (!(await askAI(PQ(p0).design.title + "？", ["调用 AI 1 次，约 30-60 秒"].concat(wqGaps(p0)), "开始审查"))) { prog.textContent = "已取消"; return; }
  prog.textContent = `${PQ(p0).design.title}中（约 1-2 分钟）…`; out.hidden = true;
  try {
    const pq = PQ(p0), lv = LV(p0);
    const dp = pq.design.prompt
      .replaceAll("${venueHint}", pq.venueHint)
      .replaceAll("${topic}", p0.topic || "未定");
    const txt = await callAI(`${dp}

选题主题：${p0.topic || "未定"}
选题报告：${(p0.selection || "（未做评估）").slice(0, 1200)}
文献矩阵：
${(p0.matrix || "（未生成）").slice(0, 2500)}`, 6000);
    const p = liveProj(pid); if (!p) { prog.textContent = "项目已被删除，结果丢弃"; return; }
    p.design = withMeta(txt, "文献矩阵");
    p.outs = p.outs || {}; p.outs.design = p.design; p.showW = "design"; addVersion(p, PQ(p).design.title, p.design, "design"); save();
    out.hidden = false; setMD(out, txt); $("btnWCopy").hidden = false;
    prog.textContent = "完成 ✓ 「" + pq.design.title + "」已存入项目，相关分节起草会自动引用";
  } catch (e) { prog.textContent = "失败：" + e.message; }
}));

/* 分节写作：章节按钮由范式包动态渲染；字数由层级决定；注入个人写作档案 */
function renderSecBtns() {
  const p = cur(); if (!p) { $("secBtns").innerHTML = '<p class="hint">先新建项目</p>'; return; }
  const pq = PQ(p);
  const ok = keyOK();
  const dis = ok ? "" : " disabled title=\"需先在页头配置 AI Key\"";
  $("secBtns").innerHTML = pq.sections.map(s => `<button class="btn2 sec" data-sec="${esc(s)}" ${dis}>写：${esc(s)}</button>`).join("");
}
$("secBtns").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sec]"); if (!b) return;
  withBusy(b, () => draftSection(b.dataset.sec, b));
});
async function draftSection(sec, btn) {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const prog = $("wProg"), out = $("wOut");
  if (!(await askAI("起草「" + sec + "」？", ["调用 AI 1 次，约 30-60 秒"].concat(wqGaps(p0)), "开始起草"))) { prog.textContent = "已取消"; return; }
  prog.textContent = `起草「${sec}」中…`; out.hidden = true;
  try {
    const pq = PQ(p0), lv = LV(p0);
    const en = $("enMode").checked;
    const langSpec = en
      ? "Write in polished academic English suitable for the target journal. Keep citation markers like [n] as-is."
      : "用学术简体中文撰写，术语首现括注英文原文。";
    const designCtx = p0.design ? `\n\n研究设计审查报告（方法/实验设计以此为准）：\n${p0.design.slice(0, 2000)}` : "";
    const hint = pq.secHint[sec] ? `\n本节范式要求：${pq.secHint[sec]}` : "";
    const designLike = sec.includes("设计") || sec.includes("方法") || sec.includes("对象");
    const useDesign = p0.design && designLike;
    /* v1.0.1（QA P2-19）：长文分节写作改流式输出（与参考稿一致），完成后仍走 Markdown 渲染与落盘 */
    const __prompt = `你是学术写作助手（${pq.name}范式）。请基于大纲与文献矩阵，起草论文的「${sec}」一节：${lv.length}。${hint}
论述中在对应位置标注引用编号[n]（编号只能取自文献矩阵且禁止虚构；标注「禁止引用」的编号一律不得使用），需要补充数据处用〔待补：xxx〕占位。不要虚构文献。${useDesign ? "\n本节涉及研究设计/方法，须严格按下方审查报告的方案撰写。" : ""}${sec === "引言" ? "\n引言末尾补一段 Contribution Statement（相对文献矩阵的三点边际贡献）。" : ""}${en ? "" : ""} 语言要求：${langSpec}${styleBlock()}

大纲：${(p0.outline || "（未生成大纲，建议先点「生成大纲」按钮）").slice(0, 2000)}
${outlineCtx(p0)}${designCtx}`;
    let txt = "";
    if (window.WQCore && WQCore.ai.stream) {
      out.hidden = false;
      let __lastPaint = 0;
      const r = await WQCore.ai.stream(__prompt, { max_tokens: 6000 }, (_d, full) => {
        const now = Date.now();
        if (now - __lastPaint > 250) { __lastPaint = now; out.textContent = full; out.scrollTop = out.scrollHeight; }
      });
      txt = r.text;
    } else {
      txt = await callAI(__prompt, 6000);
    }
    const p = liveProj(pid); if (!p) { prog.textContent = "项目已被删除，结果丢弃"; return; }
    if (/当前状态诊断|请您提供|请先提供|无法支撑|缺乏研究主题|缺乏研究大纲|输入不足|无法撰写|需要您补充|暂无足够|无法为您|无法直接撰写/.test(txt) && txt.length < 2600) {
      out.hidden = false; setMD(out, txt); $("btnWCopy").hidden = false;
      prog.textContent = "⚠ 检测到 AI 未成稿（输入不足的说明而非草稿）——未存入草稿。请先补齐主题/文献矩阵后重试。";
      return;
    }
    p.draft = p.draft || {}; p.draft[sec] = withMeta(txt, "文献矩阵 + 大纲"); p.showW = "sec:" + sec; addVersion(p, "草稿·" + sec, p.draft[sec], "draft:" + sec); save();
    out.hidden = false; setMD(out, txt); $("btnWCopy").hidden = false;
    const citeWarn = checkCites(txt, p.papers.length);
    prog.textContent = `「${sec}」草稿完成 ✓ 已存入项目` + (citeWarn ? " ⚠ " + citeWarn : "（引用编号已过校验）");
  } catch (e) { prog.textContent = "失败：" + e.message; }
}

/* 引用编号机械校验：[n] 必须落在文献库范围内，防幻觉引用 */
function checkCites(txt, n) {
  if (!n) return "文献库为空，引用编号无从校验";
  const used = [...new Set((txt.match(/\[(\d+)\]/g) || []).map(x => parseInt(x.slice(1, -1), 10)))];
  const bad = used.filter(k => k < 1 || k > n);
  if (bad.length) return `引用编号越界：[${bad.join("][")}]（文献库只有 ${n} 篇），必须修正`;
  return used.length ? "" : "（注意：草稿没有任何引用编号，综述/方法节应有引用）";
}

/* 三专家内审：人设来自范式包与层级；界面明示为同模型自审脚手架 */
$("btnInternal").addEventListener("click", () => withBusy($("btnInternal"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const prog = $("wProg"), out = $("wOut");
  const pq = PQ(p0), lv = LV(p0);
  const order = pq.sections.filter(s => p0.draft?.[s]);
  const fallback = ["摘要", "引言", "文献综述", "结果与讨论"].filter(s => p0.draft?.[s]);
  const draft = (order.length ? order : fallback).map(s => `【${s}】\n${p0.draft[s]}`).join("\n\n");
  if (!draft) { prog.textContent = "还没有分节草稿：先用「写：…」逐节起草。"; return; }
  if (!(await askAI("开始三专家内审？", ["将整篇草稿送审（调用 AI 1 次）", "约 1-3 分钟；同模型自审，仅作改稿脚手架"].concat(wqGaps(p0)), "开始内审"))) { prog.textContent = "已取消"; return; }
  prog.textContent = "三专家内审中（约 2-3 分钟，请勿关闭页面）…"; out.hidden = true;
  try {
    const reviewerC = lv.id === "bsc" ? "答辩委员会主席（本科毕设口径：规范性、完整性、可答辩性）" : lv.id === "general" ? "资深同行（通用口径：问题是否讲清、论证链是否完整、结论是否有证据支撑）" : "主编（贡献定位与期刊匹配）";
    const txt = await callAI(`你是评审团召集人。请以下三个身份分别评审这篇${lv.name}论文草稿（${pq.name}范式，${pq.venueHint}）：

【专家A · 领域审稿人】关注：贡献定位是否清晰（相对文献矩阵的边际贡献是否成立）、与文献的对话是否扎实、覆盖是否有明显遗漏方向。
【专家B · ${pq.reviewerB.split("：")[0]}】${pq.reviewerB.split("：").slice(1).join("：")}
【专家C · ${reviewerC}】关注：结构是否完整流畅、摘要与结论是否呼应、${lv.innovation}；给 1 个最优先修改建议。

每位专家输出：总体评价（1句）+ 3-5 条具体意见（标注严重度：🔴必须改/🟡建议改/🟢可选）+ Overall 判断（如 Major Revision / Minor Revision）。最后由召集人汇总一页「修改清单」（按优先级排序）。用简体中文。
（注：三专家为同一模型分角色自审，仅作改稿脚手架，不能替代真实评审。）

选题主题：${p0.topic || "未定"}
创新标尺：${lv.innovation}
文献矩阵：
${(p0.matrix || "（未生成）").slice(0, 1500)}

论文草稿：
${draft.slice(0, 9000)}`, 8000);
    out.hidden = false; setMD(out, txt); $("btnWCopy").hidden = false;
    (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.internal = withMeta(txt, "分节草稿"); p.showW = "internal"; addVersion(p, "三专家内审", p.outs.internal, "outs.internal"); save(); } })();
    prog.textContent = "内审完成 ✓ 按修改清单逐条改稿（同模型自审，仅供参考）";
  } catch (e) { prog.textContent = "失败：" + e.message; }
}));

/* 章节一致性检查（v0.4 第4步） */
$("btnConsistency").addEventListener("click", () => withBusy($("btnConsistency"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const pq = PQ(p0);
  const parts = pq.sections.filter(s => p0.draft?.[s]).map(s => `【${s}】\n${p0.draft[s]}`);
  if (parts.length < 2) { $("wProg").textContent = "至少两个分节草稿才能做一致性检查。"; return; }
  const prog = $("wProg"), out = $("wOut");
  if (!(await askAI("开始跨节一致性检查？", [parts.length + " 节草稿将比对（调用 AI 1 次）"].concat(wqGaps(p0)), "开始检查"))) { prog.textContent = "已取消"; return; }
  prog.textContent = "一致性检查中…"; out.hidden = true;
  try {
    const txt = await callAI(`你是论文质控助手。检查以下分节草稿的跨节一致性，只输出问题清单（按严重度 🔴/🟡 排序），没有问题就明确说「未发现一致性问题」：
1. 术语与译名（同一概念是否前后同名）
2. 变量/符号/指标名称与定义
3. 数字与数据（样本量、年份区间、系数是否前后一致）
4. 引用编号与文献库的对应
5. 章节衔接（前后节承诺-兑现关系）

文献库题录（编号对照）：
${p0.papers.map((f, i) => `[${i + 1}] ${f.title}`).join("\n").slice(0, 1500)}

分节草稿：
${parts.join("\n\n").slice(0, 9000)}`, 6000);
    out.hidden = false; setMD(out, txt); $("btnWCopy").hidden = false;
    (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.consistency = withMeta(txt, "分节草稿"); p.showW = "consistency"; addVersion(p, "一致性检查", p.outs.consistency, "outs.consistency"); save(); } })();
    prog.textContent = "一致性检查完成 ✓";
  } catch (e) { prog.textContent = "失败：" + e.message; }
}));

/* v1.0.1（QA P0-2）：导出节序 = 参考稿节序 ∪ 我的稿键 ∪ 范式节（去重保序）——快速稿节名由 AI 自定，按范式节遍历会丢节 */
function exportSecList(p, pq) {
  const list = [], seen = new Set();
  const push = (x) => { const s0 = String(x || "").trim(); if (s0 && !seen.has(s0)) { seen.add(s0); list.push(s0); } };
  ((p && p.ref && p.ref.order) || []).forEach(push);
  Object.keys((p && p.draft) || {}).forEach(push);
  ((pq && pq.sections) || []).forEach(push);
  return list;
}

/* 全文合并导出（Word 可直接打开的 .doc；章节顺序=范式章节表） */
$("btnExportDoc").addEventListener("click", () => {
  const p = cur(); if (!p) return wqNotice("先新建项目");
  const pq = PQ(p);
  const esc2 = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const metaLines = [];
  const secList = exportSecList(p, pq);
  const parts = secList.map(s => {
    let t = p.draft?.[s] || "";
    if (t) t = t.replace(/〔生成：[^〕]*〕/g, (m) => { metaLines.push(s + "：" + m.replace(/^〔|〕$/g, "")); return ""; }).trim();
    return `<h2>${esc2(s)}</h2>` + (t ? t.split(/\n+/).map(x => `<p>${esc2(x)}</p>`).join("") : "<p>〔本节未起草〕</p>");
  }).join("\n");
  const aiDecl = metaLines.length ? `<h2>AI 辅助说明</h2><p style="font-size:10.5pt;color:#555">本稿以下章节含 AI 辅助起草内容（模型 · 日期 · 依据）：<br>${metaLines.map(esc2).join("<br>")}</p>` : "";
  const refs = p.papers.length ? `<h2>参考文献</h2><p style="font-size:10.5pt;line-height:1.4">` +
    p.papers.map((f, i) => `[${i + 1}] ${esc2(f.author || "作者待补")}. ${esc2(f.title)}[${f.type || "J"}]. ${esc2(f.venue || "出处待补")}, ${esc2(f.year || "年份待补")}${f.doi ? ". DOI:" + esc2(f.doi) : ""}.`).join("<br>") + "</p>" : "";
  const html = `<html><head><meta charset="utf-8"><style>body{font-family:SimSun,serif;font-size:12pt;line-height:1.6}h1{font-size:16pt;text-align:center}h2{font-size:14pt}</style></head><body><h1>${esc2(p.topic || p.name)}</h1>${parts}${refs}${aiDecl}<p style="color:#888">—— 由萤算科研·文渠工作台辅助起草（${new Date().toISOString().slice(0, 10)}），引用与数据请人工核对 ——</p></body></html>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }));
  a.download = (p.topic || p.name || "论文全文").replace(/[\\/:*?"<>|]/g, "_") + ".doc";
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  const drafted = secList.filter(s => p.draft && p.draft[s]).length;
  trailAdd(p, "export", "导出全文（Word）", (p.topic || p.name) + " · 已起草 " + drafted + "/" + pq.sections.length + " 节" + (drafted ? "" : "（尚为空稿占位）"));
  save(); renderProcessLog();
});

$("btnAIDecl").addEventListener("click", () => withBusy($("btnAIDecl"), async () => {
  const p0 = cur(); if (!p0) { wqNotice("先新建项目"); return; }
  const pid = p0.id;
  if (!(await askAI("生成 AI 使用声明模板？", ["调用 AI 1 次"], "生成"))) { $("wProg").textContent = "已取消"; return; }
  $("wProg").textContent = "生成 AI 使用声明模板…";
  try {
    const txt = await callAI(`生成两份「AI使用声明」模板（简体中文）：一份用于期刊投稿（声明使用了AI辅助语言润色/文献整理，内容与结论由作者负责，按常见期刊要求写），一份用于学位论文（按高校常见格式，含AI工具名称、用途、使用范围、作者承诺段）。每份150字内，留空待填处用____。`);
    setMD($("wOut"), txt); $("btnWCopy").hidden = false; $("wProg").textContent = "完成 ✓";
    (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.aidecl = txt; p.showW = "aidecl"; addVersion(p, "AI 使用声明", txt, "outs.aidecl"); save(); } })();
  } catch (e) { $("wProg").textContent = "失败：" + e.message; }
}));

$("btnWCopy").addEventListener("click", () => {
  if ($("wOut").dataset.rawmd) { copyText($("wOut").dataset.rawmd, $("btnWCopy")); return; }
  navigator.clipboard.writeText($("wOut").textContent).then(() => { $("btnWCopy").textContent = "已复制 ✓"; setTimeout(() => $("btnWCopy").textContent = "复制结果", 1500); }).catch(() => {});
});

/* ---------- 阶段5 投稿 / 答辩 ---------- */
$("btnVenue").addEventListener("click", () => withBusy($("btnVenue"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const dois = p0.papers.filter(f => f.doi).map(f => f.doi).slice(0, 50);
  if (dois.length < 3) { $("vProg").textContent = "DOI 不足 3 条：回阶段2给关键文献补 DOI（批量导入会自动带 DOI）。"; return; }
  $("vProg").textContent = "OpenAlex 批量查询中…";
  try {
    const d = await fetchJSON(`${OA}?filter=doi:${dois.map(x => "https://doi.org/" + x).join("|")}&select=doi,primary_location&per-page=50${MAIL()}`);
    const cnt = {};
    d.results.forEach(w => { const s = w.primary_location?.source?.display_name; if (s) cnt[s] = (cnt[s] || 0) + 1; });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $("venueOut").hidden = false;
    $("venueOut").innerHTML = `<p style="margin-top:0"><b>你的文献库主要发表在：</b>（${d.results.length}/${dois.length} 条 DOI 命中）</p>` +
      `<table class="tb"><tr><th>期刊</th><th>篇数</th><th>占比</th></tr>` +
      top.map(([n, c]) => `<tr><td>${esc(n)}</td><td>${c}</td><td>${Math.round(c / dois.length * 100)}%</td></tr>`).join("") + "</table>" +
      `<p class="hint">同领域期刊是你最现实的投稿去向（审稿人池、引用口味重合）。影响因子/分区请到期刊官网或 JCR 核对。</p>`;
    $("vProg").textContent = "完成 ✓ 可再点「AI 投稿策略」要梯度建议";
  } catch (e) { $("vProg").textContent = "失败：" + e.message; }
}));

$("btnStrategy").addEventListener("click", () => withBusy($("btnStrategy"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  if (!(await askAI("生成冲/稳/保投稿策略？", ["调用 AI 1 次"], "生成"))) { $("vProg").textContent = "已取消"; return; }
  $("vProg").textContent = "AI 生成投稿策略中…";
  try {
    const venues = $("venueOut").textContent.split("\n").filter(l => l.trim()).slice(0, 12).join("; ");
    const txt = await callAI(`你是投稿顾问。研究主题：「${p0.topic || "未定"}」（${PQ(p0).name}范式）。文献库期刊分布：${venues || "未分析"}。选题报告：${(p0.selection || "").slice(0, 800)}
请给出投稿策略：冲(1-2刊)/稳(2-3刊)/保底(1-2刊)三档期刊建议——每刊一句话理由（匹配度、周期特点、口碑），并给投稿顺序建议与拒稿后的调整动作（改投/改写）。中文输出，注明「期刊指标请自行到官网核对」。`, 3000);
    setMD($("vOut"), txt);
    (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.strategy = withMeta(txt, "文献库期刊分布"); p.showV = "strategy"; addVersion(p, "投稿策略", p.outs.strategy, "outs.strategy"); save(); } })();
  } catch (e) { $("vProg").textContent = "失败：" + e.message; }
}));

$("btnCover").addEventListener("click", () => withBusy($("btnCover"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  if (!(await askAI("生成 Cover Letter？", ["调用 AI 1 次"], "生成"))) { $("vProg").textContent = "已取消"; return; }
  $("vProg").textContent = "生成 Cover Letter…";
  try {
    const txt = await callAI(`Write a concise journal cover letter (English, <250 words) based on: Title topic: ${p0.topic || "____"}; Key contribution: ${(p0.selection || "").slice(0, 500) || "____"}. Include: significance, fit to journal (placeholder [Journal Name]), no simultaneous submission, no conflicts of interest, all authors approved. Provide placeholders like [Your Name] where personal info is required. Also append a 中文版.`, 2000);
    setMD($("vOut"), txt);
    (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.cover = txt; p.showV = "cover"; addVersion(p, "Cover Letter", txt, "outs.cover"); save(); } })();
  } catch (e) { $("vProg").textContent = "失败：" + e.message; }
}));

$("btnRebuttal").addEventListener("click", () => withBusy($("btnRebuttal"), async () => {
  const p0 = cur(); if (!p0) return wqNotice("先新建项目");
  const pid = p0.id;
  const comments = (typeof window.wqPromptAI === "function")
    ? await window.wqPromptAI("粘贴审稿意见（Reviewer #1 / #2 …，可整段）：", "把审稿意见粘贴到这里…", "开始起草")
    : prompt("粘贴审稿意见（Reviewer #1 / #2 …，可整段）：");
  if (!comments || !comments.trim()) return;
  if (!(await askAI("起草审稿回复信？", ["调用 AI 1 次，约 30-60 秒"], "开始起草"))) { $("vProg").textContent = "已取消"; return; }
  $("vProg").textContent = "起草审稿回复中…";
  try {
    const drafts = Object.entries(p0.draft || {}).map(([k, v]) => `【${k}】${v.slice(0, 400)}`).join("\n").slice(0, 2000);
    const txt = await callAI(`你是学术写作教练。请把下面的审稿意见逐条拆解并起草回复：
要求：1) 每条意见编号并归类（方法/数据/写作/图表）；2) 每条给出回复策略（补实验/补数据/文字修改/礼貌反驳）与一段可直接粘贴的英文回复草稿（Response to Reviewer 风格，标明需要改动处用〔待补〕）；3) 结尾给「修改说明清单」（Change List 骨架）。
论文草稿节选（供回复时对齐内容）：
${drafts || "（无草稿）"}
审稿意见如下：

${comments.trim().slice(0, 3500)}`, 6000);
    setMD($("vOut"), txt);
    (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.rebuttal = txt; p.showV = "rebuttal"; addVersion(p, "审稿回复信", txt, "outs.rebuttal"); save(); } })();
  } catch (e) { $("vProg").textContent = "失败：" + e.message; }
}));

/* 答辩材料：按层级动态渲染（本科：开题报告/PPT大纲/问答预演；硕博：问答预演） */
function renderDefense() {
  const p = cur();
  const list = p ? (LV(p).defense || []) : [];
  $("defenseBtns").innerHTML = list.length ? `<span class="hint">答辩材料（${LV(p).name}）：</span>` + list.map(d => `<button class="btn2 ghost" data-def="${d}" ${keyOK() ? "" : "disabled title=\"需先在页头配置 AI Key\""}>🎓 ${d}</button>`).join("") : "";
  $("defenseBtns").hidden = !list.length;
}
$("defenseBtns").addEventListener("click", (e) => {
  const b = e.target.closest("[data-def]"); if (!b) return;
  withBusy(b, async () => {
    const p0 = cur(); if (!p0) return wqNotice("先新建项目");
    const pid = p0.id;
    const prog = $("vProg"), out = $("vOut");
    const pq = PQ(p0), lv = LV(p0);
    if (!(await askAI("生成「" + b.dataset.def + "」？", ["调用 AI 1 次，约 30-60 秒"], "开始生成"))) { prog.textContent = "已取消"; return; }
    prog.textContent = `生成「${b.dataset.def}」中…`; out.hidden = true;
    try {
      const base = `选题主题：${p0.topic || "未定"}（${pq.name}范式，${lv.name}）\n大纲：${(p0.outline || "（未生成）").slice(0, 1500)}\n文献矩阵：${(p0.matrix || "（未生成）").slice(0, 1200)}`;
      const prompts = {
        "开题报告初稿": `请基于以下材料起草一份${lv.name}开题报告初稿（简体中文）：一、研究背景与意义；二、文献综述述评（引用编号来自文献矩阵）；三、研究内容与研究问题；四、研究方法/技术路线；五、进度安排（6个阶段，标月份占位）；六、预期成果与可能困难。可直接填入学校模板。`,
        "答辩PPT大纲": `请基于以下材料生成${lv.name}答辩 PPT 大纲（10-12页）：每页给出页标题+3条要点+一句讲解词提示；首页与致谢页含占位。`,
        "答辩问题预演": `请基于以下材料，模拟答辩委员/盲审专家最可能提出的 8-10 个问题（按「选题价值/方法与数据/创新点/局限与改进」分组），每个问题给 2-3 句作答要点与答题策略。直白、不留情面。`
      };
      const txt = await callAI((prompts[b.dataset.def] || "生成答辩材料。") + "\n\n" + base, 6000);
      const p = liveProj(pid); if (!p) return;
      out.hidden = false; setMD(out, txt);
      prog.textContent = `完成 ✓「${b.dataset.def}」`;
    } catch (e) { prog.textContent = "失败：" + e.message; }
  });
});

/* ---------- 个人写作档案 UI ---------- */
$("stylePrefs").value = getStyle().prefs || "";
$("stylePrefs").addEventListener("change", () => {
  const s = getStyle(); s.prefs = $("stylePrefs").value.trim();
  setStyle(s) ? $("styleProg").textContent = "显式偏好已保存 ✓" : $("styleProg").textContent = "保存失败";
});
$("btnStyleExtract").addEventListener("click", () => withBusy($("btnStyleExtract"), async () => {
  const src = $("styleSrc").value.trim();
  if (src.length < 200) { $("styleProg").textContent = "请先粘贴 ≥200 字你自己写的文字（论文/报告片段均可）"; return; }
  if (!(await askAI("从这段文字提炼风格画像？", ["调用 AI 1 次，结果需你确认后才写入档案"], "开始提炼"))) { $("styleProg").textContent = "已取消"; return; }
  $("styleProg").textContent = "提炼风格画像中…";
  try {
    const txt = await callAI(`你是写作风格分析师。从下面这段作者亲笔文字中提炼「写作风格画像」，输出 ≤200 字，涵盖：句子长短与节奏、主动/被动偏好、段落组织方式（总分/递进）、常用衔接词、人称习惯（我们/本文/笔者）、术语使用风格、标点与口头禅特征。只描述客观特征，不评价好坏。\n\n【作者文字】\n${src.slice(0, 3000)}`, 800);
    $("stylePrev").hidden = false;
    $("stylePrev").innerHTML = `<b>风格画像（确认后写入档案）：</b><br>${esc(txt)}<br><button class="btn2 btn-sm" id="styleConfirm" style="margin-top:6px">✓ 确认写入档案</button>`;
    $("styleConfirm").addEventListener("click", () => {
      const s = getStyle(); s.profileText = txt; s.updatedAt = new Date().toISOString().slice(0, 10);
      setStyle(s); $("styleProg").textContent = "已写入档案 ✓（所有写作类生成即刻生效）";
    });
  } catch (e) { $("styleProg").textContent = "失败：" + e.message; }
}));
$("btnStyleLearn").addEventListener("click", () => withBusy($("btnStyleLearn"), async () => {
  const a = $("styleSrc").value.trim(), b = $("styleSrc2").value.trim();
  if (!a || !b) { $("styleProg").textContent = "改稿学习需要两段：上=AI 原稿，下=你的改稿"; return; }
  if (!(await askAI("对比原稿与改稿、提炼改动模式？", ["调用 AI 1 次，结果需你确认后才并入档案"], "开始对比"))) { $("styleProg").textContent = "已取消"; return; }
  $("styleProg").textContent = "提炼改动模式中…";
  try {
    const txt = await callAI(`对比下面两段文字（第一段是 AI 起草稿，第二段是作者的修改稿）。提炼作者的修改模式，输出 ≤150 字要点（如：长句拆短、删空洞副词、改被动为主动、段落重排、补充数据位置习惯等）。只描述规律。\n\n【AI原稿】\n${a.slice(0, 1500)}\n\n【作者改稿】\n${b.slice(0, 1500)}`, 600);
    $("stylePrev").hidden = false;
    $("stylePrev").innerHTML = `<b>改稿模式（确认后并入档案）：</b><br>${esc(txt)}<br><button class="btn2 btn-sm" id="styleConfirm2" style="margin-top:6px">✓ 确认并入档案</button>`;
    $("styleConfirm2").addEventListener("click", () => {
      const s = getStyle();
      s.profileText = (s.profileText ? s.profileText + "\n" : "") + "【改稿学习 " + new Date().toISOString().slice(0, 10) + "】" + txt;
      setStyle(s); $("styleProg").textContent = "已并入档案 ✓";
    });
  } catch (e) { $("styleProg").textContent = "失败：" + e.message; }
}));

$("projStatus").addEventListener("change", () => { const p = cur(); if (p) { p.status = $("projStatus").value; save(); renderProjects(); } });

/* ---------- v0.4：阶段卡片 / 进度 / 引导 / 备份提醒 / AI 置灰 ---------- */
function keyOK() { return !!aiConf().key; }
function refreshAIButtons() {
  const ok = keyOK();
  document.querySelectorAll("[data-ai]").forEach(b => { b.disabled = !ok; b.title = ok ? "" : "需先在页头「AI / 接口设置」配置 Key"; });
  renderSecBtns(); renderDefense(); // 动态按钮的置灰状态同步
}
function backupInfo() {
  const last = localStorage.getItem("wenqu_lastBackup") || "";
  const stale = DB.projects.length && (!last || (Date.now() - new Date(last).getTime() > 7 * 86400000));
  return { last, stale };
}
function renderStageCards() {
  const p = cur();
  const abs = p ? p.papers.filter(f => f.abs).length : 0;
  const draftN = p ? Object.keys(p.draft || {}).length : 0;
  const has = { trend: !!(p?.trend?.length), sel: !!(p?.selection), lit10: (p?.papers.length || 0) >= 10, abs5: abs >= 5, matrix: !!(p?.matrix), outline: !!p?.outline, design: !!p?.design, draft: draftN > 0 };
  const done = Object.values(has).filter(Boolean).length;
  const ck = (v, yes, no) => v ? "✓ " + yes : "○ " + no;
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  set("sc1", "<b>阶段目标：</b>确定研究问题与创新点　<b>产出：</b>趋势图 + 选题卡<br>" + ck(has.trend, "趋势图已生成", "趋势未生成") + " · " + ck(has.sel, "选题卡已存入", "选题卡未生成（点「AI 评估选题」）") + "　<b>下一步 →</b> ② 文献获取与管理");
  set("sc2", "<b>阶段目标：</b>建立项目文献库　<b>当前：</b>" + (p?.papers.length || 0) + " 篇（" + abs + " 篇带摘要）　<b>建议规模：</b>" + LV(p).lit + "<br>工具：上方免费检索 / 批量 DOI / 收藏篮导入 / 逐条添加　<b>下一步 →</b> ③ 阅读与综合");
  set("sc3", "<b>前置依赖：</b>带摘要文献 " + abs + " 篇 " + (abs === 0 ? "—— ⚠ 为 0 时矩阵无法生成，请先回阶段2补摘要" : "") + "<br><b>产出：</b>文献矩阵（依据：摘要级）+ AI 读论文精读 + 综述素材　<b>下一步 →</b> ④ 设计与写作");
  set("sc4", "<b>前置：</b>" + ck(has.sel, "选题卡", "选题卡缺（生成质量下降）") + " · " + ck(has.matrix, "文献矩阵", "矩阵缺（无法标注引用编号）") + "<br><b>产出：</b>大纲 + 研究设计审查 + 分节草稿 " + draftN + " 篇 + 全文导出　<b>下一步 →</b> ⑤ 参考稿修改（有参考稿时）或 ⑥ 质检与投稿");
  set("sc5", "<b>阶段目标：</b>把参考稿逐段改成你自己的东西　<b>产出：</b>我的稿（逐节）+ 归属账本 + 本人贡献度 + 归属报告<br>用法：左侧参考稿逐段「采用/改写/追问依据」→ 右侧编辑保存（正文 [n] 可点击跳到文末参考文献并可修订题录）　<b>下一步 →</b> ⑥ 质检与投稿");
  set("sc6", "<b>产出：</b>引用核验 + 论断抽查 + 三专家内审 + 一致性检查 + 期刊/答辩包　<b>完成后：</b>" + (LV(p).name === "本科毕设" ? "导出全文 → 查重 → 答辩" : LV(p).id === "general" ? "导出全文 → 同行/合作者反馈（如需投稿再走期刊匹配）" : "投稿 → 返修用「审稿回复起草」"));
  const pl = $("progressLine");
  if (pl) pl.innerHTML = "关键产出 <b>" + done + "/8</b>：趋势 " + (has.trend ? "✓" : "○") + " · 选题卡 " + (has.sel ? "✓" : "○") + " · 文献≥10 " + (has.lit10 ? "✓" : "○") + " · 摘要≥5 " + (has.abs5 ? "✓" : "○") + " · 矩阵 " + (has.matrix ? "✓" : "○") + " · 大纲 " + (has.outline ? "✓" : "○") + " · 设计审查 " + (has.design ? "✓" : "○") + " · 草稿 " + (has.draft ? "✓" : "○");
}

/* ---------- v0.6：版本档案 —— 每次生成按分秒存档，便于日后查阅（每项目上限 40 条） ---------- */
function vStamp() {
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}
function addVersion(p, kind, content, field) {
  if (!p || !content) return;
  p.versions = p.versions || [];
  p.versions.unshift({ ts: vStamp(), kind: kind, content: String(content).slice(0, 12000), field: field || "", star: false });
  /* v3.1（E1）：40 条上限，⭐星标豁免淘汰；淘汰发生时明示条数，不再静默 */
  let vDrop = 0;
  while (p.versions.length > 40) {
    let vIdx = -1;
    for (let vi = p.versions.length - 1; vi >= 0; vi--) { if (!p.versions[vi].star) { vIdx = vi; break; } }
    if (vIdx < 0) break;
    p.versions.splice(vIdx, 1); vDrop++;
  }
  if (vDrop && typeof wqNotice === "function") wqNotice("较早的 " + vDrop + " 条版本已移出档案（⭐星标版本保留）——重要版本请在版本档案加星标");
  /* v0.8：每次生成/留存自动记入轨迹（附模型·依据·字数） */
  const meta = (String(content).match(/〔生成：([^〕]{0,120})〕/) || [])[1];
  const isTool = (field || "") === "tool";
  trailAdd(p, isTool ? "keep" : "ver", (isTool ? "留存：" : "新版本：") + kind,
    (meta ? "模型·依据：" + meta + " · " : "") + String(content).length + " 字");
  renderVerCount(); // 徽标即时刷新
}
function renderVerCount() { const el = $("verCount"); if (el) el.textContent = String((cur()?.versions || []).length); }
function verFileName(v, ext) { return ("版本-" + v.kind + "-" + v.ts).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_") + "." + ext; }
function verDl(v, fmt) {
  if (fmt === "doc") {
    const html = "<html><head><meta charset=\"utf-8\"><style>body{font-family:SimSun,serif;font-size:12pt;line-height:1.6}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}h1{font-size:16pt;text-align:center}</style></head><body>" + mdRender(v.content) + "</body></html>";
    dlText(verFileName(v, "doc"), html, "application/msword");
  } else {
    dlText(verFileName(v, "md"), v.content, "text/markdown");
  }
  const p = cur();
  if (p) { trailAdd(p, "export", "导出版本", v.kind + " → " + (fmt === "doc" ? "Word(.doc)" : ".md")); save(); renderProcessLog(); }
}
async function verLoad(i) {
  const p = cur(); if (!p) return;
  const v = (p.versions || [])[i]; if (!v || !v.field || v.field === "tool") return;
  /* v1.0：归档版本先回取全文 */
  let content = v.content;
  if (v.archived && window.WQStore) content = (await window.WQStore.getVersion(p.id, i)) || v.content;
  const f = v.field;
  p.outs = p.outs || {};
  if (f === "selection") p.selection = v.content;
  else if (f === "matrix") p.matrix = content;
  else if (f === "outline") { p.outline = content; p.outs.outline = content; p.showW = "outline"; }
  else if (f === "design") { p.design = content; p.outs.design = content; p.showW = "design"; }
  else if (f.indexOf("draft:") === 0) { p.draft = p.draft || {}; const sec2 = f.slice(6); p.draft[sec2] = content; p.showW = "sec:" + sec2; }
  else if (f.indexOf("outs.") === 0) { const k = f.slice(5); p.outs[k] = content; if (["internal", "consistency", "aidecl"].indexOf(k) >= 0) p.showW = k; else p.showV = k; }
  save(); renderAll();
  $("verDrawer").classList.remove("open"); $("mask").classList.remove("open");
  trailAdd(p, "load", "载入回项目（迭代）", v.kind + " → 已设为当前内容");
  save(); renderProcessLog();
  toast("已载入该版本为当前内容——继续修改或重新生成会产生新版本");
}
function procNote(kind, content) {
  const t = String(content || "").replace(/[#>*`|\-]{1,}/g, " ").replace(/\s+/g, " ").trim();
  return (t.slice(0, 88) || "（无正文摘要）") + (t.length > 88 ? "…" : "");
}
/* v0.9：论文矩阵「存入项目文献库」桥（工具台调用；去重 + 入版本档案） */
window.wqAddToPapers = function (items) {
  const p = cur(); if (!p) return { ok: false, msg: "先新建项目" };
  const exist = new Set(p.papers.map(f => ((f.doi || "") + (f.title || "")).toLowerCase()));
  let n = 0;
  (items || []).forEach((b, i) => {
    const key = ((b.doi || "") + (b.title || "")).toLowerCase();
    if (!key || exist.has(key)) return;
    exist.add(key);
    p.papers.push({ id: "f" + Date.now() + "_" + i, title: b.title || "", year: b.year || "", doi: b.doi || "", venue: b.venue || "", author: (b.authors || []).slice(0, 3).join("，") + ((b.authors || []).length > 3 ? "，等" : ""), type: "J", abs: "" });
    n++;
  });
  save(); renderPapers(); renderProjects(); renderStageCards();
  if (n) { addVersion(p, "检索矩阵入库（" + n + " 篇）", p.papers.map((f, i) => "[" + (i + 1) + "] " + f.title).join("\n"), "tool"); save(); }
  return { ok: true, n };
};
window.wqProjectKeep = function (kind, content, mode) {  const p = cur(); if (!p) return;
  if (mode === "keep") { addVersion(p, "工具台·" + kind, content, "tool"); }
  else {
    trailAdd(p, "note", "工具台·" + kind + "（未留存）", procNote(kind, content));
  }
  save(); renderVerCount(); renderProcessLog();
};
function renderProcessLog() {
  const box = $("procList"); if (!box) return;
  const p = cur();
  const tr = (p && p.trail) || [];
  const vN = (p && p.versions || []).length;
  box.innerHTML = (tr.length ? tr.slice(0, 120).map(e =>
      "<div class=\"srcitem\">" + esc(e.ts) + " · " + (TRAIL_ICON[e.type] || "•") + " <b>" + esc(e.label) + "</b>"
      + (e.note ? " — <span style=\"color:#5c6675\">" + esc(e.note) + "</span>" : "") + "</div>").join("")
      + (tr.length > 120 ? "<p class=\"hint\">…仅显示最近 120 条（共 " + tr.length + " 条，导出轨迹可看全部）</p>" : "")
    : "<p class=\"hint\">暂无轨迹。AI 生成、确认 / 取消、留存选择、版本载入、导入导出都会自动记录在这里。</p>")
    + "<p class=\"hint\" style=\"margin-top:8px\">版本档案：共 <b>" + vN + "</b> 版 <button class=\"pill\" id=\"procOpenVer\">📜 打开版本档案</button></p>";
  const b = document.getElementById("procOpenVer"); if (b) b.addEventListener("click", verOpen);
}
/* ---------- v3.1：易用性五件套（B 对比 / A 总览 / C 中文路径 / D 覆盖率 / E 角标） ---------- */
const OUT_NAMES = { outline: "大纲", design: "设计审查", internal: "三专家内审", consistency: "一致性检查", aidecl: "AI 使用声明", cover: "投稿信", rebuttal: "回复信" };
function fieldLabel(f) {
  f = f || "";
  if (f.indexOf("draft:") === 0) return "④草稿·" + f.slice(6);
  if (f.indexOf("sec:") === 0) return "④草稿·" + f.slice(4);
  if (f.indexOf("outs.") === 0) { const k = f.slice(5); return "⑤" + (OUT_NAMES[k] || k); }
  const m0 = { selection: "①选题卡", trend: "①选题趋势", matrix: "③文献矩阵", outline: "④大纲", design: "④设计审查", internal: "⑤三专家内审", consistency: "⑤一致性检查", aidecl: "⑤AI 使用声明", cover: "⑤投稿信", rebuttal: "⑤回复信", tool: "工具台产出" };
  return m0[f] || (f || "—");
}
/* B：版本间段落级对照（WQDiff 现成件接入版本档案） */
function renderVDiff(aText, bText, aLabel, bLabel) {
  const rows = (window.WQCore ? WQCore.diff.paras(aText, bText) : null);
  if (!rows) return "<p class='hint'>对比功能需要 wq-core 支持（刷新页面重试）</p>";
  let html = "", same = 0, adds = 0, dels = 0, mods = 0;
  const flush = () => { if (same) { html += "<div class='dsame'>··· " + same + " 段未变 ···</div>"; same = 0; } };
  rows.forEach(r => {
    if (r.type === "same") { same++; return; }
    flush();
    if (r.type === "del") { dels++; html += "<div class='ddel'><b>− " + esc(aLabel) + " 独有</b>" + esc(r.ai) + "</div>"; }
    else if (r.type === "add") { adds++; html += "<div class='dadd'><b>+ " + esc(bLabel) + " 独有</b>" + esc(r.mine) + "</div>"; }
    else { mods++; html += "<div class='dmod'><div class='do'><b>" + esc(aLabel) + " 旧</b>" + esc(r.ai) + "</div><div class='dn'><b>" + esc(bLabel) + " 新</b>" + esc(r.mine) + "</div></div>"; }
  });
  flush();
  const ca = String(aText).replace(/\s+/g, "").length, cb = String(bText).replace(/\s+/g, "").length;
  const dd = cb - ca;
  return "<div class='dsum'>" + esc(aLabel) + " " + ca + " 字 → " + esc(bLabel) + " " + cb + " 字（" + (dd >= 0 ? "+" : "") + dd + "）· 删 " + dels + " 段 · 增 " + adds + " 段 · 改 " + mods + " 段</div>" + (html || "<div class='dsame'>两个版本段落级一致</div>");
}
function verDiffRun() {
  const p = cur(); const vs = p && p.versions || [];
  const sa = document.getElementById("verDiffA"), sb = document.getElementById("verDiffB"), ck = document.getElementById("verDiffCur");
  if (!sa || !sb || !vs.length) return;
  const va = vs[+sa.value]; if (!va) return;
  const out0 = document.getElementById("verDiffOut");
  const run = (bT, bL) => { out0.innerHTML = renderVDiff(va.content, bT, "A·" + va.kind, bL); };
  if (ck && ck.checked) {
    if ((va.field || "").indexOf("draft:") !== 0) { out0.innerHTML = "<p class='hint'>「当前稿」仅适用于草稿类版本（该版本：" + esc(fieldLabel(va.field)) + "）</p>"; return; }
    run((p.draft || {})[va.field.slice(6)] || "", "当前稿");
  } else {
    const vb = vs[+sb.value];
    if (!vb || vb === va) { out0.innerHTML = "<p class='hint'>请选择两个不同的版本</p>"; return; }
    if (vb.archived && window.WQStore) { out0.innerHTML = "<p class='hint'>B 为归档版本，回取中…</p>"; window.WQStore.getVersion(p.id, +sb.value).then(c => run(c || vb.content, "B·" + vb.kind)); return; }
    run(vb.content, "B·" + vb.kind);
  }
}
function verFillCmp() {
  const p = cur(); const vs = p && p.versions || [];
  const sa = document.getElementById("verDiffA"), sb = document.getElementById("verDiffB");
  if (!sa || !sb) return;
  const opts = vs.map((v, i) => "<option value='" + i + "'>" + i + " · " + esc(String(v.kind).slice(0, 14)) + " · " + esc(fieldLabel(v.field)) + "</option>").join("");
  sa.innerHTML = opts; sb.innerHTML = opts;
  sa.value = "0"; sb.value = vs.length > 1 ? "1" : "0";
  const out0 = document.getElementById("verDiffOut"); if (out0) out0.innerHTML = "";
}
/* A：项目资产总览（治"创建了什么不知道哪里找"） */
function invOpen() {
  const p = cur(); if (!p) { wqNotice("先新建项目"); return; }
  document.getElementById("invProj").textContent = p.name;
  const starred = (p.versions || []).filter(v => v.star).length;
  const rows = [];
  const row = (name, meta, content, field) => rows.push({ name, meta, content, field });
  row("① 选题卡", p.selection ? "已生成" : "未生成", p.selection || "", "selection");
  row("① 选题趋势", p.trend && p.trend.length ? p.trend.length + " 个方向" : "未生成", "", "");
  row("② 文献库", (p.papers.length || 0) + " 篇", "", "");
  row("③ 文献矩阵", p.matrix ? "已生成" : "未生成", p.matrix || "", "matrix");
  row("④ 大纲", p.outline ? "已生成" : "未生成", p.outline || "", "outline");
  row("④ 设计审查", p.design ? "已生成" : "未生成", p.design || "", "design");
  const secs = Object.keys(p.draft || {});
  if (secs.length) secs.forEach(s => {
    const len = (p.draft[s] || "").replace(/\s+/g, "").length;
    const lv = (p.versions || []).find(v => v.field === "draft:" + s);
    row("④ 草稿·" + s, len + " 字" + (lv ? " · " + lv.ts : ""), p.draft[s] || "", "draft:" + s);
  });
  else row("④ 草稿", "未生成", "", "");
  [["⑤ 三专家内审", "internal"], ["⑤ 一致性检查", "consistency"], ["⑤ AI 使用声明", "aidecl"]].forEach(pair => {
    row(pair[0], p.outs && p.outs[pair[1]] ? "已生成" : "未生成", (p.outs && p.outs[pair[1]]) || "", "outs." + pair[1]);
  });
  row("⑤ 校验记录", (p.checks || []).length + " 条", "", "");
  row("🕓 版本档案", (p.versions || []).length + " 条（⭐ " + starred + " 星标）", "", "");
  let html = "<h3 style='margin:4px 0 8px;font-size:14px'>🕒 最近动态</h3>";
  const tr = (p.trail || []).slice(0, 5);
  html += tr.length ? tr.map(t0 => "<div class='irow' style='cursor:default'><span class='iname' style='min-width:0;flex:1;font-weight:400'>" + esc((t0.label || "") + (t0.note ? "（" + t0.note + "）" : "")) + "</span><span class='imeta'>" + esc(t0.ts || "") + "</span></div>").join("") : "<p class='hint'>还没有动态</p>";
  html += "<h3 style='margin:14px 0 8px;font-size:14px'>📦 项目资产（点击「查看」看全文）</h3>";
  rows.forEach((r0, i) => {
    const missing = r0.meta === "未生成";
    html += "<div class='irow" + (missing ? " imiss" : "") + "'><span class='iname'>" + esc(r0.name) + "</span><span class='imeta'>" + esc(r0.meta) + "</span>" +
      (missing ? "" : "<button class='pill' data-invv='" + i + "'>查看</button>") + "</div>";
  });
  const list = document.getElementById("invList");
  list.innerHTML = html;
  window.__invRows = rows;
  list.querySelectorAll("[data-invv]").forEach(b => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const r0 = (window.__invRows || [])[+b.dataset.invv]; if (!r0) return;
    invShow(r0.name, r0.content);
  }));
  document.getElementById("invDrawer").classList.add("open");
  document.getElementById("mask").classList.add("open");
}
function invShow(title, content) {
  let ov = document.getElementById("invShowBox");
  if (ov) ov.remove();
  ov = document.createElement("div");
  ov.id = "invShowBox";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(27,42,74,.4);z-index:120;display:flex;align-items:center;justify-content:center";
  document.body.appendChild(ov);
  ov.innerHTML = "<div style='background:#fff;border-radius:14px;width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column;padding:16px 18px;box-shadow:0 18px 50px rgba(2,6,23,.25)'>" +
    "<div style='display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:8px'><b>" + esc(title) + "</b><span style='flex:1'></span>" +
    "<button class='pill' id='invShowDl'>⤓ .md</button><button class='pill' id='invShowX'>关闭</button></div>" +
    "<div id='invShowBody' style='overflow:auto;font-size:13px;line-height:1.7'></div></div>";
  const body = ov.querySelector("#invShowBody");
  if (typeof setMD === "function") setMD(body, content || "（空）"); else body.textContent = content || "";
  ov.querySelector("#invShowX").addEventListener("click", () => { ov.remove(); });
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  ov.querySelector("#invShowDl").addEventListener("click", () => {
    const b0 = new Blob([content || ""], { type: "text/markdown;charset=utf-8" });
    const a0 = document.createElement("a"); a0.href = URL.createObjectURL(b0);
    a0.download = String(title).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) + ".md"; a0.click();
  });
}
/* E2：阶段页签产出角标 */
function renderStageBadges() {
  const p = cur();
  const counts = p ? {
    "1": (p.selection ? 1 : 0) + ((p.trend && p.trend.length) ? 1 : 0),
    "2": (p.papers || []).length,
    "3": (p.matrix ? 1 : 0) + (p.datacards || []).length,
    "4": (p.outline ? 1 : 0) + (p.design ? 1 : 0) + Object.keys(p.draft || {}).length,
    "5": (p.checks || []).length + Object.keys(p.outs || {}).filter(k => ["internal", "consistency", "aidecl", "cover", "rebuttal"].indexOf(k) >= 0).length,
    "6": 0
  } : {};
  document.querySelectorAll(".stage[data-s]").forEach(b => {
    const n = counts[b.dataset.s] || 0;
    let s0 = b.querySelector(".sbadge");
    if (!n) { if (s0) s0.remove(); return; }
    if (!s0) { s0 = document.createElement("span"); s0.className = "sbadge"; b.appendChild(s0); }
    s0.textContent = n;
  });
}
/* D：数据关联覆盖率常显条（④草稿区顶部；点击跳质检中心绑定面板） */
function renderNumBar() {
  const p = cur(); const pane = document.getElementById("s4");
  if (!pane || !p) return;
  let bar = document.getElementById("numBar");
  if (!bar) {
    bar = document.createElement("div"); bar.id = "numBar"; bar.className = "callout c-info"; bar.style.margin = "8px 0";
    const anchor = pane.querySelector(".stagecard");
    pane.insertBefore(bar, anchor ? anchor.nextSibling : pane.firstChild);
  }
  const secs = Object.keys(p.draft || {});
  const re = /(?:^|[^\d\[（(]?)(\d+(?:\.\d+)?(?:%|万|千|亿|个百分点)?)/g;
  let hits = 0, bound = 0; const seen = {};
  secs.forEach(s0 => {
    const t = p.draft[s0] || ""; let m;
    while ((m = re.exec(t)) && hits < 500) {
      const num = m[1];
      const pre = m.index > 0 ? t.charAt(m.index - 1) : "";
      const after = t.charAt(m.index + m[0].length);
      if (pre === "（" || pre === "(") continue;
      if ((pre === "[" || pre === "［") && after === "]" && num.indexOf(".") < 0) continue;
      if (/^\d{4}$/.test(num) && +num >= 1900 && +num <= 2100) {
        const around = t.slice(Math.max(0, m.index - 6), m.index + m[0].length + 6);
        if (/年|年份|年度|—|–|至|到/.test(around)) continue;
      }
      const ctx = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ");
      const key = (s0 + "|" + ctx).slice(0, 100);
      if (seen[key]) continue; seen[key] = 1; hits++;
      const b0 = (p.nummap || {})[key];
      if (b0 && b0.src) bound++;
    }
  });
  const pct = hits ? Math.round(bound / hits * 100) : 100;
  bar.innerHTML = "<b>🔢 数据关联</b>　正文数字 <b>" + hits + "</b> 处 · 已绑定来源 <b>" + bound + "</b> 处" + (hits ? "（覆盖 " + pct + "%）" : "") +
    "　<button class='pill' id='numBarGo'>去绑定 →</button><span class='hint'>重要数字都应能指回来源（文献 / 数据卡 / 本人测算）</span>";
  const go = document.getElementById("numBarGo");
  if (go && !go.dataset.bound) {
    go.dataset.bound = "1";
    go.addEventListener("click", () => {
      const st6 = document.querySelector('.stage[data-s="6"]');
      if (st6) st6.click();
      setTimeout(() => { const c = document.getElementById("ckNums"); if (c) c.click(); }, 120);
    });
  }
}
function verOpen() {
  window.renderStageBadges = renderStageBadges;
  window.renderNumBar = renderNumBar;
  const p = cur(); if (!p) { wqNotice("先新建项目"); return; }
  $("verProj").textContent = p.name;
  const list = $("verList");
  const vs = p.versions || [];
  verFillCmp();
  list.innerHTML = vs.length ? vs.map((v, i) =>
    "<div class=\"vitem\" data-vi=\"" + i + "\"><b style=\"font-size:13px\">" + esc(v.kind) + (v.star ? " ⭐" : "") + "</b><div class=\"vmeta\">" + esc(v.ts) + " · " + esc(fieldLabel(v.field)) + " · " + (v.archived ? "已归档 · 点开回取" : v.content.length + " 字") + " · 点击展开</div><div class=\"vdetail\"></div></div>").join("")
    : "<p class=\"hint\">还没有版本记录：每次 AI 生成（选题评估 / 矩阵 / 大纲 / 草稿 / 内审 / 一致性 / 声明 / 投稿材料）都会自动存档，按分秒保留最近 40 版。</p>";
  list.querySelectorAll("[data-vi]").forEach(el => el.addEventListener("click", async () => {
    const i = +el.dataset.vi, p2 = cur(), v = (p2?.versions || [])[i]; if (!v) return;
    const dt = el.querySelector(".vdetail");
    if (el.classList.contains("open")) { el.classList.remove("open"); return; }
    /* v1.0：正文已归档到 IndexedDB 的版本，展开时自动回取 */
    let content = v.content;
    if (v.archived && window.WQStore) {
      dt.innerHTML = '<p class="hint">从 IndexedDB 回取正文中…</p>';
      content = (await window.WQStore.getVersion(p2.id, i)) || v.content;
    }
    dt.innerHTML = mdRender(content) + "<div style=\"margin-top:8px\"><button class=\"pill\" data-vdl=\"" + i + "\">⤓ .md</button> <button class=\"pill\" data-vdw=\"" + i + "\">⤓ Word</button>" + (v.field && v.field !== "tool" ? " <button class=\"pill\" data-vld=\"" + i + "\">↻ 载入回项目（迭代）</button>" : "") + " <button class=\"pill\" data-vstar=\"" + i + "\">" + (v.star ? "⭐ 取消星标" : "☆ 加星标") + "</button></div>";
    el.classList.add("open");
    dt.dataset.rawmd = content;
    const dl = dt.querySelector("[data-vdl]");
    if (dl) dl.addEventListener("click", (e) => { e.stopPropagation(); verDl({ ...v, content }, "md"); });
    const dw = dt.querySelector("[data-vdw]");
    if (dw) dw.addEventListener("click", (e) => { e.stopPropagation(); verDl({ ...v, content }, "doc"); });
    const ld = dt.querySelector("[data-vld]");
    if (ld) ld.addEventListener("click", (e) => { e.stopPropagation(); verLoad(i); });
    const vstar = dt.querySelector("[data-vstar]");
    if (vstar) vstar.addEventListener("click", (e) => { e.stopPropagation(); const p3 = cur(); const v3 = (p3 && p3.versions || [])[i]; if (!v3) return; v3.star = !v3.star; save(); renderVerCount(); verOpen(); });
  }));
  $("verDrawer").classList.add("open"); $("mask").classList.add("open");
}
$("btnVer").addEventListener("click", verOpen);
$("verClose").addEventListener("click", () => { $("verDrawer").classList.remove("open"); $("mask").classList.remove("open"); });
(function () {
  const vdb = document.getElementById("verDiffBtn");
  if (vdb) vdb.addEventListener("click", verDiffRun);
  const bi = document.getElementById("btnInv");
  if (bi) bi.addEventListener("click", invOpen);
  const ic = document.getElementById("invClose");
  if (ic) ic.addEventListener("click", () => { document.getElementById("invDrawer").classList.remove("open"); document.getElementById("mask").classList.remove("open"); });
  const mk = document.getElementById("mask");
  if (mk) mk.addEventListener("click", () => { document.getElementById("invDrawer").classList.remove("open"); });
})();
$("mask").addEventListener("click", () => $("verDrawer").classList.remove("open"));

/* v0.8：轨迹手动笔记 + 导出（.md，便于日后追溯与随稿归档） */
$("btnTrailAdd")?.addEventListener("click", () => {
  const p = cur(); if (!p) return wqNotice("先新建项目");
  const t = ($("trailNote").value || "").trim();
  if (!t) { $("trailNote").focus(); return; }
  trailAdd(p, "misc", "决策笔记", t);
  $("trailNote").value = ""; save(); renderProcessLog();
  toast("已记入项目轨迹");
});
$("trailNote")?.addEventListener("keydown", e => { if (e.key === "Enter") $("btnTrailAdd").click(); });
$("btnTrailDl")?.addEventListener("click", () => {
  const p = cur(); if (!p) return wqNotice("先新建项目");
  const tr = p.trail || [];
  if (!tr.length) return wqNotice("还没有轨迹可导出");
  const rows = tr.map(e => "| " + e.ts + " | " + (TRAIL_ICON[e.type] || "•") + " " + e.label.replace(/\|/g, "/") + " | " + (e.note || "").replace(/\|/g, "/") + " |");
  const md = "# " + p.name + " — 思维链与决策轨迹\n\n"
    + "> 项目：「" + p.name + "」 · 共 " + tr.length + " 条 · 导出于 " + vStamp() + "\n"
    + "> 记录内容（时间倒序）：AI 生成与版本、发起/取消的确认、留存选择、版本载入、导入导出、决策笔记；随「备份全部」一同打包。\n\n"
    + "| 时间 | 事件 | 摘要 |\n| --- | --- | --- |\n" + rows.join("\n") + "\n";
  dlText("决策轨迹-" + String(p.name || "项目").replace(/[\\/:*?"<>|]/g, "_") + ".md", md, "text/markdown");
  trailAdd(p, "export", "导出决策轨迹", tr.length + " 条 → .md");
  save(); renderProcessLog();
});
function renderOnboard() {
  const el = $("onboard"); if (!el) return;
  if (localStorage.getItem("wenqu_onboarded")) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = "<b>👋 三步开始：</b>① 配置 AI（<b>可跳过</b>——检索/趋势/引用格式化免费可用）→ ② 新建项目，选研究范式与层级 → ③ 跟随每阶段顶部的「目标与产出」推进。 <button class=\"btn2 btn-sm\" onclick=\"document.getElementById('setPanel').hidden=false;document.getElementById('btnSet').scrollIntoView({behavior:'smooth'})\">① 打开 AI 设置</button> <button class=\"btn2 btn-sm ghost\" id=\"obDismiss\">知道了，不再提示</button>";
  const d = document.getElementById("obDismiss");
  if (d) d.addEventListener("click", () => { try { localStorage.setItem("wenqu_onboarded", "1"); } catch {} el.hidden = true; });
}
function renderBackupHint() {
  const { last, stale } = backupInfo();
  const row = document.querySelector(".projbar .row");
  if (!row) return;
  let el = document.getElementById("bkHint");
  if (!el) { el = document.createElement("p"); el.id = "bkHint"; el.className = "hint"; row.after(el); }
  el.innerHTML = stale ? '<b style="color:var(--bad)">⚠ 距上次备份已超 7 天</b>（论文周期长，建议定期「⤓ 备份全部」）' : (last ? "最近备份：" + esc(last.slice(0, 10)) : "尚未备份过——点上方「⤓ 备份全部」导出 JSON");
}


/* ---------- 初始化 ---------- */
function renderAll() {
  const p = cur();
  $("topic").value = p?.topic || "";
  if (p?.trend?.length) drawTrend(p.trend, p.topic);
  else { $("trendBox").hidden = true; }
  if (p?.selection) { $("selOut").hidden = false; $("selOut").textContent = p.selection; }
  const rows = (p?.matrix || "").split("\n====\n").filter(Boolean).map(r => { const pp = r.split("||"); return { f: { title: pp[0] || "", year: "" }, txt: pp[1] || "" }; });
  if (rows.length) drawMatrix(rows); else { $("matrixOut").hidden = true; $("matrixOut").innerHTML = ""; }
  let wTxt = "";
  if (p) {
    if (p.showW && p.showW.indexOf("sec:") === 0) wTxt = (p.draft || {})[p.showW.slice(4)] || "";
    else if (p.showW && p.outs && p.outs[p.showW]) wTxt = p.outs[p.showW];
    else wTxt = p.outline || "";
  }
  /* v1.0：setMD 由 wb.js（后加载）提供——首次渲染时可能尚未就绪，降级为纯文本，绝不中断初始化 */
  if (wTxt) { if (typeof setMD === "function") setMD($("wOut"), wTxt); else { const o=$("wOut"); o.hidden=false; o.textContent=wTxt; } }
  if (p && p.showV && p.outs && p.outs[p.showV]) { if (typeof setMD === "function") setMD($("vOut"), p.outs[p.showV]); else { const o=$("vOut"); o.hidden=false; o.textContent=p.outs[p.showV]; } }
  $("projStatus").value = p?.status || "选题中";
  if (p) { $("cfgParadigm").value = p.paradigm; $("cfgLevel").value = p.level; }
  window.__renderErrs = [];
  [["renderSecBtns",0],["renderDefense",0],["renderPapers",0],["renderStageCards",0],["renderOnboard",0],["renderBackupHint",0],["renderVerCount",0],["renderProcessLog",0],["refreshAIButtons",0],["renderStageBadges",0],["renderNumBar",0]].forEach(([f]) => { try { window[f](); } catch (e) { window.__renderErrs.push(f + ": " + e.message); } });
}
/* v0.7：多标签一致性——其他标签页写入时同步刷新，防止旧标签的内存快照覆盖版本档案 */
window.addEventListener("storage", (e) => {
  if (e && e.key && e.key !== KEY) return;
  try {
    DB = loadDB();
    renderProjects(); renderAll();
    toast("检测到另一标签页的更新，已同步");
  } catch (err) {}
});

if (!localStorage.getItem(KEY) && !DB.projects.length) {
  const p = newProject("示例项目（可删除）");
  p.topic = "数字经济与农村共同富裕（示例，可改）";
  p.papers = [
    { id: "f-ex1", doi: "10.1016/j.jfineco.2014.10.010", title: "A five-factor asset pricing model", year: "2015", venue: "Journal of Financial Economics", author: "Fama E F, French K R", type: "J", abs: "" },
    { id: "f-ex2", doi: "10.1038/s41586-020-2649-2", title: "Array programming with NumPy", year: "2020", venue: "Nature", author: "Harris C R 等", type: "J", abs: "" }
  ];
  p.selection = "（示例选题卡）研究问题：数字经济发展是否促进了农村共同富裕？创新点：使用县域微观数据；可行性：可用电商进农村政策试点做准自然实验。";
  save();
}
if (!DB.projects.length) newProject("示例项目：我的第一个研究");
/* v1.0：quick.html 生成的项目深链直达 ?p=<id>&stage=4；?tab= 直达工具台标签 */
(function () {
  try {
    const q = new URLSearchParams(location.search);
    const pid = q.get("p");
    if (pid && DB.projects.some(x => x.id === pid)) DB.cur = pid;
    const st = q.get("stage");
    if (st && /^[1-6]$/.test(st)) setTimeout(() => document.querySelector('.stage[data-s="' + st + '"]')?.click(), 0);
  } catch (e) {}
})();
renderProjects(); renderAll();
/* v1.0：渲染钩子——wq-ui.js 在 renderAll 之后刷新自己的面板（工作台/校验中心/数据卡） */
const __wqRenderAll = renderAll;
renderAll = function () { __wqRenderAll(); if (window.WQUI && window.WQUI.afterRender) { try { window.WQUI.afterRender(); } catch (e) { console.warn("WQUI.afterRender", e); } } };
renderAll();

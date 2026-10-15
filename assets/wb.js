/* 文渠科研工作台 · app.js
 * 集成：OpenAlex/Crossref/Unpaywall 官方API + 自托管 pdf.js + citation.js(MIT) + 萤算 OpenAI 兼容接口
 * 纯前端零后端；开源件许可与集成状态见「开源引擎」页。
 */
"use strict";

/* IIFE 封装：本文件与 studio.js 同页加载时，顶层 const/let 不进全局词法环境，避免 SyntaxError */
(() => {

/* ================= 通用工具 ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/* v0.6：Markdown 渲染（marked + DOMPurify 本地库；缺失时降级为转义纯文本） */
function mdRender(text) {
  const src = String(text == null ? "" : text);
  if (window.marked && window.DOMPurify) {
    try { return DOMPurify.sanitize(marked.parse(src, { gfm: true, breaks: true })); } catch (e) {}
  }
  return esc(src).replace(/\n/g, "<br>");
}
function setMD(el, text) {
  if (!el) return;
  el.dataset.rawmd = String(text == null ? "" : text); // 保留原始 md 供复制/下载
  el.innerHTML = mdRender(text);
  el.classList.add("mdr");
  el.hidden = false;
}
window.mdRender = mdRender; window.setMD = setMD;

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

/* localStorage 防御：隐私模式/配额满时不崩，只提示 */
function lsSet(key, val) {
  try { localStorage.setItem(key, val); return true; }
  catch { toast("浏览器存储不可用（隐私模式或配额已满），该项不会被记住"); return false; }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
window.toast = toast; // v0.5.1：供 studio.js 等全局脚本使用（修 toast is not a function）
function dlText(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function copyText(text, btn) {
  const done = () => {
    if (btn) { const old = btn.textContent; btn.textContent = "已复制 ✓"; setTimeout(() => btn.textContent = old, 1500); }
    else toast("已复制");
  };
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) done(); else toast("复制失败，请手动选择文本复制");
    } catch { toast("复制失败，请手动选择文本复制"); }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

/* ================= v0.5：AI 操作确认 / citation 懒加载 / 分析历史 ================= */
function aiConfirmOn() {
  try { const s = JSON.parse(localStorage.getItem("wenqu_ai") || "{}"); return s.confirm !== false; } catch { return true; }
}
window.wqConfirmAI = function (opts) {
  opts = opts || {};
  if (!aiConfirmOn()) return Promise.resolve(true);
  return new Promise(function (resolve) {
    let mask = document.getElementById("wqCMask");
    if (!mask) {
      mask = document.createElement("div");
      mask.id = "wqCMask";
      mask.style.cssText = "position:fixed;inset:0;background:rgba(20,28,44,.35);z-index:200;display:none";
      document.body.appendChild(mask);
    }
    const b1 = "padding:8px 16px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid #e5e8ee;background:#fff;color:#5c6675";
    const b2 = "padding:8px 16px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;border:none;background:#2456e6;color:#fff";
    mask.innerHTML = "<div style=\"position:fixed;left:50%;top:22%;transform:translateX(-50%);width:min(460px,92vw);background:#fff;border:1px solid #e5e8ee;border-radius:14px;padding:18px 20px;box-shadow:0 12px 40px rgba(27,42,74,.2);font-size:14px;line-height:1.75;color:#1b2434\">"
      + "<b style=\"font-size:15.5px\">" + esc(opts.title || "开始 AI 操作？") + "</b>"
      + (opts.lines || []).map(function (l) { return "<div style=\"color:#5c6675;font-size:13px\">· " + esc(l) + "</div>"; }).join("")
      + "<label style=\"display:flex;gap:6px;align-items:center;margin:10px 0 0;font-size:12.5px;color:#5c6675\"><input type=\"checkbox\" id=\"wqCNoMore\"> 以后不再询问（可在 AI 设置中恢复）</label>"
      + "<div style=\"display:flex;gap:10px;justify-content:flex-end;margin-top:12px\">"
      + "<button id=\"wqCCancel\" style=\"" + b1 + "\">取消</button>"
      + "<button id=\"wqCOk\" style=\"" + b2 + "\">" + esc(opts.okText || "开始分析") + "</button></div></div>";
    mask.style.display = "block";
    const done = function (v) {
      const ck = document.getElementById("wqCNoMore");
      if (ck && ck.checked) { try { const c = JSON.parse(localStorage.getItem("wenqu_ai") || "{}"); c.confirm = false; localStorage.setItem("wenqu_ai", JSON.stringify(c)); toast("已关闭 AI 前确认（可在 AI 设置中恢复）"); } catch (e) {} }
      mask.style.display = "none";
      resolve(v);
    };
    document.getElementById("wqCOk").onclick = function () { done(true); };
    document.getElementById("wqCCancel").onclick = function () { done(false); };
  });
};


/* v0.5.1：页内通知与输入弹窗（替代原生 alert/prompt，避免阻塞卡死） */
function wqBaseModal() {
  let mask = document.getElementById("wqCMask");
  if (!mask) {
    mask = document.createElement("div");
    mask.id = "wqCMask";
    mask.style.cssText = "position:fixed;inset:0;background:rgba(20,28,44,.35);z-index:200;display:none";
    document.body.appendChild(mask);
  }
  mask.innerHTML = "<div id=\"wqCBox\" style=\"position:fixed;left:50%;top:22%;transform:translateX(-50%);width:min(460px,92vw);background:#fff;border:1px solid #e5e8ee;border-radius:14px;padding:18px 20px;box-shadow:0 12px 40px rgba(27,42,74,.2);font-size:14px;line-height:1.75;color:#1b2434\"></div>";
  mask.style.display = "block";
  return {
    mask: mask,
    box: mask.querySelector("#wqCBox"),
    b1: "padding:8px 16px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid #e5e8ee;background:#fff;color:#5c6675",
    b2: "padding:8px 16px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;border:none;background:#2456e6;color:#fff"
  };
}
window.wqNotice = function (title, lines) {
  return new Promise(function (resolve) {
    const m = wqBaseModal();
    m.box.innerHTML = "<b style=\"font-size:15.5px\">" + esc(title) + "</b>"
      + (lines || []).map(function (l) { return "<div style=\"color:#5c6675;font-size:13px\">· " + esc(l) + "</div>"; }).join("")
      + "<div style=\"display:flex;justify-content:flex-end;margin-top:12px\"><button id=\"wqNOk\" style=\"" + m.b2 + "\">知道了</button></div>";
    document.getElementById("wqNOk").onclick = function () { m.mask.style.display = "none"; resolve(true); };
  });
};
window.wqPromptAI = function (title, placeholder, okText) {
  return new Promise(function (resolve) {
    const m = wqBaseModal();
    m.box.innerHTML = "<b style=\"font-size:15.5px\">" + esc(title) + "</b>"
      + "<textarea id=\"wqPIn\" rows=\"6\" style=\"width:100%;margin:10px 0 0;padding:9px 11px;border:1px solid #e5e8ee;border-radius:9px;font-family:inherit;font-size:13.5px;box-sizing:border-box\" placeholder=\"" + esc(placeholder || "") + "\"></textarea>"
      + "<div style=\"display:flex;gap:10px;justify-content:flex-end;margin-top:12px\">"
      + "<button id=\"wqPCancel\" style=\"" + m.b1 + "\">取消</button>"
      + "<button id=\"wqPOk\" style=\"" + m.b2 + "\">" + esc(okText || "确定") + "</button></div>";
    const ta = document.getElementById("wqPIn"); ta.focus();
    const done = function (v) { m.mask.style.display = "none"; resolve(v); };
    document.getElementById("wqPOk").onclick = function () { done(ta.value.trim() || null); };
    document.getElementById("wqPCancel").onclick = function () { done(null); };
  });
};


/* v0.7：多选弹窗 + 工具台结果「留存到项目 / 仅记过程」询问 */
window.wqChoose = function (title, lines, actions) {
  return new Promise(function (resolve) {
    const m = wqBaseModal();
    m.box.innerHTML = "<b style=\"font-size:15.5px\">" + esc(title) + "</b>"
      + (lines || []).map(function (l) { return "<div style=\"color:#5c6675;font-size:13px\">· " + esc(l) + "</div>"; }).join("")
      + "<div style=\"display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap\">"
      + (actions || []).map(function (a, i) { return "<button id=\"wqCh" + i + "\" style=\"" + (a.primary ? m.b2 : m.b1) + "\">" + esc(a.label) + "</button>"; }).join("")
      + "</div>";
    (actions || []).forEach(function (a, i) {
      document.getElementById("wqCh" + i).onclick = function () { m.mask.style.display = "none"; resolve(a.key); };
    });
  });
};
function curProjectBrief() {
  try {
    const d = JSON.parse(localStorage.getItem("wenqu_studio") || "{}");
    const p = (d.projects || []).find(x => x.id === d.cur);
    return p ? { name: p.name, has: true } : { has: false };
  } catch (e) { return { has: false }; }
}
async function maybeKeepToProject(kind, content) {
  try {
    if (typeof window.wqChoose !== "function") return;
    const proj = curProjectBrief();
    if (!proj.has) return; // 无当前项目：维持原有本地历史逻辑
    const key = await wqChoose("这段内容与当前项目的关系？",
      ["当前项目：「" + proj.name + "」", kind + " · 共 " + String(content || "").length + " 字", "与项目无关也不怕——选「仅记过程」会在项目末尾留一条过程记录"],
      [{ key: "keep", label: "留存到项目", primary: true }, { key: "note", label: "不留存，仅记过程" }, { key: "skip", label: "关闭" }]);
    if (key === "keep" || key === "note") {
      if (typeof window.wqProjectKeep === "function") window.wqProjectKeep(kind, content, key);
      toast(key === "keep" ? "已留存到项目（版本档案可见）" : "已记入项目过程记录");
    }
  } catch (e) { /* 静默，不打断主流程 */ }
}
window.maybeKeepToProject = maybeKeepToProject;

/* citation.js 懒加载（首屏省约 3.2MB） */
let _citeLoading = null;
function ensureCiteJS() {
  if (window.CiteJS) return Promise.resolve();
  if (_citeLoading) return _citeLoading;
  _citeLoading = new Promise(function (res, rej) {
    const sc = document.createElement("script");
    sc.src = "assets/vendor/citation.min.js";
    sc.onload = function () { res(); };
    sc.onerror = function () { _citeLoading = null; rej(new Error("citation.js 加载失败（检查 assets/vendor/）")); };
    document.head.appendChild(sc);
  });
  return _citeLoading;
}

/* 分析历史：本地保存、可回看 */
const RLOG = "wenqu_readlog";
function rlogGet() { try { return JSON.parse(localStorage.getItem(RLOG) || "[]"); } catch { return []; } }
function rlogAdd(entry) {
  try {
    const a = rlogGet();
    a.unshift(entry);
    localStorage.setItem(RLOG, JSON.stringify(a.slice(0, 12)));
  } catch { toast("历史记录保存失败（存储已满）"); }
  rlogRender();
}
function rlogRender() {
  const box = $("readLog"); if (!box) return;
  const a = rlogGet();
  if (!a.length) { box.innerHTML = ""; return; }
  box.innerHTML = "<h3 style=\"margin:4px 0 8px\">📚 历史分析<small style=\"font-weight:400;color:var(--muted);margin-left:8px\">本地保存 · 点击回看 · 最多 12 条</small></h3>"
    + a.map(function (e, i) { return "<div class=\"rcard\" style=\"padding:8px 12px;margin-bottom:6px;display:flex;gap:8px;align-items:center\">"
      + "<span style=\"flex:1;font-size:13px\"><b>" + esc(e.label) + "</b> · " + esc(e.doc || "粘贴文本") + " · " + esc((e.ts || "").slice(5, 16)) + " · " + (e.len || 0) + " 字</span>"
      + "<button class=\"pill\" data-rl=\"" + i + "\">回看</button> <button class=\"pill\" data-rld=\"" + i + "\">删</button></div>"; }).join("")
    + "<button class=\"pill\" id=\"rlClear\">清空历史</button>";
  box.querySelectorAll("[data-rl]").forEach(function (b) { b.addEventListener("click", function () {
    const e = rlogGet()[+b.dataset.rl]; if (!e) return;
    const out = $("aiOut"); setMD(out, e.result); $("btnCopy").hidden = false;
    $("aiProg").textContent = "回看：「" + e.label + "」· " + (e.ts || "");
    out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }); });
  box.querySelectorAll("[data-rld]").forEach(function (b) { b.addEventListener("click", function () {
    const a2 = rlogGet(); a2.splice(+b.dataset.rld, 1);
    try { localStorage.setItem(RLOG, JSON.stringify(a2)); } catch (e) {}
    rlogRender();
  }); });
  const cl = $("rlClear");
  if (cl) cl.addEventListener("click", async function () { if (await wqConfirmAI({ title: "清空全部历史分析？", lines: ["本地保存的分析结果将全部删除"], okText: "清空" })) { localStorage.removeItem(RLOG); rlogRender(); const out = $("aiOut"); if (out) { out.hidden = true; out.textContent = ""; delete out.dataset.rawmd; } } });
}
rlogRender();
/* ================= 设置（与 wenqu/tools.html 共用 localStorage 键） ================= */
const AI_DEF = { base: "https://yingcompute.com/v1", model: "glm-5.3-flash" };
function loadAI() {
  try {
    const s = JSON.parse(localStorage.getItem("wenqu_ai") || "{}");
    $("aiBase").value = s.base || AI_DEF.base;
    $("aiKey").value = s.key || "";
    $("aiModel").value = s.model || AI_DEF.model;
    if ($("aiConfirmChk")) $("aiConfirmChk").checked = s.confirm !== false;
  } catch { $("aiBase").value = AI_DEF.base; $("aiModel").value = AI_DEF.model; }
}
function getAI() {
  try {
    const s = JSON.parse(localStorage.getItem("wenqu_ai") || "{}");
    return { base: (s.base || AI_DEF.base).replace(/\/+$/, ""), key: s.key || "", model: s.model || AI_DEF.model };
  } catch { return { ...AI_DEF, key: "" }; }
}
$("aiSave").addEventListener("click", () => {
  lsSet("wenqu_ai", JSON.stringify({
    base: $("aiBase").value.trim() || AI_DEF.base,
    key: $("aiKey").value.trim(),
    model: $("aiModel").value.trim() || AI_DEF.model,
    confirm: $("aiConfirmChk") ? $("aiConfirmChk").checked : true,
  }));
  lsSet("wenqu_email", $("upEmail").value.trim());
  lsSet("wenqu_grobid", $("grobidUrl").value.trim());
  oaMail = $("upEmail").value.trim(); // 立即生效，不必刷新页面
  $("aiSave").textContent = "已保存 ✓"; setTimeout(() => $("aiSave").textContent = "保存设置", 1500);
  if (typeof refreshAIButtons === "function") refreshAIButtons(); // 合并平台：保存后即时解除 AI 按钮置灰
});
$("btnSet").addEventListener("click", () => { $("setPanel").hidden = !$("setPanel").hidden; });
loadAI();
$("upEmail").value = localStorage.getItem("wenqu_email") || "";
$("grobidUrl").value = localStorage.getItem("wenqu_grobid") || "";
/* Unpaywall 条款要求真实邮箱：默认不发 mailto，用户填了真实邮箱才附 */
let oaMail = localStorage.getItem("wenqu_email") || "";
const mto = () => oaMail ? "&mailto=" + encodeURIComponent(oaMail) : "";

async function callAI(userMsg, opts = {}) {
  const { base, key, model } = getAI();
  if (!key) throw new Error("未配置 API Key：页头「AI / 接口设置」里填入并保存");
  const body = {
    model, temperature: opts.temperature ?? 0.3, max_tokens: opts.max_tokens ?? 4096,
    messages: Array.isArray(userMsg) ? userMsg : [{ role: "user", content: userMsg }],
  };
  const r = await fetchJSON(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify(body),
  }, opts.timeout ?? 180000);
  const ch = r.choices?.[0];
  const txt = ch?.message?.content;
  if (!txt) {
    if (ch?.message?.reasoning_content) throw new Error("模型把 token 全花在思维链上、正文为空——换非推理模型，或降低任务量后重试");
    throw new Error("模型返回为空（检查 Key / 模型名 / 余额）");
  }
  return txt;
}
function parseJSONLoose(txt) {
  let s = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  const ao = s.indexOf("{"), bo = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  else if (ao >= 0 && bo > ao) s = s.slice(ao, bo + 1);
  return JSON.parse(s);
}

/* ================= 收藏篮 ================= */
const BK_KEY = "wenqu_basket";
function getBasket() { try { return JSON.parse(localStorage.getItem(BK_KEY) || "[]"); } catch { return []; } }
function saveBasket(b) { lsSet(BK_KEY, JSON.stringify(b)); $("bkCount").textContent = b.length; renderBasket(); }
function addBasket(item) {
  const b = getBasket();
  if (item.doi && b.some(x => x.doi === item.doi)) { toast("已在收藏篮"); return; }
  if (!item.doi && b.some(x => x.title === item.title)) { toast("已在收藏篮"); return; }
  b.push(item); saveBasket(b); toast("已收藏 ✓");
}
function delBasket(i) { const b = getBasket(); b.splice(i, 1); saveBasket(b); }
function renderBasket() {
  const b = getBasket();
  $("bkCount").textContent = b.length;
  $("bkList").innerHTML = b.length ? b.map((x, i) => `
    <div class="bitem">
      <div class="bt">${i + 1}. ${esc(x.title)}</div>
      <div class="bm">${esc((x.authors || []).slice(0, 3).join(", "))}${(x.authors || []).length > 3 ? " 等" : ""} · ${esc(x.year || "")} · ${esc(x.venue || "")}</div>
      ${x.doi ? `<div class="bm mono">DOI: ${esc(x.doi)}</div>` : ""}
      <button class="pill" data-del="${i}" style="margin-top:6px">移除</button>
      ${x.oa_url ? `<a class="pill ok" href="${esc(x.oa_url)}" target="_blank" rel="noopener">📥 PDF</a>` : ""}
    </div>`).join("") : '<p class="hint">空的。在「找文献」「新论文雷达」点【➕收藏】把文献放进来。</p>';
  $("bkList").querySelectorAll("[data-del]").forEach(el => el.addEventListener("click", () => delBasket(+el.dataset.del)));
}
$("btnBasket").addEventListener("click", () => { renderBasket(); $("basket").classList.add("open"); $("mask").classList.add("open"); });
$("bkClose").addEventListener("click", () => { $("basket").classList.remove("open"); $("mask").classList.remove("open"); });
$("mask").addEventListener("click", () => { $("basket").classList.remove("open"); $("mask").classList.remove("open"); });
$("bkClear").addEventListener("click", async () => { if (await wqConfirmAI({ title: "清空收藏篮？", lines: ["已收藏的题录将被移除（项目文献库不受影响）"], okText: "清空" })) saveBasket([]); });
$("bkGB").addEventListener("click", () => {
  const b = getBasket().map(basket2csl);
  if (!b.length) { toast("收藏篮是空的"); return; }
  copyText(b.map((c, i) => gbEntry(c, i + 1)).join("\n"), $("bkGB"));
});
  $("bkBib").addEventListener("click", async () => {
    await ensureCiteJS().catch(function () {});
  const b = getBasket().map(basket2csl).filter(Boolean).map(c => JSON.parse(JSON.stringify(c)));
  if (!b.length) { toast("收藏篮是空的"); return; }
  if (!window.CiteJS) { toast("citation.js 未加载"); return; }
  dlText("basket.bib", new CiteJS.Cite(b).format("bibtex"));
});
function basket2csl(x) {
  return {
    id: x.doi || x.title, type: "article-journal", title: x.title,
    author: (x.authors || []).map(n => guessName(n)),
    issued: x.year ? { "date-parts": [[x.year]] } : undefined,
    "container-title": x.venue || "", DOI: x.doi || undefined,
    URL: x.doi ? "https://doi.org/" + x.doi : (x.oa_url || undefined),
  };
}
function guessName(n) {
  const s = String(n || "").trim();
  if (!s) return { family: "", given: "" };
  if (/[\u4e00-\u9fff]/.test(s)) return { family: s, given: "" };
  const parts = s.split(/,\s*/);
  if (parts.length === 2) return { family: parts[0], given: parts[1] };
  const w = s.split(/\s+/);
  const P = new Set(["von", "van", "de", "del", "della", "di", "da", "la", "le", "du", "der", "den", "ten", "ter"]);
  let cut = w.length - 1;
  while (cut > 0 && P.has(w[cut - 1].toLowerCase())) cut--; // 前缀姓（von/van/de…）并入姓
  return { family: w.slice(cut).join(" "), given: w.slice(0, cut).join(" ") };
}
saveBasket(getBasket());

/* ================= 标签页 ================= */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b === btn));
    document.querySelectorAll(".tabpane").forEach(p => p.hidden = p.id !== "tab-" + btn.dataset.tab);
  });
});
function gotoTab(name) { document.querySelector(`.tab[data-tab="${name}"]`)?.click(); }

/* ================= Tab1 找文献 ================= */
const OA = "https://api.openalex.org/works";
const OA_SELECT = "id,display_name,publication_year,doi,open_access,best_oa_location,primary_location,authorships,type,cited_by_count,abstract_inverted_index";

function oaAbstract(inv) {
  if (!inv) return "";
  const arr = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) arr[p] = w;
  return arr.join(" ").replace(/\s+/g, " ").trim();
}
function oaLink(w) {
  const oa = w.open_access || {};
  const loc = w.best_oa_location || {};
  return oa.oa_url || loc.pdf_url || loc.landing_page_url || null;
}

async function doSearch() {
  const q = $("q").value.trim();
  const out = $("searchOut");
  if (!q) { out.innerHTML = '<p class="hint">请输入关键词或 DOI</p>'; return; }
  const btn = $("btnSearch"); btn.disabled = true;
  out.innerHTML = '<p class="hint">检索中…</p>';
  if (/[\u4e00-\u9fff]/.test(q)) {
    $("zhJump").hidden = false;
    $("jWf").href = "https://s.wanfangdata.com.cn/paper?q=" + encodeURIComponent(q);
    $("jBd").href = "https://xueshu.baidu.com/s?wd=" + encodeURIComponent(q);
  } else $("zhJump").hidden = true;

  const filters = [];
  if ($("qOA").checked) filters.push("is_oa:true");
  if ($("qYear").value) filters.push("publication_year:" + $("qYear").value);
  const sort = $("qSortCited").checked ? "cited_by_count:desc" : "relevance_score:desc";
  try {
    let url;
    if (/^10\./.test(q)) url = `${OA}/https://doi.org/${encodeURIComponent(q)}?select=${OA_SELECT}${mto()}`;
    else {
      const f = filters.length ? `&filter=${filters.join(",")}` : "";
      url = `${OA}?search=${encodeURIComponent(q)}&per-page=${$("qN").value}&sort=${sort}${f}&select=${OA_SELECT}${mto()}`;
    }
    const d = await fetchJSON(url);
    const rows = d.results || (d.id ? [d] : []);
    if (!rows.length) { out.innerHTML = '<p class="hint">没有命中。试试更宽的关键词，中文文献用上方官方站跳转。</p>'; return; }
    out.innerHTML = rows.map((w, i) => searchCard(w, i)).join("") +
      '<p class="hint">免费 PDF = 出版社或机构仓库的合法开放版本。【AI速读】基于官方摘要；【➕收藏】入篮后可喂给「综述工坊」、导出 .bib。</p>';
    bindSearchCards(rows);
  } catch (e) {
    out.innerHTML = `<p class="hint">检索失败（${esc(e.message)}）。OpenAlex 偶发限流，稍等几秒重试。</p>`;
  } finally { btn.disabled = false; }
}
/* 无免费版时的合法求助兜底：官方平台跳转 + 向作者索要（学界惯例）。不接入任何文献代下渠道 */
function mailTplOf(w) {
  const title = String(w?.display_name || "");
  const doi = w?.doi ? String(w.doi).replace("https://doi.org/", "") : "";
  return "主题：学术文献求助（Request for a copy）\n\n尊敬的作者：您好！我在研究中需要以下文献，能否惠赠一份副本（preprint/reprint）？\n\n题名：" + title + (doi ? "\nDOI: https://doi.org/" + doi : "") + "\n\n谢谢！";
}
function helpBoxHTML(w) {
  const q = encodeURIComponent(String(w?.display_name || ""));
  return `<div class="why" data-help hidden><b>没有免费版？合法兜底通道：</b><br>
    <a class="pill" target="_blank" rel="noopener" href="https://s.wanfangdata.com.cn/paper?q=${q}">万方</a>
    <a class="pill" target="_blank" rel="noopener" href="https://xueshu.baidu.com/s?wd=${q}">百度学术</a>
    <a class="pill" target="_blank" rel="noopener" href="https://www.ncpssd.cn">ncpssd 国家平台</a>
    <a class="pill" target="_blank" rel="noopener" href="https://www.nstl.gov.cn">NSTL 文献传递</a>
    <button class="pill" data-mailtpl>✉ 复制作者索要邮件</button>
    <div class="hint" style="margin-top:4px">向作者发索要信（Reprint Request）是学界通行做法，命中率不低；机构用户优先走本校图书馆馆际互借/文献传递。</div>
  </div>`;
}
function bindHelp(root, works) {
  root.querySelectorAll("[data-helpbtn]").forEach(b => b.addEventListener("click", () => {
    const box = b.closest(".rcard")?.querySelector("[data-help]");
    if (box) box.hidden = !box.hidden;
  }));
  root.querySelectorAll("[data-mailtpl]").forEach(b => b.addEventListener("click", () => {
    const card = b.closest(".rcard");
    const w = works[+card?.dataset.i];
    copyText(mailTplOf(w), b);
  }));
}
function searchCard(w, i) {
  const authors = (w.authorships || []).slice(0, 4).map(a => a.author?.display_name || "");
  const venue = w.primary_location?.source?.display_name || "";
  const pdf = oaLink(w);
  const doi = w.doi ? w.doi.replace("https://doi.org/", "") : "";
  const hasAb = !!w.abstract_inverted_index;
  return `<div class="rcard" data-i="${i}">
    <div class="rt"><a href="${esc(w.doi || w.id)}" target="_blank" rel="noopener">${i + 1}. ${esc(w.display_name)}</a></div>
    <div class="rmeta">${esc(w.publication_year || "")} · ${esc(venue)} · ${esc(authors.join(", "))}${(w.authorships || []).length > 4 ? " 等" : ""} · 被引 ${w.cited_by_count ?? 0}</div>
    <div class="rbtns">
      ${pdf ? `<a class="pill ok" href="${esc(pdf)}" target="_blank" rel="noopener">📥 免费 PDF</a>` : `<button class="pill no" data-helpbtn>无免费版 · 求助</button>`}
      <button class="pill" data-act="ab" ${hasAb ? "" : "disabled"}>⚡AI速读</button>
      <button class="pill" data-act="add">➕收藏</button>
      <button class="pill" data-act="cite">引 ↗</button>
      ${doi ? `<a class="pill" href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">DOI</a>` : ""}
      <a class="pill" href="${esc(w.id)}" target="_blank" rel="noopener">详情</a>
    </div>
    <div class="ab" data-ab hidden></div>
    ${helpBoxHTML(w)}
  </div>`;
}
function bindSearchCards(rows) {
  $("searchOut").querySelectorAll(".rcard").forEach(card => {
    const w = rows[+card.dataset.i];
    const doi = w.doi ? w.doi.replace("https://doi.org/", "") : "";
    card.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.act === "add") {
          addBasket({
            doi, title: w.display_name, year: w.publication_year || "",
            venue: w.primary_location?.source?.display_name || "",
            authors: (w.authorships || []).map(a => a.author?.display_name || "").filter(Boolean),
            oa_url: oaLink(w),
          });
          btn.textContent = "✓ 已收藏"; btn.classList.add("added");
        } else if (btn.dataset.act === "ab") {
          const box = card.querySelector("[data-ab]");
          if (!box.hidden) { box.hidden = true; return; }
          const ab = oaAbstract(w.abstract_inverted_index);
          if (!ab) { toast("此条无官方摘要"); return; }
          if (!(await wqConfirmAI({ title: "AI 速读这篇？", lines: [String(w.display_name || "").slice(0, 60), "调用 AI 1 次，约 5-20 秒"], okText: "开始速读" }))) return;
          box.hidden = false; box.className = "why"; box.textContent = "AI 速读中…";
          try {
            const r = await callAI("你是学术助手。基于下面的官方摘要，用中文输出三句话：①这篇论文做了什么 ②怎么做的（数据/方法）③核心发现或贡献。不超过120字。\n\n【摘要】" + ab);
            box.innerHTML = "⚡ " + mdRender(r); box.dataset.rawmd = String(r || "");
          } catch (e) { box.textContent = "速读失败：" + e.message; }
        } else if (btn.dataset.act === "cite") {
          const authors = (w.authorships || []).slice(0, 3).map(a => a.author?.display_name || "").join(", ");
          const venue = w.primary_location?.source?.display_name || "";
          const line = `${authors} (${w.publication_year || "n.d."}). ${w.display_name}. ${venue}.${doi ? " DOI: " + doi + "." : ""}`;
          const dupKey = (doi || w.display_name || "").slice(0, 60).toLowerCase();
          if (dupKey && $("citeIn").value.toLowerCase().includes(dupKey)) { toast("该文献已在引用列表中"); return; }
          $("citeIn").value = ($("citeIn").value.trim() + "\n" + line).trim();
          gotoTab("cite"); toast("已加入「引用引擎」，点【解析】");
        }
      });
    });
  });
  bindHelp($("searchOut"), rows);
}
$("btnSearch").addEventListener("click", doSearch);
$("q").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

/* ================= Tab2 AI 读论文 ================= */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdf.worker.min.js";
let docText = "", docPages = null, docName = "";
function setStat(n) { $("docStat").textContent = n ? `已导入「${docName}」${n} 字符（约 ${(n / 1000).toFixed(1)}k）${docPages ? "，" + docPages.length + " 页" : ""}，可开始分析` : "未导入文档"; }

let lastFile = null;
async function handleFile(f) {
  if (!f) return;
  lastFile = f;
  docName = f.name;
  $("docStat").textContent = `正在解析 ${f.name} …`;
  try {
    if (f.name.toLowerCase().endsWith(".pdf")) {
      if (!window.pdfjsLib) throw new Error("PDF 组件未加载，请改用粘贴文本");
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        pages.push(tc.items.map(it => it.str).join(" "));
      }
      docPages = pages;
      docText = pages.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    } else {
      docText = await f.text(); docPages = null;
    }
    if (docText.length < 50) { docText = ""; throw new Error("没提取到文本（扫描版 PDF 无文字层），请换文字版 PDF 或粘贴文本"); }
    $("docText").value = docText;
    setStat(docText.length);
  } catch (e) { $("docStat").textContent = `解析失败：${e.message}`; }
}
$("file").addEventListener("change", e => handleFile(e.target.files[0]));
const dz = $("drop");
dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); handleFile(e.dataTransfer.files[0]); });
$("docText").addEventListener("input", () => { docText = $("docText").value; docPages = null; setStat(docText.length); });

/* 模板库（ChatPaper 四模板思路 + gpt_academic 交互思路，均为自写提示词） */
const TMPL = {
  sum: { name: "摘要速读", p: "你是学术阅读助手。对以下文献输出：1) 一句话概括；2) 研究问题与动机；3) 核心方法与数据；4) 主要发现（分点，保留关键数字）；5) 局限与可引用的结论。用简体中文，专业术语保留英文。" },
  method: { name: "方法与结论", p: "你是学术阅读助手。聚焦方法与实证部分，输出：1) 研究设计框架；2) 数据来源与样本；3) 关键变量与模型设定（公式用文字描述）；4) 稳健性检验；5) 主要实证结果（保留系数与显著性）。用简体中文，术语保留英文。" },
  crit: { name: "批判评估·审稿", p: "你是严格但建设性的审稿人。对以下论文输出：1) 核心贡献；2) 主要优点；3) 潜在弱点与隐含假设；4) 识别/推断中可能的内生性问题；5) 修改建议（按 Major / Minor 分列）。用简体中文。" },
  rebuttal: { name: "审稿回复信", p: "你是论文作者，需要逐条回复审稿意见。结合【论文内容】与【审稿意见】，输出回复信草稿：每条意见下先复述意见要点，再给出：回复思路（中文）+ 英文回复正文（Response: ...）+ 需要修改的位置说明。语气礼貌、直接回应、不回避。严禁虚构实验结果或数据；涉及未做的补充实验，一律标注【需补充实验】。用简体中文+英文混合格式。", needExtra: "请把审稿意见粘贴到上方补充输入框" },
  polish: { name: "中译英·学术润色", p: "你是学术英语编辑。把以下内容翻译成地道的学术英语：术语准确、句式符合期刊惯例、避免 AI 腔（不用 clichéd openers，不用空洞强调词）。对不确定的专业表达给出 [备选: ...] 注记。直接输出译文，末尾附「主要术语对照表」。", needExtra: "可在补充输入框指定目标期刊风格（如 JFE / AER 风格）" },
  card: { name: "综述素材卡", p: "你是综述写作助手。把这篇文献整理成综述素材卡：1) 主题定位（一句话）；2) 可直接引用的论点清单（每条附一段可检索的原文短语，便于回原文核对）；3) 与同领域文献可能的对话点或分歧点；4) 检索关键词（中英）。用简体中文。" },
};

let busy = false;
async function analyze(prompt, label) {
  if (busy) { $("aiProg").textContent = "有任务正在进行，请等它完成"; return; }
  const text = docText || $("docText").value;
  if (!text || text.length < 50) { $("aiProg").textContent = "请先导入文档或粘贴至少 50 字文本"; return; }
  const extra = $("extraIn").value.trim();
  if (extra) prompt += "\n\n【补充要求/输入】\n" + extra;
  const out = $("aiOut"), prog = $("aiProg");
  const CHUNK = 12000; // v0.5：加大分块，长文少调几次 AI（更快）
  const chunks = text.match(new RegExp("[\\s\\S]{1," + CHUNK + "}", "g")) || [];
  const calls = chunks.length === 1 ? 1 : chunks.length + 1;
  const okGo = await wqConfirmAI({ title: "开始分析：" + label, lines: [
    "文档：" + (docName || "（粘贴文本）") + " · " + text.length + " 字符",
    "将分 " + chunks.length + " 段、调用 AI " + calls + " 次",
    "长文分段通常需 1-3 分钟，期间请勿关闭页面"
  ], okText: "开始分析" });
  if (!okGo) { prog.textContent = "已取消"; return; }
  out.hidden = false; $("btnCopy").hidden = true; out.textContent = "";
  busy = true;
  const t0 = Date.now();
  let lastMsg = "正在分析（" + label + "）…";
  const timer = setInterval(function () { if (busy) prog.textContent = lastMsg + "（已用 " + Math.round((Date.now() - t0) / 1000) + "s）"; }, 1000);
  try {
    let result;
    if (chunks.length === 1) {
      prog.textContent = lastMsg;
      result = await callAI(prompt + "\n\n【文献内容】\n" + chunks[0]);
    } else {
      const maps = [];
      for (let i = 0; i < chunks.length; i++) {
        lastMsg = "长文分 " + chunks.length + " 段，正在处理第 " + (i + 1) + " 段（" + label + "）…";
        prog.textContent = lastMsg;
        maps.push(await callAI(prompt + "\n\n【说明】这是同一篇长文献的第 " + (i + 1) + "/" + chunks.length + " 段节选，只分析该段实际出现的内容，不要虚构其余部分。\n\n【文献内容·第" + (i + 1) + "段】\n" + chunks[i]));
      }
      lastMsg = "正在合成整体分析…";
      prog.textContent = lastMsg;
      result = await callAI("以下是一篇长文献分段处理后的结果。注意：每段结果只是对局部节选的分析，可能各自重复了相同的研究问题/方法框架。请合并为一份连贯、完整、去重的分析报告，删除重复的框架性内容，按主题重组。\n\n" + maps.map(function (m, i) { return "【第" + (i + 1) + "段结果】\n" + m; }).join("\n\n"));
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    prog.textContent = "完成 ✓（" + label + " · " + text.length + " 字符 · " + chunks.length + " 段 · 用时 " + secs + "s）";
    setMD(out, result);
    $("btnCopy").hidden = false;
    rlogAdd({ ts: new Date().toISOString().slice(0, 16).replace("T", " "), label: label, doc: docName || "粘贴文本", len: (result || "").length, result: String(result || "").slice(0, 30000) });
    await maybeKeepToProject("读论文·" + label, result);
  } catch (e) { prog.textContent = "分析失败：" + e.message; }
  clearInterval(timer);
  busy = false;
}
document.querySelectorAll(".tp").forEach(b => b.addEventListener("click", () => {
  const t = TMPL[b.dataset.p];
  if (t.needExtra && !$("extraIn").value.trim()) { $("aiProg").textContent = "⚠️ " + t.needExtra; $("extraIn").focus(); return; }
  analyze(t.p, t.name);
}));
$("customP").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.value.trim()) analyze(e.target.value.trim(), "自定义指令");
});
$("btnCopy").addEventListener("click", () => copyText($("aiOut").dataset.rawmd || $("aiOut").textContent, $("btnCopy")));

/* paper-qa 式追问（自实现检索：IDF 加权词面匹配，中文按 2-gram 切分） */
const QA_STOP = new Set("the a an of in on for and or to is are was were be been with as by at from this that these those we our their its it s t can could may might will would should do does did not no than then thus so such which what who whom whose how why where when".split(" "));
function termsOf(q) {
  const out = new Set();
  for (const w of q.toLowerCase().split(/[^\w\u4e00-\u9fff]+/)) {
    if (!w || w.length < 2 || QA_STOP.has(w)) continue;
    if (/^[\u4e00-\u9fff]{2,}$/.test(w)) {
      for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); // 中文整句按2-gram切，保证能命中
    } else out.add(w);
  }
  return [...out];
}
function buildChunks() {
  const text = docText || $("docText").value;
  if (!text || text.length < 100) return null;
  const chunks = [];
  const src = docPages && docPages.length ? docPages : [text];
  src.forEach((pageText, pi) => {
    for (let i = 0; i < pageText.length; i += 1800) {
      const c = pageText.slice(i, i + 1800).trim();
      if (c.length > 60) chunks.push({ text: c, page: docPages ? pi + 1 : null });
    }
  });
  return chunks;
}
function retrieve(chunks, query, k = 5) {
  const terms = termsOf(query);
  if (!terms.length) return chunks.slice(0, k);
  const N = chunks.length;
  const df = {};
  const toks = chunks.map(c => {
    const s = new Set();
    const lower = c.text.toLowerCase();
    for (const t of terms) if (lower.includes(t)) s.add(t);
    for (const t of s) df[t] = (df[t] || 0) + 1;
    return s;
  });
  return chunks.map((c, i) => {
    let score = 0;
    for (const t of toks[i]) score += Math.log(1 + N / (df[t] || 1));
    return { ...c, score };
  }).sort((a, b) => b.score - a.score).slice(0, k).filter(c => c.score > 0);
}
$("btnQA").addEventListener("click", async () => {
  const q = $("qaQ").value.trim();
  if (!q) { $("qaProg").textContent = "请输入问题"; return; }
  const chunks = buildChunks();
  if (!chunks) { $("qaProg").textContent = "请先导入文档（≥100字符）"; return; }
  const btn = $("btnQA"); btn.disabled = true;
  if (!(await wqConfirmAI({ title: "开始追问？", lines: ["将本地检索本文最相关段落并调用 AI 1 次（约 10-40 秒）"], okText: "开始追问" }))) { btn.disabled = false; $("qaProg").textContent = "已取消"; return; }
  const prog = $("qaProg"), out = $("qaOut"), srcBox = $("qaSrc");
  prog.textContent = "本地检索相关段落中…";
  const hits = retrieve(chunks, q, 5);
  if (!hits.length) { prog.textContent = "没检索到相关段落（试试问题里带上论文的关键词）"; return; }
  out.hidden = false; srcBox.hidden = false; out.textContent = "AI 思考中…";
  const ctx = hits.map((h, i) => `[材料${i + 1}${h.page ? "·第" + h.page + "页" : ""}]\n${h.text}`).join("\n\n");
  try {
    const ans = await callAI("你是论文问答助手。只依据下面的材料回答问题；每个论断后标注来源编号如 [材料1]；材料不足时明确说「材料未提及」，不要编造。用简体中文。\n\n" + ctx + "\n\n【问题】" + q);
    setMD(out, ans);
    srcBox.innerHTML = "<h3>引用来源（本地检索命中）</h3>" + hits.map((h, i) =>
      `<div class="srcitem">材料${i + 1}${h.page ? " · 第 " + h.page + " 页" : ""} · ${esc(h.text.slice(0, 90))}…</div>`).join("");
    prog.textContent = `完成 ✓ 命中 ${hits.length} 段`;
    rlogAdd({ ts: new Date().toISOString().slice(0, 16).replace("T", " "), label: "追问：" + q.slice(0, 24), doc: docName || "粘贴文本", len: (ans || "").length, result: String(ans || "").slice(0, 30000) });
    await maybeKeepToProject("追问·" + q.slice(0, 24), ans);
  } catch (e) { out.textContent = "失败：" + e.message; prog.textContent = ""; }
  finally { btn.disabled = false; }
});
$("qaQ").addEventListener("keydown", e => { if (e.key === "Enter") $("btnQA").click(); });

/* GROBID 选配 */
$("btnGrobid").addEventListener("click", async () => {
  const gb = ($("grobidUrl").value || localStorage.getItem("wenqu_grobid") || "").replace(/\/+$/, "");
  const prog = $("gbProg");
  if (!gb) { prog.textContent = "未配置：页头「AI / 接口设置」里填 GROBID 地址（如 http://localhost:8070）"; return; }
  const f = $("file").files[0] || lastFile;
  if (!f || !f.name.toLowerCase().endsWith(".pdf")) { prog.textContent = "请先导入 PDF（支持拖拽或点击选择，GROBID 需要原始文件）"; return; }
  prog.textContent = "上传解析中…（首次调用 GROBID 模型加载可能要 30 秒+）";
  try {
    const fd = new FormData();
    fd.append("input", f, f.name);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120000);
    const r = await fetch(`${gb}/api/processFulltextDocument?consolidateHeader=1&consolidateReferences=0`, { method: "POST", body: fd, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const tei = await r.text();
    const doc = new DOMParser().parseFromString(tei, "text/xml");
    const title = doc.querySelector("titleStmt > title")?.textContent?.trim() || "";
    const bibs = [...doc.querySelectorAll("listBibl biblStruct")];
    const lines = bibs.map(b => {
      const au = [...b.querySelectorAll("analytic author persName")].map(p => p.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
      const t2 = b.querySelector("analytic title")?.textContent?.trim() || b.querySelector("monogr title")?.textContent?.trim() || "";
      const host = b.querySelector("monogr title")?.textContent?.trim() || "";
      const yr = b.querySelector("monogr imprint date")?.getAttribute("when")?.slice(0, 4) || "";
      const doiN = [...b.querySelectorAll("idno")].find(x => x.getAttribute("type") === "DOI")?.textContent?.trim() || "";
      return `${au.join(", ")}${au.length ? " " : ""}(${yr}). ${t2 || host}.${doiN ? " DOI: " + doiN + "." : ""}`;
    }).filter(l => l.trim().length > 8);
    if (!lines.length) { prog.textContent = "GROBID 未抽出参考文献（检查是否为学术PDF）"; return; }
    $("citeIn").value = lines.join("\n");
    prog.textContent = `完成 ✓「${title || docName}」抽出 ${lines.length} 条参考文献，已送入「引用引擎」`;
    gotoTab("cite");
    $("citeProg").textContent = "来自 GROBID 的 " + lines.length + " 条待解析";
  } catch (e) {
    prog.textContent = "失败：" + e.message + "。提示：GROBID 默认不开 CORS（浏览器会拦），需在 GROBID 配置开启跨域或走本地代理；确认 Docker 服务已启动。";
  }
});

/* ================= Tab3 引用引擎 ================= */
const CROSSREF = "https://api.crossref.org/works";
const CR_TYPE2CSL = { "journal-article": "article-journal", "book": "book", "proceedings-article": "paper-conference", "book-chapter": "chapter", "posted-content": "post", "report": "report", "thesis": "thesis", "dataset": "dataset", "preprint": "post", "standard": "standard" };

function cr2csl(cr) {
  if (!cr) return null;
  const year = cr.issued?.["date-parts"]?.[0]?.[0] || cr.created?.["date-parts"]?.[0]?.[0] || "";
  const pub = typeof cr.publisher === "string" ? cr.publisher : (cr.publisher?.name || "");
  return {
    id: cr.DOI || "cr-" + Math.random().toString(36).slice(2),
    type: CR_TYPE2CSL[cr.type] || "article-journal",
    title: Array.isArray(cr.title) ? cr.title[0] : cr.title,
    author: (cr.author || []).map(a => ({ family: a.family || a.name || "", given: a.given || "" })),
    issued: year ? { "date-parts": [[year]] } : undefined,
    "container-title": Array.isArray(cr["container-title"]) ? cr["container-title"][0] : (cr["container-title"] || ""),
    "container-title-short": Array.isArray(cr["short-container-title"]) ? cr["short-container-title"][0] : (cr["short-container-title"] || ""),
    volume: cr.volume, issue: cr.issue, page: cr.page,
    publisher: pub, "publisher-place": cr.publisher?.address || undefined,
    DOI: cr.DOI, URL: cr.URL || (cr.DOI ? "https://doi.org/" + cr.DOI : undefined),
  };
}
function isDOIStr(s) { return /^10\.\d{4,9}\/\S+$/.test(s.trim()); }
function cleanRefLine(l) {
  l = l.trim();
  if (/^10\.\d{4,9}\//.test(l)) return l; // 裸DOI不做编号清理，避免吃掉"10."
  return l.replace(/^\s*[\[\(]?\d{1,3}[\]】\.、\)]\s+/, "").trim();
}
function extractDOI(ref) {
  const m = ref.match(/(10\.\d{4,9}\/[^\s"<>，。；]+)/);
  return m ? m[1].replace(/[.,;)\]]+$/, "") : null;
}
async function crByDOI(doi) {
  return (await fetchJSON(`${CROSSREF}/${encodeURIComponent(doi)}${mto().replace("&", "?")}`))?.message || null;
}
async function crByBiblio(ref) {
  const d = await fetchJSON(`${CROSSREF}?query.bibliographic=${encodeURIComponent(ref.slice(0, 300))}&rows=1${mto()}`);
  return d?.message?.items?.[0] || null;
}

/* 混合输入解析：BibTeX / RIS 块 + 自由文本行 → CSL 数组 */
function normTitle(s) { return String(s || "").toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, ""); }

async function parseCiteInput(raw, onProg) {
  const csl = [], errors = [];
  const seen = new Set(); // DOI/题名去重，Crossref 模糊匹配易产生重复
  let rest = raw;
  // 1) 提取 BibTeX 块（边提取边从 rest 移除，避免重扫；未闭合块立即停止防卡死）
  const bibBlocks = [];
  {
    const bre = /@(\w+)\s*\{/g; let m;
    while ((m = bre.exec(rest)) !== null) {
      let depth = 1, i = bre.lastIndex;
      while (i < rest.length && depth > 0) { if (rest[i] === "{") depth++; else if (rest[i] === "}") depth--; i++; }
      if (depth !== 0) break; // 花括号不闭合，停止扫描
      bibBlocks.push(rest.slice(m.index, i));
      rest = rest.slice(0, m.index) + "\n" + rest.slice(i);
      bre.lastIndex = 0;
    }
  }
  // 2) 提取 RIS 块（按 TY 分段整体移除，残留的 TY/TI 字段行绝不能当自由文本去匹配）
  const risBlocks = [];
  if (/(^|\n)TY\s{2}-/.test(rest)) {
    const keep = [];
    for (const b of rest.split(/(?=TY\s{2}-)/)) {
      const t = b.trim();
      if (!t) continue;
      if (/^TY\s{2}-/.test(t)) risBlocks.push(t); else keep.push(t);
    }
    rest = keep.join("\n");
  }
  // 3) BibTeX/RIS 走 citation.js
  if ((bibBlocks.length || risBlocks.length) && !window.CiteJS) errors.push("citation.js 未加载，BibTeX/RIS 块被跳过");
  const pushDedup = (c) => {
    if (!c || !c.title) return false;
    const key = (c.DOI || "").toLowerCase() || normTitle(c.title);
    if (!key || seen.has(key)) return false;
    seen.add(key); csl.push(c); return true;
  };
  for (const b of bibBlocks) { try { new CiteJS.Cite(b).get().forEach(pushDedup); } catch (e) { errors.push("BibTeX 块解析失败: " + e.message); } }
  for (const b of risBlocks) { try { new CiteJS.Cite(b).get().forEach(pushDedup); } catch (e) { errors.push("RIS 块解析失败: " + e.message); } }
  // 4) 剩余行
  const lines = rest.split(/\r?\n/).map(cleanRefLine).filter(l => l.length > 8);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    onProg?.(`第 ${i + 1}/${lines.length} 条：${line.slice(0, 42)}…`);
    const doi = extractDOI(line);
    const bare = isDOIStr(line);
    let cr = null;
    try {
      if (doi) cr = await crByDOI(doi);
      if (!cr && bare) cr = await crByDOI(line.trim());
      if (!cr) {
        if (bare) { errors.push("DOI 未收录: " + line.slice(0, 60)); continue; }
        cr = await crByBiblio(line);
      }
      const c = cr2csl(cr);
      if (!pushDedup(c)) { if (c && c.title) errors.push("重复条目已跳过: " + String(c.title).slice(0, 40)); else errors.push("未匹配: " + line.slice(0, 60)); }
    } catch (e) { errors.push("查询失败: " + line.slice(0, 40) + "（" + e.message + "）"); }
    await sleep(400); // 对 Crossref 保持礼貌
  }
  return { csl, errors };
}

let parsedCsl = [];
function renderParsed() {
  const box = $("parsedList");
  if (!box) return;
  if (!parsedCsl.length) { box.innerHTML = ""; return; }
  box.innerHTML = '<h3>解析结果核对<small style="font-weight:400;color:var(--muted);margin-left:8px">Crossref 自动匹配可能出错——发现错配直接「删」掉或「重查」</small></h3>' +
    '<table class="tb"><tr><th>#</th><th>题名</th><th>年</th><th>DOI</th><th>操作</th></tr>' +
    parsedCsl.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(String(c.title).slice(0, 64))}</td><td>${esc(c.issued?.["date-parts"]?.[0]?.[0] || "")}</td><td class="mono">${esc(c.DOI || "—")}</td><td style="white-space:nowrap"><button class="pill" data-rq="${i}">重查</button> <button class="pill" data-dl="${i}">删</button></td></tr>`).join("") +
    "</table>";
  box.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", () => { parsedCsl.splice(+b.dataset.dl, 1); renderParsed(); }));
  box.querySelectorAll("[data-rq]").forEach(b => b.addEventListener("click", async () => {
    const i = +b.dataset.rq; const c = parsedCsl[i];
    if (!c) return;
    b.textContent = "查…"; b.disabled = true;
    try {
      const cr = c.DOI ? await crByDOI(c.DOI) : await crByBiblio(String(c.title));
      const nc = cr2csl(cr);
      if (nc && nc.title) { parsedCsl[i] = nc; renderParsed(); toast("已重查更新"); }
      else { toast("没查到更匹配的记录"); b.textContent = "重查"; b.disabled = false; }
    } catch (e) { toast("查询失败：" + e.message); b.textContent = "重查"; b.disabled = false; }
  }));
}
$("btnCiteParse").addEventListener("click", async () => {
  const raw = $("citeIn").value.trim();
  if (!raw) { $("citeProg").textContent = "请先粘贴引用"; return; }
  const btn = $("btnCiteParse"); btn.disabled = true;
  await ensureCiteJS().catch(function () {}); // 首次使用时才加载 3.2MB 引用库
  parsedCsl = []; $("citeOut").hidden = true; $("oaOut").innerHTML = ""; renderParsed();
  try {
    const { csl, errors } = await parseCiteInput(raw, s => { $("citeProg").textContent = "解析中…" + s; });
    parsedCsl = csl;
    $("citeProg").textContent = `完成 ✓ 解析出 ${csl.length} 条` + (errors.length ? `；${errors.length} 条提示：` + errors.slice(0, 3).join(" / ") : "");
    if (!csl.length) toast("没有解析出条目，见进度行提示");
    renderParsed();
  } finally { btn.disabled = false; }
});

/* GB/T 7714-2015（与 tools/cite.js 同款实现） */
const GB_TYPE = { "article-journal": "J", "book": "M", "paper-conference": "C", "chapter": "M", "thesis": "D", "report": "R", "post": "EB/OL", "webpage": "EB/OL", "dataset": "DS", "standard": "S", "software": "CP", "patent": "P" };
function normPages(p) { return String(p).replace(/[–—]/g, "-"); }
function gbName(a) {
  if (!a) return "";
  const fam = (a.family || "").trim(), giv = (a.given || "").trim();
  if (fam && /[\u4e00-\u9fff]/.test(fam) && (!giv || /[\u4e00-\u9fff]/.test(giv))) return fam + giv;
  const famUp = fam.toUpperCase();
  if (!giv) return famUp;
  return (famUp + " " + giv.split(/[\s\-]+/).filter(Boolean).map(w => w[0].toUpperCase()).join(" ")).trim();
}
function gbAuthors(authors) {
  const list = (authors || []).map(gbName).filter(Boolean);
  if (!list.length) return "";
  const etal = /[\u4e00-\u9fff]/.test(list.join("")) ? "等" : "et al";
  return list.length > 3 ? list.slice(0, 3).join(", ") + ", " + etal : list.join(", ");
}
function gbEntry(c, idx) {
  const t = GB_TYPE[c.type] || "Z"; // 未知文献类型按国标 [Z] 其他，不冒充期刊
  const title = String(c.title || "[无题]").replace(/\s+/g, " ").trim();
  const yr = c.issued?.["date-parts"]?.[0]?.[0] ? String(c.issued["date-parts"][0][0]) : "";
  const au = gbAuthors(c.author);
  const head = (au ? au + ". " : "") + title;
  const pg = c.page ? normPages(c.page) : "";
  const place = c["publisher-place"] || "";
  const pub = c.publisher || "";
  const pubSeg = pub ? (place ? place + ": " + pub : pub) : "";
  const opt = (arr) => { const s = arr.filter(Boolean).join(", "); return s ? " " + s + "." : "."; };
  let tail = "";
  if (c.type === "article-journal") {
    const voliss = [c.volume ? String(c.volume) : "", c.issue ? "(" + c.issue + ")" : ""].join("");
    const seg = [c["container-title"] || "", yr, voliss].filter(Boolean).join(", ");
    tail = "[J]. " + seg + (pg ? ": " + pg : "") + ".";
  } else if (c.type === "paper-conference") {
    const host = c["container-title"] || "";
    tail = "[C]" + (host ? "//" + host : "") + "." + (yr ? " " + yr : "") + (pg ? ": " + pg : "") + "."; // 国标：年: 页码；无会议录名不编造占位
  } else if (c.type === "chapter") {
    const book = c["container-title"] || ""; // 国标：章名[M]//书名. 出版地: 出版社, 年: 页码
    const main = [pubSeg, yr].filter(Boolean).join(", ");
    tail = "[M]" + (book ? "//" + book : "") + "." + (main ? " " + main : "") + (pg ? ": " + pg : "") + ".";
  } else if (c.type === "book") {
    tail = "[M]." + opt([pubSeg, yr]);
  } else if (c.type === "thesis") {
    tail = "[D]." + opt([pubSeg, yr]);
  } else if (c.type === "report") {
    tail = "[R]." + opt([pub, yr]);
  } else if (c.type === "standard") {
    tail = "[S]." + opt([pub, yr]);
  } else if (c.type === "post" || c.type === "webpage") {
    const url = c.URL || (c.DOI ? "https://doi.org/" + c.DOI : "");
    const today = new Date().toISOString().slice(0, 10); // 第二括号是引用日期
    tail = "[EB/OL]" + (yr ? ". (" + yr + ")" : "") + "[" + today + "]." + (url ? " " + url + "." : "");
  } else {
    tail = "[" + t + "]." + (yr ? " " + yr + "." : "");
  }
  let s = (head + " " + tail).replace(/\s+/g, " ").replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").replace(/:\s*\./g, ".");
  if (c.DOI && c.type === "article-journal") s += " DOI: " + c.DOI + ".";
  return "[" + idx + "] " + s;
}
function fmtAll(fmt) {
  if (!parsedCsl.length) { toast("请先点【解析】"); return null; }
  if (fmt === "gb") return parsedCsl.map((c, i) => gbEntry(c, i + 1)).join("\n");
  if (!window.CiteJS) { toast("citation.js 未加载，无法输出该格式"); return null; }
  const clean = parsedCsl.map(c => JSON.parse(JSON.stringify(c))); // 去掉 undefined 字段，citation.js 更稳
  const cite = new CiteJS.Cite(clean);
  if (fmt === "csl") return JSON.stringify(parsedCsl, null, 2);
  if (fmt === "bibtex") return cite.format("bibtex");
  if (fmt === "ris") return cite.format("ris");
  if (["apa", "vancouver", "harvard1"].includes(fmt)) return cite.format("bibliography", { template: fmt, lang: "en-US" });
  return null;
}
$("btnCiteFmt").addEventListener("click", async () => {
  await ensureCiteJS().catch(function () {});
  const fmt = $("citeFmt").value;
  const out = fmtAll(fmt);
  if (out === null) return;
  $("citeOut").hidden = false; $("citeOut").textContent = out;
  $("btnCiteCopy").hidden = false; $("btnCiteDl").hidden = false;
});
$("btnCiteCopy").addEventListener("click", () => copyText($("citeOut").textContent, $("btnCiteCopy")));
$("btnCiteDl").addEventListener("click", () => {
  const fmt = $("citeFmt").value;
  const ext = { gb: "txt", apa: "txt", vancouver: "txt", bibtex: "bib", ris: "ris" }[fmt] || "txt";
  dlText("references." + ext, $("citeOut").textContent);
});

/* 批量找免费版（OpenAlex + Unpaywall） */
async function upwByDOI(doi, email) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  try { return await fetchJSON(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`); }
  catch { return null; }
}
$("btnCiteOA").addEventListener("click", async () => {
  if (!parsedCsl.length) { $("oaProg").textContent = "请先点【解析】"; return; }
  const btnOA = $("btnCiteOA"); btnOA.disabled = true;
  const email = $("upEmail").value.trim();
  if (email) { lsSet("wenqu_email", email); oaMail = email; }
  const onlyPdf = $("oaOnlyPdf").checked;
  const out = $("oaOut"), prog = $("oaProg"), bar = $("oaBar");
  document.querySelector("#tab-cite .prog").hidden = false;
  out.innerHTML = "";
  const rows = []; let found = 0;
  for (let i = 0; i < parsedCsl.length; i++) {
    const c = parsedCsl[i];
    bar.style.width = `${((i + 1) / parsedCsl.length) * 100}%`;
    prog.textContent = `第 ${i + 1}/${parsedCsl.length} 条：${String(c.title).slice(0, 40)}…`;
    let oaPdf = null, oaLanding = null;
    try {
      if (c.DOI) {
        const w = await fetchJSON(`${OA}/https://doi.org/${encodeURIComponent(c.DOI)}?select=open_access,best_oa_location${mto().replace("&", "?")}`);
        const loc = w.best_oa_location || {};
        oaPdf = (w.open_access?.oa_url) || loc.pdf_url || null;
        oaLanding = loc.landing_page_url || null;
      }
      if (!oaPdf && !oaLanding && c.DOI) {
        const u = await upwByDOI(c.DOI, email);
        if (u && u.is_oa) { oaPdf = (u.best_oa_location || {}).url_for_pdf || null; oaLanding = (u.best_oa_location || {}).url || null; }
      }
    } catch (e) { /* 单条失败不中断 */ }
    const ok = onlyPdf ? oaPdf : (oaPdf || oaLanding);
    if (ok) found++;
    rows.push(`<tr><td>${i + 1}</td><td>${esc(String(c.title).slice(0, 70))}${c.issued?.["date-parts"]?.[0]?.[0] ? ` <span class="mono">(${c.issued["date-parts"][0][0]})</span>` : ""}</td>
      <td>${ok ? (oaPdf ? `<a class="pill ok" href="${esc(oaPdf)}" target="_blank" rel="noopener">📥 直接PDF</a>` : "") : ""} ${ok && !oaPdf ? `<a class="pill" href="${esc(oaLanding)}" target="_blank" rel="noopener">开放版本</a>` : ""}${!ok ? '<span class="pill no">无免费版</span>' : ""}</td>
      <td>${c.DOI ? `<a class="pill" href="https://doi.org/${esc(c.DOI)}" target="_blank" rel="noopener">DOI</a>` : "—"}</td></tr>`);
    out.innerHTML = `<table class="tb"><tr><th>#</th><th>文献</th><th>免费全文</th><th>DOI</th></tr>${rows.join("")}</table>`;
    await sleep(400);
  }
  prog.textContent = `完成：${found}/${parsedCsl.length} 条找到合法免费版（${Math.round(found / parsedCsl.length * 100)}%）。未找到的走机构图书馆或向作者索要。`;
  btnOA.disabled = false;
});

/* ================= Tab4 综述工坊 ================= */
let stormStop = false;
$("btnStormStop").addEventListener("click", () => { stormStop = true; $("stProg").textContent = "正在停止（完成当前步后中止）…"; });

$("btnStorm").addEventListener("click", async () => {
  const topic = $("stTopic").value.trim();
  if (!topic) { toast("请输入综述主题"); return; }
  if (busy) { toast("「AI 读论文」正在分析，请稍候"); return; }
  const nSec = +$("stN").value, kPapers = +$("stK").value;
  const useBasket = $("stBasket").checked, oaOnly = $("stOA").checked;
  if (!(await wqConfirmAI({ title: "生成综述草稿？", lines: [nSec + " 章 · 每章约 " + kPapers + " 篇文献", "调用 AI 约 " + (nSec + 4) + "-" + (nSec + 6) + " 次，全程 2-5 分钟", "产出为可改骨架，引用 [n] 需人工核对"], okText: "开始生成" }))) { $("stProg").textContent = "已取消"; return; }
  const bar = $("stBar"), prog = $("stProg");
  document.querySelector("#tab-storm .prog").hidden = false;
  $("btnStorm").disabled = true; $("btnStormStop").hidden = false;
  stormStop = false; busy = true;
  const setP = (pct, txt) => { bar.style.width = pct + "%"; prog.textContent = txt; };

  try {
    const pool = [];
    const poolIds = new Set();
    // ① 收藏篮优先入池
    if (useBasket) {
      for (const b of getBasket()) {
        const key = b.doi || b.title;
        if (poolIds.has(key)) continue;
        poolIds.add(key);
        pool.push({ n: pool.length + 1, title: b.title, authors: (b.authors || []).slice(0, 3).join(", "), year: b.year, venue: b.venue, doi: b.doi || "", abstract: b.abstract || "" });
      }
      setP(5, `收藏篮带入 ${pool.length} 篇`);
    }
    // ② LLM 大纲
    setP(8, "Step 1/4：AI 设计多视角大纲…");
    const outlineRaw = await callAI(
      `你是综述规划专家。主题：「${topic}」。请设计共 ${nSec} 章正文的综述大纲（引言与结语由系统另行生成，不要输出），每章围绕一个视角/流派/方法族。只输出 JSON 数组，格式：
[{"section":"章节标题","question":"该章要回答的核心问题(一句话)","keywords":["英文检索词1","英文检索词2"]}]
检索词要适合 OpenAlex 学术库（英文、可加引号短语），每章 2 个。不要输出任何 JSON 之外的内容。`, { temperature: 0.4 });
    if (stormStop) throw new Error("已停止");
    let outline;
    try { outline = parseJSONLoose(outlineRaw); }
    catch { setP(10, "大纲 JSON 解析失败，重试一次…"); outline = parseJSONLoose(await callAI("把下面的内容转成合法 JSON 数组，不要任何解释：\n" + outlineRaw)); }
    if (!Array.isArray(outline) || !outline.length) throw new Error("AI 没能生成大纲，请调整主题表述后重试");
    outline = outline.slice(0, nSec);
    $("stOutline").innerHTML = outline.map((o, i) => `<div class="rcard"><div class="rt">${i + 1}. ${esc(o.section)}</div><div class="rmeta">${esc(o.question || "")} · 检索词：${esc((o.keywords || []).join(" / "))}</div></div>`).join("");

    // ③ 每章检索
    const per = Math.ceil((nSec * kPapers) / 2);
    for (let i = 0; i < outline.length; i++) {
      if (stormStop) throw new Error("已停止");
      const kw = (outline[i].keywords || []).slice(0, 2);
      setP(15 + (i / outline.length) * 40, `Step 2/4：第 ${i + 1}/${outline.length} 章「${outline[i].section}」检索中…`);
      for (const k of kw) {
        if (!k) continue;
        try {
          const f = oaOnly ? "&filter=is_oa:true" : "";
          const d = await fetchJSON(`${OA}?search=${encodeURIComponent(k)}&per-page=${per}&sort=relevance_score:desc&select=${OA_SELECT}${mto()}${f}`);
          for (const w of (d.results || [])) {
            const doi = w.doi ? w.doi.replace("https://doi.org/", "") : "";
            const key = doi || w.display_name;
            if (poolIds.has(key)) continue;
            poolIds.add(key);
            pool.push({
              n: pool.length + 1, title: w.display_name,
              authors: (w.authorships || []).slice(0, 3).map(a => a.author?.display_name || "").join(", "),
              year: w.publication_year || "", venue: w.primary_location?.source?.display_name || "",
              doi, abstract: oaAbstract(w.abstract_inverted_index).slice(0, 320),
              oa: oaLink(w),
            });
          }
        } catch (e) { /* 检索失败继续 */ }
        await sleep(350);
      }
    }
    setP(58, `文献池共 ${pool.length} 篇（DOI 去重后）`);
    if (!pool.length) throw new Error("文献池为空：换更通用的检索词，或关掉「只用有免费版的」");

    // ④ 逐章起草
    const poolList = pool.map(p => `[${p.n}] ${p.title} — ${p.authors}${p.year ? ", " + p.year : ""}${p.venue ? ", " + p.venue : ""}${p.abstract ? "。摘要节选: " + p.abstract : ""}`).join("\n");
    const drafts = [];
    for (let i = 0; i < outline.length; i++) {
      if (stormStop) throw new Error("已停止");
      setP(60 + (i / outline.length) * 30, `Step 3/4：起草第 ${i + 1}/${outline.length} 章「${outline[i].section}」…`);
      const d = await callAI(
        `你在写一篇中文学术综述「${topic}」。现在写第 ${i + 1} 章「${outline[i].section}」，要回答：${outline[i].question || ""}
要求：最多600字，宁可短也不要灌水；只依据下方文献池，论断后标注 [编号]，编号只能取自【文献池】行首的 [n]，禁止引用池外编号；客观转述不要编造；若该方向文献不足以支撑本章，直接写明「该方向文献不足」并点出缺口在哪，不要用空话填充；按"观点—证据—对话"组织；术语保留英文。
【文献池】
${poolList}`, { temperature: 0.4 });
      drafts.push(`## ${i + 1} ${outline[i].section}\n\n${d.trim()}`);
    }
    if (stormStop) throw new Error("已停止");

    // ⑤ 引言+结语+组装
    setP(92, "Step 4/4：写引言与结语，组装 Markdown…");
    const intro = await callAI(`为中文综述「${topic}」写一段 250-350 字的引言：说明该主题为什么重要、综述覆盖哪些方面（下列章节）、以及阅读价值。不要列条目。\n章节：${outline.map(o => o.section).join("；")}`, { temperature: 0.4 });
    const concl = await callAI(`为中文综述「${topic}」写一段 200-300 字的结语：总结主要脉络、指出共识与分歧、列出 3 个值得进一步研究的问题。`, { temperature: 0.4 });
    const refs = pool.map(p => `[${p.n}] ${p.authors}${p.authors ? " " : ""}(${p.year}). ${p.title}. ${p.venue}.${p.doi ? " DOI: " + p.doi + "." : ""}${p.oa ? " [免费PDF] " + p.oa : ""}`);
    const md = `# ${topic}（综述草稿）\n\n> 由文渠科研工作台生成 · 文献池 ${pool.length} 篇 · 生成日期 ${new Date().toISOString().slice(0, 10)}\n> ⚠️ AI 草稿：所有引用 [n] 与论断请人工核对后再使用。\n\n## 引言\n\n${intro.trim()}\n\n${drafts.join("\n\n")}\n\n## 结语\n\n${concl.trim()}\n\n## 参考文献\n\n${refs.join("\n")}\n`;
    setP(100, `完成 ✓ 全文约 ${md.length} 字，参考文献 ${pool.length} 条`);
    setMD($("stOut"), md);
    await maybeKeepToProject("综述草稿·" + topic.slice(0, 20), md);
    $("btnStCopy").hidden = false; $("btnStDl").hidden = false;
  } catch (e) {
    prog.textContent = (e.message === "已停止" ? "已停止。" : "失败：" + e.message);
  }
  $("btnStorm").disabled = false; $("btnStormStop").hidden = true; busy = false;
});
$("btnStCopy").addEventListener("click", () => copyText($("stOut").dataset.rawmd || $("stOut").textContent, $("btnStCopy")));
$("btnStDl").addEventListener("click", () => dlText("综述草稿.md", $("stOut").dataset.rawmd || $("stOut").textContent, "text/markdown"));

/* ================= Tab5 新论文雷达 ================= */
$("btnRadar").addEventListener("click", async () => {
  const interests = $("rdInterests").value.trim();
  if (!interests) { toast("请填写研究兴趣"); return; }
  const btn = $("btnRadar"); btn.disabled = true;
  lsSet("wenqu_radar", interests);
  const days = $("rdDays").value;
  if (!(await wqConfirmAI({ title: "扫描新论文并用 AI 打分？", lines: ["拉取近 " + days + " 天新论文（最多 30 篇）", "调用 AI 约 3 次（每批 10 篇打分）"], okText: "开始扫描" }))) { btn.disabled = false; toast("已取消"); return; }
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const out = $("rdOut"), prog = $("rdProg"), bar = $("rdBar");
  document.querySelector("#tab-radar .prog").hidden = false;
  bar.style.width = "15%"; prog.textContent = "拉取近 " + days + " 天新论文…";
  out.innerHTML = "";
  let rows = [];
  try {
    const d = await fetchJSON(`${OA}?search=${encodeURIComponent(interests)}&filter=from_publication_date:${since}&sort=publication_date:desc&per-page=30&select=${OA_SELECT}&mailto=${oaMail}`);
    rows = d.results || [];
  } catch (e) { prog.textContent = "检索失败：" + e.message; btn.disabled = false; return; }
  if (!rows.length) { prog.textContent = "这个时间段没有命中新论文，放宽天数或改关键词。"; bar.style.width = "100%"; btn.disabled = false; return; }
  bar.style.width = "50%"; prog.textContent = `取到 ${rows.length} 篇，AI 打分中…`;
  const items = rows.map((w, i) => {
    const doi = w.doi ? w.doi.replace("https://doi.org/", "") : "";
    return { i: i + 1, doi, w, line: `${i + 1}. ${w.display_name}${w.publication_year ? " (" + w.publication_year + ")" : ""}. ${oaAbstract(w.abstract_inverted_index).slice(0, 260)}` };
  });
  const scored = [];
  // 分批（每批 10 篇）避免超长
  for (let s = 0; s < items.length; s += 10) {
    const batch = items.slice(s, s + 10);
    try {
      const r = await callAI(
        `你是文献推荐助手。用户研究兴趣：「${interests}」。下面每篇新论文行首有编号（n），给每篇打 0-100 的相关度分，并写一句 ≤30 字的中文推荐语（说清与兴趣的关系）。只输出 JSON 数组：[{"n":行首编号,"score":85,"why":"..."}]，n 必须照抄行首编号。
${batch.map(b => b.line).join("\n")}`, { temperature: 0.2, max_tokens: 2048 });
      const arr = parseJSONLoose(r);
      for (const b of batch) {
        const hit = arr.find(x => +x.n === b.i);
        scored.push({ ...b, score: hit ? Math.max(0, Math.min(100, +hit.score || 0)) : null, why: hit?.why || "" });
      }
    } catch (e) {
      for (const b of batch) scored.push({ ...b, score: null, why: "" });
    }
    bar.style.width = 50 + (s / items.length) * 45 + "%";
    await sleep(300);
  }
  scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  bar.style.width = "100%";
  prog.textContent = `完成 ✓ ${scored.filter(x => (x.score ?? 0) >= 70).length} 篇 ≥70 分。按 AI 相关度排序：`;
  out.innerHTML = scored.map((x, i) => {
    const pdf = oaLink(x.w);
    const cls = (x.score ?? 0) >= 80 ? "hi" : (x.score ?? 0) >= 60 ? "mid" : "";
    return `<div class="rcard" data-i="${i}">
      <div class="rt"><span class="score ${cls}" style="margin-right:8px">${x.score ?? "?"}</span><a href="${esc(x.w.doi || x.w.id)}" target="_blank" rel="noopener">${esc(x.w.display_name)}</a></div>
      ${x.why ? `<div class="why">💡 ${esc(x.why)}</div>` : ""}
      <div class="rmeta">${esc(x.w.publication_year || "")} · ${esc(x.w.primary_location?.source?.display_name || "")} · ${esc((x.w.authorships || []).slice(0, 3).map(a => a.author?.display_name || "").join(", "))}</div>
      <div class="rbtns">
        ${pdf ? `<a class="pill ok" href="${esc(pdf)}" target="_blank" rel="noopener">📥 免费 PDF</a>` : `<button class="pill no" data-helpbtn>无免费版 · 求助</button>`}
        <button class="pill" data-add="${i}">➕收藏</button>
        ${x.doi ? `<a class="pill" href="https://doi.org/${esc(x.doi)}" target="_blank" rel="noopener">DOI</a>` : ""}
      </div>
      ${helpBoxHTML(x.w)}
    </div>`;
  }).join("");
  out.querySelectorAll("[data-add]").forEach(btn => btn.addEventListener("click", () => {
    const x = scored[+btn.dataset.add];
    const doi = x.w.doi ? x.w.doi.replace("https://doi.org/", "") : "";
    addBasket({
      doi, title: x.w.display_name, year: x.w.publication_year || "",
      venue: x.w.primary_location?.source?.display_name || "",
      authors: (x.w.authorships || []).map(a => a.author?.display_name || "").filter(Boolean),
      oa_url: oaLink(x.w),
    });
    btn.textContent = "✓ 已收藏"; btn.classList.add("added");
  }));
  bindHelp(out, scored);
  $("btnRadar").disabled = false;
});
$("rdInterests").value = localStorage.getItem("wenqu_radar") || "";

/* ================= Tab6 开源引擎（仅内部版：公开页不加载 engines-data.js，本标签自动移除） ================= */
if (window.WQ_ENGINES) {
const ENGINES = window.WQ_ENGINES;
const KIND_LABEL = { reuse: '<span class="lic reuse">可复用</span>', learn: '<span class="lic learn">只学架构</span>', caution: '<span class="lic caution">限制/需谨慎</span>' };
$("engOut").innerHTML = ENGINES.map(g => `
  <h3>${esc(g.sec)}</h3>
  <table class="tb"><tr><th>项目</th><th>星数 / 许可</th><th>是什么 → 怎么用</th><th>集成状态</th></tr>
  ${g.items.map(x => `<tr>
    <td><a href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.name)}</b></a></td>
    <td>★${esc(x.stars)}<br>${KIND_LABEL[x.kind]} <span class="mono">${esc(x.lic)}</span></td>
    <td>${esc(x.what)}<br><span class="hint">↳ ${esc(x.use)}</span></td>
    <td class="st">${x.st}</td>
  </tr>`).join("")}</table>`).join("");

$("chanOut").innerHTML = (window.WQ_CHANNELS || []).map(x => `<div class="rcard"><div class="rt">${esc(x.p)}</div><div class="rmeta">${esc(x.t)}</div></div>`).join("");
} else {
  document.querySelector('.tab[data-tab="engines"]')?.remove();
  $("tab-engines")?.remove();
  $("skBiz")?.remove(); // 公开版不出现"三工具分发"等内部商业表述
}

/* ================= Tab7 技能库 ================= */
const SKILLS = [
  { t: "文献阅读报告", d: "对一篇文献出完整报告（对应 AI 读论文页，导入后即可用）", p: "你是学术阅读助手。请基于我提供的文献输出一份阅读报告：\n1) 一句话概括\n2) 研究问题、动机与假设\n3) 数据、方法与识别策略\n4) 主要发现（分点，保留关键数字与系数）\n5) 贡献与局限\n6) 与哪些文献对话（如文中提及）\n7) 我综述里可以怎么引用它\n用简体中文，术语保留英文。" },
  { t: "综述素材卡", d: "把单篇文献变成综述可用的素材卡", p: "你是综述写作助手。把这篇文献整理成综述素材卡：\n1) 主题定位（一句话）\n2) 可直接引用的论点清单（每条注明出现位置/章节）\n3) 与同领域其他文献可能的对话点或分歧点\n4) 检索关键词（中英各3-5个）\n用简体中文。" },
  { t: "审稿模拟", d: "投稿前自检，模拟严格审稿人", p: "你是顶级期刊的严格但建设性的审稿人。对以下论文：\n1) 概括核心贡献\n2) 列主要优点\n3) 列潜在弱点、隐含假设与内生性问题\n4) 给出 Major / Minor 修改建议\n5) 给出 1-10 的接收倾向分并说明理由\n用简体中文。" },
  { t: "审稿回复信", d: "逐条起草 Response Letter（AI 读论文页 + 补充输入粘贴审稿意见）", p: "你是论文作者。结合【论文内容】与【审稿意见】逐条起草回复：每条先复述意见，再给回复思路（中文）+ 英文 Response 正文 + 论文修改位置。语气礼貌、直接回应、不回避尖锐问题。" },
  { t: "论文写作 · 引言框架", d: "按 CARS 模型（建立领域-指出缺口-占据缺口）起草引言骨架", p: "你是学术写作教练。按 CARS 模型为题目「{{题目}}」起草英文引言框架（每段给出：段落功能、要点清单、可用的句式模板、引用位置建议）。建立领域：3-4句；指出缺口：2-3句；占据缺口：2句。目标期刊风格：{{期刊}}。" },
  { t: "论文写作 · 讨论节", d: "结果→解释→对话→局限→意义", p: "你是学术写作教练。基于以下结果起草讨论节框架：1) 主要发现复述（不重复数字堆砌）；2) 与已有文献的对话（一致/矛盾+可能原因）；3) 机制解释；4) 局限（诚实但不自毁）；5) 政策/实践/理论意义。每部分给要点和关键句式。\n【结果】{{粘贴结果}}" },
  { t: "学术润色 · 合规版", d: "语言表达优化（注意红线：不做规避 AIGC 检测）", p: "你是学术英语编辑。对以下文字做语言层面的优化：术语准确、句式地道、逻辑连接清晰、避免空洞强调与 AI 腔套话。逐段输出修改稿，并用对照表列出主要改动及理由。不做内容增删，不改变作者观点。\n【文字】{{粘贴}}" },
  { t: "科学计算审稿", d: "审计算法/量化部分的可复现性与正确性", p: "你是量化方法审稿人。审阅以下计算/算法部分：1) 数学推导是否成立（逐步检查）；2) 数值实现是否有坑（量纲、边界、收敛、随机种子）；3) 可复现性（数据、代码、超参数是否交代）；4) 复杂度与效率；5) 建议的稳健性检验。\n【内容】{{粘贴}}" },
];
$("skOut").innerHTML = SKILLS.map((s, i) => `
  <div class="pcard">
    <div class="pt">${esc(s.t)}</div>
    <div class="pd">${esc(s.d)}</div>
    <pre>${esc(s.p)}</pre>
    <div class="rbtns">
      <button class="pill" data-sk="${i}">📋 复制提示词</button>
      <button class="pill" data-use="${i}">▶ 到「AI 读论文」用</button>
    </div>
  </div>`).join("");
$("skOut").querySelectorAll("[data-sk]").forEach(b => b.addEventListener("click", () => copyText(SKILLS[+b.dataset.sk].p, b)));
$("skOut").querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => {
  const s = SKILLS[+b.dataset.use];
  if (/\{\{/.test(s.p)) { copyText(s.p); toast("含 {{占位符}} 的提示词已复制，请替换后使用"); return; }
  $("customP").value = s.p; gotoTab("read"); toast("已填入自定义指令，回车运行");
}));

/* ================= Tab8 科研数据库（导航 + 地址直达 + 自定义入口） ================= */
const DBS = [
  { g: "第三方文献服务（自购卡自行登录）", items: [
    { n: "wxy88·中文库", u: "http://www.wxy88.top/e/action/ListInfo/?classid=61", d: "第三方服务：中文期刊/学位论文入口，需自购卡登录" },
    { n: "wxy88·英文库", u: "http://www.wxy88.top/e/action/ListInfo/?classid=63", d: "第三方服务：外文库入口，需自购卡登录" },
    { n: "wxy88·数据档", u: "http://www.wxy88.top/e/action/ListInfo/?classid=65", d: "第三方服务：CSMAR/EPS/锐思等数据入口，需自购卡登录" },
    { n: "wxy88·医学库", u: "http://www.wxy88.top/e/action/ListInfo/?classid=187", d: "第三方服务：医学库入口，需自购卡登录" },
    { n: "wxy88·智慧芽专利", u: "http://www.wxy88.top/e/action/ListInfo/?classid=198", d: "第三方服务：专利查新入口，各入口账号不通用" },
    { n: "wxy88·备用入口", u: "https://lib.wenx.top", d: "主站不可用时备用" },
  ]},
  { g: "中文数据库", items: [
    { n: "CNKI 知网", u: "https://www.cnki.net", d: "中文期刊/学位论文最大库，下载需机构权限" },
    { n: "万方数据", u: "https://www.wanfangdata.com.cn", d: "期刊/学位/会议/标准" },
    { n: "维普", u: "https://www.cqvip.com", d: "中文期刊" },
    { n: "百度学术", u: "https://xueshu.baidu.com", d: "免费学术搜索，可查各库收录情况" },
    { n: "ncpssd", u: "https://www.ncpssd.cn", d: "国家哲学社会科学文献中心，注册后免费下载" },
  ]},
  { g: "国家平台", items: [
    { n: "NSTL 文献传递", u: "https://www.nstl.gov.cn", d: "国家科技图书文献中心，付费传递外文文献" },
    { n: "国家图书馆", u: "https://www.nlc.cn", d: "读者卡可远程访问部分数字资源" },
    { n: "图书馆参考咨询联盟", u: "http://www.ucdrs.superlib.net", d: "公共馆联合免费文献咨询传递" },
  ]},
  { g: "外文数据库", items: [
    { n: "OpenAlex", u: "https://openalex.org", d: "2.5亿+ 文献元数据（本工作台的数据源）" },
    { n: "arXiv", u: "https://arxiv.org", d: "物理/CS/量化预印本，全免费" },
    { n: "PubMed", u: "https://pubmed.ncbi.nlm.nih.gov", d: "生物医学文献" },
    { n: "Semantic Scholar", u: "https://www.semanticscholar.org", d: "AI 增强学术搜索" },
    { n: "DOAJ", u: "https://doaj.org", d: "合规开放获取期刊目录" },
    { n: "SSRN", u: "https://www.ssrn.com", d: "社科/金融预印本" },
  ]},
  { g: "公共图书馆通道（办证后免费使用数字资源）", items: [
    { n: "浙江图书馆", u: "https://www.zjlib.cn", d: "线上可办读者证，数字资源丰富" },
    { n: "首都图书馆", u: "https://www.clcn.net.cn", d: "注册读者卡可访问部分库" },
  ]},
];
function renderDB() {
  $("dbGrid").innerHTML = DBS.map(g => `<h3 style="margin-top:6px">${esc(g.g)}</h3><div class="rbtns" style="margin-bottom:10px">` +
    g.items.map(x => `<a class="pill" style="font-size:13px;padding:6px 14px" href="${esc(x.u)}" target="_blank" rel="noopener" title="${esc(x.d)}">${esc(x.n)}</a>`).join("") + `</div>`).join("") +
    '<p class="hint">悬停看说明。需要机构权限的库走你所在的学校/单位订阅；没有权限的用「求助」兜底通道（NSTL 传递 / 向作者索要）。<b>第三方服务条目</b>需自购卡自行登录，与本平台无隶属关系、不代理不留凭据，使用前请自行确认符合所在机构授权条款。</p>';
}
function dbGo() {
  let u = $("dbUrl").value.trim();
  if (!u) return;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^[\w-]+(\.[\w-]+)+/.test(u)) {
    window.open("https://xueshu.baidu.com/s?wd=" + encodeURIComponent(u), "_blank", "noopener"); // 纯搜索词走百度学术
    return;
  }
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  window.open(u, "_blank", "noopener");
}
$("dbGo").addEventListener("click", dbGo);
$("dbUrl").addEventListener("keydown", e => { if (e.key === "Enter") dbGo(); });

const PORTAL_KEY = "wenqu_portals";
function getPortals() { try { return JSON.parse(localStorage.getItem(PORTAL_KEY) || "[]"); } catch { return []; } }
function renderPortals() {
  const p = getPortals();
  $("dbPortals").innerHTML = p.length ? p.map((x, i) =>
    `<span class="pill" style="font-size:13px;padding:6px 14px;margin:0 8px 8px 0"><a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.n)}</a> <button class="pill" data-dp="${i}" style="border:none;background:none;padding:0 2px;color:var(--bad);font-weight:800" title="删除">✕</button></span>`).join("")
    : '<p class="hint">还没有自定义入口。添加后点击名称即在新开页打开。</p>';
  $("dbPortals").querySelectorAll("[data-dp]").forEach(b => b.addEventListener("click", () => {
    const a = getPortals(); a.splice(+b.dataset.dp, 1); lsSet(PORTAL_KEY, JSON.stringify(a)); renderPortals();
  }));
}
$("dbAdd").addEventListener("click", () => {
  const n = $("dbName").value.trim(), u = $("dbPUrl").value.trim();
  if (!n || !u) { toast("名称和网址都要填"); return; }
  const a = getPortals();
  if (a.some(x => x.u === (/^https?:\/\//i.test(u) ? u : "https://" + u))) { toast("这个网址已存在"); return; }
  a.push({ n, u: /^https?:\/\//i.test(u) ? u : "https://" + u });
  lsSet(PORTAL_KEY, JSON.stringify(a));
  $("dbName").value = ""; $("dbPUrl").value = "";
  renderPortals(); toast("已添加 ✓");
});
renderDB(); renderPortals();

/* 初始渲染 */
$("bkCount").textContent = getBasket().length;

/* 深链：?tab=search|read|cite|storm|radar|skills|db|engines。合并平台上先切「工具台」模式再激活标签 */
const __deepTab = new URLSearchParams(location.search).get("tab");
if (__deepTab) {
  document.querySelector('[data-mode="tools"]')?.click();
  document.querySelector('.tab[data-tab="' + CSS.escape(__deepTab) + '"]')?.click();
}
})();

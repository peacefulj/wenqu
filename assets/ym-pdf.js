/* 研墨 · PDF 全文 ym-pdf.js（v1.1.0 新增）
 * 文献卡上传 PDF（只存本机 IndexedDB「yanmo-files」）→ 内置阅读器（pdf.js 逐页渲染 + 文字层）
 * → 选中文字高亮 / 写批注 → AI 按页精读（每条结论带页码）。
 * 批注、精读结果存在文献卡上（随项目保存、备份、同步到 MCP）；PDF 原文件不进备份（体积太大）。
 * 依赖 studio.js 的全局：cur() liveProj() save() renderPapers() renderProcessLog() addVersion() trailAdd()
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const notice = (t, lines) => (window.wqNotice ? wqNotice(t, lines) : alert(t));
  const tip = (t) => (window.toast ? toast(t) : console.log(t));
  const mdHTML = (t) => (window.mdRender ? mdRender(t) : esc(t).replace(/\n/g, "<br>"));
  const COLORS = { y: "黄", g: "绿", b: "蓝", r: "红" };
  const EMOJI = { y: "🟨", g: "🟩", b: "🟦", r: "🟥" };

  /* ================= 本机存储：IndexedDB「yanmo-files」（与 ym-sync.js 共用，结构必须一致） ================= */
  let dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("浏览器不支持 IndexedDB，无法保存 PDF"));
      const r = indexedDB.open("yanmo-files", 1);
      r.onupgradeneeded = () => { const d = r.result; ["pdfs", "handles"].forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("IndexedDB 打开失败"));
    });
    dbP.catch(() => { dbP = null; });
    return dbP;
  }
  function tx(store, mode, fn) {
    return idb().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode), out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("存储事务中止（空间不足？）"));
    }));
  }
  const keyOf = (pid, fid) => pid + "/" + fid;
  const putPdf = (pid, fid, rec) => tx("pdfs", "readwrite", s => s.put(rec, keyOf(pid, fid)));
  const getPdf = (pid, fid) => tx("pdfs", "readonly", s => s.get(keyOf(pid, fid)));
  const delPdf = (pid, fid) => tx("pdfs", "readwrite", s => s.delete(keyOf(pid, fid)));
  const delProject = (pid) => tx("pdfs", "readwrite", s => s.delete(IDBKeyRange.bound(pid + "/", pid + "0", false, true)));

  /* ================= pdf.js（studio.html 在 load 后懒加载；这里兜底等待） ================= */
  let libP = null;
  function setWorker() {
    const L = window.pdfjsLib;
    if (L && L.GlobalWorkerOptions && !L.GlobalWorkerOptions.workerSrc) L.GlobalWorkerOptions.workerSrc = "assets/vendor/pdf.worker.min.js";
  }
  function ensurePdfJs() {
    if (window.pdfjsLib) { setWorker(); return Promise.resolve(window.pdfjsLib); }
    if (libP) return libP;
    libP = new Promise((res, rej) => {
      const exist = document.querySelector('script[src$="assets/vendor/pdf.min.js"]');
      const s = exist || document.createElement("script");
      const done = () => { if (window.pdfjsLib) { setWorker(); res(window.pdfjsLib); } else { libP = null; rej(new Error("PDF 组件加载失败")); } };
      s.addEventListener("load", done);
      s.addEventListener("error", () => { libP = null; rej(new Error("PDF 组件加载失败（assets/vendor/pdf.min.js）")); });
      if (!exist) { s.src = "assets/vendor/pdf.min.js"; document.head.appendChild(s); }
      else setTimeout(() => { if (window.pdfjsLib) done(); }, 0);
    });
    return libP;
  }

  /* ================= 文献列表里的「全文」单元格 ================= */
  function cellHTML(p, f) {
    const n = (f.annots || []).length;
    if (f.pdf) {
      return `<button class="btn2 btn-sm" data-ympdf-open="${esc(f.id)}" title="${esc((f.pdf.name || "") + (f.pdf.pages ? " · " + f.pdf.pages + " 页" : ""))}">📖 阅读${n ? " · " + n + " 批注" : ""}${f.reading ? " · ✨" : ""}</button>`;
    }
    return `<label class="btn2 btn-sm ghost" style="cursor:pointer" title="上传这篇文献的 PDF（只存在本机浏览器）">📎 上传 PDF<input type="file" accept="application/pdf,.pdf" data-ympdf-attach="${esc(f.id)}" hidden></label>` +
      (n || f.reading ? `<br><button class="pillbtn" data-ympdf-notes="${esc(f.id)}">批注 ${n}${f.reading ? " · 精读" : ""}</button>` : "");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-ympdf-open]");
    if (b) { e.preventDefault(); openReader(b.dataset.ympdfOpen); return; }
    const nb = e.target.closest && e.target.closest("[data-ympdf-notes]");
    if (nb) { e.preventDefault(); showNotesOnly(nb.dataset.ympdfNotes); }
  });
  document.addEventListener("change", (e) => {
    const inp = e.target.closest && e.target.closest("[data-ympdf-attach]");
    if (inp && inp.files && inp.files[0]) { const file = inp.files[0]; inp.value = ""; attach(inp.dataset.ympdfAttach, file); }
  });
  function pickFile() {
    return new Promise((res) => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = "application/pdf,.pdf";
      i.addEventListener("change", () => res(i.files && i.files[0] || null));
      i.click();
    });
  }

  /* ================= 上传 ================= */
  async function attach(fid, file, opts) {
    opts = opts || {};
    const p0 = cur(); if (!p0) return;
    const pid = p0.id;
    if (!p0.papers.some(x => x.id === fid)) return;
    if (file.size > 120 * 1024 * 1024) return notice("PDF 超过 120MB，浏览器存不下，请压缩后再上传");
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode.apply(null, head) !== "%PDF-") return notice("这个文件不是有效的 PDF");
    tip("正在读取 PDF…");
    let pages = 0, chars = 0;
    try {
      const lib = await ensurePdfJs();
      const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      pages = doc.numPages;
      for (let i = 1; i <= Math.min(3, pages); i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        chars += tc.items.map(x => x.str).join("").length;
      }
      doc.destroy();
    } catch (e) { return notice("PDF 打不开：" + e.message); }
    try { await putPdf(pid, fid, { blob: file, name: file.name, size: file.size, ts: Date.now() }); }
    catch (e) { return notice("保存 PDF 失败（浏览器存储空间不足？）：" + (e && e.message)); }
    const p = liveProj(pid); const f = p && p.papers.find(x => x.id === fid); if (!f) return;
    const oldPages = f.pdf && f.pdf.pages;
    f.pdf = { name: String(file.name).slice(0, 200), size: file.size, pages: pages, ts: WQCore.stamp(), scanned: chars < 30 };
    trailAdd(p, "importT", opts.replace ? "替换 PDF" : "上传 PDF", f.title.slice(0, 40) + " · " + pages + " 页");
    save(); renderPapers(); renderProcessLog();
    if (chars < 30) notice("PDF 已保存，但前几页没有文字层", ["可能是扫描版：能阅读，但高亮、批注定位和 AI 精读会受限", "如有文字版 PDF，建议替换"]);
    else tip("PDF 已保存到本机 ✓（" + pages + " 页）");
    if (opts.replace && oldPages && oldPages !== pages && (f.annots || []).length) notice("新 PDF 的页数（" + pages + "）和原来（" + oldPages + "）不同，旧批注的位置可能对不上，请核对");
    if (opts.open !== false) openReader(fid);
  }

  /* ================= 阅读器 ================= */
  const R = { pid: null, fid: null, doc: null, scale: 1.25, pages: [], io: null, texts: null, tab: "ann", busy: false, ctl: null, pending: null };
  function curPaper() {
    const p = R.pid ? liveProj(R.pid) : null;
    return p ? p.papers.find(x => x.id === R.fid) || null : null;
  }
  function closeReader() {
    if (R.io) { R.io.disconnect(); R.io = null; }
    if (R.ctl) { try { R.ctl.abort(); } catch (e) {} }
    if (R.doc) { try { R.doc.destroy(); } catch (e) {} R.doc = null; }
    const m = $("ymReader"); if (m) m.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    R.texts = null; R.pages = []; R.pending = null;
    if (R.pid) { try { renderPapers(); } catch (e) {} }
  }
  function onKey(e) {
    if (e.key !== "Escape") return;
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) { t.blur(); return; }
    closeReader();
  }
  async function openReader(fid) {
    const p = cur(); if (!p) return;
    const f = p.papers.find(x => x.id === fid); if (!f) return;
    let rec = null;
    try { rec = await getPdf(p.id, fid); } catch (e) { rec = null; }
    if (!rec || !rec.blob) {
      const act = window.wqChoose
        ? await wqChoose("本机找不到这份 PDF", ["PDF 只存在上传它的浏览器里，备份文件不含 PDF 原文", "批注和 AI 精读结果还在；重新上传同一份 PDF 即可继续"], [{ key: "up", label: "重新上传", primary: true }, { key: "notes", label: "只看批注" }, { key: "x", label: "取消" }])
        : "x";
      if (act === "up") { const file = await pickFile(); if (file) attach(fid, file, { replace: true }); }
      else if (act === "notes") showNotesOnly(fid);
      return;
    }
    let lib;
    try { lib = await ensurePdfJs(); } catch (e) { return notice(e.message); }
    closeReader();
    R.pid = p.id; R.fid = fid; R.tab = "ann";
    R.scale = Math.min(3, Math.max(0.6, parseFloat(localStorage.getItem("ym_pdf_scale")) || 1.25));
    buildShell(f);
    try { R.doc = await lib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()) }).promise; }
    catch (e) { closeReader(); return notice("PDF 打不开：" + e.message); }
    $("ymrInfo").textContent = "共 " + R.doc.numPages + " 页 · " + Math.round((rec.size || 0) / 1024) + " KB";
    await layoutPages();
    renderSide();
  }
  function buildShell(f) {
    const m = document.createElement("div");
    m.id = "ymReader"; m.className = "ymr"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "PDF 阅读器");
    m.innerHTML = `<div class="ymr-top">
        <b class="ymr-title" title="${esc(f.title)}">📖 ${esc(f.title.slice(0, 70))}</b>
        <span class="hint" id="ymrInfo">加载中…</span><span style="flex:1"></span>
        <button class="pillbtn" data-r="zout" title="缩小">−</button><span id="ymrZoom" class="hint"></span><button class="pillbtn" data-r="zin" title="放大">＋</button>
        <button class="pillbtn" data-r="fit">适合宽度</button>
        <button class="pillbtn" data-r="md">⤓ 批注 .md</button>
        <button class="pillbtn" data-r="replace">替换 PDF</button>
        <button class="pillbtn" data-r="del">删除 PDF</button>
        <button class="pillbtn" data-r="close">✕ 关闭（Esc）</button>
      </div>
      <div class="ymr-main">
        <div class="ymr-pages" id="ymrPages"></div>
        <aside class="ymr-side">
          <div class="ymr-tabs"><button data-tab="ann">批注 <span id="ymrAnnN">0</span></button><button data-tab="ai">✨ AI 精读</button><button data-tab="help">说明</button></div>
          <div id="ymrSide" class="ymr-sidebody"></div>
        </aside>
      </div>
      <div class="ymr-bubble" id="ymrBubble" hidden>
        ${Object.keys(COLORS).map(c => `<button data-color="${c}" title="${COLORS[c]}色高亮">${EMOJI[c]}</button>`).join("")}
        <button data-note="1">📝 批注</button>
      </div>`;
    document.body.appendChild(m);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    m.addEventListener("click", onReaderClick);
    m.addEventListener("input", (e) => { const t = e.target.closest("[data-a=note]"); if (t) saveNote(t.closest(".ymr-ann").dataset.aid, t.value); });
    $("ymrPages").addEventListener("mouseup", onMouseUp);
    $("ymrPages").addEventListener("scroll", () => { const b = $("ymrBubble"); if (b) b.hidden = true; });
  }
  async function layoutPages(keepRatio) {
    const box = $("ymrPages"); if (!box || !R.doc) return;
    const ratio = keepRatio && box.scrollHeight ? box.scrollTop / box.scrollHeight : 0;
    box.innerHTML = "";
    R.pages = [];
    const vp1 = (await R.doc.getPage(1)).getViewport({ scale: R.scale });
    for (let i = 1; i <= R.doc.numPages; i++) {
      const wrap = document.createElement("div");
      wrap.className = "ymr-page"; wrap.dataset.page = String(i);
      wrap.style.width = vp1.width + "px"; wrap.style.height = vp1.height + "px";
      wrap.innerHTML = '<div class="ymr-pno">' + i + "</div>";
      box.appendChild(wrap);
      R.pages.push({ wrap: wrap, rendered: false, rendering: false });
    }
    if (R.io) R.io.disconnect();
    R.io = new IntersectionObserver((ents) => ents.forEach(en => { if (en.isIntersecting) renderPage(+en.target.dataset.page); }), { root: box, rootMargin: "900px 0px" });
    R.pages.forEach(pg => R.io.observe(pg.wrap));
    $("ymrZoom").textContent = Math.round(R.scale * 100) + "%";
    if (ratio) box.scrollTop = ratio * box.scrollHeight;
  }
  async function renderPage(n) {
    const st = R.pages[n - 1]; const doc = R.doc;
    if (!st || st.rendered || st.rendering || !doc) return;
    st.rendering = true;
    try {
      const page = await doc.getPage(n);
      if (doc !== R.doc) return;
      const vp = page.getViewport({ scale: R.scale });
      const wrap = st.wrap;
      wrap.style.width = vp.width + "px"; wrap.style.height = vp.height + "px";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
      cv.style.width = vp.width + "px"; cv.style.height = vp.height + "px";
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      if (doc !== R.doc) return;
      const hl = document.createElement("div"); hl.className = "ymr-hl";
      const tl = document.createElement("div"); tl.className = "textLayer";
      tl.style.setProperty("--scale-factor", String(vp.scale));
      const pno = document.createElement("div"); pno.className = "ymr-pno"; pno.textContent = String(n);
      wrap.innerHTML = ""; wrap.appendChild(cv); wrap.appendChild(hl); wrap.appendChild(tl); wrap.appendChild(pno);
      const tc = await page.getTextContent();
      await window.pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
      st.rendered = true;
      paintHighlights(n);
    } catch (e) { console.warn("[研墨] 第 " + n + " 页渲染失败", e); }
    finally { st.rendering = false; }
  }
  function paintHighlights(n) {
    const st = R.pages[n - 1]; if (!st || !st.rendered) return;
    const hl = st.wrap.querySelector(".ymr-hl"); if (!hl) return;
    const f = curPaper();
    const list = ((f && f.annots) || []).filter(a => a.page === n);
    const num = (x) => Math.max(0, Math.min(100, (+x || 0) * 100)).toFixed(3);
    hl.innerHTML = list.map(a => (Array.isArray(a.rects) ? a.rects : []).slice(0, 80).map(r =>
      `<div class="ymr-mark c-${COLORS[a.color] ? a.color : "y"}" data-aid="${esc(a.id)}" style="left:${num(r[0])}%;top:${num(r[1])}%;width:${num(r[2])}%;height:${num(r[3])}%"></div>`).join("")).join("");
  }

  /* ---------- 选中文字 → 高亮 / 批注 ---------- */
  function pageOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest(".ymr-page") : null;
  }
  function onMouseUp() {
    setTimeout(() => {
      const bub = $("ymrBubble"); if (!bub) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { bub.hidden = true; return; }
      const range = sel.getRangeAt(0);
      const pg = pageOf(range.startContainer);
      if (!pg || !$("ymrPages").contains(pg)) { bub.hidden = true; return; }
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2) { bub.hidden = true; return; }
      const rr = range.getBoundingClientRect();
      bub.style.left = Math.min(window.innerWidth - 260, Math.max(8, rr.left + rr.width / 2 - 120)) + "px";
      bub.style.top = Math.max(8, rr.top - 48) + "px";
      bub.hidden = false;
      R.pending = { page: +pg.dataset.page, range: range.cloneRange(), text: text };
    }, 10);
  }
  function mergeRects(rects) {
    rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const out = [];
    rects.forEach(r => {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - r[1]) < 0.004 && Math.abs(last[3] - r[3]) < 0.006 && r[0] <= last[0] + last[2] + 0.012) {
        last[2] = Math.max(last[0] + last[2], r[0] + r[2]) - last[0];
      } else out.push(r.slice());
    });
    return out;
  }
  function createAnnot(color, withNote) {
    const pend = R.pending; if (!pend) return;
    const st = R.pages[pend.page - 1]; if (!st) return;
    const box = st.wrap.getBoundingClientRect();
    const rects = mergeRects(Array.from(pend.range.getClientRects())
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height])
      .filter(r => r[0] > -0.02 && r[1] > -0.02 && r[0] < 1 && r[1] < 1));   // 跨页选择只记起始页
    const p = liveProj(R.pid); const f = p && p.papers.find(x => x.id === R.fid); if (!f) return;
    f.annots = f.annots || [];
    const a = {
      id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      page: pend.page, text: pend.text.slice(0, 2000), note: "", color: COLORS[color] ? color : "y",
      rects: rects.slice(0, 80).map(r => r.map(x => Math.round(x * 10000) / 10000)), ts: WQCore.stamp()
    };
    f.annots.push(a);
    save();
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    $("ymrBubble").hidden = true; R.pending = null;
    paintHighlights(a.page);
    renderSide("ann");
    if (withNote) setTimeout(() => {
      const t = document.querySelector('#ymrSide .ymr-ann[data-aid="' + CSS.escape(a.id) + '"] textarea');
      if (t) { t.scrollIntoView({ block: "center" }); t.focus(); }
    }, 30);
  }
  let noteTimer = null;
  function saveNote(aid, val) {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const f = curPaper(); const a = f && (f.annots || []).find(x => x.id === aid);
      if (!a) return;
      a.note = String(val || "").slice(0, 4000);
      save();
    }, 500);
  }
  async function jumpTo(aid) {
    const f = curPaper(); const a = f && (f.annots || []).find(x => x.id === aid); if (!a) return;
    const st = R.pages[a.page - 1]; if (!st) return;
    const box = $("ymrPages");
    const r0 = (a.rects && a.rects[0]) || [0, 0];
    box.scrollTop = st.wrap.offsetTop + (+r0[1] || 0) * st.wrap.offsetHeight - 120;
    await renderPage(a.page);
    st.wrap.querySelectorAll('.ymr-mark[data-aid="' + CSS.escape(aid) + '"]').forEach(mk => { mk.classList.remove("flash"); void mk.offsetWidth; mk.classList.add("flash"); });
  }

  /* ---------- 侧栏 ---------- */
  function sortedAnnots(f) {
    return ((f && f.annots) || []).slice().sort((a, b) => (a.page - b.page) || (((a.rects || [])[0] || [0, 0])[1] - (((b.rects || [])[0] || [0, 0])[1])));
  }
  function annListHTML(f, readOnly) {
    const list = sortedAnnots(f);
    if (!list.length) return '<p class="hint">选中 PDF 里的文字，在弹出的小工具条上选颜色即可高亮；点「📝 批注」可以顺手写笔记。批注随项目保存、备份，也会出现在 MCP 里。</p>';
    return list.map(a => `<div class="ymr-ann" data-aid="${esc(a.id)}">
        <div class="ymr-annh"><i class="ymr-dot c-${COLORS[a.color] ? a.color : "y"}"></i><b>第 ${+a.page || "?"} 页</b><span class="hint">${esc(a.ts)}</span><span style="flex:1"></span>
          ${readOnly ? "" : '<button class="pillbtn" data-a="go">定位</button>'}<button class="pillbtn" data-a="cite" title="复制“原句”（第N页）[n]">复制引用</button>${readOnly ? "" : '<button class="pillbtn" data-a="del">删</button>'}</div>
        <blockquote>${esc(a.text)}</blockquote>
        ${readOnly ? (a.note ? `<div class="hint">笔记：${esc(a.note)}</div>` : "") : `<textarea data-a="note" rows="2" placeholder="写点笔记（自动保存）">${esc(a.note || "")}</textarea>`}
      </div>`).join("");
  }
  function renderSide(tab) {
    tab = tab || R.tab || "ann"; R.tab = tab;
    document.querySelectorAll("#ymReader .ymr-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    const f = curPaper(); const box = $("ymrSide"); if (!f || !box) return;
    $("ymrAnnN").textContent = String((f.annots || []).length);
    if (tab === "ann") box.innerHTML = annListHTML(f, false);
    else if (tab === "ai") renderAITab(box, f);
    else box.innerHTML = `<div class="hint" style="line-height:1.8">
        <p><b>存在哪：</b>PDF 原文件只存在当前浏览器（IndexedDB），不上传服务器；「备份全部」不含 PDF 原文件，换电脑需重新上传。批注和 AI 精读结果存在项目里，会随备份、同步文件一起保存。</p>
        <p><b>高亮：</b>选中文字 → 选颜色。跨页选中只记录起始页。扫描版 PDF 没有文字层，无法选中。</p>
        <p><b>AI 精读：</b>会把这篇 PDF 的文字发给你在「AI / 接口设置」里配置的模型服务；审稿中、涉密、含个人信息的稿件请勿使用。结果可能出错，引用前回原文核对。</p>
        <p><b>快捷键：</b>Esc 关闭阅读器。</p></div>`;
  }
  function renderAITab(box, f) {
    const r = f.reading;
    box.innerHTML = `<div class="ymr-ai">
        <p class="hint">AI 按页读全文，整理研究问题、数据、方法、发现、局限和可直接引用的原句，<b>每条标注页码</b>。结果存进这篇文献（随项目备份、MCP 可读）。AI 可能读错，引用前请回原文核对。</p>
        <div class="row" style="margin:6px 0;align-items:center">
          <button class="btn2 btn-sm" data-a="ai-run">${r ? "↻ 重新精读" : "✨ 开始 AI 精读"}</button>
          <button class="btn2 btn-sm gray" data-a="ai-stop" hidden>停止</button>
          ${r ? '<button class="btn2 btn-sm ghost" data-a="ai-copy">复制</button>' : ""}
          ${r && !f.abs ? '<button class="btn2 btn-sm ghost" data-a="ai-abs" title="文献库里这篇没有摘要：用精读的概括与发现补上（会标注来源）">补到摘要</button>' : ""}
          <span class="hint" id="ymrAiMsg">${r ? esc("上次：" + r.ts + (r.model ? " · " + r.model : "") + (r.pages ? " · " + r.pages + " 页" : "")) : ""}</span>
        </div>
        <div id="ymrAiOut" class="ymr-aiout mdr">${r ? mdHTML(r.md) : ""}</div></div>`;
  }
  /* 没有 PDF 时也能看批注与精读（换了浏览器的情况） */
  function showNotesOnly(fid) {
    const p = cur(); const f = p && p.papers.find(x => x.id === fid); if (!f) return;
    let m = $("ymNotesBox"); if (m) m.remove();
    m = document.createElement("div"); m.id = "ymNotesBox"; m.className = "ymmodal";
    m.innerHTML = `<div class="ymcard"><div class="ymhead"><b>📝 ${esc(f.title.slice(0, 60))}</b><span style="flex:1"></span>
        <button class="pillbtn" data-n="md">⤓ .md</button><button class="pillbtn" data-n="x">✕</button></div>
      <div class="ymr-sidebody" style="max-height:66vh">${annListHTML(f, true)}${f.reading ? '<h3 style="font-size:14px">✨ AI 精读</h3><div class="mdr">' + mdHTML(f.reading.md) + "</div>" : ""}</div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m || (e.target.closest("[data-n]") || {}).dataset?.n === "x") { m.remove(); return; }
      const n = e.target.closest("[data-n]"); if (n && n.dataset.n === "md") downloadNotes(p, f);
      const c = e.target.closest("[data-a=cite]"); if (c) copyCite(p, f, c.closest(".ymr-ann").dataset.aid);
    });
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(() => tip("已复制 ✓"), () => tip("复制失败"));
    tip("浏览器不允许复制，请手动选择");
  }
  function copyCite(p, f, aid) {
    const a = (f.annots || []).find(x => x.id === aid); if (!a) return;
    const n = p.papers.indexOf(f) + 1;
    copyText("“" + a.text + "”（第 " + a.page + " 页）[" + n + "]");
  }
  function notesMarkdown(p, f) {
    const n = p.papers.indexOf(f) + 1;
    const ref = window.YMBib ? YMBib.gbEntry(YMBib.paperToCSL(f), n) : "[" + n + "] " + f.title;
    let md = "# 批注 · " + f.title + "\n\n> " + ref + "\n> 导出：" + WQCore.stamp() + "（" + ((window.YANMO && YANMO.label) || "研墨") + "）\n\n";
    let page = 0;
    sortedAnnots(f).forEach(a => {
      if (a.page !== page) { page = a.page; md += "\n## 第 " + page + " 页\n\n"; }
      md += "- " + (EMOJI[a.color] || "🟨") + " “" + String(a.text).replace(/\n/g, " ") + "”\n" + (a.note ? "  - 笔记：" + String(a.note).replace(/\n/g, "\n    ") + "\n" : "");
    });
    if (f.reading) md += "\n## AI 精读（" + f.reading.ts + (f.reading.model ? " · " + f.reading.model : "") + "）\n\n" + f.reading.md + "\n";
    return md;
  }
  function downloadNotes(p, f) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([notesMarkdown(p, f)], { type: "text/markdown;charset=utf-8" }));
    a.download = ("批注-" + f.title).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) + ".md";
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    trailAdd(p, "export", "导出批注", f.title.slice(0, 40) + " · " + (f.annots || []).length + " 条"); save();
  }

  async function onReaderClick(e) {
    const t = e.target;
    const tabB = t.closest(".ymr-tabs button");
    if (tabB) { renderSide(tabB.dataset.tab); return; }
    const col = t.closest("#ymrBubble [data-color]");
    if (col) { createAnnot(col.dataset.color, false); return; }
    if (t.closest("#ymrBubble [data-note]")) { createAnnot("y", true); return; }
    const r = t.closest("[data-r]");
    if (r) {
      const act = r.dataset.r;
      if (act === "close") closeReader();
      else if (act === "zin" || act === "zout") {
        R.scale = Math.min(3, Math.max(0.6, Math.round((R.scale + (act === "zin" ? 0.15 : -0.15)) * 100) / 100));
        try { localStorage.setItem("ym_pdf_scale", String(R.scale)); } catch (e2) {}
        layoutPages(true);
      } else if (act === "fit") {
        const box = $("ymrPages"); const vp = (await R.doc.getPage(1)).getViewport({ scale: 1 });
        R.scale = Math.min(3, Math.max(0.6, Math.round(((box.clientWidth - 48) / vp.width) * 100) / 100));
        try { localStorage.setItem("ym_pdf_scale", String(R.scale)); } catch (e2) {}
        layoutPages(true);
      } else if (act === "md") { const p = liveProj(R.pid), f = curPaper(); if (p && f) downloadNotes(p, f); }
      else if (act === "replace") {
        const file = await pickFile(); if (!file) return;
        const fid = R.fid; closeReader(); attach(fid, file, { replace: true });
      } else if (act === "del") {
        const ok = window.wqChoose ? (await wqChoose("删除本机保存的这份 PDF？", ["批注和 AI 精读结果会保留", "之后可以重新上传"], [{ key: "del", label: "删除 PDF" }, { key: "x", label: "取消", primary: true }])) === "del" : confirm("删除这份 PDF？");
        if (!ok) return;
        const pid = R.pid, fid = R.fid; closeReader();
        try { await delPdf(pid, fid); } catch (e2) {}
        const p = liveProj(pid); const f = p && p.papers.find(x => x.id === fid);
        if (f) { delete f.pdf; trailAdd(p, "act", "删除 PDF", f.title.slice(0, 40)); save(); renderPapers(); }
      }
      return;
    }
    const a = t.closest("[data-a]");
    if (!a) return;
    const act = a.dataset.a;
    const item = a.closest(".ymr-ann");
    const p = liveProj(R.pid), f = curPaper(); if (!p || !f) return;
    if (act === "go" && item) jumpTo(item.dataset.aid);
    else if (act === "cite" && item) copyCite(p, f, item.dataset.aid);
    else if (act === "del" && item) {
      const ann = (f.annots || []).find(x => x.id === item.dataset.aid); if (!ann) return;
      f.annots = f.annots.filter(x => x !== ann); save();
      paintHighlights(ann.page); renderSide("ann");
    }
    else if (act === "ai-run") runReading();
    else if (act === "ai-stop") { if (R.ctl) R.ctl.abort(); }
    else if (act === "ai-copy" && f.reading) copyText(f.reading.md);
    else if (act === "ai-abs" && f.reading) {
      const pick = (h) => { const m = f.reading.md.match(new RegExp("##\\s*" + h + "[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)")); return m ? m[1].replace(/[#>*`]/g, "").replace(/\s+/g, " ").trim() : ""; };
      const abs = [pick("一句话概括"), pick("主要发现")].filter(Boolean).join(" ").slice(0, 1150);
      if (!abs) return tip("精读结果里没找到可用的概括");
      f.abs = "〔AI 精读摘录，待核对〕" + abs;
      trailAdd(p, "ai", "精读结果补摘要", f.title.slice(0, 40)); save(); renderPapers(); renderSide("ai");
      tip("已补到摘要（标注了来源），可以生成文献矩阵了");
    }
  }

  /* ---------- AI 精读 ---------- */
  async function pageTexts() {
    if (R.texts) return R.texts;
    const out = [];
    for (let i = 1; i <= R.doc.numPages; i++) {
      const tc = await (await R.doc.getPage(i)).getTextContent();
      out.push(tc.items.map(x => x.str + (x.hasEOL ? "\n" : "")).join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
    }
    R.texts = out;
    return out;
  }
  function chunkPages(texts, max) {
    const out = []; let c = null;
    texts.forEach((t, i) => {
      let block = "[第" + (i + 1) + "页]\n" + t + "\n\n";
      if (block.length > max) block = block.slice(0, max);
      if (c && c.text.length + block.length > max) { out.push(c); c = null; }
      if (!c) c = { from: i + 1, to: i + 1, text: "" };
      c.text += block; c.to = i + 1;
    });
    if (c) out.push(c);
    return out;
  }
  const RULES = "规则：只依据给出的原文；每条结论后用（第N页）标注出处，N 取自原文里的「[第N页]」标记；原文没有的信息写「原文未提及」，不得推测，不得编造数据、样本或文献；用简体中文，专业术语保留英文原文。";
  const HEADS = "## 一句话概括\n## 研究问题与动机\n## 数据与样本\n## 方法 / 识别策略\n## 主要发现（保留关键数字）\n## 局限与作者自述的不足\n## 可直接引用的原句（3-6 句，原文照录并注明页码）\n## 与我的研究的关联";
  async function runReading() {
    if (R.busy) return;
    const p0 = liveProj(R.pid); const f0 = curPaper(); if (!p0 || !f0 || !R.doc) return;
    if (!WQCore.ai.conf().key) return notice("还没有配置 AI Key", ["页头「⚙️ AI / 接口设置」里填好 Key 再用 AI 精读"]);
    const msg = () => $("ymrAiMsg"), out = () => $("ymrAiOut");
    const setMsg = (t) => { const m = msg(); if (m) m.textContent = t; };
    R.busy = true;
    try {
      setMsg("提取全文文字…");
      const texts = await pageTexts();
      const total = texts.reduce((a, t) => a + t.length, 0);
      if (total < 300) throw new Error("没提取到足够的文字（可能是扫描版 PDF）——AI 精读需要文字版 PDF");
      let chunks = chunkPages(texts, 16000), cut = "";
      if (chunks.length > 8) { cut = "（论文较长，只读前 " + chunks[7].to + " 页）"; chunks = chunks.slice(0, 8); }
      const calls = chunks.length === 1 ? 1 : chunks.length + 1;
      const inTok = WQCore.ai.estimateTokens(chunks.map(c => c.text).join("")) + 600 * calls;
      const ok = window.wqConfirmAI ? await wqConfirmAI({
        title: "AI 精读这篇论文？",
        lines: [f0.title.slice(0, 60), texts.length + " 页 · 约 " + Math.round(total / 1000) + "k 字" + cut, "调用 AI " + calls + " 次" + (calls > 1 ? "（分段读，再合成）" : ""), "预估 " + WQCore.ai.estCostText(inTok, 1800 * calls), "全文会发送给你配置的模型服务"],
        okText: "开始精读"
      }) : true;
      if (!ok) { setMsg("已取消"); return; }
      R.ctl = new AbortController();
      const stopB = document.querySelector('#ymrSide [data-a="ai-stop"]'); if (stopB) stopB.hidden = false;
      const runB = document.querySelector('#ymrSide [data-a="ai-run"]'); if (runB) runB.disabled = true;
      const topic = p0.topic || p0.name || "未填写";
      let last = 0;
      const paint = (full) => { const now = Date.now(); if (now - last > 300) { last = now; const o = out(); if (o) { o.classList.add("ymr-stream"); o.textContent = full; o.scrollTop = o.scrollHeight; } } };
      const opt = (max) => ({ max_tokens: max, temperature: 0.2, signal: R.ctl.signal, timeout: 300000 });
      let md;
      if (chunks.length === 1) {
        setMsg("AI 精读中…");
        md = (await WQCore.ai.stream("你是严谨的学术精读助手。请精读下面这篇论文全文，输出 Markdown 精读笔记，结构如下：\n" + HEADS + "（我的研究主题：" + topic + "；无法判断就写「需作者判断」）\n" + RULES + "\n\n【论文】" + f0.title + "\n【原文】\n" + chunks[0].text, opt(4000), (d, full) => paint(full))).text;
      } else {
        const notes = [];
        for (let i = 0; i < chunks.length; i++) {
          setMsg("分段精读 " + (i + 1) + "/" + chunks.length + "（第 " + chunks[i].from + "–" + chunks[i].to + " 页）…");
          notes.push((await WQCore.ai.stream("你是学术精读助手。下面是论文《" + f0.title + "》第 " + chunks[i].from + "–" + chunks[i].to + " 页的原文。只提取这几页里实际出现的：研究问题、数据与样本、方法、关键结果（保留数字）、作者提到的局限、值得引用的原句（照录）。每条后标注（第N页）。" + RULES + "\n\n【原文】\n" + chunks[i].text, opt(2500), (d, full) => paint(full))).text);
        }
        setMsg("合成精读笔记…");
        md = (await WQCore.ai.stream("下面是同一篇论文分段精读得到的要点（每段只覆盖部分页）。请合并成一份完整、去重的 Markdown 精读笔记，结构如下：\n" + HEADS + "（我的研究主题：" + topic + "；无法判断就写「需作者判断」）\n保留每条的页码标注；各段之间有矛盾时如实指出；不要添加分段要点里没有的内容。\n\n【论文】" + f0.title + "\n\n" + notes.map((n, i) => "【第" + (i + 1) + "段要点】\n" + n).join("\n\n"), opt(4000), (d, full) => paint(full))).text;
      }
      const model = WQCore.ai.conf().model || "";
      const p = liveProj(R.pid); const f = p && p.papers.find(x => x.id === R.fid); if (!f) return;
      f.reading = { ts: WQCore.stamp(), model: model, md: md, pages: texts.length };
      addVersion(p, "AI 精读·" + f.title.slice(0, 30), md, "tool");
      trailAdd(p, "ai", "AI 精读", f.title.slice(0, 40) + " · " + texts.length + " 页" + (model ? " · " + model : ""));
      save(); renderProcessLog();
      renderSide("ai");
      tip("AI 精读完成 ✓ 已存入这篇文献");
    } catch (e) {
      setMsg(/已手动停止/.test(e.message) ? "已停止" : "失败：" + e.message);
    } finally {
      R.busy = false; R.ctl = null;
      const stopB = document.querySelector('#ymrSide [data-a="ai-stop"]'); if (stopB) stopB.hidden = true;
      const runB = document.querySelector('#ymrSide [data-a="ai-run"]'); if (runB) runB.disabled = false;
    }
  }

  window.YMPdf = {
    cellHTML: cellHTML, attach: attach, open: openReader, close: closeReader,
    remove: (pid, fid) => delPdf(pid, fid).catch(() => {}),
    removeProject: (pid) => delProject(pid).catch(() => {}),
    get: getPdf, notesMarkdown: notesMarkdown
  };
  /* 首次渲染文献表时本模块可能还没加载：补一次 */
  try { if (typeof renderPapers === "function") renderPapers(); } catch (e) {}
})();

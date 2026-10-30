/* 研墨 · Zotero 互通界面 ym-refs.js（v1.1.0 新增）
 * 阶段② 文献库：导入 BibTeX / RIS / CSL-JSON（Zotero、EndNote、NoteExpress 都能导出这几种）；
 * 导出 BibTeX / RIS / CSL-JSON / GB/T 7714 文本。解析与格式化在 ym-bib.js。
 * 依赖 studio.js 的全局：cur() save() renderPapers() renderProjects() renderStageCards() addVersion() trailAdd() renderProcessLog()
 */
(function () {
  "use strict";
  if (!window.YMBib) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FMT_NAME = { bibtex: "BibTeX", ris: "RIS", csl: "CSL-JSON", unknown: "未知格式" };
  const notice = (t) => (window.wqNotice ? wqNotice(t) : alert(t));
  const tip = (t) => (window.toast ? toast(t) : console.log(t));

  /* 不加 BOM 的下载：.bib/.ris/.json 带 BOM 会让部分工具读不了 */
  function dlRaw(name, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const safeName = (s) => String(s || "文献库").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  function copy(text) {
    const done = () => tip("已复制 ✓");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { tip("复制失败，请手动复制"); }
      ta.remove();
    }
  }

  /* ================= 导出 ================= */
  function exportRefs(fmt) {
    const p = cur(); if (!p) return notice("先新建项目");
    if (!p.papers.length) return notice("文献库是空的，先导入或添加文献");
    if (YMBib.ensureKeys(p.papers)) save();   // 引用键存回文献卡：LaTeX 导出、MCP 用同一套键
    const base = safeName(p.name || p.topic);
    let label = "";
    if (fmt === "bib") { dlRaw(base + ".bib", YMBib.toBibTeX(p.papers), "application/x-bibtex"); label = "BibTeX"; }
    else if (fmt === "ris") { dlRaw(base + ".ris", YMBib.toRIS(p.papers), "application/x-research-info-systems"); label = "RIS"; }
    else if (fmt === "csl") { dlRaw(base + ".json", YMBib.toCSLJSON(p.papers), "application/json"); label = "CSL-JSON"; }
    else if (fmt === "gb") { copy(YMBib.gbList(p.papers).join("\n")); label = "GB/T 7714（复制）"; }
    trailAdd(p, "export", "导出文献库 · " + label, p.papers.length + " 篇");
    save(); renderProcessLog();
  }

  /* ================= 导入弹窗 ================= */
  let state = null;   // { text, fmt, items(papers), plan, errors }
  function modal(open) {
    let m = $("ymRefModal");
    if (!open) { if (m) m.remove(); state = null; return; }
    if (m) m.remove();
    m = document.createElement("div");
    m.id = "ymRefModal"; m.className = "ymmodal";
    m.innerHTML = `<div class="ymcard" role="dialog" aria-label="导入文献">
      <div class="ymhead"><b>📥 导入文献（Zotero / EndNote / NoteExpress）</b><span style="flex:1"></span><button class="pillbtn" data-ym="close">✕</button></div>
      <p class="hint" style="margin:6px 0">支持 <b>BibTeX（.bib）</b>、<b>RIS（.ris）</b>、<b>CSL JSON（.json）</b>。Zotero：选中条目或整个文件夹 → 右键「导出条目…」/「导出文件夹…」→ 选格式。导入只追加到文献库末尾，<b>已有的 [n] 编号不会变</b>。</p>
      <label class="ymdrop" id="ymRefDrop">把文件拖到这里，或 <u>点击选择文件</u><input type="file" id="ymRefFile" accept=".bib,.bibtex,.ris,.json,.txt,.nbib,application/json" hidden></label>
      <textarea id="ymRefText" rows="6" placeholder="也可以直接粘贴 BibTeX / RIS / CSL JSON 文本…"></textarea>
      <label class="hint" style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="checkbox" id="ymRefFill" checked> 重复条目：补全文献库里的空缺字段（作者/年份/出处/DOI/摘要），不覆盖已有内容</label>
      <div class="row" style="margin:4px 0"><button class="btn2" data-ym="parse">解析预览</button><span class="hint" id="ymRefMsg"></span></div>
      <div id="ymRefPrev" class="ymprev"></div>
      <div class="row" style="margin-top:8px;justify-content:flex-end"><button class="btn2 ghost" data-ym="close">取消</button><button class="btn2" data-ym="go" id="ymRefGo" disabled>导入到当前项目</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m) { modal(false); return; }
      const b = e.target.closest("[data-ym]"); if (!b) return;
      if (b.dataset.ym === "close") modal(false);
      else if (b.dataset.ym === "parse") parseNow();
      else if (b.dataset.ym === "go") doImport();
    });
    $("ymRefFile").addEventListener("change", (e) => readFile(e.target.files[0]));
    const dz = $("ymRefDrop");
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); readFile(e.dataTransfer.files[0]); });
    $("ymRefText").addEventListener("input", () => { $("ymRefGo").disabled = true; $("ymRefPrev").innerHTML = ""; });
    setTimeout(() => $("ymRefText").focus(), 0);
  }
  async function readFile(f) {
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { $("ymRefMsg").textContent = "文件超过 30MB，请分批导出（按文件夹）"; return; }
    $("ymRefMsg").textContent = "读取 " + f.name + " …";
    $("ymRefText").value = await f.text();
    parseNow(f.name);
  }
  async function parseNow(fileName) {
    const p = cur(); if (!p) { notice("先新建项目"); return; }
    const text = $("ymRefText").value.trim();
    if (!text) { $("ymRefMsg").textContent = "先选择文件或粘贴文本"; return; }
    let r = YMBib.parse(text, { Cite: window.CiteJS && CiteJS.Cite });
    if (!r.items.length && (r.format === "bibtex" || r.format === "ris") && !window.CiteJS && window.wqEnsureCiteJS) {
      $("ymRefMsg").textContent = "内置解析没读出条目，加载 citation.js 再试…";
      try { await wqEnsureCiteJS(); r = YMBib.parse(text, { Cite: window.CiteJS && CiteJS.Cite }); } catch (e) { r.errors.push(e.message); }
    }
    const stamp = Date.now().toString(36);
    const items = r.items.map((c, i) => { const f = YMBib.cslToPaper(c, r.format); f.id = "f" + stamp + "_" + i; return f; });
    const plan = YMBib.planImport(p.papers, items);
    state = { fmt: r.format, items, plan, errors: r.errors, fileName: fileName || "" };
    const fillN = plan.dup.filter(d => d.existing && d.fill.length).length;
    $("ymRefMsg").textContent = "识别为 " + FMT_NAME[r.format] + "：共 " + items.length + " 条 → 新增 " + plan.add.length + " · 重复 " + plan.dup.length + (fillN ? "（其中 " + fillN + " 条可补全空缺）" : "") + (r.errors.length ? " · 提示：" + r.errors.join("；") : "");
    const rows = plan.add.slice(0, 40).map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.title.slice(0, 80))}</td><td>${esc(f.author)}</td><td>${esc(f.year)}</td><td>${esc(f.venue.slice(0, 40))}</td><td>${f.doi ? "✓" : ""}</td></tr>`).join("");
    const dupRows = plan.dup.slice(0, 10).map(d => `<li>${esc(d.item.title.slice(0, 70))}${d.existing && d.fill.length ? ` <span class="badge b-ok">可补：${esc(d.fill.join("/"))}</span>` : ' <span class="hint">已存在</span>'}</li>`).join("");
    $("ymRefPrev").innerHTML = (plan.add.length ? `<table class="tb"><tr><th>#</th><th>题名</th><th>作者</th><th>年</th><th>出处</th><th>DOI</th></tr>${rows}</table>${plan.add.length > 40 ? `<p class="hint">…其余 ${plan.add.length - 40} 条未显示</p>` : ""}` : "")
      + (plan.dup.length ? `<details class="fold" style="margin-top:6px"><summary>重复条目 ${plan.dup.length} 条（按 DOI / 题名判断）</summary><ul class="hint">${dupRows}</ul></details>` : "");
    $("ymRefGo").disabled = !(plan.add.length || fillN);
    $("ymRefGo").textContent = plan.add.length ? "导入 " + plan.add.length + " 篇到当前项目" : "补全 " + fillN + " 条空缺字段";
  }
  function doImport() {
    const p = cur(); if (!p || !state) return;
    const plan = YMBib.planImport(p.papers, state.items);   // 以当前文献库为准重算一次（预览后可能有变化）
    const fill = $("ymRefFill").checked;
    let filled = 0;
    if (fill) plan.dup.forEach(d => { if (d.existing && YMBib.fillMissing(d.existing, d.item).length) filled++; });
    plan.add.forEach(f => p.papers.push(f));
    YMBib.ensureKeys(p.papers);
    if (p.papers.length > 3000) tip("文献库已超过 3000 篇，浏览器存储可能吃紧，建议定期备份");
    const label = FMT_NAME[state.fmt] || "文件";
    if (plan.add.length) addVersion(p, "文献导入·" + label + "（" + plan.add.length + " 篇）", plan.add.map(f => "[" + (p.papers.indexOf(f) + 1) + "] " + f.title).join("\n"), "tool");
    trailAdd(p, "importT", "导入文献 · " + label, (state.fileName ? state.fileName + " · " : "") + "新增 " + plan.add.length + " 篇" + (filled ? "，补全 " + filled + " 条" : "") + (plan.dup.length - filled > 0 ? "，跳过重复 " + (plan.dup.length - filled) + " 条" : ""));
    save(); renderPapers(); renderProjects(); renderStageCards(); renderProcessLog();
    modal(false);
    notice("导入完成：新增 " + plan.add.length + " 篇" + (filled ? "，补全 " + filled + " 条已有文献的空缺字段" : "") + "。带 DOI 的条目可继续用【补摘要】；需要全文可在「全文」列上传 PDF。");
  }

  /* ================= 挂到阶段② ================= */
  (function mount() {
    const anchor = $("btnImportBasket");
    if (!anchor || $("ymRefBar")) return;
    const bar = document.createElement("div");
    bar.id = "ymRefBar"; bar.className = "row";
    bar.style.marginTop = "0";
    bar.innerHTML = `<button class="btn2" id="ymRefImport">📥 导入 Zotero / BibTeX / RIS</button>
      <span class="hint" style="margin-left:4px">导出：</span>
      <button class="btn2 ghost btn-sm" data-ymexp="bib" title="LaTeX / Overleaf / Zotero 都能用">BibTeX</button>
      <button class="btn2 ghost btn-sm" data-ymexp="ris" title="EndNote / NoteExpress / Zotero">RIS</button>
      <button class="btn2 ghost btn-sm" data-ymexp="csl" title="Zotero / Pandoc">CSL-JSON</button>
      <button class="btn2 ghost btn-sm" data-ymexp="gb" title="复制 GB/T 7714 参考文献表">📋 GB/T 7714</button>`;
    anchor.closest(".row").before(bar);
    $("ymRefImport").addEventListener("click", () => modal(true));
    bar.querySelectorAll("[data-ymexp]").forEach(b => b.addEventListener("click", () => exportRefs(b.dataset.ymexp)));
  })();

  window.YMRefs = { open: () => modal(true), exportRefs: exportRefs };
})();

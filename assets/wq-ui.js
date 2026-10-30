/* 研墨 · 工作台集成 wq-ui.js
 * v1.0（2026-10-16）：在 studio.html 上挂载生成之后的环节——
 *   ① 修改工作台：参考稿 ↔ 我的稿 双栏，逐段 采用/改写/追问依据，diff、归属账本、本人贡献度
 *   ② 校验中心：引用存在性（Crossref，免费）/ 引用-论断抽查 / 数字来源绑定 / 格式规范 / 回测对比
 *   ③ 数据卡：来源·变量·处理步骤 → AI 生成分析代码与复现清单
 *   ④ 导出增强：排版预设 + 《AI 使用说明》（按归属账本生成）
 *   ⑤ 启动自愈：IndexedDB 镜像恢复（配合 wq-core.js / studio.js 的 save 镜像）
 * 依赖：studio.js 的全局（DB/save/cur/…）与 wq-core.js（WQCore/WQStore）。app.js 之后加载。
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const has = (id) => !!$(id);

  /* ================= 0) 启动自愈：IndexedDB → localStorage ================= */
  (async function bootHydrate() {
    if (!window.WQStore) return;
    try {
      const r = await WQStore.hydrate();
      if (r && r.adopted) {
        DB = WQCore.loadLocal();
        renderProjects(); renderAll();
        toast("已从 IndexedDB 恢复 " + r.projects + " 个项目（本机数据自愈完成）");
      }
    } catch (e) { /* 静默：IDB 不可用不影响主流程 */ }
  })();

  /* ================= 公共小件 ================= */
  /* v1.1.0：富文本只保留排版标签——导入的备份、粘贴进来的内容里可能夹带脚本或事件属性 */
  const RICH_FORBID = ["style", "form", "input", "button", "textarea", "select", "option", "iframe", "frame", "object", "embed", "svg", "math", "link", "meta", "base"];
  function sanitizeRich(html) {
    const s = String(html || "");
    if (!s) return "";
    if (window.DOMPurify) return DOMPurify.sanitize(s, { FORBID_TAGS: RICH_FORBID, FORBID_ATTR: ["srcset", "action", "formaction"] });
    return plainToRich(htmlToPlain(s));   // 没有 DOMPurify 时退化为纯文本段落
  }
  /* 排版模板 CSS 只允许普通样式声明：去掉能跳出 <style> 的字符、外部引用与脚本 */
  function cleanCss(css) {
    return String(css || "")
      .replace(/<\/?\s*style/gi, "").replace(/[<>]/g, "")
      .replace(/@import[^;]*;?/gi, "").replace(/expression\s*\(/gi, "(")
      .replace(/javascript\s*:/gi, "").replace(/url\s*\(/gi, "(")
      .slice(0, 8000);
  }
  function P() { try { return cur(); } catch (e) { return null; } }
  function plainLen(s) { return String(s || "").replace(/\s+/g, "").length; }
  function mdInline(t) { return esc(t).replace(/\n/g, "<br>"); }
  function refSections(p) {
    const r = p && p.ref;
    if (!r || !r.sections) return [];
    const order = (r.order && r.order.length ? r.order : Object.keys(r.sections));
    return order.filter(n => r.sections[n] && r.sections[n].text);
  }
  function styleBlock() {
    let s = {}; try { s = JSON.parse(localStorage.getItem("wenqu_style") || "{}"); } catch (e) {}
    const parts = [s.profileText, s.prefs].filter(Boolean);
    return parts.length ? "\n\n【作者写作档案——改写必须贴近此档案（这是把文字改成作者的表达，不是规避检测）】\n" + parts.join("\n") : "";
  }

  /* ================================================================
   * ① 修改工作台
   * ================================================================ */
  const wbState = { pid: null, sec: null };

  function renderWorkbench() {
    if (!has("wbMain")) return;
    const p = P();
    const secs = refSections(p);
    const mineSecs = p ? Object.keys(p.draft || {}) : [];
    if (!secs.length && !mineSecs.length) { $("wbNoRef").hidden = false; $("wbMain").hidden = true; return; }
    $("wbNoRef").hidden = true; $("wbMain").hidden = false;
    const all = [...new Set(secs.concat(mineSecs))];
    const sel = $("wbSec");
    const prev = wbState.sec;
    const listKey = all.join("|");
    const changed = wbState.pid !== (p && p.id) || wbState.listKey !== listKey;
    sel.innerHTML = all.map(s => `<option value="${esc(s)}">${esc(s)}${secs.includes(s) ? "" : "（自起稿）"}</option>`).join("");
    sel.value = all.includes(prev) ? prev : all[0];
    wbState.pid = p ? p.id : null; wbState.listKey = listKey; wbState.sec = sel.value;
    renderWbPanes(changed);   /* 项目/节集合变了才强刷输入框，否则不碰用户正在编辑的内容 */
  }

  function renderWbPanes(forceMine) {
    const p = P(); if (!p) return;
    const sec = $("wbSec").value; if (!sec) return;
    wbState.sec = sec;
    const refEnt = (p.ref && p.ref.sections && p.ref.sections[sec]) || null;
    const refText = refEnt ? refEnt.text : "";
    $("wbRefMeta").textContent = refEnt && refEnt.refs && refEnt.refs.length ? " · 本节建议引用 [" + refEnt.refs.join("][") + "]" : "";
    const paras = String(refText).split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
    $("wbRefPane").innerHTML = paras.length
      ? paras.map((t, i) => `<div class="wbpara" data-pi="${i}">${mdInline(t)}
          <div class="pb">
            <button class="pillbtn" data-adopt="${i}">✅ 采用</button>
            <button class="pillbtn" data-rewrite="${i}">✒️ 改写后采用</button>
            <button class="pillbtn" data-why="${i}">💬 追问依据</button>
          </div></div>`).join("")
      : '<p class="hint">本节没有参考稿（可能是自起稿节）——直接在右侧写。</p>';
    bindRefButtons(sec, paras);
    citeEnhance($("wbRefPane"));   /* v1.0.5（QA二轮 P1-2）：修改过程中 [n] 也可点击跳文末明细 */
    const mineBox = $("wbMine");
    const saved = (p.draft || {})[sec] || "";
    if (forceMine || document.activeElement !== mineBox || mineBox.value === (wbState.lastSaved || "")) mineBox.value = saved;
    wbState.lastSaved = saved;
    /* v1.0.6：富文本容器内容与当前节同步（切项目/切节/恢复） */
    if (typeof editorRich === "function" && editorRich()) {
      const sr = (p.draftRich || {})[sec];
      editorRich().innerHTML = (sr && sanitizeRich(sr)) || plainToRich(saved);
    }
    renderContrib();
    renderWbDiff(sec, refText, mineBox.value);
  }

  function bindRefButtons(sec, paras) {
    $("wbRefPane").querySelectorAll("[data-adopt]").forEach(b => b.addEventListener("click", () => {
      const para = paras[+b.dataset.adopt]; if (!para) return;
      const p = P(); if (!p) return;
      setMineText(para, true);   /* v1.0.7：富文本/纯文本统一写入 */
      logLedger(p, sec, "adopt", para.length);
      saveDraft(sec, true);
    }));
    $("wbRefPane").querySelectorAll("[data-rewrite]").forEach(b => b.addEventListener("click", () => withBusy(b, async () => {
      const p0 = P(); const para = paras[+b.dataset.rewrite]; if (!p0 || !para) return;
      const pid = p0.id;
      if (!(await askAI("改写这段并采用？（按你的写作档案改成你的表达）", ["调用 AI 1 次，改写结果直接进入「我的稿」"], "改写并采用"))) return;
      $("wbProg").textContent = "改写中…";
      try {
        /* v1.1.0：修正参数（原来把 3000 当成 opts 传，温度与上限都没生效） */
        const r = await WQCore.ai.stream(
          "把下面这段学术文字改写成作者自己的表达：保持论点、引用编号[n]与术语不变；按写作档案调整句式、衔接与用词；不增删事实；不做规避检测处理，只做语言层面的重写。\n" + styleBlock() + "\n\n【原文】\n" + para, { max_tokens: 3000, temperature: 0.4 });
        if (!liveProj(pid)) return;
        const here = applyAIToSection(pid, sec, r.text, "append", "rewrite", para.length);   /* 富文本/纯文本统一写入；已切节则写回原节 */
        $("wbProg").textContent = (here ? "✓ 已改写并采用（" : "✓ 已改写并写入「" + sec + "」（") + r.usage.inTok + "+" + r.usage.outTok + " tok）";
      } catch (e) { $("wbProg").textContent = "失败：" + e.message; }
    })));
    $("wbRefPane").querySelectorAll("[data-why]").forEach(b => b.addEventListener("click", () => withBusy(b, async () => {
      const p0 = P(); const para = paras[+b.dataset.why]; if (!p0 || !para) return;
      const pid = p0.id;
      if (!(await askAI("核对本段论断的文献依据？", ["调用 AI 1 次：逐条判断引用编号是否支撑该段论断"], "开始核对"))) return;
      $("wbProg").textContent = "核对依据中…";
      try {
        const refEnt = (p0.ref && p0.ref.sections && p0.ref.sections[sec]) || {};
        const secRefs = (refEnt.refs || []).map(n => p0.papers[n - 1]).filter(Boolean).slice(0, 8);
        const r = await WQCore.ai.call(
          "你是引用核查助手。下面一段文字带引用编号[n]，文献清单附后。逐条判断：每个被引编号是否真实支撑对应论断？输出：每行「[n] 支持/部分支持/不支持/清单外编号 —— 一句话理由」。最后给一行总评。禁止编造。\n\n【段落】\n" + para + "\n\n【文献清单】\n" +
          secRefs.map(f => "[" + (p0.papers.indexOf(f) + 1) + "] " + f.title + " — " + (f.abs || "（无摘要）").slice(0, 260)).join("\n"), 2000, { temperature: 0.1 });
        const out = $("wOut"); out.hidden = false; setMD(out, r);
        out.scrollIntoView({ behavior: "smooth", block: "start" });
        $("wbProg").textContent = "✓ 核对完成（结果在上方写作区）";
        const p = liveProj(pid); if (p) { trailAdd(p, "ai", "追问依据·" + sec, String(para).slice(0, 60)); save(); }
      } catch (e) { $("wbProg").textContent = "失败：" + e.message; }
    })));
  }

  function logLedger(p, sec, action, chars) {
    p.ledger = p.ledger || {};
    p.ledger[sec] = p.ledger[sec] || [];
    p.ledger[sec].unshift({ ts: WQCore.stamp(), action, chars: chars || 0 });
    if (p.ledger[sec].length > 100) p.ledger[sec].length = 100;
  }

  /* v1.1.0：AI 结果回来时用户可能已切到别的节或项目——结果写回发起时的那一节，
     不动编辑器里正在显示的内容（原来会把 A 节的改写写进 B 节，再存到 A 节名下）。
     返回 true 表示结果已进入当前编辑器。 */
  function applyAIToSection(pid, sec, text, mode, action, chars) {
    const p = liveProj(pid); if (!p || !text) return false;
    const sameView = wbState.pid === pid && has("wbSec") && $("wbSec").value === sec;
    if (sameView) {
      setMineText(text, mode === "append");
      logLedger(p, sec, action, chars);
      saveDraft(sec, true);
      return true;
    }
    p.draft = p.draft || {};
    const old = p.draft[sec] || "";
    const next = (mode === "append" && old.trim()) ? old.replace(/\s+$/, "") + "\n\n" + text : text;
    if (old.trim()) addVersion(p, "改写前自动存档·" + sec, old, "draft:" + sec);
    p.draft[sec] = next;
    if (p.draftRich) delete p.draftRich[sec];
    logLedger(p, sec, action, chars);
    addVersion(p, "我的稿·" + sec, next, "draft:" + sec);
    trailAdd(p, "ai", "AI 改写写回·" + sec, "发起后切换了章节，结果写回原节");
    save(); renderProjects();
    toast("改写结果已写入「" + sec + "」——你已切到别的节，当前编辑器没有改动");
    return false;
  }
  /* 当前编辑器里的正文（富文本模式取派生纯文本） */
  function currentMine() {
    try { return editorPlainValue().plain; } catch (e) { return has("wbMine") ? $("wbMine").value : ""; }
  }

  /* v1.0.7（QA三轮 P0-1）：正文统一写入口——富文本/纯文本双模式都正确落位 */
  function setMineText(text, append) {
    const t = String(text || "");
    if (!t) return;
    if (editorIsRich()) {
      const box = editorRich();
      if (!box) return;
      box.innerHTML = (append && box.innerHTML.trim()) ? (box.innerHTML + plainToRich(t)) : plainToRich(t);
      box.scrollTop = box.scrollHeight;
    } else {
      const ta = $("wbMine");
      if (!ta) return;
      ta.value = (append && ta.value.trim()) ? (ta.value.replace(/\s+$/, "") + "\n\n" + t) : t;
      ta.scrollTop = ta.scrollHeight;
    }
  }

  function saveDraft(sec, silent) {
    const p = P(); if (!p) return;
    p.draft = p.draft || {};
    const v = $("wbMine").value;
    if ((p.draft[sec] || "") === v) { if (!silent) toast("内容未变化"); return; }
    p.draft[sec] = v;
    save();
    if (v.length > 120) { addVersion(p, "我的稿·" + sec, v, "draft:" + sec); save(); }
    trailAdd(p, "act", "保存我的稿·" + sec, plainLen(v) + " 字");
    save(); renderProjects(); renderWbPanes(false);
    if (!silent) toast("已保存 ✓（归属账本已更新）");
  }

  function renderContrib() {
    const p = P(); if (!p || !has("wbContrib")) return;
    $("wbContrib").innerHTML = WQCore.ledger.contributionHTML(p);
  }

  function renderWbDiff(sec, refText, mineText) {
    if (!has("wbDiff")) return;
    if (!refText || !mineText) { $("wbDiff").innerHTML = '<p class="hint">' + (refText ? "右侧还没有内容：先「采用」或自己写。" : "本节没有参考稿可对比。") + "</p>"; return; }
    const rows = WQCore.diff.paras(refText, mineText);
    const badge = { same: '<span class="badge b-ok">未改</span>', mod: '<span class="badge">已改 ' + '' + "</span>", add: '<span style="color:#0a7a43">➕ 我的新段</span>', del: '<span style="color:#b42318">➖ 未采用</span>' };
    citeEnhanceLater($("wbDiff"));
    $("wbDiff").innerHTML = rows.map(r => {
      if (r.type === "same") return '<div class="ckitem">' + badge.same + " " + mdInline(r.mine.slice(0, 160)) + (r.mine.length > 160 ? "…" : "") + "</div>";
      if (r.type === "mod") return '<div class="ckitem">' + badge.mod.replace("已改 ", "已改 " + Math.round((1 - r.sim) * 100) + "% ") + WQCore.diff.charsHTML(r.ai, r.mine) + "</div>";
      if (r.type === "add") return '<div class="ckitem">' + badge.add + mdInline(r.mine.slice(0, 220)) + "</div>";
      return '<div class="ckitem">' + badge.del + '<del style="color:#b42318">' + mdInline(r.ai.slice(0, 220)) + "</del></div>";
    }).join("");
  }

  (function bindWorkbench() {
    if (!has("wbSec")) return;
    $("wbSec").addEventListener("change", async () => {
      /* v1.0.1（QA P1-4）：有未保存修改时先询问，不再静默覆盖；v1.1.0：富文本模式也检查（原来只看隐藏的文本框） */
      const prevSec = wbState.sec, mine = currentMine();
      const p = P();
      const saved = (p && p.draft && p.draft[prevSec]) || "";
      if (prevSec && mine.trim() && mine !== saved) {
        let act = "save";
        if (window.wqChoose) {
          act = await window.wqChoose("「" + prevSec + "」有未保存的修改", ["切换前如何处理这份修改？"], [
            { label: "💾 保存并切换", key: "save", primary: true }, { label: "丢弃修改", key: "discard" }, { label: "留在本节", key: "stay" }]);
        } else { act = confirm("保存修改并切换？（取消=留在本节）") ? "save" : "stay"; }
        if (act === "stay") { const sel = $("wbSec"); sel.value = prevSec; return; }
        if (act === "save") { saveDraft(prevSec, true); }
      }
      renderWbPanes(true);
    });
    $("wbSaveDraft").addEventListener("click", () => saveDraft($("wbSec").value));
    $("wbMine").addEventListener("input", () => { /* 输入中不重渲染，防打断 */ });
    $("wbRecalc").addEventListener("click", () => { renderContrib(); toast("归属账本已重算"); });
    $("wbLedgerDl").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const r = WQCore.ledger.analyzeProject(p);
      const pct = v => Math.round(v * 100) + "%";
      const lines = ["# 归属报告 — " + (p.topic || p.name), "", "> 生成于 " + WQCore.stamp() + " · 口径：按字符数；「混合段」按相似度折算，项目级混合折半。", ""];
      lines.push("**项目本人贡献度：" + pct(r.contribution) + "**（亲笔 " + pct(r.total.total ? r.total.userChars / r.total.total : 0) + " · 混合改写 " + pct(r.total.total ? r.total.mixedChars / r.total.total : 0) + " · 参考原样 " + pct(r.total.total ? r.total.aiChars / r.total.total : 0) + "，共 " + r.total.total.toLocaleString() + " 字）", "");
      Object.keys(r.bySec).forEach(sec => {
        const a = r.bySec[sec];
        lines.push("## " + sec, "", "- 本人贡献度：" + pct(a.contribution) + "（亲笔 " + a.userChars + " 字 / 混合 " + a.mixedChars + " 字 / 参考原样 " + a.aiChars + " 字）");
        const acts = (p.ledger && p.ledger[sec]) || [];
        if (acts.length) lines.push("- 操作记录：" + acts.slice(0, 20).map(x => x.ts + " " + x.action + "(" + x.chars + "字)").join("；"));
        lines.push("");
      });
      lines.push("## 各段明细", "");
      Object.keys(r.bySec).forEach(sec => {
        lines.push("### " + sec);
        r.bySec[sec].rows.forEach((row, i) => {
          lines.push("- 段" + (i + 1) + " [" + ({ ai_ref: "参考原样", mixed: "混合", user: "亲笔" }[row.origin]) + " " + Math.round(row.sim * 100) + "%] " + row.text.slice(0, 60).replace(/\n/g, " ") + "…");
        });
        lines.push("");
      });
      dlText("归属报告-" + String(p.name || "项目").replace(/[\\/:*?"<>|]/g, "_") + ".md", lines.join("\n"), "text/markdown");
      trailAdd(p, "export", "导出归属报告", Object.keys(r.bySec).length + " 节 · 贡献度 " + pct(r.contribution));
      save(); renderProcessLog();
    });
    $("wbRewrite").addEventListener("click", () => withBusy($("wbRewrite"), async () => {
      const p0 = P(); const sec = $("wbSec").value; if (!p0) return toast("先新建项目");
      const mine = currentMine().trim();
      if (!mine) return toast("先在右侧写入内容（采用或自写），再整节改写");
      const pid = p0.id;
      if (!(await askAI("整节改写为你的表达？", ["「" + sec + "」全文将按写作档案重写（调用 AI 1 次）", "改写后原稿仍可在版本档案找回"], "开始改写"))) return;
      $("wbProg").textContent = "整节改写中…";
      try {
        const r = await WQCore.ai.stream(
          "把下面这一节学术论文文字改写成作者自己的表达：保持论点结构、引用编号[n]、术语与数据不变；按写作档案调整句式、衔接与用词；分段保持清晰；只做语言层面重写，不做规避检测处理。" + styleBlock() + "\n\n【本节原文】\n" + mine, { max_tokens: 6000, temperature: 0.4 });
        if (!liveProj(pid)) return;
        const here = applyAIToSection(pid, sec, r.text, "replace", "rewrite_full", plainLen(mine));
        $("wbProg").textContent = here ? "✓ 已改写保存" : "✓ 已改写并写回「" + sec + "」";
      } catch (e) { $("wbProg").textContent = "失败：" + e.message; }
    }));
    $("wbAsk").addEventListener("click", () => {
      toast("请点左侧段落下的「💬 追问依据」按钮（按段核对更准）");
    });
  })();

  /* ================================================================
   * ② 校验中心
   * ================================================================ */
  function pushCheck(p, kind, label, items, stats) {
    p.checks = p.checks || [];
    p.checks.unshift({ ts: WQCore.stamp(), kind, label, items: (items || []).slice(0, 80), stats: stats || {} });
    if (p.checks.length > 60) p.checks.length = 60;
    save();
  }
  function renderChecks() {
    if (!has("ckOut")) return;
    const p = P();
    const list = (p && p.checks) || [];
    $("ckOut").innerHTML = list.length ? list.slice(0, 12).map((c, i) =>
      '<div class="ckitem"><b>' + esc(c.label) + "</b> · " + esc(c.ts) + " · " +
      (c.stats && c.stats.problem != null ? '<b style="color:' + (c.stats.problem ? "var(--bad)" : "var(--ok)") + '">' + (c.stats.problem ? c.stats.problem + " 项待处理" : "通过") + "</b>" : "") +
      ' <button class="pillbtn" data-ck="' + i + '">展开</button><div class="ckdetail" hidden>' +
      (c.items || []).map(x => "<div>· " + esc(typeof x === "string" ? x : JSON.stringify(x)) + "</div>").join("") + "</div></div>").join("")
      : '<p class="hint">还没有校验记录。建议顺序：①引用存在性 → ②论断抽查 → ③数字绑定 → ④格式规范；改稿后点「回测」看新旧对比。</p>';
    $("ckOut").querySelectorAll("[data-ck]").forEach(b => b.addEventListener("click", () => {
      const d = b.parentElement.querySelector(".ckdetail");
      if (d) d.hidden = !d.hidden;
    }));
  }

  (function bindChecks() {
    if (!has("ckRefs")) return;
    /* ① 引用存在性：Crossref 免费核验（有 DOI 验真；无 DOI 补匹配并给匹配度） */
    $("ckRefs").addEventListener("click", () => withBusy($("ckRefs"), async () => {
      const p0 = P(); if (!p0) return toast("先新建项目");
      const pid = p0.id;
      if (!p0.papers.length) { $("ckProg").textContent = "文献库为空"; return; }
      $("ckProg").textContent = "Crossref 逐条核验中（每条约 0.4 秒）…";
      const items = []; let okN = 0;
      for (let i = 0; i < p0.papers.length; i++) {
        const p = liveProj(pid); if (!p) return;
        const f = p.papers[i];
        $("ckProg").textContent = `核验中 ${i + 1}/${p.papers.length}：${f.title.slice(0, 24)}…`;
        try {
          if (f.doi) {
            const cr = await fetchJSON("https://api.crossref.org/works/" + encodeURIComponent(f.doi)).catch(() => null);
            if (cr && cr.message) {
              const t = (Array.isArray(cr.message.title) ? cr.message.title[0] : cr.message.title) || "";
              const score = WQCore.diff.sim(t, f.title);
              f.verify = { ok: score >= 0.6, score: Math.round(score * 100) / 100, ts: WQCore.stamp() };
              if (f.verify.ok) okN++; else items.push("[" + (i + 1) + "] DOI 存在但题名匹配度仅 " + f.verify.score + "（" + f.title.slice(0, 40) + "）——人工核对是否配错");
            } else {
              f.verify = { ok: false, score: 0, ts: WQCore.stamp() };
              items.push("[" + (i + 1) + "] DOI 无法在 Crossref 解析：" + f.doi + "（" + f.title.slice(0, 40) + "）");
            }
          } else {
            const q = await fetchJSON("https://api.crossref.org/works?query.bibliographic=" + encodeURIComponent(f.title.slice(0, 120)) + "&rows=1").catch(() => null);
            const it = q && q.message && q.message.items && q.message.items[0];
            const t = it ? ((Array.isArray(it.title) ? it.title[0] : it.title) || "") : "";
            const score = t ? WQCore.diff.sim(t, f.title) : 0;
            const doiS = it && it.DOI || "";
            f.verify = { ok: score >= 0.75, score: Math.round(score * 100) / 100, doiSuggest: doiS, ts: WQCore.stamp() };
            if (f.verify.ok) { okN++; if (doiS && !f.doi) items.push("[" + (i + 1) + "] 匹配到 DOI " + doiS + "（匹配度 " + f.verify.score + "）→ 可在文献库采纳"); }
            else items.push("[" + (i + 1) + "] 无 DOI 且匹配度低（" + f.verify.score + "）：" + f.title.slice(0, 44) + " —— 中文库/学位论文常见，人工确认");
          }
        } catch (e) { items.push("[" + (i + 1) + "] 核验请求失败：" + e.message); }
        await sleep(400);
      }
      const p = liveProj(pid); if (!p) return;
      save(); renderPapers();
      const problem = p.papers.length - okN;
      pushCheck(p, "refs", "引用存在性核验", items, { problem, total: p.papers.length, ok: okN });
      $("ckProg").textContent = "完成 ✓ " + okN + "/" + p.papers.length + " 条可确认存在";
      renderChecks();
    }));
    /* ② 引用-论断对应抽查（AI） */
    $("ckClaims").addEventListener("click", () => withBusy($("ckClaims"), async () => {
      const p0 = P(); if (!p0) return toast("先新建项目");
      const pid = p0.id;
      /* 抽样：各节带 [n] 的段落，最多 12 段 */
      const samples = [];
      const secs = Object.keys(p0.draft || {});
      for (const s of secs) {
        (p0.draft[s] || "").split(/\n{1,}/).forEach(line => {
          if (/\[\d+\]/.test(line) && line.length > 40 && samples.length < 12) samples.push({ sec: s, line: line.trim().slice(0, 260) });
        });
        if (samples.length >= 12) break;
      }
      if (!samples.length) { $("ckProg").textContent = "草稿里没有带 [n] 的段落（先写作或采用参考稿）"; return; }
      if (!(await askAI("抽查引用-论断对应？", [samples.length + " 个带引用的句子（调用 AI 1 次）", "结果存入校验记录，可回测对比"], "开始抽查"))) return;
      $("ckProg").textContent = "AI 抽查中…";
      try {
        const r = await WQCore.ai.call(
          "你是引用核查员。下面每个句子带 [n] 引用编号，文献清单附后。逐句判断引用是否支撑论断，只输出 JSON 数组：[{\"i\":句序号,\"n\":[涉及编号],\"v\":\"支持|部分支持|不支持|清单外\",\"note\":\"≤25字\"}]。禁止编造。\n\n【句子】\n" +
          samples.map((s0, i) => (i + 1) + ". " + s0.line).join("\n") + "\n\n【文献】\n" +
          p0.papers.map((f, i) => "[" + (i + 1) + "] " + f.title + " — " + (f.abs || "").slice(0, 200)).join("\n").slice(0, 4000), 3000, { temperature: 0.1 });
        let arr = []; try { arr = JSON.parse(String(r).replace(/```(?:json)?/g, "").replace(/^\s*[^\[]*/, "").replace(/\][^\]]*$/, "]")); } catch (e) {
          const m0 = String(r).match(/\[[\s\S]*\]/); if (m0) { try { arr = JSON.parse(m0[0]); } catch (e2) {} }
        }
        const items = arr.map(x => "句" + x.i + " [" + (Array.isArray(x.n) ? x.n.join(",") : x.n) + "] " + x.v + " —— " + (x.note || ""));
        const problem = arr.filter(x => x.v && x.v !== "支持").length;
        pushCheck(liveProj(pid) || p0, "claims", "引用-论断抽查（" + arr.length + " 句）", items, { problem, total: arr.length });
        $("ckProg").textContent = "完成 ✓ " + (arr.length - problem) + "/" + arr.length + " 句引用获支持，其余见记录";
        renderChecks();
      } catch (e) { $("ckProg").textContent = "失败：" + e.message; }
    }));
    /* ③ 数字来源绑定（本地，v1.0.6 交互版：每处数字可选来源并保存） */
    $("ckNums").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const secs = Object.keys(p.draft || {});
      const hits = [];
      /* v3.2：数字扫描统一走 WQCore.scanNumHits（S0：三处合一，含 [n] 引用排除与置信区间保留） */
      secs.forEach(s0 => {
        (window.WQCore && WQCore.scanNumHits ? WQCore.scanNumHits(p.draft[s0]) : []).forEach(h => {
          hits.push({ sec: s0, num: h.num, ctx: h.ctx, key: (s0 + "|" + h.ctx).slice(0, 100) });
        });
      });
      const uniq = []; const seen = new Set();
      hits.forEach(h => { if (!seen.has(h.key)) { seen.add(h.key); uniq.push(h); } });
      p.nummap = p.nummap || {};
      const bound = uniq.filter(h => p.nummap[h.key] && p.nummap[h.key].src).length;
      const rows = uniq.slice(0, 40).map(function (h) {
        const cur0 = p.nummap[h.key] || {};
        return '<div class="refrow"><span class="rn">' + (cur0.review ? "⚠" : cur0.src ? "✅" : "🔴") + '</span><span class="rt">…' + esc(h.ctx) + '…</span>' +
          '<select class="nmSel" data-nmkey="' + esc(h.key) + '">' +
          '<option value="">未绑定</option>' +
          p.papers.map((f, i) => '<option value="文献[' + (i + 1) + ']"' + (cur0.src === "文献[" + (i + 1) + "]" ? " selected" : "") + '>文献[' + (i + 1) + '] ' + esc(f.title.slice(0, 14)) + '</option>').join("") +
          (p.datacards || []).map(c => '<option value="数据卡：' + esc(c.name) + '"' + (cur0.src === "数据卡：" + c.name ? " selected" : "") + '>数据卡：' + esc(c.name.slice(0, 12)) + '</option>').join("") +
          '<option value="本人测算"' + (cur0.src === "本人测算" ? " selected" : "") + '>本人测算</option>' +
          '</select></div>';
      }).join("");
      pushCheck(p, "nums", "数字来源绑定（" + uniq.length + " 处，可交互）", [],
        { problem: uniq.length - bound, total: uniq.length, bound: bound });
      const anchorBox = document.getElementById("ckRetestBox") || document.getElementById("ckOut");
      const oldP = document.getElementById("nmPanel");
      if (oldP) oldP.remove();   /* v1.0.7：重复点击不再堆积面板 */
      const div = document.createElement("div");
      div.id = "nmPanel";
      div.className = "callout c-info";
      div.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>🔢 逐处绑定来源</b>' +
        '<span class="hint" id="nmCount">已绑定 ' + bound + ' / ' + uniq.length + '</span><span style="flex:1"></span>' +
        '<button class="pillbtn" id="nmSave">💾 保存绑定</button><span class="hint">改完下拉点保存；正文重要数字都应能指回来源</span></div>' +
        (rows || '<p class="hint">草稿里没有检测到数字类表述</p>');
      anchorBox.before(div);
      div.querySelectorAll(".nmSel").forEach(sel => sel.addEventListener("change", function () {
        const key = sel.dataset.nmkey;
        if (sel.value) { p.nummap[key] = { src: sel.value, ts: WQCore.stamp() }; } else { delete p.nummap[key]; }
        save();
        const b = uniq.filter(h => p.nummap[h.key] && p.nummap[h.key].src).length;
        const cnt = document.getElementById("nmCount");
        if (cnt) cnt.textContent = "已绑定 " + b + " / " + uniq.length;
      }));
      document.getElementById("nmSave").addEventListener("click", function () {
        pushCheck(p, "nums", "数字来源绑定（" + uniq.length + " 处）",
          uniq.map(h => { const b0 = p.nummap[h.key]; return (b0 && b0.review ? "⚠待复核" : b0 && b0.src ? "✅" : "🔴") + "「" + h.sec + "」…" + h.ctx + "…" + (b0 && b0.src ? "（" + b0.src + "）" : "（未绑定）"); }),
          { problem: uniq.length - bound, total: uniq.length, bound: bound });
        renderChecks(); toast("绑定结果已存入校验记录 ✓");
      });
    });

    /* ④ 格式规范（本地，v1.0.7：按类别归组，缺字段给一键修复入口） */
    $("ckFormat").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const items = [];
      let problem = 0;
      /* 1. 题录完整性：按字段归组（不再逐篇刷屏） */
      const missAuth = p.papers.map((f, i) => ({ f, i })).filter(x => !x.f.author);
      const missVenue = p.papers.map((f, i) => ({ f, i })).filter(x => !x.f.venue);
      const missYear = p.papers.map((f, i) => ({ f, i })).filter(x => !x.f.year);
      if (missAuth.length) {
        items.push("题录缺作者 " + missAuth.length + "/" + p.papers.length + " 篇（如：" + missAuth.slice(0, 3).map(x => "[" + (x.i + 1) + "] " + x.f.title.slice(0, 20)).join("；") + "）—— 点文献库「补作者」可批量补");
        problem++;
      }
      if (missVenue.length) { items.push("题录缺出处 " + missVenue.length + " 篇"); problem++; }
      if (missYear.length) { items.push("题录缺年份 " + missYear.length + " 篇"); problem++; }
      /* 2. 图表编号连续性 */
      const allText = Object.keys(p.draft || {}).map(s0 => p.draft[s0]).join("\n");
      const figs = [...allText.matchAll(/(图|表)\s*(\d+)/g)].map(m => m[1] + m[2]);
      const seq = {};
      figs.forEach(x => { const t = x[0], n = +x.slice(1); seq[t] = seq[t] || []; if (!seq[t].includes(n)) seq[t].push(n); });
      Object.keys(seq).forEach(t => {
        const arr = seq[t].sort((a, b) => a - b);
        for (let i = 0; i < arr.length; i++) if (arr[i] !== i + 1) { items.push(t + "编号不连续：出现 " + arr.join(",") + "（缺 " + (i + 1) + "）"); problem++; break; }
      });
      /* 3. 引用覆盖 */
      const secs = Object.keys(p.draft || {});
      if (secs.length) {
        const noCite = secs.filter(s0 => !/\[\d+\]/.test(p.draft[s0] || ""));
        if (noCite.length && p.papers.length) { items.push("以下节没有任何引用标注：" + noCite.join("、")); problem++; }
      } else { items.push("还没有「我的稿」内容：先在⑤修改工作台采用/写作"); problem++; }
      pushCheck(p, "format", "格式规范检查", items, { problem });
      $("ckProg").textContent = problem ? "发现 " + problem + " 类问题（展开查看；题录缺失可点「补作者」批量修复）" : "✓ 格式检查通过";
      renderChecks();
    });

    /* 🔁 回测：与上次同项对比 */
    $("ckRetest").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const kinds = { refs: "引用存在性", claims: "引用-论断", nums: "数字绑定", format: "格式规范" };
      const lines = [];
      Object.keys(kinds).forEach(k => {
        const runs = (p.checks || []).filter(c => c.kind === k);
        if (runs.length < 2) return;
        const cur0 = new Set(runs[0].items), prev = new Set(runs[1].items);
        const fixed = [...prev].filter(x => !cur0.has(x));
        const added = [...cur0].filter(x => !prev.has(x));
        lines.push("### " + kinds[k] + "（上次 " + runs[1].ts + " → 本次 " + runs[0].ts + "）", "",
          "- 新增问题 " + added.length + " 条" + (added.length ? "：" + added.slice(0, 5).join("；") : ""),
          "- 已解决 " + fixed.length + " 条" + (fixed.length ? "（如：" + fixed.slice(0, 3).join("；") + "）" : ""), "");
      });
      if (!lines.length) { toast("同一校验项至少跑两次才能回测对比"); return; }
      const out = $("ckOut");
      let div = document.getElementById("ckRetestBox");
      if (!div) { div = document.createElement("div"); div.id = "ckRetestBox"; div.className = "callout c-info"; out.before(div); }
      div.innerHTML = "<b>🔁 回测对比</b>" + mdRender(lines.join("\n"));
      out.before(div);
      trailAdd(p, "act", "校验回测", lines.length + " 项对比");
      save();
    });
  })();

  /* ================================================================
   * ③ 数据卡（P4 复现）
   * ================================================================ */
  function renderDatacards() {
    if (!has("dcList")) return;
    const p = P();
    const cards = (p && p.datacards) || [];
    $("dcList").innerHTML = cards.length ? cards.map((c, i) =>
      '<div class="ckitem"><b>' + esc(c.name) + "</b> · " + esc(c.source || "来源未填") +
      ' <button class="pillbtn" data-dcdel="' + i + '">删</button>' +
      (c.vars ? '<div class="hint">' + esc(c.vars).replace(/\n/g, "；") + "</div>" : "") + "</div>").join("")
      : '<p class="hint">还没有数据卡。填好名称与来源点「添加」——写结果节时每个数字都应能指回一张数据卡。</p>';
    $("dcList").querySelectorAll("[data-dcdel]").forEach(b => b.addEventListener("click", () => {
      const p2 = P(); if (!p2) return;
      p2.datacards = (p2.datacards || []).filter((x, i) => i !== +b.dataset.dcdel);
      save(); renderDatacards();
    }));
  }
  (function bindDatacards() {
    if (!has("dcAdd")) return;
    $("dcAdd").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const name = $("dcName").value.trim(); if (!name) { $("dcName").focus(); return; }
      p.datacards = p.datacards || [];
      p.datacards.unshift({ id: "dc" + Date.now(), name, source: $("dcSource").value.trim(), vars: $("dcVars").value.trim(), ts: WQCore.stamp() });
      save(); ["dcName", "dcSource", "dcVars"].forEach(i => $(i).value = "");
      renderDatacards(); trailAdd(p, "note", "添加数据卡", name); save();
    });
    $("dcCode").addEventListener("click", () => withBusy($("dcCode"), async () => {
      const p0 = P(); if (!p0) return toast("先新建项目");
      const pid = p0.id;
      if (!(p0.datacards || []).length) { $("dcProg").textContent = "先添加至少一张数据卡"; return; }
      if (!(await askAI("根据数据卡与研究设计生成分析代码？", ["调用 AI 1 次（Python/pandas 默认，可在补充框写 R）"], "生成代码"))) return;
      $("dcProg").textContent = "生成分析代码中…";
      try {
        const r = await WQCore.ai.call(
          "你是数据分析工程师。根据下面的研究设计与数据卡，生成可运行的分析脚本（默认 Python+pandas/statsmodels；若数据卡注明 R 则用 R）。要求：读入→清洗→描述统计→主分析（对应研究设计）→稳健性；每步注释；结果打印为可直接贴进论文的表；数据文件名用占位 data.csv 并注释说明应替换为数据卡来源。不要编造结果数字。\n\n【研究设计】\n" + (p0.design || p0.selection || "（未做设计审查，按数据卡推断）").slice(0, 1500) +
          "\n\n【数据卡】\n" + p0.datacards.map(c => "- " + c.name + "｜来源：" + (c.source || "未填") + "｜变量：" + (c.vars || "未填").replace(/\n/g, "；")).join("\n"), 5000, { temperature: 0.2 });
        const p = liveProj(pid); if (!p) return;
        p.outs = p.outs || {}; p.outs.datacode = withMeta(r, "数据卡+研究设计"); p.showV = "datacode";
        addVersion(p, "分析代码", p.outs.datacode, "outs.datacode"); save();
        const out = $("dcOut"); out.hidden = false; setMD(out, p.outs.datacode); $("btnDcCopy").hidden = false;
        $("dcProg").textContent = "✓ 代码已生成并存入项目（结果数字必须由你本地跑出）";
      } catch (e) { $("dcProg").textContent = "失败：" + e.message; }
    }));
    $("dcChecklist").addEventListener("click", () => withBusy($("dcChecklist"), async () => {
      const p0 = P(); if (!p0) return toast("先新建项目");
      const pid = p0.id;
      if (!(await askAI("生成复现清单？", ["按范式与层级生成「结果可复现」检查单（调用 AI 1 次）"], "生成"))) return;
      $("dcProg").textContent = "生成复现清单中…";
      try {
        const pq = PQ(p0), lv = LV(p0);
        const r = await WQCore.ai.call(
          "你是可复现性审稿人。为一份「" + lv.name + "·" + pq.name + "」研究生成复现清单（Markdown 勾选框），覆盖：数据（来源/授权/版本/缺失处理）、变量与代码（可运行/随机种子/软件版本）、统计（显著性口径/稳健性/多重比较）、结果一致性（正文数字=代码输出）、归档（数据+代码+环境 可交给第三方跑通）。每项一行 - [ ]，共 12-18 行，按重要度排序，结合已有研究设计给 2-3 条针对性提醒。\n\n【研究设计】\n" + (p0.design || "（未生成）").slice(0, 1200) + "\n【数据卡】\n" + (p0.datacards || []).map(c => "- " + c.name).join("\n"), 3000, { temperature: 0.2 });
        const p = liveProj(pid); if (!p) return;
        p.outs = p.outs || {}; p.outs.repro = withMeta(r, "范式与设计审查"); p.showV = "repro";
        addVersion(p, "复现清单", p.outs.repro, "outs.repro"); save();
        const out = $("dcOut"); out.hidden = false; setMD(out, p.outs.repro); $("btnDcCopy").hidden = false;
        $("dcProg").textContent = "✓ 清单已存入项目";
      } catch (e) { $("dcProg").textContent = "失败：" + e.message; }
    }));
    $("btnDcCopy") && $("btnDcCopy").addEventListener("click", () => {
      if ($("dcOut").dataset.rawmd) { navigator.clipboard.writeText($("dcOut").dataset.rawmd).then(() => toast("已复制")); return; }
      navigator.clipboard.writeText($("dcOut").textContent).then(() => toast("已复制"));
    });
  })();

  /* ================================================================
   * ④ 导出增强：排版预设 + 归属说明
   * ================================================================ */
  const EXP_CSS = {
    "thesis-cn": "body{font-family:SimSun,serif;font-size:12pt;line-height:1.5}h1{font-size:16pt;text-align:center}h2{font-size:14pt}p{text-indent:2em;margin:0.3em 0}",
    "thesis-fs": "body{font-family:'FangSong_GB2312',FangSong,serif;font-size:14pt;line-height:1.6}h1{font-size:16pt;text-align:center}h2{font-size:15pt}p{text-indent:2em}",
    "journal-en": "body{font-family:'Times New Roman',serif;font-size:12pt;line-height:2}h1{font-size:14pt;text-align:center}h2{font-size:13pt}",
    "plain": "body{font-family:SimSun,serif;font-size:12pt;line-height:1.5}h1{font-size:16pt;text-align:center}h2{font-size:14pt}"
  };
  (function bindExport2() {
    if (!has("btnExportDoc2")) return;
    $("btnExportDoc2").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const pq = PQ(p);
      const secList = exportSecList(p, pq);
      const drafted = secList.filter(s => p.draft && p.draft[s]);
      if (!drafted.length) { toast("还没有「我的稿」内容：先在④修改工作台采用/写作，再导出"); return; }
      const esc2 = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const parts = secList.map(s => {
        const rich = (p.draftRich || {})[s];
        let t = p.draft?.[s] || "";
        const richClean = rich ? sanitizeRich(rich).replace(/〔生成：[^〕]*〕/g, "") : "";
        if (t) t = t.replace(/〔生成：[^〕]*〕/g, "").trim();
        return `<h2>${esc2(s)}</h2>` + (richClean ? richClean : (t ? t.split(/\n+/).map(x => `<p>${esc2(x)}</p>`).join("") : "<p>〔本节未写〕</p>"));
      }).join("\n");
      /* 归属说明：按账本，不再只看〔生成：〕标记 */
      const led = WQCore.ledger.analyzeProject(p);
      const pct = v => Math.round(v * 100) + "%";
      const declLines = [];
      Object.keys(led.bySec).forEach(sec => {
        const a = led.bySec[sec];
        declLines.push(sec + "：本人贡献 " + pct(a.contribution) + "（亲笔 " + a.userChars + " 字 / 混合 " + a.mixedChars + " 字 / 参考原样 " + a.aiChars + " 字）");
      });
      const aiDecl = '<h2>AI 辅助说明</h2><p style="font-size:10.5pt;color:#555">本稿在「研墨」辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。各节归属（按字符估算）：<br>' +
        (declLines.map(esc2).join("<br>") || "（账本为空）") +
        '<br>模型：' + esc2((p.ref && p.ref.model) || WQCore.ai.conf().model || "") + ' · 报告日期：' + WQCore.stamp() +
        '。作者对全部内容与引用的真实性负责。</p>';
      /* 校验摘要：各类型最近一次 */
      const latest = {};
      (p.checks || []).forEach(c => { if (!latest[c.kind]) latest[c.kind] = c; });
      const ckLines = Object.values(latest).map(c => c.label + "：" + (c.stats && c.stats.problem != null ? (c.stats.problem ? c.stats.problem + " 项待处理" : "通过") + "（" + c.ts + "）" : c.ts));
      const ckDecl = ckLines.length ? '<h2>校验记录（最近）</h2><p style="font-size:10.5pt;color:#555">' + ckLines.map(esc2).join("<br>") + "</p>" : "";
      /* v1.1.0：参考文献按 GB/T 7714 生成 */
      const refLines = window.YMBib ? YMBib.gbList(p.papers) : p.papers.map((f, i) => "[" + (i + 1) + "] " + refTxt(f));
      const refs = p.papers.length ? "<h2>参考文献</h2><p style=\"font-size:10.5pt;line-height:1.4\">" + refLines.map(esc2).join("<br>") + "</p>" : "";
      const css = cleanCss((window.WQTemplate && WQTemplate.activeCss()) || EXP_CSS[$("expFmt") ? $("expFmt").value : "plain"] || EXP_CSS.plain);
      const html = `<html><head><meta charset="utf-8"><style>${css}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}</style></head><body><h1>${esc2(p.topic || p.name)}</h1>${parts}${refs}${aiDecl}${ckDecl}<p style="color:#888">—— 由${esc2((window.YANMO && YANMO.label) || "研墨")}辅助完成（${WQCore.stamp()}）；引用与数据请人工核对 ——</p></body></html>`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }));
      a.download = (p.topic || p.name || "论文全文").replace(/[\\/:*?"<>|]/g, "_") + ".doc";
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      trailAdd(p, "export", "导出全文+归属说明", "已写 " + drafted.length + "/" + pq.sections.length + " 节 · 贡献度 " + pct(led.contribution));
      save(); renderProcessLog();
    });
  })();

  /* ================================================================
   * ⑤ 设置扩展：单价 + 用量显示
   * ================================================================ */
  (function bindSettings() {
    if (!has("aiPriceIn")) return;
    const c = WQCore.ai.conf();
    $("aiPriceIn").value = c.priceIn || ""; $("aiPriceOut").value = c.priceOut || "";
    const persist = () => WQCore.ai.setConf({ priceIn: $("aiPriceIn").value.trim(), priceOut: $("aiPriceOut").value.trim() });
    $("aiPriceIn").addEventListener("change", persist);
    $("aiPriceOut").addEventListener("change", persist);
    window.wqRenderUsage = function () {
      const u = WQCore.ai.usageToday();
      $("usageBox").innerHTML = "📊 本机今日用量：" + (u.inTok + u.outTok).toLocaleString() + " tokens / " + u.calls + " 次" + (u.price != null ? " ≈ ¥" + u.price : "") + "（只存本机）";
    };
    $("btnSet").addEventListener("click", () => { if (window.wqRenderUsage) window.wqRenderUsage(); });
    window.wqRenderUsage();
  })();

  /* ---- v1.0.1（QA P2-15）：投稿检查清单勾选持久化到项目 ---- */
  (function bindChecklist() {
    const boxes = () => [...document.querySelectorAll("#s6 .checklist input")];
    boxes().forEach((chk, i) => chk.addEventListener("change", () => {
      const p = P(); if (!p) return;
      p.checklistState = p.checklistState || [];
      p.checklistState[i] = chk.checked;
      save();
    }));
    window.__wqRestoreChecklist = function () {
      const p = P(); const st = p && p.checklistState;
      if (!st) return;
      boxes().forEach((chk, i) => { chk.checked = !!st[i]; });
    };
  })();

  function citeEnhanceLater(el) {
    if (!el) return;
    setTimeout(function () { try { citeEnhance(el); } catch (e) {} }, 0);
  }
  /* ================================================================
   * ⑥ 参考文献附文末（v1.0.4）：[n] 可点击跳到文末明细并可修订题录
   * 挂接点：包装 window.setMD——对 #wOut 的每次渲染自动做引用增强 + 附参考文献表；
   *        工作台与 afterRender 通过 renderRefAppendices() 刷新各自容器。
   * 编号口径：[n] = 文献库顺序（与校验中心/导出同源）。
   * ================================================================ */
  function citeEnhance(el) {
    const max = (P() && P().papers.length) || 0;
    if (!max) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n0) {
        return (n0.parentNode.closest && n0.parentNode.closest("a,pre,code,.refappendix,.citelink")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const hits = [];
    while (walker.nextNode()) {
      if (/\[\d{1,3}\]/.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
    }
    hits.forEach(function (t) {
      const frag = document.createDocumentFragment();
      const v = t.nodeValue;
      const re = /\[(\d{1,3})\]/g;
      let m, last = 0;
      while ((m = re.exec(v))) {
        const n = parseInt(m[1], 10);
        if (n < 1 || n > max) continue;
        if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
        const a = document.createElement("span");
        a.className = "citelink"; a.dataset.n = String(n);
        a.textContent = "[" + n + "]";
        a.title = "点此查看参考文献 " + n + "（文末）";
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  }

  function refTxt(f) {
    /* v1.1.0：有 ym-bib 时按 GB/T 7714 输出（含卷期页码等结构化题录），去掉开头的 [n] */
    if (window.YMBib) { try { return YMBib.gbEntry(YMBib.paperToCSL(f), 0).replace(/^\[0\]\s*/, ""); } catch (e) {} }
    return (f.author ? f.author + ". " : "") + f.title + "[" + (f.type || "J") + "]. " +
      (f.venue || "出处待补") + ", " + (f.year || "年份待补") + (f.doi ? ". DOI: " + f.doi : "") + ".";
  }

  function refAppendixHTML(p, hlN, srcId) {
    const rows = p.papers.map(function (f, i) {
      return '<div class="refrow' + (hlN === i + 1 ? " flash" : "") + '" data-rn="' + (i + 1) + '">'
        + '<span class="rn">[' + (i + 1) + ']</span><span class="rt">' + esc(refTxt(f)) + '</span>'
        + '<button class="pillbtn" data-redit="' + (i + 1) + '" title="修订题录（作者/标题/年份/出处/DOI）">✏️修改</button>'
        + '<button class="pillbtn" data-rtrace="' + (i + 1) + '" title="全文溯源：引用位置 + 摘要 + AI 支撑判断">🔍溯源</button>'
        + (f.doi ? ' <a class="pillbtn" href="https://doi.org/' + esc(f.doi) + '" target="_blank" rel="noopener">DOI</a>' : "")
        + '</div>';
    }).join("");
    return '<div class="refappendix"><b class="rahead">参考文献</b><span class="hint">（编号与正文 [n] 一致；✏️修改 会同步文献库与导出）</span>'
      + (srcId ? ' <button class="pillbtn" data-reback="' + esc(srcId) + '" title="回到刚才阅读的位置">↑ 返回正文</button>' : "")
      + '<div class="reflist">' + (rows || '<p class="hint">文献库为空</p>') + '</div></div>';
  }

  const REF_SLOTS = [
    { src: "wOut", apId: "wRefsAppendix" },
    { src: "selOut", apId: "selRefsAppendix" },
    { src: "vOut", apId: "vRefsAppendix" },
    { src: null, apId: "wbRefs", always: true }
  ];
  function renderRefAppendices(hlN) {
    const p = P();
    REF_SLOTS.forEach(function (rc) {
      const srcEl = rc.src ? document.getElementById(rc.src) : null;
      let ap = document.getElementById(rc.apId);
      /* wbRefs（always:true）是常驻折叠容器，本身就是附录；其余容器有内容才附 */
      const hasContent = rc.always ? true : (srcEl && (srcEl.textContent || "").trim().length > 0);
      if (!hasContent) { if (ap && !rc.always) ap.innerHTML = ""; return; }
      if (!ap) {
        ap = document.createElement("div"); ap.id = rc.apId; ap.dataset.src = rc.src || "";
        if (rc.src) srcEl.insertAdjacentElement("afterend", ap);
      }
      ap.innerHTML = (p && p.papers.length) ? refAppendixHTML(p, hlN, rc.src) : '<p class="hint">文献库为空</p>';
    });
  }

  function startRefEdit(row) {
    const p = P(); if (!p) return;
    const n = parseInt(row.dataset.rn, 10);
    const f = p.papers[n - 1]; if (!f) return;
    const inp = function (k, ph, val) {
      return '<input class="refEd" data-k="' + k + '" value="' + esc(val || "") + '" placeholder="' + ph + '">';
    };
    row.classList.add("editing");
    row.innerHTML = '<span class="rn">[' + n + ']</span>'
      + inp("author", "作者", f.author) + inp("title", "标题（必填）", f.title)
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;flex-basis:100%">'
      + '<select class="refEd" data-k="type">' + ["J", "D", "C", "M", "R", "EB"].map(function (t) {
          return '<option value="' + t + '"' + (f.type === t ? " selected" : "") + ">[" + t + "]</option>";
        }).join("") + '</select>'
      + inp("venue", "期刊/出处", f.venue) + inp("year", "年份", f.year) + inp("doi", "DOI", f.doi)
      + '<button class="pillbtn" data-resave="' + n + '" style="background:#0a7a43;color:#fff">💾 保存</button>'
      + '<button class="pillbtn" data-recancel="1">取消</button></div>';
    row.querySelector('.refEd[data-k="title"]').focus();
  }

  function saveRefEdit(row) {
    const p = P(); if (!p) return;
    const n = parseInt(row.dataset.rn, 10);
    const f = p.papers[n - 1]; if (!f) return;
    let bad = "";
    row.querySelectorAll(".refEd").forEach(function (inp) {
      const k = inp.dataset.k, v = inp.value.trim();
      if (k === "title" && !v) { bad = "标题不能为空"; return; }
      if (k === "year" && v && !/^\d{4}$/.test(v)) { bad = "年份应为 4 位数字"; return; }
      f[k] = v;
    });
    if (bad) { toast(bad); return; }
    f.verify = {}; /* 题录被人工修订后，旧核验结论作废 */
    save();
    renderRefAppendices(n);
    renderPapers();
    trailAdd(p, "act", "修订参考文献题录", "[" + n + "] " + (f.title || "").slice(0, 40));
    save(); renderProcessLog();
    toast("[" + n + "] 题录已更新（引用编号不变）");
  }

  /* 全局委托：正文 [n] 点击 → 滚动定位 + 高亮；明细行的编辑/保存/取消 */
  document.addEventListener("click", function (e) {
    const cl = e.target.closest(".citelink");
    if (cl) {
      const n = cl.dataset.n;
      const row = document.querySelector('.refappendix .refrow[data-rn="' + CSS.escape(n) + '"]');
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
      } else {
        toast("[" + n + "] 暂无对应文献（正文引用与文献库不一致，建议跑一次「引用存在性核验」）");
      }
      return;
    }
    const ed = e.target.closest("[data-redit]");
    if (ed) { startRefEdit(ed.closest(".refrow")); return; }
    const sv = e.target.closest("[data-resave]");
    if (sv) { saveRefEdit(sv.closest(".refrow")); return; }
    const cx = e.target.closest("[data-recancel]");
    if (cx) { renderRefAppendices(); return; }
    const bk = e.target.closest("[data-reback]");
    if (bk) {
      const src = document.getElementById(bk.dataset.reback);
      if (src) src.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const tr = e.target.closest("[data-rtrace]");
    if (tr) {
      const row = tr.closest(".refrow");
      const n = parseInt(tr.dataset.rtrace, 10);
      const exist = row.querySelector(".reftrace");
      if (exist) { exist.remove(); return; }
      row.insertAdjacentHTML("beforeend", traceHTML(P(), n));
      return;
    }
    const jd = e.target.closest("[data-rjudge]");
    if (jd) { runJudge(jd.closest(".refrow"), parseInt(jd.dataset.rjudge, 10)); return; }
  });

  /* 包装 setMD：#wOut 渲染后自动增强引用并附文末参考文献 */
  (function wrapSetMD() {
    const orig = window.setMD;
    if (typeof orig !== "function") return;
    window.setMD = function (el, text) {
      orig(el, text);
      try {
        if (el && ["wOut", "selOut", "vOut"].indexOf(el.id) >= 0) {
          citeEnhance(el);
          renderRefAppendices();
        }
      } catch (e) { console.warn("citeEnhance", e); }
    };
  })();


  /* ---- v1.0.5（QA二轮 P3）：有未保存修改时，离开页面前提示（v1.1.0：富文本模式也算，且只注册一次） ---- */
  window.addEventListener("beforeunload", function (e) {
    try {
      if (!has("wbMine") || $("wbMain").hidden) return;
      const p = P(), sec = wbState.sec;
      const saved = (p && p.draft && sec && p.draft[sec]) || "";
      const mine = currentMine();
      if (mine.trim() && mine !== saved) { e.preventDefault(); e.returnValue = ""; }
    } catch (err) {}
  });

  /* ================================================================
   * ⑦ 在线富文本编辑器 + 一键排版（v1.0.6）
   * 双模式：所见即所得（contentEditable）↔ 纯文本；富文本存 p.draftRich[sec]，
   * 纯文本派生存 p.draft[sec]（diff/账本/校验逻辑不变）。导出优先用富文本。
   * ================================================================ */
  function htmlToPlain(html) {
    /* v1.0.7：真正解析 HTML（textarea.innerHTML 不解析标签，会把 <p> 漏进纯文本）；
       段落闭合转双换行，保证 diff/归属账本的段落切分准确。
       v1.1.0：改用 DOMParser 的惰性文档解析——普通 div 解析时 <img onerror> 之类会被执行 */
    const src = String(html || "")
      .replace(/<\s*(\/p|\/div|\/h[1-6]|\/blockquote)[^>]*>/gi, "\n\n")
      .replace(/<\s*br[^>]*>/gi, "\n")
      .replace(/<\s*\/li[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ");
    const doc = new DOMParser().parseFromString("<body>" + src + "</body>", "text/html");
    return ((doc.body && doc.body.textContent) || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function plainToRich(text) {
    return String(text || "").split(/\n{2,}|\n/).map(x => x.trim()).filter(Boolean)
      .map(x => "<p>" + esc(x) + "</p>").join("");
  }
  const RICH_TOOLBAR = [
    { cmd: "formatBlock", arg: "h2", label: "H2" }, { cmd: "formatBlock", arg: "h3", label: "H3" },
    { cmd: "formatBlock", arg: "p", label: "正文" }, { cmd: "bold", label: "B" },
    { cmd: "italic", label: "I" }, { cmd: "insertUnorderedList", label: "• 列表" },
    { cmd: "formatBlock", arg: "blockquote", label: "引用" }, { cmd: "removeFormat", label: "清除格式" },
    { cmd: "undo", label: "↶" }, { cmd: "redo", label: "↷" }
  ];
  function editorRich() { return document.getElementById("wbMineRich"); }
  function editorIsRich() { return localStorage.getItem("wenqu_editmode") === "rich"; }
  function setEditorMode(rich, sec) {
    const p = P(); if (!p) return;
    const mine = $("wbMine"), box = editorRich();
    if (!mine || !box) return;
    if (rich) {
      const saved = (p.draftRich || {})[sec];
      box.innerHTML = (saved && sanitizeRich(saved)) || plainToRich(mine.value);
      box.style.display = ""; mine.style.display = "none";
    } else {
      if (box.innerHTML && !mine.value.trim()) mine.value = htmlToPlain(box.innerHTML);
      box.style.display = "none"; mine.style.display = "";
    }
    localStorage.setItem("wenqu_editmode", rich ? "rich" : "plain");
    $("wbModeBtn").textContent = rich ? "☑ 所见即所得" : "✍️ 富文本";
    document.getElementById("wbToolbar").style.display = rich ? "" : "none";
  }
  function editorPlainValue() {
    /* 保存时取值：富文本 → 派生纯文本 */
    if (editorIsRich()) {
      const rich = editorRich().innerHTML;
      return { rich: rich, plain: htmlToPlain(rich) };
    }
    return { rich: null, plain: $("wbMine").value };
  }
  (function bindEditor() {
    if (!has("wbMine")) return;
    /* 工具栏 */
    const bar = document.getElementById("wbToolbar");
    if (bar && !bar.childElementCount) {
      RICH_TOOLBAR.forEach(function (t) {
        const b = document.createElement("button");
        b.className = "pillbtn"; b.type = "button"; b.innerHTML = esc(t.label);
        b.addEventListener("mousedown", function (e) { e.preventDefault(); });
        b.addEventListener("click", function () {
          editorRich().focus();
          document.execCommand(t.cmd, false, t.arg || null);
        });
        bar.appendChild(b);
      });
      const mode = document.createElement("button");
      mode.className = "pillbtn"; mode.id = "wbModeBtn"; mode.style.marginLeft = "auto";
      bar.appendChild(mode);
      mode.addEventListener("click", function () { setEditorMode(!editorIsRich(), $("wbSec").value); });
    }
    /* contentEditable 容器插到 textarea 前面 */
    const box = document.createElement("div");
    box.id = "wbMineRich";
    box.contentEditable = "true";
    box.style.cssText = "border:1px solid var(--line);border-radius:10px;padding:10px;min-height:280px;max-height:520px;overflow:auto;font-size:13px;line-height:1.7;background:#fff";
    $("wbMine").before(box);
    $("wbMine").style.display = "none";
    /* v1.1.0：粘贴进富文本时先清洗（网页/Word 里复制来的内容可能带脚本、事件属性或大段样式） */
    box.addEventListener("paste", function (e) {
      const dt = e.clipboardData; if (!dt) return;
      const html = dt.getData("text/html");
      if (!html) return;   // 纯文本粘贴交给浏览器
      e.preventDefault();
      document.execCommand("insertHTML", false, sanitizeRich(html));
    });
    setEditorMode(editorIsRich(), $("wbSec").value);
    /* 保存：富文本派生纯文本 */
    const origSave = saveDraft;
    saveDraft = function (sec, silent) {
      const p = P(); if (!p) return;
      const v = editorIsRich() ? htmlToPlain(editorRich().innerHTML) : $("wbMine").value;
      p.draft = p.draft || {};
      if ((p.draft[sec] || "") === v) { if (!silent) toast("内容未变化"); return; }
      p.draft[sec] = v;
      if (editorIsRich()) {
        p.draftRich = p.draftRich || {};
        p.draftRich[sec] = sanitizeRich(editorRich().innerHTML);
      } else {
        p.draftRich = p.draftRich || {};
        delete p.draftRich[sec];
      }
      save();
      if (v.length > 120) { addVersion(p, "我的稿·" + sec, v, "draft:" + sec); save(); }
      trailAdd(p, "act", "保存我的稿·" + sec, plainLen(v) + " 字");
      save(); renderProjects(); renderWbPanes(false);
      if (!silent) toast("已保存 ✓（归属账本已更新）");
    };
    /* 整节改写（wbRewrite）结果写回富文本容器 */
    const origRewrite = $("wbRewrite").onclick;
  })();

  /* ================================================================
   * ⑧ 高校格式模板库（v1.0.6 闭环方案）
   * 内置通用模板 + AI 按校生成草稿 + 从格式要求文本提取 + 用户模板管理
   * + 导出/导入 JSON（社区分享闭环）。不依赖任何私有模板数据。
   * ================================================================ */
  const TPL_KEY = "wenqu_templates", TPL_ACTIVE = "wenqu_tpl_active";
  const EXP_TPL_BUILTIN = function () {
    return [
      { id: "b-thesis-cn", name: "学位论文·通用（宋体小四/1.5倍行距）", css: EXP_CSS["thesis-cn"], source: "内置" },
      { id: "b-thesis-fs", name: "学位论文·仿宋（仿宋四号）", css: EXP_CSS["thesis-fs"], source: "内置" },
      { id: "b-journal-en", name: "期刊英文·Times 12pt 双倍行距", css: EXP_CSS["journal-en"], source: "内置" },
      { id: "b-plain", name: "朴素（默认宋体 12pt）", css: EXP_CSS["plain"], source: "内置" }
    ];
  };
  function tplAll() {
    let mine = [];
    try { mine = JSON.parse(localStorage.getItem(TPL_KEY) || "[]"); } catch (e) {}
    return EXP_TPL_BUILTIN().concat(mine);
  }
  function tplActiveCss() {
    const act = localStorage.getItem(TPL_ACTIVE);
    if (act) { const t = tplAll().find(x => x.id === act); if (t) return cleanCss(t.css); }
    return null;
  }
  function tplCssFromParams(j) {
    /* AI 返回结构化参数 → Word 可用的 style 块 */
    const g = (k, d) => (j[k] || d);
    return "body{font-family:" + g("bodyFont", "SimSun,serif") + ";font-size:" + g("bodySize", "12pt") +
      ";line-height:" + g("lineHeight", "1.5") + ";margin:" + g("margin", "2.54cm 3.17cm") + "}" +
      "h1{font-size:" + g("h1Size", "16pt") + ";text-align:center}" +
      "h2{font-size:" + g("h2Size", "14pt") + "}" +
      "h3{font-size:" + g("h3Size", "13pt") + "}" +
      "p{text-indent:" + g("indent", "2em") + ";margin:0.3em 0}" +
      "table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}";
  }
  /* ---------- v1.0.6：模板弹窗（事件委托版——所有交互走 m 上的单一委托，杜绝逐元素绑定时序问题） ---------- */
  function tplModal(open) {
    let m = document.getElementById("tplModal");
    if (!open) { if (m) m.remove(); return; }
    if (m) m.remove();
    m = document.createElement("div");
    m.id = "tplModal";
    m.style.cssText = "position:fixed;inset:0;background:rgba(20,28,44,.4);z-index:210;display:flex;align-items:flex-start;justify-content:center;overflow:auto";
    m.innerHTML = '<div style="background:#fff;border-radius:14px;width:min(680px,94vw);margin:40px 12px;padding:18px 20px;box-shadow:0 12px 40px rgba(27,42,74,.25)">' +
      '<div style="display:flex;align-items:center;gap:8px"><b style="font-size:15.5px">📑 排版模板库</b>' +
      '<button class="pillbtn" data-act="unset">切回预设排版</button>' +
      '<span class="hint">闭环：AI 生成草稿 → 对照官方规范修订 → 存为我的模板 → 导出 JSON 分享</span>' +
      '<span style="flex:1"></span><button class="pillbtn" data-act="close">关闭</button></div>' +
      '<h3 style="margin:10px 0 4px;font-size:13.5px">模板列表</h3><div id="tplList"></div>' +
      '<h3 style="margin:12px 0 4px;font-size:13.5px">＋ AI 按学校生成草稿<small class="hint">（AI 草稿务必对照学校官方规范核对后使用）</small></h3>' +
      '<div class="row" style="margin-top:0"><input id="tplSchool" placeholder="学校全名（如：青岛大学）" style="flex:1">' +
      '<select id="tplDegree" style="flex:0 0 120px"><option>本科</option><option>硕士</option><option>博士</option></select>' +
      '<button class="btn2 btn-sm" id="tplGen">生成草稿</button></div>' +
      '<h3 style="margin:12px 0 4px;font-size:13.5px">＋ 从格式要求文本提取<small class="hint">（粘贴学校发布的格式要求/规范原文，AI 提取参数）</small></h3>' +
      '<textarea id="tplSpec" rows="3" placeholder="例：正文宋体小四、1.5倍行距；一级标题黑体三号居中；页边距上2.5下2.5左3右2.5…"></textarea>' +
      '<div class="row" style="margin-top:4px"><button class="btn2 btn-sm" id="tplExtract">提取参数</button>' +
      '<button class="btn2 ghost btn-sm" id="tplExport">⤓ 导出我的模板 JSON</button>' +
      '<label class="btn2 ghost btn-sm" style="cursor:pointer">⤒ 导入 JSON<input id="tplImportFile" type="file" accept=".json" hidden></label>' +
      '<span class="hint" id="tplMsg"></span></div></div>';
    document.body.appendChild(m);
    const $m = (id) => m.querySelector("#" + id);
    const drawList = function () {
      const act = localStorage.getItem(TPL_ACTIVE);
      $m("tplList").innerHTML = tplAll().map(function (t) {
        const isMine = t.source !== "内置";
        return '<div class="refrow" data-tid="' + esc(t.id) + '"><b>' + esc(t.name) + '</b> <span class="hint">' + esc(t.source || "") + '</span>' +
          '<span style="flex:1"></span>' +
          (act === t.id ? '<span class="badge b-ok">使用中</span>' : '<button class="pillbtn" data-act="use" data-id="' + esc(t.id) + '">应用</button>') +
          (isMine ? ' <button class="pillbtn" data-act="edit" data-id="' + esc(t.id) + '">编辑CSS</button> <button class="pillbtn" data-act="del" data-id="' + esc(t.id) + '">删</button> <button class="pillbtn" data-act="exp" data-id="' + esc(t.id) + '">⤓</button>' : "") +
          '</div>';
      }).join("");
    };
    const tplMineList = function () {
      try { return JSON.parse(localStorage.getItem(TPL_KEY) || "[]"); } catch (e) { return []; }
    };
    const aiToTemplate = function (prompt, namePrefix) {
      $m("tplMsg").textContent = "AI 生成中…";
      WQCore.ai.call(prompt, 3000, { temperature: 0.2 }).then(function (txt) {
        /* tplParseAI：宽容解析；8 参数格式 → tplCssFromParams 转 CSS */
        const j = (function () {
          const s0 = String(txt || "").replace(/```(?:json)?/g, "").trim();
          const a = s0.indexOf("{"), b = s0.lastIndexOf("}");
          if (a < 0 || b <= a) return null;
          try {
            const j0 = JSON.parse(s0.slice(a, b + 1));
            if (j0 && j0.css) return j0;
            if (j0 && (j0.bodyFont || j0.bodySize || j0.lineHeight || j0.margin || j0.h1Size)) {
              return { name: j0.name || "", css: WQTemplate.tplCssFromParams(j0) };
            }
            return j0;
          } catch (e) { return null; }
        })();
        if (!j || !j.css) { $m("tplMsg").textContent = "AI 返回格式异常，请重试"; return; }
        const list = tplMineList();
        const t = { id: "t" + Date.now(), name: String(j.name || namePrefix).slice(0, 40), css: cleanCss(j.css), source: "AI草稿·以官方规范为准", ts: WQCore.stamp() };
        list.unshift(t);
        localStorage.setItem(TPL_KEY, JSON.stringify(list));
        $m("tplMsg").textContent = "✓ 已存入「我的模板」（务必对照官方规范核对）";
        drawList();
      }).catch(function (e) { $m("tplMsg").textContent = "失败：" + e.message.slice(0, 50); });
    };
    /* 单一委托：弹窗内所有按钮/输入统一处理（v1.0.6 根治逐元素绑定时序问题） */
    m.addEventListener("click", function (e) {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act, id = act.dataset.id || "";
      if (a === "close") { tplModal(false); }
      else if (a === "unset") { localStorage.removeItem(TPL_ACTIVE); drawList(); try { window.__wqSyncTplHint && window.__wqSyncTplHint(); } catch (e) {} toast("已切回预设排版"); }
      else if (a === "use") { localStorage.setItem(TPL_ACTIVE, id); drawList(); try { window.__wqSyncTplHint && window.__wqSyncTplHint(); } catch (e) {} toast("已应用该模板（导出与预览生效；预设下拉已停用）"); }
      else if (a === "del") {
        const rest = tplMineList().filter(x => x.id !== id);
        localStorage.setItem(TPL_KEY, JSON.stringify(rest));
        if (localStorage.getItem(TPL_ACTIVE) === id) localStorage.removeItem(TPL_ACTIVE);
        drawList();
      }
      else if (a === "exp") {
        const t = tplMineList().find(x => x.id === id);
        if (t) dlText("模板-" + t.name + ".json", JSON.stringify([t], null, 2), "application/json");
      }
      else if (a === "edit") {
        const t = tplMineList().find(x => x.id === id); if (!t) return;
        const row = $m("tplList").querySelector('[data-tid="' + id + '"]');
        row.innerHTML = '<textarea class="tplCssEd" data-tplcss="' + esc(id) + '" rows="5" style="width:100%;font-family:monospace;font-size:12px">' + esc(t.css) + '</textarea>' +
          '<div style="text-align:right;margin-top:4px"><button class="pillbtn" data-act="savecss" data-id="' + esc(id) + '" style="background:#0a7a43;color:#fff">💾 保存CSS</button></div>';
      }
      else if (a === "savecss") {
        const list = tplMineList();
        const t = list.find(x => x.id === id);
        const ta = $m("tplList").querySelector('[data-tplcss="' + id + '"]');
        if (t && ta) { t.css = cleanCss(ta.value); localStorage.setItem(TPL_KEY, JSON.stringify(list)); toast(t.css === ta.value ? "已保存" : "已保存（已去掉不允许的内容：<、@import、url( 等）"); }
        drawList();
      }
    });
    $m("tplGen").addEventListener("click", function () {
      const school = $m("tplSchool").value.trim();
      if (!school) { $m("tplMsg").textContent = "先填学校名"; return; }
      const deg = $m("tplDegree").value;
      aiToTemplate("你是学位论文排版顾问。为「" + school + "」的" + deg + "学位论文生成 Word 排版 CSS（占位草稿，用户会对照官方规范核对）。" +
        "只输出 JSON：{\"name\":\"模板名\",\"bodyFont\":\"…\",\"bodySize\":\"…\",\"lineHeight\":\"…\",\"margin\":\"…\",\"h1Size\":\"…\",\"h2Size\":\"…\",\"h3Size\":\"…\",\"indent\":\"…\"}。" +
        "按国内高校通行规范给出常见值（如正文宋体小四、1.5倍行距、页边距上下2.5cm左右3cm）；不确定的用通行值。", school + deg + "模板");
    });
    $m("tplExtract").addEventListener("click", function () {
      const spec = $m("tplSpec").value.trim();
      if (!spec) { $m("tplMsg").textContent = "先粘贴格式要求原文"; return; }
      aiToTemplate("你是学位论文排版顾问。从下面的格式要求原文中提取排版参数，转成 Word 排版 CSS。" +
        "只输出 JSON：{\"name\":\"模板名\",\"bodyFont\":\"…\",\"bodySize\":\"…\",\"lineHeight\":\"…\",\"margin\":\"…\",\"h1Size\":\"…\",\"h2Size\":\"…\",\"h3Size\":\"…\",\"indent\":\"…\"}；原文没提到的参数用国内通行值补齐。\n【格式要求原文】\n" + spec.slice(0, 1200), "提取模板");
    });
    $m("tplExport").addEventListener("click", function () {
      dlText("研墨-排版模板.json", JSON.stringify(tplMineList(), null, 2), "application/json");
    });
    $m("tplImportFile").addEventListener("change", function (e) {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(function (txt) {
        const arr = JSON.parse(txt);
        if (!Array.isArray(arr)) throw new Error("格式不对");
        const list = tplMineList();
        arr.forEach(function (t) {
          if (!t || !t.name || !t.css) return;
          /* v1.1.0：别人分享的模板只取名称与清洗后的 CSS，其余字段一律不要 */
          list.unshift({ id: "t" + Date.now() + Math.floor(Math.random() * 99999), name: String(t.name).slice(0, 40), css: cleanCss(t.css), source: "导入", ts: WQCore.stamp() });
        });
        localStorage.setItem(TPL_KEY, JSON.stringify(list));
        drawList(); toast("导入完成");
      }).catch(function (e) { toast("导入失败：" + e.message); });
    });
    drawList();
  }

  /* v1.0.6 恢复：looseJsonArr（重构 tplModal 时误删）——JSON 数组宽容解析 */
  function looseJsonArr(txt) {
    let s = String(txt || "").replace(/```(?:json)?/g, "").trim();
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
    throw new Error("AI 返回的不是合法 JSON 数组");
  }
  $("btnPPT") && $("btnPPT").addEventListener("click", () => withBusy($("btnPPT"), async () => {

    const p0 = P(); if (!p0) return toast("先新建项目");
    const pid = p0.id;
    const secs = Object.keys(p0.draft || {}).filter(k => (p0.draft[k] || "").length > 60);
    if (!secs.length && !p0.outline) { toast("先在④写草稿或⑤采用参考稿，再生成 PPT"); return; }
    if (!(await askAI("生成答辩 PPT（.pptx 文件）？", ["AI 拆页 1 次 + 本地组装（约 10-14 页）", "同时下载「演讲稿.md」"], "开始生成"))) return;
    const prog = $("vProg"); prog.textContent = "AI 拆页中…";
    try {
      const brief = secs.map(s => "【" + s + "】" + (p0.draft[s] || "").replace(/〔生成：[^〕]*〕/g, "").slice(0, 260)).join("\n").slice(0, 5000);
      const txt = await WQCore.ai.call(
        "你是答辩 PPT 设计师。基于以下论文材料，产出答辩演示的分页内容（10-13 页）。" +
        "第1页固定：{t:论文题目,b:[\"答辩人：____\",\"指导教师：____\"],cover:true}；最后一页固定：{t:\"谢谢各位专家\",b:[\"恳请批评指正\"]}；中间页每页一个主题：{t:页标题(≤16字),b:[要点3-5条,每条≤22字,来自材料原文概括,禁止编造数据]}。\n" +
        "只输出 JSON 数组，不要任何其他文字。\n\n【论文材料】\n题目：" + (p0.topic || p0.name) + "\n" + brief, 4000, { temperature: 0.3 });
      const arr = looseJsonArr(txt).filter(s0 => s0 && s0.t);
      const slides = arr.map(function (s0, i) {
        return { t: String(s0.t).slice(0, 40), b: (s0.b || []).slice(0, 5).map(x => String(x).slice(0, 60)), cover: i === 0 };
      });
      prog.textContent = "组装 .pptx 中…";
      const blob = await window.WQPptx.build(slides, { title: p0.topic || p0.name });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "答辩PPT-" + String(p0.topic || p0.name).replace(/[\\/:*?"<>|]/g, "_") + ".pptx";
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      /* 演讲稿 md */
      const md = "# 答辩演讲稿 — " + (p0.topic || p0.name) + "\n\n" + slides.map(function (s0, i) {
        return "## 第" + (i + 1) + "页 · " + s0.t + "\n" + (s0.b || []).map(x => "- " + x).join("\n") + "\n";
      }).join("\n");
      dlText("演讲稿-" + String(p0.topic || p0.name).replace(/[\\/:*?"<>|]/g, "_") + ".md", md, "text/markdown");
      (function () { const p = liveProj(pid); if (p) { p.outs = p.outs || {}; p.outs.pptx = withMeta(JSON.stringify(slides, null, 2), "大纲+草稿要点"); addVersion(p, "答辩PPT结构", p.outs.pptx, "outs.pptx"); save(); } })();
      prog.textContent = "完成 ✓ .pptx 与演讲稿已下载（页数：" + slides.length + "）";
    } catch (e) { prog.textContent = "失败：" + e.message; }
  }));

  /* ================================================================
   * ⑩ [n] 全文级溯源：明细行展开 → 全文引用位置 + 摘要节选 + AI 支撑判断
   * ================================================================ */
  function traceCitations(p, n) {
    const out = [];
    const scan = function (label, text) {
      const re = new RegExp("\\[" + n + "\\]", "g");
      let m;
      while ((m = re.exec(text || "")) && out.length < 12) {
        out.push({ label: label, ctx: (text || "").slice(Math.max(0, m.index - 46), m.index + m[0].length + 46).replace(/\s+/g, " ") });
      }
    };
    Object.keys(p.draft || {}).forEach(function (s) { scan("我的稿·" + s, p.draft[s]); });
    ((p.ref && p.ref.order) || Object.keys((p.ref && p.ref.sections) || {})).forEach(function (s) {
      const ent = p.ref.sections[s];
      scan("参考稿·" + s, typeof ent === "string" ? ent : (ent && ent.text) || "");
    });
    return out;
  }
  function traceHTML(p, n) {
    const f = p.papers[n - 1]; if (!f) return "";
    const locs = traceCitations(p, n);
    return '<div class="reftrace" data-trace="' + n + '">' +
      '<div class="hint" style="margin:4px 0"><b>全文溯源：</b>共 ' + locs.length + ' 处引用</div>' +
      (locs.length ? locs.map(l => '<div class="ckitem">【' + esc(l.label) + '】…' + esc(l.ctx) + '…</div>').join("") : '<div class="hint">正文中还没有引用该文献</div>') +
      '<div class="hint" style="margin-top:4px"><b>该文献摘要节选：</b>' + esc((f.abs || f.title).slice(0, 220)) + '…</div>' +
      (locs.length ? '<button class="pillbtn" data-rjudge="' + n + '" style="margin-top:5px">🧠 AI 支撑判断</button> <span class="hint" id="rjudge' + n + '"></span>' : "") +
      '</div>';
  }
  async function runJudge(row, n) {
    const p = P(); if (!p) return;
    const f = p.papers[n - 1]; if (!f) return;
    const box = row.querySelector("#rjudge" + n);
    if (!box) return;
    if (!has("wOut") && true) { /* noop */ }
    box.textContent = "AI 判断中…";
    try {
      const locs = traceCitations(p, n);
      if (!locs.length) { box.textContent = "正文中没有引用该文献"; return; }
      const r = await WQCore.ai.call(
        "你是引用核查员。下面是论文中引用文献[" + n + "]的全部位置的上下文，以及该文献的题录与摘要。判断这些引用是否得到文献支持。输出：第一行「总体：支持/部分支持/不支持」，然后每处一行简短理由。禁止编造。\n" +
        "【文献 " + n + "】" + f.title + "\n摘要：" + (f.abs || "无").slice(0, 400) + "\n【引用位置】\n" +
        locs.map(l => "- " + l.ctx).join("\n").slice(0, 1800), 1200, { temperature: 0.1 });
      box.innerHTML = '<div class="callout c-info" style="margin-top:4px;white-space:pre-wrap">' + esc(r) + '</div>';
      const pp = liveProj(P().id);
      if (pp) { trailAdd(pp, "ai", "AI 支撑判断 [" + n + "]", String(r).slice(0, 60)); save(); }
    } catch (e) { box.textContent = "失败：" + e.message; }
  }


  /* v1.0.7（QA三轮 P1-2）：存量项目批量补作者（Crossref 按 DOI，一次 ≤25 篇） */
  $("btnFillAuthors") && $("btnFillAuthors").addEventListener("click", () => withBusy($("btnFillAuthors"), async () => {
    const p0 = P(); if (!p0) return toast("先新建项目");
    const pid = p0.id;
    const todo = p0.papers.filter(f => !f.author && f.doi).slice(0, 25);
    if (!todo.length) { toast(p0.papers.some(f => !f.author && !f.doi) ? "缺作者的条目没有 DOI，需手工补录" : "所有条目都已有作者"); return; }
    if (!(await askAI("按 DOI 批量补作者？", [todo.length + " 篇将查询 Crossref（逐条限速，约 " + Math.ceil(todo.length * 0.45) + " 秒）", "只补作者/出处/年份，不覆盖已有内容"], "开始补全"))) return;
    let ok = 0, fail = 0;
    const prog = document.getElementById("paperProg");
    for (let i = 0; i < todo.length; i++) {
      if (prog) prog.textContent = "补作者 " + (i + 1) + "/" + todo.length + "…";
      try {
        const cr = await fetchJSON("https://api.crossref.org/works/" + encodeURIComponent(todo[i].doi)).catch(() => null);
        const m0 = cr && cr.message;
        if (m0) {
          const p = liveProj(pid); if (!p) return;
          const f = p.papers.find(x => x.id === todo[i].id);
          if (f) {
            const au = (m0.author || []).slice(0, 3).map(a => (a.family || a.name || "") + (a.given ? " " + a.given : "")).join("，") + ((m0.author || []).length > 3 ? "，等" : "");
            if (au) f.author = au;
            if (!f.venue) f.venue = (Array.isArray(m0["container-title"]) ? m0["container-title"][0] : m0["container-title"]) || "";
            if (!f.year) f.year = String((m0.issued && m0.issued["date-parts"] && m0.issued["date-parts"][0] && m0.issued["date-parts"][0][0]) || "");
            ok++;
          }
        } else fail++;
      } catch (e) { fail++; }
      await sleep(400);
      if (i % 5 === 0) { const p = liveProj(pid); if (p) { save(); } }
    }
    save(); renderPapers();
    if (prog) prog.textContent = "补作者完成：成功 " + ok + " · 失败 " + fail;
    const p = liveProj(pid);
    if (p) { addVersion(p, "批量补作者（" + ok + " 篇）", p.papers.map((f, i) => "[" + (i + 1) + "] " + (f.author || "（缺）") + " " + f.title.slice(0, 40)).join("\n"), "tool"); trailAdd(p, "act", "批量补作者", ok + " 篇"); save(); }
    toast("补作者完成：成功 " + ok + " 篇" + (fail ? "，失败 " + fail : ""));
  }));

  /* v1.0.6：暴露模板接口 + 模板库按钮 */
  window.WQTemplate = { activeCss: tplActiveCss, all: tplAll, tplCssFromParams: tplCssFromParams };
  $("btnTplLib")?.addEventListener("click", function () { tplModal(true); });
  /* v1.0.7（QA三轮 P1-3）：模板库与「排版预设」互斥联动——应用模板时预设置灰并显示当前模板；改预设则自动切回 */
  (function tplLinkage() {
    const sel = $("expFmt");
    if (!sel) return;
    const sync = function () {
      const act = localStorage.getItem(TPL_ACTIVE);
      const t = act ? tplAll().find(function (x) { return x.id === act; }) : null;
      sel.disabled = !!t;
      sel.title = t ? "当前使用模板库模板：" + t.name : "";
      let hint = document.getElementById("tplActiveHint");
      if (!hint) { hint = document.createElement("span"); hint.id = "tplActiveHint"; hint.className = "hint"; sel.insertAdjacentElement("afterend", hint); }
      hint.textContent = t ? "（模板库生效：" + t.name + "；点「📑 排版模板库」可切回预设）" : "";
    };
    sel.addEventListener("change", function () {
      if (localStorage.getItem(TPL_ACTIVE)) { localStorage.removeItem(TPL_ACTIVE); toast("已切回预设排版（模板库模板已停用）"); }
      sync();
    });
    window.__wqSyncTplHint = sync;
    sync();
  })();

  /* ================================================================
   * afterRender：studio.renderAll 之后刷新本模块 UI（不打断输入）
   * ================================================================ */
  window.WQUI = {
    afterRender: function () {
      try { renderWorkbench(); } catch (e) { console.warn("wb", e); }
      try { renderChecks(); } catch (e) {}
      try { renderDatacards(); } catch (e) {}
      try { if (window.__wqRestoreChecklist) window.__wqRestoreChecklist(); } catch (e) {}
      try { if (window.__wqSyncTplHint) window.__wqSyncTplHint(); } catch (e) {}
      try { renderRefAppendices(); } catch (e) {}
      try { if (window.wqRenderUsage) window.wqRenderUsage(); } catch (e) {}
    }
  };
  /* 本文件在 studio.js 初始化之后加载：挂载完成立即渲染一次 */
  window.WQUI.afterRender();
})();

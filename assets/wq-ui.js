/* 萤算科研 · 工作台集成 wq-ui.js
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
    const mineBox = $("wbMine");
    const saved = (p.draft || {})[sec] || "";
    if (forceMine || document.activeElement !== mineBox || mineBox.value === (wbState.lastSaved || "")) mineBox.value = saved;
    wbState.lastSaved = saved;
    renderContrib();
    renderWbDiff(sec, refText, mineBox.value);
  }

  function bindRefButtons(sec, paras) {
    $("wbRefPane").querySelectorAll("[data-adopt]").forEach(b => b.addEventListener("click", () => {
      const para = paras[+b.dataset.adopt]; if (!para) return;
      const p = P(); if (!p) return;
      const box = $("wbMine");
      box.value = box.value ? box.value.replace(/\s+$/, "") + "\n\n" + para : para;
      logLedger(p, sec, "adopt", para.length);
      saveDraft(sec, true);
    }));
    $("wbRefPane").querySelectorAll("[data-rewrite]").forEach(b => b.addEventListener("click", () => withBusy(b, async () => {
      const p0 = P(); const para = paras[+b.dataset.rewrite]; if (!p0 || !para) return;
      const pid = p0.id;
      if (!(await askAI("改写这段并采用？（按你的写作档案改成你的表达）", ["调用 AI 1 次，改写结果直接进入「我的稿」"], "改写并采用"))) return;
      $("wbProg").textContent = "改写中…";
      try {
        const lv = LV(p0);
        const r = await WQCore.ai.stream(
          "把下面这段学术文字改写成作者自己的表达：保持论点、引用编号[n]与术语不变；按写作档案调整句式、衔接与用词；不增删事实；不做规避检测处理，只做语言层面的重写。\n" + styleBlock() + "\n\n【原文】\n" + para, 3000, { temperature: 0.4 });
        const p = liveProj(pid); if (!p) return;
        const box = $("wbMine");
        box.value = box.value ? box.value.replace(/\s+$/, "") + "\n\n" + r.text : r.text;
        logLedger(p, sec, "rewrite", para.length);
        saveDraft(sec, true);
        $("wbProg").textContent = "✓ 已改写并采用（" + r.usage.inTok + "+" + r.usage.outTok + " tok）";
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
      /* v1.0.1（QA P1-4）：有未保存修改时先询问，不再静默覆盖 */
      const prevSec = wbState.sec, mine = $("wbMine").value;
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
      const mine = $("wbMine").value.trim();
      if (!mine) return toast("先在右侧写入内容（采用或自写），再整节改写");
      const pid = p0.id;
      if (!(await askAI("整节改写为你的表达？", ["「" + sec + "」全文将按写作档案重写（调用 AI 1 次）", "改写后原稿仍可在版本档案找回"], "开始改写"))) return;
      $("wbProg").textContent = "整节改写中…";
      try {
        const r = await WQCore.ai.stream(
          "把下面这一节学术论文文字改写成作者自己的表达：保持论点结构、引用编号[n]、术语与数据不变；按写作档案调整句式、衔接与用词；分段保持清晰；只做语言层面重写，不做规避检测处理。" + styleBlock() + "\n\n【本节原文】\n" + mine, 6000, { temperature: 0.4 });
        const p = liveProj(pid); if (!p) return;
        $("wbMine").value = r.text;
        logLedger(p, sec, "rewrite_full", plainLen(mine));
        saveDraft(sec, true);
        $("wbProg").textContent = "✓ 已改写保存";
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
    /* ③ 数字来源绑定（本地） */
    $("ckNums").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const secs = Object.keys(p.draft || {});
      const hits = [];
      const re = /(?:^|[^\d\[][（(]?)(\d+(?:\.\d+)?(?:%|万|千|亿|个百分点)?)/g;
      secs.forEach(s => {
        const t = p.draft[s] || "";
        let m;
        while ((m = re.exec(t)) && hits.length < 60) {
          const ctx = t.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).replace(/\s+/g, " ");
          const num = m[1];
          if (/^\d{4}$/.test(num)) continue;                    // 年份跳过
          if (/\[\d+\]$/.test(m[0].trim())) continue;           // 引用编号跳过
          hits.push({ sec: s, num, ctx, key: (s + "|" + ctx).slice(0, 80) });
        }
      });
      p.nummap = p.nummap || {};
      const uniq = []; const seen = new Set();
      hits.forEach(h => { if (!seen.has(h.key)) { seen.add(h.key); uniq.push(h); } });
      const bound = uniq.filter(h => p.nummap[h.key] && p.nummap[h.key].src).length;
      const items = uniq.slice(0, 40).map(h => (p.nummap[h.key] && p.nummap[h.key].src ? "✅" : "🔴") + " 「" + h.sec + "」…" + h.ctx + "…" + (p.nummap[h.key] ? "（" + p.nummap[h.key].src + "）" : "（未绑定）"));
      pushCheck(p, "nums", "数字来源绑定（" + uniq.length + " 处）", items, { problem: uniq.length - bound, total: uniq.length, bound });
      $("ckProg").textContent = "完成：数字类表述 " + uniq.length + " 处，已绑定 " + bound + " 处——重要数字务必逐个补来源（文献[n]/数据卡/本人测算）";
      renderChecks();
    });
    /* ④ 格式规范（本地） */
    $("ckFormat").addEventListener("click", () => {
      const p = P(); if (!p) return toast("先新建项目");
      const items = [];
      let problem = 0;
      p.papers.forEach((f, i) => {
        const miss = [];
        if (!f.author) miss.push("作者");
        if (!f.year) miss.push("年份");
        if (!f.venue) miss.push("出处");
        if (miss.length) { items.push("[" + (i + 1) + "] 题录缺 " + miss.join("/") + "：" + f.title.slice(0, 40)); problem++; }
      });
      const allText = Object.keys(p.draft || {}).map(s => p.draft[s]).join("\n");
      const figs = [...allText.matchAll(/(图|表)\s*(\d+)/g)].map(m => m[1] + m[2]);
      const seq = {};
      figs.forEach(x => { const t = x[0], n = +x.slice(1); seq[t] = seq[t] || []; if (!seq[t].includes(n)) seq[t].push(n); });
      Object.keys(seq).forEach(t => {
        const arr = seq[t].sort((a, b) => a - b);
        for (let i = 0; i < arr.length; i++) if (arr[i] !== i + 1) { items.push(t + "编号不连续：出现 " + arr.join(",") + "（缺 " + (i + 1) + " 或顺序错）"); problem++; break; }
      });
      const secs = Object.keys(p.draft || {});
      if (secs.length) {
        const noCite = secs.filter(s => !/\[\d+\]/.test(p.draft[s] || ""));
        if (noCite.length && p.papers.length) { items.push("以下节没有任何引用标注：" + noCite.join("、")); problem++; }
      } else { items.push("还没有「我的稿」内容：先在④修改工作台采用/写作"); problem++; }
      pushCheck(p, "format", "格式规范检查", items, { problem });
      $("ckProg").textContent = problem ? "发现 " + problem + " 处待处理（展开查看）" : "✓ 格式检查通过";
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
        let t = p.draft?.[s] || "";
        if (t) t = t.replace(/〔生成：[^〕]*〕/g, "").trim();
        return `<h2>${esc2(s)}</h2>` + (t ? t.split(/\n+/).map(x => `<p>${esc2(x)}</p>`).join("") : "<p>〔本节未写〕</p>");
      }).join("\n");
      /* 归属说明：按账本，不再只看〔生成：〕标记 */
      const led = WQCore.ledger.analyzeProject(p);
      const pct = v => Math.round(v * 100) + "%";
      const declLines = [];
      Object.keys(led.bySec).forEach(sec => {
        const a = led.bySec[sec];
        declLines.push(sec + "：本人贡献 " + pct(a.contribution) + "（亲笔 " + a.userChars + " 字 / 混合 " + a.mixedChars + " 字 / 参考原样 " + a.aiChars + " 字）");
      });
      const aiDecl = '<h2>AI 辅助说明</h2><p style="font-size:10.5pt;color:#555">本稿在「萤算科研（文渠工作台）」辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。各节归属（按字符估算）：<br>' +
        (declLines.map(esc2).join("<br>") || "（账本为空）") +
        '<br>模型：' + esc2((p.ref && p.ref.model) || WQCore.ai.conf().model || "") + ' · 报告日期：' + WQCore.stamp() +
        '。作者对全部内容与引用的真实性负责。</p>';
      /* 校验摘要：各类型最近一次 */
      const latest = {};
      (p.checks || []).forEach(c => { if (!latest[c.kind]) latest[c.kind] = c; });
      const ckLines = Object.values(latest).map(c => c.label + "：" + (c.stats && c.stats.problem != null ? (c.stats.problem ? c.stats.problem + " 项待处理" : "通过") + "（" + c.ts + "）" : c.ts));
      const ckDecl = ckLines.length ? '<h2>校验记录（最近）</h2><p style="font-size:10.5pt;color:#555">' + ckLines.map(esc2).join("<br>") + "</p>" : "";
      const refs = p.papers.length ? "<h2>参考文献</h2><p style=\"font-size:10.5pt;line-height:1.4\">" +
        p.papers.map((f, i) => "[" + (i + 1) + "] " + esc2(f.author || "作者待补") + ". " + esc2(f.title) + "[" + (f.type || "J") + "]. " + esc2(f.venue || "出处待补") + ", " + esc2(f.year || "年份待补") + (f.doi ? ". DOI:" + esc2(f.doi) : "") + ".").join("<br>") + "</p>" : "";
      const css = EXP_CSS[$("expFmt") ? $("expFmt").value : "plain"] || EXP_CSS.plain;
      const html = `<html><head><meta charset="utf-8"><style>${css}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}</style></head><body><h1>${esc2(p.topic || p.name)}</h1>${parts}${refs}${aiDecl}${ckDecl}<p style="color:#888">—— 由萤算科研·文渠工作台辅助完成（${WQCore.stamp()}）；引用与数据请人工核对 ——</p></body></html>`;
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
    return (f.author ? f.author + ". " : "") + f.title + "[" + (f.type || "J") + "]. " +
      (f.venue || "出处待补") + ", " + (f.year || "年份待补") + (f.doi ? ". DOI: " + f.doi : "") + ".";
  }

  function refAppendixHTML(p, hlN) {
    const rows = p.papers.map(function (f, i) {
      return '<div class="refrow' + (hlN === i + 1 ? " flash" : "") + '" data-rn="' + (i + 1) + '">'
        + '<span class="rn">[' + (i + 1) + ']</span><span class="rt">' + esc(refTxt(f)) + '</span>'
        + '<button class="pillbtn" data-redit="' + (i + 1) + '" title="修订题录（作者/标题/年份/出处/DOI）">✏️修改</button>'
        + (f.doi ? ' <a class="pillbtn" href="https://doi.org/' + esc(f.doi) + '" target="_blank" rel="noopener">DOI</a>' : "")
        + '</div>';
    }).join("");
    return '<div class="refappendix"><b class="rahead">参考文献</b><span class="hint">（References — 编号与正文 [n] 一致；点正文引用可跳到这里，点 ✏️修改 可修订题录，修改会同步到文献库与导出）</span>'
      + '<div class="reflist">' + (rows || '<p class="hint">文献库为空</p>') + '</div></div>';
  }

  function renderRefAppendices(hlN) {
    const p = P();
    const targets = [];
    const wOut = document.getElementById("wOut");
    if (wOut) {
      let ap = document.getElementById("wRefsAppendix");
      if (!ap) { ap = document.createElement("div"); ap.id = "wRefsAppendix"; wOut.insertAdjacentElement("afterend", ap); }
      ap.style.display = p && p.papers.length ? "" : "none";
      targets.push([ap, p]);
    }
    const wb = document.getElementById("wbRefs");
    if (wb) targets.push([wb, p]);
    targets.forEach(function (pair) {
      pair[0].innerHTML = (p && p.papers.length) ? refAppendixHTML(p, hlN) : '<p class="hint">文献库为空</p>';
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
  });

  /* 包装 setMD：#wOut 渲染后自动增强引用并附文末参考文献 */
  (function wrapSetMD() {
    const orig = window.setMD;
    if (typeof orig !== "function") return;
    window.setMD = function (el, text) {
      orig(el, text);
      try {
        if (el && el.id === "wOut") {
          citeEnhance(el);
          renderRefAppendices();
        }
      } catch (e) { console.warn("citeEnhance", e); }
    };
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
      try { renderRefAppendices(); } catch (e) {}
      try { if (window.wqRenderUsage) window.wqRenderUsage(); } catch (e) {}
    }
  };
  /* 本文件在 studio.js 初始化之后加载：挂载完成立即渲染一次 */
  window.WQUI.afterRender();
})();

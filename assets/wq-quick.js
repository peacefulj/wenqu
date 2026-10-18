/* 萤算科研 · 参考稿 Agent（快速模式）wq-quick.js
 * v1.0（2026-10-16）：对标"一键生成"但定位为学习参考稿——
 *   步骤：真实文献 50 篇（OpenAlex）→ AI 提纲（沿用已有材料）→ 分节流式写作（逐节落盘可续跑）
 *        → 图表占位卡（本地生成，不编数据）→ 自检（引用编号/字数）→ 落库进工作台
 *   计费：Agent 免费，只按 token；生成前给预估，生成中显示实际消耗。
 * 依赖：wq-core.js（WQCore / WQStore）；paradigms.js（层级/范式）。
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = WQCore.esc, sleep = WQCore.sleep;
  var OA = "https://api.openalex.org/works";
  var mail = function () { var e = localStorage.getItem("wenqu_email"); return e ? "&mailto=" + encodeURIComponent(e) : ""; };

  function abstractFromInverted(inv) {
    if (!inv) return "";
    var pos = [];
    Object.keys(inv).forEach(function (w) { inv[w].forEach(function (i) { pos[i] = w; }); });
    return (pos.join(" ") || "").slice(0, 900);
  }
  function plainLen(s) { return String(s || "").replace(/\s+/g, "").length; }
  /* 宽容 JSON 解析：剥掉 ```json 围栏、截取首尾大括号 */
  function parseJSONLoose(s) {
    /* v1.0.3：支持数组与对象两种输出——此前只截 {..}，模型返回 [..] 时截成 "{..},{..}]" 直接炸（用户实测报错） */
    s = String(s || "").replace(/```(?:json)?/g, "").trim();
    var a1 = s.indexOf("["), b1 = s.lastIndexOf("]");
    var a2 = s.indexOf("{"), b2 = s.lastIndexOf("}");
    if (a1 >= 0 && (a2 < 0 || a1 < a2) && b1 > a1) {
      try { return JSON.parse(s.slice(a1, b1 + 1)); } catch (e) {}
    }
    if (a2 >= 0 && b2 > a2) {
      try { return JSON.parse(s.slice(a2, b2 + 1)); } catch (e) {}
    }
    throw new Error("返回内容不是合法 JSON");
  }

  var TYPE_SPEC = {
    thesis: { name: "毕业论文", hint: "完整学位论文结构（摘要/引言/文献综述/研究设计/主体分析/结论），章节命名符合国内学位论文惯例" },
    proposal: { name: "开题报告", hint: "开题报告结构（研究背景与意义/文献综述述评/研究内容与研究问题/研究方法与技术路线/进度安排/预期成果）" },
    review: { name: "文献综述", hint: "综述结构（引言/按主题分节的述评/总结与研究空白），以文献对话为主线" },
    journal: { name: "期刊论文", hint: "期刊论文结构（引言/理论与假设/数据与方法/结果/讨论/结论），IMRaD 变体" },
    task: { name: "任务书", hint: "任务书结构（任务目标/任务内容/进度安排/考核标准），条目式，短而实" }
  };

  /* ---------- 设置与状态 ---------- */
  function hasKey() { return !!WQCore.ai.conf().key; }
  function renderKeyState() {
    $("nokey").hidden = hasKey();
    $("qGo").disabled = !hasKey();
    $("qGo").title = hasKey() ? "" : "先在上方填入 API Key";
  }
  (function initSettings() {
    var c = WQCore.ai.conf();
    $("qkBase").value = c.base || ""; $("qkKey").value = c.key || ""; $("qkModel").value = c.model || "";
    $("qkPriceIn").value = c.priceIn || ""; $("qkPriceOut").value = c.priceOut || "";
    /* v1.0.2：自愈——配了非萤算服务商但模型还是默认 glm-5.3-flash（会 503 无渠道），自动探测并修正 */
    (async function autoHeal() {
      try {
        if (!c.key || !c.base) return;
        if (/yingcompute/.test(c.base)) return;
        if (c.model && c.model !== "glm-5.3-flash") return;
        var pr = await WQCore.ai.probeModels(c.base, c.key);
        if (pr.pick && pr.pick !== c.model) {
          WQCore.ai.setConf({ model: pr.pick });
          $("qkModel").value = pr.pick;
          $("qkSaveMsg").textContent = "检测到原模型在该服务商不可用，已自动切换为：" + pr.pick;
          setTimeout(function () { $("qkSaveMsg").textContent = ""; }, 6000);
        }
      } catch (e) { /* 静默 */ }
    })();
    $("qkSave").addEventListener("click", async function () {
      var b = $("qkBase").value.trim() || "https://yingcompute.com/v1";
      var k = $("qkKey").value.trim();
      var m = $("qkModel").value.trim();
      /* v1.0.2：模型名留空 → 自动探测该服务商可用模型（只填 Key 就能用） */
      if (!m) {
        $("qkSaveMsg").textContent = "模型名留空——正在探测可用模型…";
        try {
          var pr = await WQCore.ai.probeModels(b, k);
          m = pr.pick || WQCore.ai.conf().model || "glm-5.3-flash";
          $("qkModel").value = m;
          $("qkSaveMsg").textContent = "已自动选择该服务商可用模型：" + m;
        } catch (e) {
          m = WQCore.ai.conf().model || "glm-5.3-flash";
          $("qkSaveMsg").textContent = "探测失败（" + e.message.slice(0, 40) + "），沿用原模型：" + m;
        }
      }
      WQCore.ai.setConf({ base: b, key: k, model: m, priceIn: $("qkPriceIn").value.trim(), priceOut: $("qkPriceOut").value.trim() });
      if (!($("qkSaveMsg").textContent || "").indexOf("已自动")) $("qkSaveMsg").textContent = "已保存 ✓";
      renderKeyState(); updateEst();
      setTimeout(function () { $("qkSaveMsg").textContent = ""; }, 5000);
    });
  })();

  (function initSelects() {
    var lv = window.WQ_LEVELS || [];
    $("qLevel").innerHTML = lv.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "</option>"; }).join("");
    $("qLevel").value = "bsc";
    $("qParadigm").innerHTML = (window.WQ_PARADIGMS || []).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "（" + esc(x.desc || "") + "）</option>"; }).join("");
    ["qTitle", "qWords", "qSecs", "qRefs", "qType", "qLevel", "qLang", "qMat"].forEach(function (id) {
      $(id).addEventListener("change", updateEst); $(id).addEventListener("input", updateEst);
    });
    renderKeyState();
  })();

  /* ---------- 帮我想题目 ---------- */
  $("qSuggest").addEventListener("click", async function () {
    if (!hasKey()) { $("qSugMsg").textContent = "先配置 Key"; return; }
    var kw = $("qTitle").value.trim();
    var b = $("qSuggest"); b.disabled = true; $("qSugMsg").textContent = "AI 想题目中…";
    try {
      /* v1.0.3：接受宽泛关键词（如「地方债」），结果可编辑后再填入 */
      var ask = kw
        ? "用户输入的关键词是「" + kw + "」（可能是宽泛主题词，如：地方债、乡村振兴）。请基于它给出 3 个具体、可操作的中文论文题目：小切口、数据可得（公开统计/问卷/公开数据库），每个题目一句话说明数据来源。只输出 JSON 数组，格式 [{\"t\":\"题目\",\"d\":\"数据来源\"}]，不要输出任何其他文字。"
        : "面向本科/硕士毕业论文，给出 3 个具体、可操作的中文论文题目（小切口、数据可得），每个题目一句话说明数据来源。只输出 JSON 数组，格式 [{\"t\":\"题目\",\"d\":\"数据来源\"}]，不要输出任何其他文字。";
      var arr = null;
      for (var attempt = 0; attempt < 2 && !arr; attempt++) {
        var txt = await WQCore.ai.call(attempt ? (ask + "（上次输出不是合法 JSON 数组，请严格只输出 JSON 数组本身）") : ask, 600, { temperature: attempt ? 0.3 : 0.8, max_tokens: 600 });
        var parsed = parseJSONLoose(txt);
        if (Array.isArray(parsed)) arr = parsed;
        else if (parsed && typeof parsed === "object") arr = parsed.titles || parsed.data || parsed.list || parsed.items || null;
      }
      if (!arr || !arr.length) throw new Error("AI 没有给出可用的题目列表，请重试");
      arr = arr.slice(0, 3).map(function (x) { return { t: String(x.t || x.title || x.name || "").trim(), d: String(x.d || x.data || x.source || x.desc || "").trim() }; }).filter(function (x) { return x.t; });
      if (!arr.length) throw new Error("AI 返回的题目为空，请重试");
      $("qSugList").innerHTML = arr.map(function (x, i) {
        return '<div class="srcitem" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
          + '<input class="sugEd" data-i="' + i + '" value="' + esc(x.t) + '" style="flex:1;min-width:200px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13px">'
          + '<button class="pill" data-use="' + i + '">✓ 填入</button>'
          + '<div class="hint" style="flex-basis:100%">' + esc(x.d) + '</div></div>';
      }).join("");
      $("qSugList").querySelectorAll("[data-use]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ed = $("qSugList").querySelector('.sugEd[data-i="' + btn.dataset.use + '"]');
          if (ed && ed.value.trim()) { $("qTitle").value = ed.value.trim(); $("qTitle").focus(); updateEst(); }
          $("qSugMsg").textContent = "已填入（可直接修改）";
          setTimeout(function () { $("qSugMsg").textContent = ""; }, 3000);
        });
      });
      $("qSugMsg").textContent = "想到 " + arr.length + " 个题目：可在框里改，改完点「✓ 填入」";
    } catch (e) { $("qSugMsg").textContent = "失败：" + e.message; }
    finally { b.disabled = false; }
  });

  /* ---------- token 预估 ---------- */
  var EST = { inTok: 0, outTok: 0, calls: 0 };
  function updateEst() {
    var words = +$("qWords").value || 12000, secs = +$("qSecs").value || 10, refs = +$("qRefs").value || 50;
    var per = Math.round(words / secs);
    var inTok = 0, outTok = 0, calls = 0;
    if ($("qTitle").value.trim().length >= 5) {
      inTok += refs * 22 + 900; outTok += 1100; calls++;            // 提纲
      inTok += secs * 3600; outTok += secs * per * 1.7; calls += secs; // 分节
    }
    EST = { inTok: inTok, outTok: outTok, calls: calls };
    var box = $("qEst");
    if (!calls) { box.textContent = "填写题目后，这里显示 token 预估与金额。"; return; }
    box.innerHTML = "预估消耗：<b>" + (inTok + outTok).toLocaleString() + " tokens</b>（" + calls + " 次调用；实际以服务商计量为准）<br>" +
      "<span class='hint'>" + WQCore.ai.estCostText(inTok, outTok) + " · 单价可在下方设置填写</span>";
  }

  /* ---------- 步骤面板 ---------- */
  var stepEls = {};
  function renderSteps(steps, state) {
    $("qSteps").innerHTML = steps.map(function (s, i) {
      var cls = state && state[s.id] ? state[s.id].status : "pending";
      var icon = cls === "done" ? "✓" : cls === "running" ? "▶" : cls === "failed" ? "✖" : String(i + 1);
      return '<div class="step ' + cls + '" data-st="' + s.id + '"><span class="st">' + icon + "</span><span>" + esc(s.label) + (cls === "failed" && state[s.id].err ? ' — <span style="color:var(--bad)">' + esc(state[s.id].err) + "</span>" : "") + "</span></div>";
    }).join("");
  }

  /* ---------- 流式输出区 ---------- */
  var outParts = [];
  function outReset() { outParts = []; $("qOut").hidden = false; $("qStream").textContent = ""; }
  function outPush(head, text) {
    outParts.push({ head: head, text: text });
    var html = outParts.map(function (p) { return "【" + p.head + "】\n" + p.text; }).join("\n\n");
    $("qStream").textContent = html;
    $("qOut").scrollTop = $("qOut").scrollHeight;
  }

  var usageStart = null;
  function actualText() {
    var u = WQCore.ai.usageToday();
    var dIn = u.inTok - (usageStart ? usageStart.inTok : 0);
    var dOut = u.outTok - (usageStart ? usageStart.outTok : 0);
    var dCalls = u.calls - (usageStart ? usageStart.calls : 0);
    return "本次会话：" + (dIn + dOut).toLocaleString() + " tokens / " + dCalls + " 次 · 今日累计 " + (u.inTok + u.outTok).toLocaleString() + " tokens" +
      (u.price != null ? " ≈ ¥" + u.price : "");
  }

  /* ---------- 主流程 ---------- */
  var busy = false, ctl = null;
  var TABID = "tab" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); /* v1.0.6 多标签锁 */
  $("qStop").addEventListener("click", function () { if (ctl) ctl.abort(); $("qMsg").textContent = "正在停止…（已完成的分节已保存，可点续跑）"; });

  function collectForm() {
    return {
      title: $("qTitle").value.trim(),
      level: $("qLevel").value,
      type: $("qType").value,
      words: Math.min(80000, Math.max(2000, +$("qWords").value || 12000)),
      secs: +$("qSecs").value,
      refsN: Math.min(200, Math.max(10, +$("qRefs").value || 50)),
      lang: $("qLang").value || "both",
      material: $("qMat").value.trim(),
      paradigm: $("qParadigm").value
    };
  }

  function styleBlock() {
    var s = {}; try { s = JSON.parse(localStorage.getItem("wenqu_style") || "{}"); } catch (e) {}
    var parts = [s.profileText, s.prefs].filter(Boolean);
    return parts.length ? "\n\n【作者写作档案——贴近此风格起草】\n" + parts.join("\n") : "";
  }

  function lvObj(id) { return (window.WQ_LEVELS || []).find(function (x) { return x.id === id; }) || (window.WQ_LEVELS || [])[0]; }
  function pqObj(id) { return (window.WQ_PARADIGMS || []).find(function (x) { return x.id === id; }) || (window.WQ_PARADIGMS || [])[0]; }

  $("qGo").addEventListener("click", async function () {
    if (busy) return;
    var f = collectForm();
    if (!hasKey()) { renderKeyState(); return; }
    if (f.title.length < 2) { $("qMsg").textContent = "主题/关键词至少 2 个字"; $("qTitle").focus(); return; }
    busy = true; ctl = new AbortController();
    proj.runLock = { tab: TABID, ts: Date.now() };
    var lockTimer = setInterval(function () { if (proj.runLock) proj.runLock.ts = Date.now(); }, 20000);
    $("qGo").disabled = true; $("qStop").hidden = false; $("qDoneRow").hidden = true; $("qMsg").textContent = "";
    usageStart = WQCore.ai.usageToday();
    var actualTimer = setInterval(function () { $("qActual").textContent = actualText(); }, 1500);

    var DB = WQCore.loadLocal();
    /* 找可续跑的项目：同题目且流水线未完成 */
    var proj = (DB.projects || []).find(function (p) {
      /* v1.0.6：跳过其他标签页正在生成的项目（心跳 2 分钟内活跃） */
      if (p.runLock && p.runLock.tab !== TABID && Date.now() - (p.runLock.ts || 0) < 120000) return false;
      return p.mode === "quick" && p.topic === f.title && p.pipeline && p.pipeline.status !== "done" && p._form && p._form.type === f.type;
    });
    if (!proj) {
      /* v1.0.5：同主题的未完成项目但表单快照缺失/类型不一致——也复用，避免同题重复建项 */
      proj = (DB.projects || []).find(function (p) {
        return p.mode === "quick" && p.topic === f.title && p.pipeline && p.pipeline.status !== "done";
      });
      if (proj && !proj._form) proj._form = { type: f.type, words: f.words, secs: f.secs, refsN: f.refsN, level: f.level, material: f.material.slice(0, 2000), paradigm: f.paradigm };
    }
    var resumed = !!proj;
    if (!proj) {
      proj = {
        id: "p" + Date.now(), name: f.title.slice(0, 40), topic: f.title, status: "参考稿生成中",
        createdAt: new Date().toISOString().slice(0, 10), mode: "quick",
        selection: "", trend: null, papers: [], matrix: "", outline: "", design: "", draft: {},
        paradigm: f.paradigm, level: f.level,
        ref: { generatedAt: "", type: f.type, words: f.words, sections: {}, order: [] },
        refDraft: {}, versions: [], trail: [], outs: {}
      };
      proj._form = { type: f.type, words: f.words, secs: f.secs, refsN: f.refsN, level: f.level, lang: f.lang, material: f.material.slice(0, 2000), paradigm: f.paradigm };
      DB.projects.unshift(proj); DB.cur = proj.id;
    }
    var saveDB = function () { WQCore.saveLocal(DB); };

    var lv = lvObj(proj._form.level), tp = TYPE_SPEC[proj._form.type] || TYPE_SPEC.thesis;
    var perWords = Math.round(proj._form.words / proj._form.secs);
    /* v1.0.1（QA P2-13）：任务书/开题类是条目式短文，不按整篇论文均摊字数 */
    if (proj._form.type === "task") perWords = Math.min(perWords, 450);
    if (proj._form.type === "proposal") perWords = Math.min(perWords, 800);

    var steps = [
      { id: "refs", label: "检索 " + proj._form.refsN + " 篇真实文献（OpenAlex）", run: stepRefs },
      { id: "outline", label: "AI 生成可编辑提纲", run: stepOutline },
      { id: "write", label: "分节流式写作（逐节落盘）", run: stepWrite },
      { id: "cards", label: "生成图表占位卡（不编数据）", run: stepCards },
      { id: "check", label: "自检：引用编号 / 字数 / 结构", run: stepCheck },
      { id: "finalize", label: "落库 → 进入工作台", run: stepFinalize }
    ];
    /* v1.0.5（提纲确认暂停点）：提纲未生成 → 先只跑「检索+提纲」，暂停等用户编辑确认；
       提纲已确认（或续跑到写正文）→ 六步连跑，已完成步骤自动跳过 */
    var outlineDone = !!(proj.pipeline && (proj.pipeline.steps || []).some(function (x) { return x.id === "outline" && x.status === "done"; }));
    var writeStarted = !!(proj.pipeline && (proj.pipeline.steps || []).some(function (x) { return x.id === "write" && x.status !== "pending"; }));
    var isPaused = !!(proj.pipeline && proj.pipeline.status === "paused");
    var pausedAtOutline = false;
    var runSteps = steps;
    if (!outlineDone) { pausedAtOutline = true; runSteps = steps.slice(0, 2); }
    else if (isPaused && !writeStarted) { pausedAtOutline = true; runSteps = []; }  // 恢复：直接回编辑器，不跑 pipeline

    function ctx() {
      return {
        proj: proj, save: saveDB,
        report: function (msg, pct) { if (msg) $("qMsg").textContent = msg; }
      };
    }
    function stateMap() {
      var m = {};
      (proj.pipeline && proj.pipeline.steps || []).forEach(function (s) { m[s.id] = s; });
      return m;
    }

    try {
      if (!resumed) saveDB();
      outReset();
      if (!resumed) outPush("题目", f.title);
      await WQCore.pipeline.run(proj, runSteps, ctx(), function (msg) {
        renderSteps(steps, stateMap());
        if (msg) $("qMsg").textContent = msg;
      });
      renderSteps(steps, stateMap());
      if (pausedAtOutline) {
        /* 暂停点：展示提纲编辑器，等用户确认后由 oeConfirm 触发续跑 */
        if (runSteps.length) { proj.pipeline.status = "paused"; proj.status = "提纲已生成（待确认）"; saveDB(); }
        renderOutlineEditor(proj);
        $("qMsg").textContent = "提纲已生成（" + (proj.refDraft.outline.sections || []).length + " 节" + (proj._form.secs !== (proj.refDraft.outline.sections || []).length ? "，你设了 " + proj._form.secs + " 节" : "") + "）——请在上方确认/编辑后点「🚀 确认提纲，开始写正文」";
        $("qGo").textContent = "▶ 续跑（从断点继续）";
      } else {
        $("qMsg").textContent = "完成 ✓ 参考稿已存入工作台（共 " + (proj.ref.order || []).length + " 节 / " + (proj.papers || []).length + " 篇文献）";
        $("qGoStudio").href = "studio.html?p=" + proj.id + "&stage=5";
        $("qDoneRow").hidden = false;
        var goMap = document.getElementById("qGoMap");
        if (goMap) { goMap.href = "map.html?p=" + encodeURIComponent(proj.id); }
      }
    } catch (e) {
      renderSteps(steps, stateMap());
      const __stopped = /已手动停止|已停止/.test(e.message) || (ctl && ctl.signal && ctl.signal.aborted);
      $("qMsg").textContent = (__stopped ? "已停止（已完成部分已保存）" : "出错：" + e.message) + " —— 点「续跑」可从断点继续。";
      try { if (proj.pipeline && proj.pipeline.status === "failed") { proj.status = "参考稿中断（可续跑）"; saveDB(); } } catch (e2) {}
      $("qGo").textContent = "▶ 续跑（从断点继续）";
    } finally {
      clearInterval(actualTimer);
      clearInterval(lockTimer);
      delete proj.runLock; saveDB();
      $("qActual").textContent = actualText();
      busy = false; ctl = null;
      $("qStop").hidden = true; $("qGo").disabled = !hasKey();
    }

    /* ===== 步骤实现 ===== */
    async function stepRefs(c, report) {
      report("检索文献中…");
      /* v1.0.3：文献语言可选（中英/中/英，默认中英）——中文主题自动加 AI 翻译的英文检索词，合并去重 */
      var lang = c.proj._form.lang || "both";
      var q0 = c.proj.topic;
      var queries = [q0];
      var cjk = /[\u4e00-\u9fff]/.test(q0);
      if (lang !== "zh" && cjk) {
        report("AI 翻译检索词（中→英）…");
        try {
          var enq = String(await WQCore.ai.call("把下面的中文研究主题翻译成英文学术检索词：只输出英文关键词短语本身（不要整句、不加引号、不要解释）。\n主题：" + q0, 120, { temperature: 0, max_tokens: 120 })).trim().replace(/^["']|["']$/g, "");
          if (enq.length > 3 && queries.indexOf(enq) < 0) queries.push(enq);
        } catch (e) { /* 翻译失败时用原文检索 */ }
      }
      if (lang === "en" && queries.length > 1) queries = [queries[1]];
      var sel = "display_name,publication_year,doi,primary_location,cited_by_count,abstract_inverted_index";
      var per = Math.min(200, c.proj._form.refsN);
      var packs = [];
      for (var qi = 0; qi < queries.length; qi++) {
        var dd = { results: [] };
        try { dd = await fetch(OA + "?search=" + encodeURIComponent(queries[qi]) + "&per-page=" + per + "&select=" + sel + mail()).then(function (r) { return r.json(); }); } catch (e) {}
        packs.push(dd.results || []);
      }
      try {
        var d2 = await fetch(OA + "?search=" + encodeURIComponent(queries[0]) + "&per-page=" + per + "&sort=cited_by_count:desc&select=" + sel + mail()).then(function (r) { return r.json(); });
        packs.push(d2.results || []);
      } catch (e) {}
      var seen = new Set(), refs = [];
      var push = function (w) {
        if (!w || !w.display_name) return;
        var doi = (w.doi || "").replace("https://doi.org/", "");
        var key = (doi || w.display_name).toLowerCase();
        if (seen.has(key)) return; seen.add(key);
        /* v1.0.7（QA三轮 P1-2）：抓作者，参考文献表才合规（此前只存题名/年份/DOI/出处） */
        var au0 = (w.authorships || []).map(function (a) { return (a.author && (a.author.display_name || a.author.raw_author_name)) || ""; }).filter(Boolean);
        var authorStr = au0.slice(0, 3).join("，") + (au0.length > 3 ? "，等" : "");
        refs.push({
          n: refs.length + 1, title: w.display_name, year: w.publication_year || "", doi: doi,
          venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "",
          cited: w.cited_by_count || 0, author: authorStr, abs: abstractFromInverted(w.abstract_inverted_index)
        });
      };
      /* v1.0.3：轮流配额合并——避免第一个检索词占满名额、其他语言被挤出 */
      var maxLen = 0;
      packs.forEach(function (rs) { if (rs.length > maxLen) maxLen = rs.length; });
      for (var ri = 0; ri < maxLen; ri++) {
        packs.forEach(function (rs) { if (rs[ri]) push(rs[ri]); });
      }
      refs = refs.slice(0, c.proj._form.refsN);

      refs = refs.slice(0, c.proj._form.refsN);
      if (refs.length < 10) throw new Error("OpenAlex 命中过少（" + refs.length + " 篇）——题目可能太具体，换个表述重试");
      c.proj.refDraft = c.proj.refDraft || {};
      c.proj.refDraft.refs = refs;
      c.proj.papers = refs.map(function (r0, i) {
        return { id: "f" + c.proj.id + "_" + i, title: r0.title, year: String(r0.year || ""), doi: r0.doi, venue: r0.venue, type: "J", author: r0.author || "", abs: (r0.abs || "").slice(0, 1200) };
      });
      c.save();
      report("✓ 检索到 " + refs.length + " 篇（含 " + refs.filter(function (x) { return x.abs; }).length + " 篇带摘要）· 检索词：" + queries.join(" ＋ "));
      outPush("文献（前 12）", refs.slice(0, 12).map(function (r0) { return "[" + r0.n + "] " + r0.title + " (" + r0.year + ")"; }).join("\n") + (refs.length > 12 ? "\n… 共 " + refs.length + " 篇" : ""));
    }

    async function stepOutline(c, report) {
      if (c.proj.refDraft.outline) return;
      report("AI 生成提纲中…");
      var refs = c.proj.refDraft.refs;
      var refList = refs.map(function (r0) { return "[" + r0.n + "] " + r0.title + " (" + r0.year + ")"; }).join("\n");
      var prompt = "你是学术写作教练。为一份【" + lv.name + "·" + tp.name + "】生成提纲。" +
        "题目：" + c.proj.topic + "\n" +
        "章节要求：" + tp.hint + "；共 " + c.proj._form.secs + " 个正文章节（参考文献表不算章节）——必须正好 " + c.proj._form.secs + " 节，不多不少。\n" +
        "层级要求：" + (lv.innovation || "") + "；文献规模：" + (lv.lit || "") + "。\n" +
        (pqObj(c.proj.paradigm).sections ? "可参考该范式推荐章节：" + pqObj(c.proj.paradigm).sections.join(" / ") + "（按题型调整）\n" : "") +
        (c.proj._form.material ? "用户已有材料/提纲（沿用其结构与思路，可优化）：" + c.proj._form.material.slice(0, 1500) + "\n" : "") +
        "\n文献列表（编号必须从这里取，禁止编造）：\n" + refList.slice(0, 4500) + "\n\n" +
        "只输出 JSON：{\"sections\":[{\"name\":\"章节名\",\"points\":[\"要点1\",\"要点2\",\"要点3\"],\"refs\":[编号数组]}]}，refs 为该节最应引用的文献编号（每节 3-8 个）。";
      var txt = await WQCore.ai.call(prompt, 3000, { temperature: 0.3, signal: ctl.signal });
      var obj;
      try { obj = parseJSONLoose(txt); } catch (e) {
        txt = await WQCore.ai.call(prompt + "\n\n（上次输出不是合法 JSON，请严格只输出 JSON，不要任何解释）", 3000, { temperature: 0, signal: ctl.signal });
        obj = parseJSONLoose(txt);
      }
      var secs = (obj.sections || []).filter(function (s) { return s && s.name; });
      /* v1.0.2：模型偶尔会把「参考文献/致谢/附录」也当正文章节产出（白花钱且结构重复）——确定性剔除 */
      var dropped = [];
      secs = secs.filter(function (s) {
        var nm = String(s.name || "").trim();
        if (/^(参考文献|参考资料|致谢|附录|references|acknowledg)/i.test(nm)) { dropped.push(nm); return false; }
        return true;
      });
      if (secs.length < 3) throw new Error("提纲解析失败（节数过少），请重试");
      if (dropped.length) report("已剔除非正文节：" + dropped.join("、") + "（参考文献表由系统自动生成）");
      c.proj.refDraft.outline = { sections: secs };
      c.save();
      outPush("提纲", secs.map(function (s, i) { return (i + 1) + ". " + s.name + "　" + (s.points || []).slice(0, 3).join("；"); }).join("\n"));
      var want = c.proj._form.secs;
      report("✓ 提纲 " + secs.length + " 节" + (secs.length !== want ? "（你设了 " + want + " 节，模型按内容结构给出 " + secs.length + " 节——以实际结构为准）" : ""));
    }

    async function stepWrite(c, report) {
      var outline = c.proj.refDraft.outline.sections;
      var refs = c.proj.refDraft.refs;
      c.proj.refDraft.sections = c.proj.refDraft.sections || {};
      var refListShort = refs.map(function (r0) { return "[" + r0.n + "] " + r0.title; }).join("；");
      var done = 0;
      for (var i = 0; i < outline.length; i++) {
        var sec = outline[i];
        if (c.proj.refDraft.sections[sec.name] && c.proj.refDraft.sections[sec.name].text && !c.proj.refDraft.sections[sec.name].partial) { done++; continue; }
        report("写作第 " + (done + 1) + "/" + outline.length + " 节：" + sec.name + "（流式输出中）");
        /* 本节文献：优先提纲指定的编号，最多 8 篇，带摘要 */
        var secRefs = (sec.refs || []).map(function (n0) { return refs[n0 - 1]; }).filter(Boolean).slice(0, 8);
        if (secRefs.length < 4) {
          refs.forEach(function (r0) { if (secRefs.length < 6 && secRefs.indexOf(r0) < 0 && r0.abs) secRefs.push(r0); });
        }
        var prevName = i > 0 ? outline[i - 1].name : "";
        var prevTail = prevName && c.proj.refDraft.sections[prevName] ? String(c.proj.refDraft.sections[prevName].text).slice(-350) : "";
        var prompt = "你是学术写作助手。这是给「" + lv.name + "」用的【" + tp.name + "】参考稿（学习参考用途）。现在只写「" + sec.name + "」这一节。\n" +
          "本节要点：\n- " + (sec.points || []).join("\n- ") + "\n" +
          "本节字数目标：约 " + perWords + " 字（不要低于一半、不要超过 " + Math.round(perWords * 1.4) + " 字）。\n" +
          "引用规范：在对应位置标注 [n]；编号只能取自文献列表；本节优先引用：" + secRefs.map(function (r0) { return r0.n; }).join("、") + "。禁止编造文献编号。\n" +
          "数据规范：需要数据、表格、图、公式支撑的地方，写「〔图表占位：说明需要什么数据或图〕」，禁止编造具体数字。\n" +
          (prevTail ? "上一节（" + prevName + "）结尾：「…" + prevTail + "」，自然衔接，不要重复。\n" : "") +
          (c.proj._form.material && i === 0 ? "用户已有材料（尽量沿用其结构思路）：" + c.proj._form.material.slice(0, 800) + "\n" : "") +
          styleBlock() + "\n" +
          "本节重点文献（含摘要）：\n" + secRefs.map(function (r0) { return "[" + r0.n + "] " + r0.title + " (" + r0.year + "). " + r0.venue + "\n摘要：" + (r0.abs || "（无摘要，仅题录，谨慎引用）").slice(0, 420); }).join("\n\n") + "\n\n" +
          "全局文献列表（如需跨节引用）：\n" + refListShort.slice(0, 2500) + "\n\n" +
          "直接输出本节正文（Markdown，可用 #### 小标题），不要输出任何说明文字。";
        var acc = "";
        try {
          var r0 = await WQCore.ai.stream(prompt, { max_tokens: Math.min(8000, perWords * 3 + 1200), temperature: 0.4, signal: ctl.signal }, function (delta, full) {
            acc = full;
            $("qStream").textContent = outParts.map(function (p0) { return "【" + p0.head + "】\n" + p0.text; }).join("\n\n") + "\n\n【" + sec.name + "】\n" + full;
            $("qOut").scrollTop = $("qOut").scrollHeight;
          });
          acc = r0.text;
        } catch (e) {
          if (acc && acc.length > 200) { /* 已流出大半：保存已有部分，标记待续 */ 
            c.proj.refDraft.sections[sec.name] = { text: acc + "\n\n〔未完成：续跑重写本节〕", refs: secRefs.map(function (x) { return x.n; }), partial: true };
            c.save();
          }
          throw e;
        }
        c.proj.refDraft.sections[sec.name] = { text: acc, refs: secRefs.map(function (x) { return x.n; }) };
        outParts.push({ head: sec.name, text: acc });
        $("qStream").textContent = outParts.map(function (p0) { return "【" + p0.head + "】\n" + p0.text; }).join("\n\n");
        $("qOut").scrollTop = $("qOut").scrollHeight;
        done++;
        c.save();
        await sleep(300);
      }
      report("✓ 全部 " + outline.length + " 节写作完成");
    }

    async function stepCards(c, report) {
      var outline = c.proj.refDraft.outline.sections;
      var secs = c.proj.refDraft.sections;
      var n = 0;
      outline.forEach(function (s) {
        var ent = secs[s.name]; if (!ent || ent.partial) return;
        if (/〔图表占位/.test(ent.text)) return;
        var need = /数据|实证|结果|样本|问卷|实验|统计|趋势|对比/.test(s.name + (s.points || []).join(""));
        if (need) {
          ent.text += "\n\n〔图表占位〕本节建议补充（须用你自己的数据/图，替换后删除本占位）：\n- 描述性统计表：变量、均值、标准差、观测数\n- " + (/方法|设计|模型/.test(s.name) ? "变量定义与测量方式表" : "主结果表或对比图（注明数据来源与处理步骤）") + "\n";
          n++;
        }
      });
      c.save();
      report("✓ 补充 " + n + " 处图表占位");
    }

    async function stepCheck(c, report) {
      var refs = c.proj.refDraft.refs;
      var secs = c.proj.refDraft.sections;
      var warns = [], totalChars = 0;
      Object.keys(secs).forEach(function (name) {
        var ent = secs[name], t = ent.text || "";
        totalChars += plainLen(t);
        var used = Array.from(new Set((t.match(/\[(\d+)\]/g) || []).map(function (x) { return parseInt(x.slice(1, -1), 10); })));
        var bad = used.filter(function (k) { return k < 1 || k > refs.length; });
        if (bad.length) warns.push("「" + name + "」引用编号越界：" + bad.join(",") + "（文献只有 " + refs.length + " 篇）");
        if (!used.length) warns.push("「" + name + "」没有任何引用标注");
        if (plainLen(t) < perWords * 0.5) warns.push("「" + name + "」字数偏少（" + plainLen(t) + " / 目标 " + perWords + "）");
        if (ent.partial) warns.push("「" + name + "」上次未写完，建议续跑重写本节");
      });
      c.proj.refDraft.check = { at: WQCore.stamp(), totalChars: totalChars, warns: warns };
      c.save();
      outPush("自检结果", "总字数（去空白）：" + totalChars.toLocaleString() + " / 目标 " + c.proj._form.words.toLocaleString() + "\n\n" +
        (warns.length ? warns.map(function (w0) { return "⚠ " + w0; }).join("\n") : "未发现引用越界、缺引用或字数异常。"));
      report(warns.length ? "自检完成：有 " + warns.length + " 条提醒（详见输出区）" : "✓ 自检全部通过");
    }

    async function stepFinalize(c, report) {
      var rd = c.proj.refDraft;
      var order = rd.outline.sections.map(function (s) { return s.name; });
      var ref0 = c.proj.ref;
      ref0.generatedAt = WQCore.stamp();
      ref0.model = WQCore.ai.conf().model || "";
      ref0.order = order;
      ref0.words = c.proj._form.words;
      ref0.sections = {};
      var full = [];
      order.forEach(function (name) {
        var ent = rd.sections[name] || { text: "" };
        ref0.sections[name] = { text: ent.text || "", refs: ent.refs || [] };
        full.push("## " + name + "\n\n" + (ent.text || ""));
      });
      ref0.fullText = full.join("\n\n");
      c.proj.outline = "## 提纲（" + tp.name + " · " + order.length + " 节）\n\n" + rd.outline.sections.map(function (s, i) {
        return (i + 1) + ". **" + s.name + "** — " + (s.points || []).join("；") + "　〔引：" + (s.refs || []).join(",") + "〕";
      }).join("\n");
      c.proj.selection = "（参考稿自动生成）研究题目：" + c.proj.topic + "。提纲与 50+ 篇真实文献已入库，可在工作台逐节修改、核验引用、加入自己的数据与观点。";
      c.proj.status = "写作中";
      /* 版本档案 + 轨迹（与 studio 的 addVersion/trailAdd 同构） */
      c.proj.versions = c.proj.versions || [];
      c.proj.versions.unshift({ ts: WQCore.stamp(), kind: "参考稿·全文", content: ref0.fullText, field: "ref" });
      if (c.proj.versions.length > 40) c.proj.versions.length = 40;
      c.proj.trail = c.proj.trail || [];
      c.proj.trail.unshift({ ts: WQCore.stamp(), type: "ai", label: "参考稿生成（" + order.length + " 节 / " + (c.proj.papers || []).length + " 篇文献）", note: "模型 " + ref0.model + " · 参考 Agent，逐节落盘" });
      delete c.proj._form; // 表单快照已完成使命（续跑判断用不到再保留）
      c.save();
      report("✓ 已存入工作台");
    }
  });

  /* ---------- v1.0.5：提纲确认暂停点 —— 生成提纲后暂停，可编辑/增删节，确认后才开始写正文 ---------- */
  var oeProj = null;
  function renderOutlineEditor(proj) {
    oeProj = proj;
    var box = $("qOutlineEd");
    if (!box) return;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    drawOE(proj.refDraft.outline.sections);
  }
  function drawOE(secs) {
    $("oeRows").innerHTML = secs.map(function (s, i) {
      return '<div class="oeRow" data-i="' + i + '">'
        + '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">'
        + '<span class="hint" style="flex:0 0 3.2em">第' + (i + 1) + '节</span>'
        + '<input class="oeName" value="' + esc(s.name) + '" style="flex:1;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13px;font-weight:600">'
        + '<button class="pill" data-oedel="' + i + '">删</button></div>'
        + '<textarea class="oePts" rows="2" style="width:100%;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:12.5px">' + esc((s.points || []).join("\n")) + '</textarea>'
        + (s.refs && s.refs.length ? '<div class="hint" style="margin-top:3px">建议引用：[' + s.refs.join("][") + ']</div>' : '')
        + '</div>';
    }).join("");
    $("oeRows").querySelectorAll("[data-oedel]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = +btn.dataset.oedel;
        if ($("oeRows").querySelectorAll(".oeRow").length <= 2) { $("oeMsg").textContent = "至少保留 2 节"; return; }
        btn.closest(".oeRow").remove();
        [...$("oeRows").querySelectorAll(".oeRow")].forEach(function (row, k) {
          row.querySelector(".hint").textContent = "第" + (k + 1) + "节";
        });
      });
    });
  }
  function oeCollect() {
    var secs = [];
    var names = {};
    [...$("oeRows").querySelectorAll(".oeRow")].forEach(function (row, idx) {
      var name = row.querySelector(".oeName").value.trim();
      if (!name) name = "未命名章节" + (idx + 1);
      while (names[name]) name = name + "·";
      names[name] = 1;
      var pts = row.querySelector(".oePts").value.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var old = (oeProj.refDraft.outline.sections || []).find(function (s) { return s.name === name; });
      secs.push({ name: name, points: pts, refs: old ? (old.refs || []) : [] });
    });
    return secs;
  }
  function withProj(fn) {
    var DB = WQCore.loadLocal();
    var p2 = DB.projects.find(function (x) { return x.id === oeProj.id; });
    if (p2) { fn(p2, DB); return true; }
    $("oeMsg").textContent = "项目已被删除，无法继续"; return false;
  }
  $("oeConfirm")?.addEventListener("click", function () {
    if (!oeProj) return;
    var secs = oeCollect();
    if (!withProj(function (p2, DB) {
      p2.refDraft.outline.sections = secs;
      p2.refDraft.outline.__edited = true;
      p2.pipeline.status = "running";   /* v1.0.5：确认后置回 running，qGo 才会进入写正文 */
      p2.status = "参考稿生成中";
      WQCore.saveLocal(DB);
    })) return;
    $("qOutlineEd").hidden = true;
    $("qGo").click();   /* 走统一入口：已完成步骤自动跳过，从写正文开始 */
  });
  $("oeSkip")?.addEventListener("click", function () {
    if (!oeProj) return;
    if (!withProj(function (p2, DB) {
      p2.pipeline.status = "running";
      p2.status = "参考稿生成中";
      WQCore.saveLocal(DB);
    })) return;
    $("qOutlineEd").hidden = true;
    $("qGo").click();
  });
  $("oeRegen")?.addEventListener("click", function () {
    if (!withProj(function (p2, DB) {
      p2.refDraft.outline = null;
      p2.refDraft.sections = {};
      (p2.pipeline.steps || []).forEach(function (st) {
        if (st.id !== "refs") st.status = "pending";
      });
      p2.pipeline.status = "running";
      p2.status = "参考稿生成中";
      WQCore.saveLocal(DB);
    })) return;
    $("qOutlineEd").hidden = true;
    $("qGo").textContent = "🚀 开始生成参考稿";
    $("qGo").click();
  });
  $("oeAdd")?.addEventListener("click", function () {
    var div = document.createElement("div");
    div.className = "oeRow";
    var i = $("oeRows").querySelectorAll(".oeRow").length;
    div.innerHTML = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">'
      + '<span class="hint" style="flex:0 0 3.2em">新节</span>'
      + '<input class="oeName" value="新章节" style="flex:1;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13px;font-weight:600">'
      + '<button class="pill" data-oedel="' + i + '">删</button></div>'
      + '<textarea class="oePts" rows="2" style="width:100%;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:12.5px"></textarea>';
    $("oeRows").appendChild(div);
    div.querySelector("[data-oedel]").addEventListener("click", function () { div.remove(); });
    div.querySelector(".oeName").focus();
  });
  $("qOutlineEd")?.addEventListener("click", function (e) {
    /* 行内“删”按钮用事件委托兜底（drawOE 已单独绑定，双保险） */
    var b = e.target.closest("[data-oedel]");
    if (b && !b._bound) { b._bound = true; b.addEventListener("click", function () { var r = b.closest(".oeRow"); if (r) r.remove(); }); }
  });


  /* ---------- 续跑入口：刷新后列出可续跑的参考稿 ---------- */
  (function listResumable() {
    var DB = WQCore.loadLocal();
    var pend = (DB.projects || []).filter(function (p) { return p.mode === "quick" && p.pipeline && p.pipeline.status !== "done"; });
    if (!pend.length) return;
    var box = document.createElement("div");
    box.className = "callout c-info";
    box.style.margin = "10px 0";
    box.innerHTML = "<b>有未完成的参考稿：</b>" + pend.map(function (p) {
      return '<div style="margin-top:6px">' + esc(p.name) + "（" + esc(WQCore.pipeline.statusText(p)) + "） <a class='pill' href='javascript:void(0)' data-resume='" + p.id + "'>载入表单并续跑</a> <a class='pill' href='studio.html?p=" + p.id + "&stage=4'>去工作台</a></div>";
    }).join("");
    document.querySelector(".quickgrid").before(box);
    box.querySelectorAll("[data-resume]").forEach(function (a) {
      a.addEventListener("click", function () {
        var p = WQCore.loadLocal().projects.find(function (x) { return x.id === a.dataset.resume; });
        if (!p || !p._form) { $("qMsg").textContent = "该项目缺少表单快照，无法自动续跑（可能生成于旧版本）"; return; }
        $("qTitle").value = p.topic;
        $("qLevel").value = p._form.level; $("qType").value = p._form.type;
        $("qWords").value = p._form.words; $("qSecs").value = p._form.secs;
        $("qRefs").value = p._form.refsN; $("qParadigm").value = p._form.paradigm; $("qLang").value = p._form.lang || "both";
        $("qMat").value = p._form.material || "";
        $("qGo").textContent = "▶ 续跑（从断点继续）";
        $("qGo").click();
        box.remove();
      });
    });
  })();

  updateEst();
})();

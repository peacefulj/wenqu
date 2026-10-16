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
    s = String(s || "").replace(/```(?:json)?/g, "").trim();
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
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
    ["qTitle", "qWords", "qSecs", "qRefs", "qType", "qLevel", "qMat"].forEach(function (id) {
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
      var txt = await WQCore.ai.call(
        (kw ? "围绕主题「" + kw + "」" : "面向本科/硕士毕业论文") + "，给出 3 个中文论文题目。要求：小切口、可操作、数据可得（公开统计/问卷/公开数据库），每个题目一句话说明数据来源。只输出 JSON 数组：[{\"t\":\"题目\",\"d\":\"数据来源\"}]", 600, { temperature: 0.8, max_tokens: 600 });
      var arr = parseJSONLoose(txt); if (!Array.isArray(arr)) throw new Error("格式异常");
      $("qSugList").innerHTML = arr.slice(0, 3).map(function (x, i) {
        return '<div class="srcitem"><b>' + esc(x.t || x.title || "") + '</b><div class="hint">' + esc(x.d || "") + ' <button class="pill" data-use="' + i + '">用这个</button></div></div>';
      }).join("");
      var titles = arr.slice(0, 3).map(function (x) { return x.t || x.title || ""; });
      $("qSugList").querySelectorAll("[data-use]").forEach(function (btn) {
        btn.addEventListener("click", function () { $("qTitle").value = titles[+btn.dataset.use] || ""; updateEst(); });
      });
      $("qSugMsg").textContent = "";
    } catch (e) { $("qSugMsg").textContent = "失败：" + e.message; }
    finally { b.disabled = false; }
  });

  /* ---------- token 预估 ---------- */
  var EST = { inTok: 0, outTok: 0, calls: 0 };
  function updateEst() {
    var words = +$("qWords").value, secs = +$("qSecs").value, refs = +$("qRefs").value;
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
  $("qStop").addEventListener("click", function () { if (ctl) ctl.abort(); $("qMsg").textContent = "正在停止…（已完成的分节已保存，可点续跑）"; });

  function collectForm() {
    return {
      title: $("qTitle").value.trim(),
      level: $("qLevel").value,
      type: $("qType").value,
      words: +$("qWords").value,
      secs: +$("qSecs").value,
      refsN: +$("qRefs").value,
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
    if (f.title.length < 5) { $("qMsg").textContent = "题目至少 5 个字"; $("qTitle").focus(); return; }
    busy = true; ctl = new AbortController();
    $("qGo").disabled = true; $("qStop").hidden = false; $("qDoneRow").hidden = true; $("qMsg").textContent = "";
    usageStart = WQCore.ai.usageToday();
    var actualTimer = setInterval(function () { $("qActual").textContent = actualText(); }, 1500);

    var DB = WQCore.loadLocal();
    /* 找可续跑的项目：同题目且流水线未完成 */
    var proj = (DB.projects || []).find(function (p) {
      return p.mode === "quick" && p.topic === f.title && p.pipeline && p.pipeline.status !== "done" && p._form && p._form.type === f.type;
    });
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
      proj._form = { type: f.type, words: f.words, secs: f.secs, refsN: f.refsN, level: f.level, material: f.material.slice(0, 2000), paradigm: f.paradigm };
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
      await WQCore.pipeline.run(proj, steps, ctx(), function (msg) {
        renderSteps(steps, stateMap());
        if (msg) $("qMsg").textContent = msg;
      });
      renderSteps(steps, stateMap());
      $("qMsg").textContent = "完成 ✓ 参考稿已存入工作台（共 " + (proj.ref.order || []).length + " 节 / " + (proj.papers || []).length + " 篇文献）";
      $("qGoStudio").href = "studio.html?p=" + proj.id + "&stage=4";
      $("qDoneRow").hidden = false;
    } catch (e) {
      renderSteps(steps, stateMap());
      const __stopped = /已手动停止|已停止/.test(e.message) || (ctl && ctl.signal && ctl.signal.aborted);
      $("qMsg").textContent = (__stopped ? "已停止（已完成部分已保存）" : "出错：" + e.message) + " —— 点「续跑」可从断点继续。";
      try { if (proj.pipeline && proj.pipeline.status === "failed") { proj.status = "参考稿中断（可续跑）"; saveDB(); } } catch (e2) {}
      $("qGo").textContent = "▶ 续跑（从断点继续）";
    } finally {
      clearInterval(actualTimer);
      $("qActual").textContent = actualText();
      busy = false; ctl = null;
      $("qStop").hidden = true; $("qGo").disabled = !hasKey();
    }

    /* ===== 步骤实现 ===== */
    async function stepRefs(c, report) {
      report("检索文献中…");
      var q = c.proj.topic;
      var sel = "display_name,publication_year,doi,primary_location,cited_by_count,abstract_inverted_index";
      var d1 = await fetch(OA + "?search=" + encodeURIComponent(q) + "&per-page=" + Math.min(200, c.proj._form.refsN) + "&select=" + sel + mail()).then(function (r) { return r.json(); });
      var d2 = {};
      try {
        d2 = await fetch(OA + "?search=" + encodeURIComponent(q) + "&per-page=" + Math.min(200, c.proj._form.refsN) + "&sort=cited_by_count:desc&select=" + sel + mail()).then(function (r) { return r.json(); });
      } catch (e) { d2 = { results: [] }; }
      var seen = new Set(), refs = [];
      var push = function (w) {
        if (!w || !w.display_name) return;
        var doi = (w.doi || "").replace("https://doi.org/", "");
        var key = (doi || w.display_name).toLowerCase();
        if (seen.has(key)) return; seen.add(key);
        refs.push({
          n: refs.length + 1, title: w.display_name, year: w.publication_year || "", doi: doi,
          venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "",
          cited: w.cited_by_count || 0, abs: abstractFromInverted(w.abstract_inverted_index)
        });
      };
      (d1.results || []).forEach(push);
      (d2.results || []).forEach(push);
      refs = refs.slice(0, c.proj._form.refsN);
      if (refs.length < 10) throw new Error("OpenAlex 命中过少（" + refs.length + " 篇）——题目可能太具体，换个表述重试");
      c.proj.refDraft = c.proj.refDraft || {};
      c.proj.refDraft.refs = refs;
      c.proj.papers = refs.map(function (r0, i) {
        return { id: "f" + c.proj.id + "_" + i, title: r0.title, year: String(r0.year || ""), doi: r0.doi, venue: r0.venue, type: "J", author: "", abs: (r0.abs || "").slice(0, 1200) };
      });
      c.save();
      report("✓ 检索到 " + refs.length + " 篇（含 " + refs.filter(function (x) { return x.abs; }).length + " 篇带摘要）");
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
        if (c.proj.refDraft.sections[sec.name] && c.proj.refDraft.sections[sec.name].text) { done++; continue; }
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
        $("qRefs").value = p._form.refsN; $("qParadigm").value = p._form.paradigm;
        $("qMat").value = p._form.material || "";
        $("qGo").textContent = "▶ 续跑（从断点继续）";
        $("qGo").click();
        box.remove();
      });
    });
  })();

  updateEst();
})();

/* 萤算科研 · 核心底座 wq-core.js
 * v1.0（2026-10-16）：给快速模式与工作台共用的纯前端能力，全部 IIFE 封装、零依赖：
 *   1) WQStore —— localStorage 读写 + IndexedDB 全量镜像/自愈 + 版本档案归档（防 5MB 配额爆掉）
 *   2) WQAI    —— SSE 流式调用（实测 usage 优先，无 usage 用估算）+ 本机用量统计与费用折算
 *   3) WQPipeline —— 带检查点的多步流水线（断网/关页可续跑，逐节落盘不白花钱）
 *   4) WQDiff  —— 段落级 diff（含段内字符级 LCS）
 *   5) WQLedger —— 归属账本：段落来源判定（ai_ref / mixed / user）与本人贡献度
 * 约定：本文件先于 wq-ui.js 加载；quick.html 也可单独使用（不依赖 studio.js）。
 */
(function () {
  "use strict";

  var LS_DB = "wenqu_studio";   // 与 studio.js 同一把钥匙：快速模式与工作台共享项目库
  var LS_AI = "wenqu_ai";
  var LS_USAGE = "wenqu_usage";
  var IDB_NAME = "wenqu-idb";
  var IDB_VER = 1;

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function uid(pre) { return (pre || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ================= 1) 存储层 ================= */
  function loadLocal() {
    var empty = { projects: [], cur: null, _loadedAt: Date.now() };
    try {
      var raw = localStorage.getItem(LS_DB);
      if (!raw) return empty;
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.projects)) {
        /* v1.0.5：页面中途被关/刷新会留下 pipeline.status="running" 的僵尸——
           载入时统一改判为可续跑的中断，否则永远显示"生成中"且状态误导 */
        d.projects.forEach(function (p0) {
          if (p0.pipeline && p0.pipeline.status === "running") {
            p0.pipeline.status = "failed";
            (p0.pipeline.steps || []).forEach(function (st) { if (st.status === "running") st.status = "failed"; });
            if (p0.status === "参考稿生成中") p0.status = "参考稿中断（可续跑）";
          }
        });
        d._loadedAt = Date.now();
        return d;
      }
    } catch (e) { /* 损坏由 studio.js 统一处理；快速模式读到损坏就当空库 */ }
    return empty;
  }
  function saveLocal(db) {
    /* v1.0.5（QA二轮 P1-1）：跨标签保护——磁盘快照比本内存快照新（别的标签页刚保存过）时，
       按项目合并后再写：以磁盘为底、本快照同 id 项目覆盖、本快照独有项目插到最前。
       这样 studio 侧的新修改不会被 quick 侧的旧快照整体冲掉。 */
    var disk = null;
    try {
      var raw = localStorage.getItem(LS_DB);
      if (raw) disk = JSON.parse(raw);
    } catch (e) { disk = null; }
    if (disk && Array.isArray(disk.projects) && (db.projects || []).length >= 0 &&
        (disk.savedAt || 0) > (db._loadedAt || 0) + 1500) {
      var byId = {};
      (db.projects || []).forEach(function (p) { byId[p.id] = p; });
      var merged = [], seen = {};
      (disk.projects || []).forEach(function (p) { merged.push(byId[p.id] || p); seen[p.id] = 1; });
      (db.projects || []).forEach(function (p) {
        if (!seen[p.id]) { merged.unshift(p); seen[p.id] = 1; }
      });
      db.projects = merged;
      if (!db.cur && disk.cur) db.cur = disk.cur;
    }
    db.savedAt = Date.now();
    db._loadedAt = db.savedAt;
    try {
      localStorage.setItem(LS_DB, JSON.stringify(db));
      WQStore.mirror(db);           // 异步镜像，失败静默
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e };
    }
  }

  var WQStore = {
    mirror: function (db) { return idbCall("mirror", db); },       // 防抖镜像当前库
    hydrate: function () { return idbCall("hydrate"); },          // 页面启动时用 IDB 自愈 localStorage
    archiveVersions: function (db) { return idbCall("archive", db); }, // 配额满：版本正文归档到 IDB
    getVersion: function (pid, idx) { return idbCall("getVer", { pid: pid, idx: idx }); },
    available: false
  };
  var idbP = null, mirrorTimer = null, pendingDb = null;
  function idbOpen() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve, reject) {
      try {
        if (!window.indexedDB) return reject(new Error("no-idb"));
        var req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
          if (!db.objectStoreNames.contains("vers")) db.createObjectStore("vers");
        };
        req.onsuccess = function () { WQStore.available = true; resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("idb-open-fail")); };
      } catch (e) { reject(e); }
    }).catch(function (e) { WQStore.available = false; throw e; });
    return idbP;
  }
  function tx(store, mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  /* 把三种 IDB 操作收敛成一个入口，全部 best-effort（浏览器不支持就静默降级） */
  function idbCall(op, arg) {
    if (op === "mirror") {
      pendingDb = arg;
      if (mirrorTimer) clearTimeout(mirrorTimer);
      mirrorTimer = setTimeout(function () {
        var db = pendingDb; pendingDb = null; mirrorTimer = null;
        tx("kv", "readwrite", function (s) { s.put({ db: db, savedAt: Date.now() }, "db"); }).catch(function () {});
      }, 1200);
      return Promise.resolve();
    }
    if (op === "hydrate") {
      return tx("kv", "readonly", function (s) { return s.get("db"); }).then(function (rec) {
        var local = loadLocal();
        if (!rec || !rec.db || !Array.isArray(rec.db.projects)) return { adopted: false, reason: "idb-empty" };
        var lAt = +local.savedAt || 0, iAt = +rec.savedAt || 0;
        var localEmpty = !local.projects.length;
        if (localEmpty || iAt > lAt + 3000) {
          try {
            localStorage.setItem(LS_DB, JSON.stringify(rec.db));
            return { adopted: true, projects: rec.db.projects.length, from: localEmpty ? "idb-empty-local" : "idb-newer" };
          } catch (e) { return { adopted: false, reason: "local-write-fail" }; }
        }
        return { adopted: false, reason: "local-fresh", idbAt: iAt, localAt: lAt };
      }).catch(function (e) { return { adopted: false, reason: "idb-fail:" + (e && e.message) }; });
    }
    if (op === "archive") {
      /* 配额满时的减重：把版本正文搬进 IDB，localStorage 只留前 300 字预览 */
      var db = arg, moved = 0, freed = 0;
      var jobs = [];
      (db.projects || []).forEach(function (p) {
        (p.versions || []).forEach(function (v, i) {
          if (v.archived || !v.content || v.content.length < 3000) return;
          freed += v.content.length; moved++;
          var key = p.id + ":" + i;
          var content0 = v.content;   /* v3.2（P0 修复）：先捕获——tx 回调异步执行时 v.content 已被截成预览（v30 闭包 bug，曾把预览当全文存进 IDB） */
          jobs.push(tx("vers", "readwrite", function (s) { s.put(content0, key); }));
          v.archived = true; v.archiveKey = key;
          v.content = v.content.slice(0, 300) + "\n…〔正文 " + v.content.length + " 字已归档到 IndexedDB；在版本档案里点开会自动回取〕";
        });
      });
      return Promise.all(jobs).then(function () { return { moved: moved, freedChars: freed }; })
        .catch(function () { return { moved: 0, freedChars: 0 }; });
    }
    if (op === "getVer") {
      return tx("vers", "readonly", function (s) { return s.get(arg.pid + ":" + arg.idx); })
        .then(function (c) { return c || null; }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  /* ================= 2) AI：流式 + 计量 ================= */
  var AI_DEF = { base: "https://yingcompute.com/v1", model: "glm-5.3-flash" };
  function conf() {
    try { return Object.assign({}, AI_DEF, JSON.parse(localStorage.getItem(LS_AI) || "{}")); }
    catch (e) { return Object.assign({}, AI_DEF); }
  }
  function setConf(o) {
    try { localStorage.setItem(LS_AI, JSON.stringify(Object.assign({}, conf(), o || {}))); return true; } catch (e) { return false; }
  }
  /* token 估算：CJK 约 1 字≈1 token，拉丁约 4 字符≈1 token（保守取整） */
  function estimateTokens(text) {
    var s = String(text || ""), cjk = 0, other = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x2e80 && c <= 0x9fff) cjk++; else other++;
    }
    return Math.ceil(cjk + other / 4);
  }
  function usageTodayAdd(inTok, outTok) {
    var all = {};
    try { all = JSON.parse(localStorage.getItem(LS_USAGE) || "{}"); } catch (e) {}
    var day = new Date().toISOString().slice(0, 10);
    var d = all[day] || { inTok: 0, outTok: 0, calls: 0 };
    d.inTok += inTok || 0; d.outTok += outTok || 0; d.calls++;
    all[day] = d;
    try { localStorage.setItem(LS_USAGE, JSON.stringify(all)); } catch (e) {}
    return d;
  }
  function usageToday() {
    try {
      var all = JSON.parse(localStorage.getItem(LS_USAGE) || "{}");
      var d = all[new Date().toISOString().slice(0, 10)] || { inTok: 0, outTok: 0, calls: 0 };
      d.price = priceOf(d);
      return d;
    } catch (e) { return { inTok: 0, outTok: 0, calls: 0, price: null }; }
  }
  /* 费用折算：单价（元/百万 token）由用户在设置里填，未填则返回 null（只报 token，不编造金额） */
  function priceOf(d) {
    var c = conf();
    var pin = parseFloat(c.priceIn), pout = parseFloat(c.priceOut);
    if (!isFinite(pin) && !isFinite(pout)) return null;
    var v = (d.inTok || 0) / 1e6 * (isFinite(pin) ? pin : 0) + (d.outTok || 0) / 1e6 * (isFinite(pout) ? pout : 0);
    return Math.round(v * 10000) / 10000;
  }
  function estCostText(inTok, outTok) {
    var probe = { inTok: inTok, outTok: outTok };
    var v = priceOf(probe);
    return v == null ? ("约 " + (inTok + outTok).toLocaleString() + " tokens（未填单价，不折算金额）")
      : ("约 " + (inTok + outTok).toLocaleString() + " tokens ≈ ¥" + v);
  }

  /* v1.0.2：探测服务商可用模型——只填 Key 的用户留空模型名时自动选择 */
  var MODEL_PREFS = ["kimi-k2.6", "kimi-k2", "glm-5.3-flash", "glm-5.2", "deepseek-v3", "deepseek-chat", "gpt-4o-mini", "gpt-4.1-mini", "claude-3-5-haiku", "qwen-plus"];
  async function probeModels(base, key) {
    base = String(base || conf().base || "").replace(/\/+$/, "");
    var headers = key ? { Authorization: "Bearer " + key } : {};
    var r = await fetch(base + "/models", { headers: headers });
    if (!r.ok) throw new Error("HTTP " + r.status);
    var j = await r.json();
    var ids = (j.data || []).map(function (m) { return m.id; });
    var pick = null;
    for (var i = 0; i < MODEL_PREFS.length; i++) {
      if (ids.indexOf(MODEL_PREFS[i]) >= 0) { pick = MODEL_PREFS[i]; break; }
      var hit = ids.find(function (x) { return typeof x === "string" && x.indexOf(MODEL_PREFS[i]) === 0; });
      if (hit) { pick = hit; break; }
    }
    if (!pick && ids.length) pick = ids[0];
    return { pick: pick, list: ids };
  }

  /* 流式调用；onDelta 可选。返回 {text, usage, est} */
  async function streamAI(userMsg, opts, onDelta) {
    opts = opts || {};
    var c = conf();
    if (!c.key) throw new Error("未配置 API Key（在「AI / 接口设置」里填好并保存）");
    var base = String(c.base || AI_DEF.base).replace(/\/+$/, "");
    var body = {
      model: opts.model || c.model || AI_DEF.model,
      temperature: opts.temperature == null ? 0.3 : opts.temperature,
      max_tokens: opts.max_tokens || 4096,
      messages: (opts.messages || [{ role: "user", content: userMsg }]),
      stream: true, stream_options: { include_usage: true }
    };
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, opts.timeout || 240000);
    if (opts.signal) { /* 外部停止按钮：用户点「停止」时中断当前请求 */
      if (opts.signal.aborted) ctl.abort();
      else opts.signal.addEventListener("abort", function () { ctl.abort(); }, { once: true });
    }
    var res;
    try {
      res = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key },
        body: JSON.stringify(body), signal: ctl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (opts.signal && opts.signal.aborted) throw new Error("已手动停止");
      throw new Error(e && e.name === "AbortError" ? "请求超时" : ("网络失败：" + (e && e.message)));
    }
    if (!res.ok) {
      clearTimeout(timer);
      var t = await res.text().catch(function () { return ""; });
      /* v1.0.2：模型无渠道是最常见的新手坑，给可执行的指引 */
      if (res.status === 503 || /model_not_found|无可用渠道|does not exist|not found/i.test(t)) {
        throw new Error("模型「" + body.model + "」在该服务商没有可用渠道——请到「AI / 接口设置」更换模型名（留空保存可自动探测可用模型）。原始信息：" + String(t).slice(0, 140));
      }
      throw new Error("HTTP " + res.status + " " + String(t).slice(0, 180));
    }
    var ctype = res.headers.get("content-type") || "";
    var text = "", usage = null;
    if (ctype.indexOf("event-stream") < 0) {
      /* 有的中转站不支持流式：整包 JSON 兜底 */
      var j = await res.json().catch(function () { return null; });
      clearTimeout(timer);
      text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      usage = (j && j.usage) || null;
    } else {
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
      try {
        for (;;) {
          var r = await reader.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            var line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line.indexOf("data:") !== 0) continue;
            var data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            var chunk = null;
            try { chunk = JSON.parse(data); } catch (e) { continue; }
            var d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
            if (d) { text += d; if (onDelta) { try { onDelta(d, text); } catch (e) {} } }
            if (chunk.usage) usage = chunk.usage;
          }
        }
      } catch (e) {
        /* v1.0.1 修复（QA P0-3）：读流阶段的中止（最常见的停止点）也要映射成人话 */
        if ((opts.signal && opts.signal.aborted) || (e && e.name === "AbortError")) throw new Error("已手动停止");
        throw e;
      } finally { clearTimeout(timer); }
    }
    if (!text && opts.signal && opts.signal.aborted) throw new Error("已手动停止");
    if (!text) throw new Error("模型返回为空（检查 Key / 模型 / 余额；推理型模型可能把 token 花在思维链上）");
    var est = usage ? { inTok: usage.prompt_tokens || 0, outTok: usage.completion_tokens || 0, real: true }
      : { inTok: estimateTokens(userMsg), outTok: estimateTokens(text), real: false };
    usageTodayAdd(est.inTok, est.outTok);
    return { text: text, usage: est };
  }
  /* 非流式简单调用（短任务；复用流式实现保证计量一致） */
  function callAI(userMsg, maxTokens, opts) {
    return streamAI(userMsg, Object.assign({ max_tokens: maxTokens || 4096 }, opts || null), null).then(function (r) { return r.text; });
  }

  /* ================= 3) 流水线（检查点续跑） ================= */
  var WQPipeline = {
    /* steps: [{id,label,run(ctx,report)}]；ctx: {proj, save(), force, log()} */
    run: async function (proj, steps, ctx, onProgress) {
      ctx = ctx || {};
      ctx.proj = proj;
      var st = proj.pipeline || (proj.pipeline = { id: uid("pl"), steps: [], result: {}, status: "running", startedAt: stamp() });
      st.steps = st.steps || []; st.result = st.result || {}; st.status = "running";
      steps.forEach(function (s) { if (!st.steps.some(function (x) { return x.id === s.id; })) st.steps.push({ id: s.id, label: s.label, status: "pending" }); });
      var report = function (msg, pct) { if (onProgress) { try { onProgress(msg, pct); } catch (e) {} } };
      ctx.report = report; ctx.save = ctx.save || function () {};
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i], rec = st.steps.find(function (x) { return x.id === s.id; });
        if (rec.status === "done" && !ctx.force) { report("⏭ 已完成：" + s.label, null); continue; }
        rec.status = "running"; rec.err = ""; ctx.save();
        report("▶ " + s.label, null);
        try {
          await s.run(ctx, report);
          rec.status = "done"; rec.at = stamp(); st.result[s.id] = true; ctx.save();
        } catch (e) {
          rec.status = "failed"; rec.err = String((e && e.message) || e); st.status = "failed"; ctx.save();
          report("✖ 失败：" + s.label + " —— " + rec.err, null);
          throw e;
        }
      }
      st.status = "done"; st.finishedAt = stamp(); ctx.save();
      report("✓ 全部完成", 100);
      return st;
    },
    statusText: function (proj) {
      var st = proj && proj.pipeline;
      if (!st) return "未开始";
      var done = st.steps.filter(function (x) { return x.status === "done"; }).length;
      var total = st.steps.length || 1;
      return st.status === "failed" ? ("中断于第 " + (done + 1) + "/" + total + " 步（可续跑）")
        : st.status === "paused" ? ("提纲已生成（" + done + "/" + total + " 步），待确认编辑")
        : st.status === "done" ? "已完成" : ("进行中 " + done + "/" + total);
    }
  };

  /* ================= 4) diff（段落级 + 段内字符级） ================= */
  function paras(t) {
    return String(t || "").split(/\n{2,}|\n(?=\s*[#【〔（(])/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function bigrams(s) {
    s = norm(s); var m = new Map();
    for (var i = 0; i < s.length - 1; i++) { var g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  }
  /* 相似度：字符 bigram 的 Jaccard（0-1），对长度差异惩罚 */
  function sim(a, b) {
    a = norm(a); b = norm(b);
    if (!a && !b) return 1; if (!a || !b) return 0;
    if (a === b) return 1;
    var A = bigrams(a), B = bigrams(b), inter = 0, unionA = 0, unionB = 0;
    A.forEach(function (v, k) { unionA += v; if (B.has(k)) inter += Math.min(v, B.get(k)); });
    B.forEach(function (v, k) { unionB += v; });
    var j = inter / (unionA + unionB - inter || 1);
    var lenPen = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return Math.max(0, Math.min(1, j * (0.5 + 0.5 * lenPen)));
  }
  /* 字符级 LCS diff（限长，防止长文爆栈）→ [{t:'same'|'del'|'add', s}] */
  function chars(a, b, cap) {
    a = String(a || ""); b = String(b || ""); cap = cap || 2600;
    var ta = a.length > cap ? a.slice(0, cap) : a, tb = b.length > cap ? b.slice(0, cap) : b;
    var n = ta.length, m = tb.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Uint16Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = [], x = 0, y = 0;
    while (x < n && y < m) {
      if (ta[x] === tb[y]) { out.push({ t: "same", s: ta[x] }); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push({ t: "del", s: ta[x] }); x++; }
      else { out.push({ t: "add", s: tb[y] }); y++; }
    }
    while (x < n) out.push({ t: "del", s: ta[x++] });
    while (y < m) out.push({ t: "add", s: tb[y++] });
    return out;
  }
  function charsHTML(a, b) {
    return chars(a, b).map(function (x) {
      if (x.t === "same") return esc(x.s);
      if (x.t === "del") return '<del style="color:#b42318;background:#fdecea">' + esc(x.s) + "</del>";
      return '<ins style="color:#0a7a43;background:#eaf7ef;text-decoration:none">' + esc(x.s) + "</ins>";
    }).join("");
  }
  /* 段落级对比：段落数组 LCS + 相似段落标记为 mod → [{type, ai, mine}] */
  function parasDiff(aiText, mineText) {
    var A = paras(aiText), B = paras(mineText), n = A.length, m = B.length, i, j;
    var SIM_MOD = 0.32;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Float32Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) {
      var s = sim(A[i], B[j]);
      var w = s >= SIM_MOD ? s : -0.4;
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], dp[i + 1][j + 1] + w);
    }
    var out = [], x = 0, y = 0;
    while (x < n && y < m) {
      var ss = sim(A[x], B[y]);
      var w2 = ss >= SIM_MOD ? ss : -0.4;
      var cur = dp[x][y];
      if (Math.abs(cur - (dp[x + 1][y + 1] + w2)) < 1e-6 && w2 > 0) {
        out.push({ type: ss >= 0.86 ? "same" : "mod", ai: A[x], mine: B[y], sim: Math.round(ss * 100) / 100 });
        x++; y++;
      } else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push({ type: "del", ai: A[x], mine: "" }); x++; }
      else { out.push({ type: "add", ai: "", mine: B[y] }); y++; }
    }
    while (x < n) out.push({ type: "del", ai: A[x++], mine: "" });
    while (y < m) out.push({ type: "add", ai: "", mine: B[y++] });
    return out;
  }

  /* ================= 5) 归属账本 ================= */
  function plainLen(s) { return String(s || "").replace(/\s+/g, "").length; }
  /* 用参考稿段落判定"我的稿"每段来源 */
  var LEDGER = { SAME: 0.86, PARTIAL: 0.32 };
  function analyzeText(refText, mineText) {
    var refP = paras(refText), mineP = paras(mineText);
    var rows = mineP.map(function (mp) {
      var best = 0, bp = "";
      for (var i = 0; i < refP.length; i++) {
        var s = sim(refP[i], mp);
        if (s > best) { best = s; bp = refP[i]; }
      }
      var origin = best >= LEDGER.SAME ? "ai_ref" : best >= LEDGER.PARTIAL ? "mixed" : "user";
      return { text: mp, origin: origin, sim: Math.round(best * 100) / 100, chars: plainLen(mp) };
    });
    var total = rows.reduce(function (a, r) { return a + r.chars; }, 0);
    var aiChars = rows.filter(function (r) { return r.origin === "ai_ref"; }).reduce(function (a, r) { return a + r.chars; }, 0);
    var mixedChars = rows.filter(function (r) { return r.origin === "mixed"; }).reduce(function (a, r) { return a + (1 - r.sim) * r.chars; }, 0);
    var mixedRaw = rows.filter(function (r) { return r.origin === "mixed"; }).reduce(function (a, r) { return a + r.chars; }, 0);
    var userChars = rows.filter(function (r) { return r.origin === "user"; }).reduce(function (a, r) { return a + r.chars; }, 0);
    var contributed = total ? (userChars + mixedChars) / total : 0;
    return {
      rows: rows, total: total, aiChars: aiChars, mixedChars: mixedRaw, userChars: userChars,
      contribution: Math.round(contributed * 1000) / 1000
    };
  }
  /* 项目级：合并各节（ref 与 draft 按节对齐；ref 条目兼容字符串或 {text} 两种形态） */
  function analyzeProject(p) {
    var secs = Object.keys((p && p.draft) || {});
    var bySec = {}, tot = { total: 0, aiChars: 0, mixedChars: 0, userChars: 0 };
    secs.forEach(function (s) {
      var ent = p.ref && p.ref.sections && p.ref.sections[s];
      var ref = typeof ent === "string" ? ent : (ent && ent.text) || "";
      var mine = p.draft[s] || "";
      if (!mine.trim()) return;
      var a = analyzeText(ref, mine);
      bySec[s] = a;
      tot.total += a.total; tot.aiChars += a.aiChars; tot.mixedChars += a.mixedChars; tot.userChars += a.userChars;
    });
    var contribution = tot.total ? (tot.userChars + tot.mixedChars * 0.5) / tot.total : 0;
    /* mixed 段折半计：既非完全照抄，也非完全亲笔 —— 报告口径里写明白 */
    return { bySec: bySec, total: tot, contribution: Math.round(contribution * 1000) / 1000 };
  }
  function contributionHTML(p) {
    var r = analyzeProject(p);
    if (!r.total || !r.total.total) return '<p class="hint">还没有可统计的稿子：先在下方把参考稿段落「采用/改写」到你的稿子，再点重算。</p>';
    var pct = function (v) { return Math.round(v * 100) + "%"; };
    var t = r.total;
    return '<div class="callout c-info" style="margin:6px 0">' +
      '<b>本人贡献度 ' + pct(r.contribution) + '</b>（按字符数计，混合段折半）　' +
      '<span class="hint">亲笔 ' + pct(t.userChars / t.total) +
      ' · 混合改写 ' + pct(t.mixedChars / t.total) +
      ' · 参考原样 ' + pct(t.aiChars / t.total) + '（共 ' + t.total.toLocaleString() + " 字）</span></div>";
  }

  /* v3.2：数字扫描唯一实现（studio/wq-ui/wq-map 共用；[n] 整数引用排除、置信区间保留、年份启发式） */
  function scanNumHits(t) {
    t = String(t || "");
    var re = /(?:^|[^\d\[（(]?)(\d+(?:\.\d+)?(?:%|万|千|亿|个百分点)?)/g;
    var hits = [], m;
    while ((m = re.exec(t)) && hits.length < 80) {
      var num = m[1];
      var pre = m.index > 0 ? t.charAt(m.index - 1) : "";
      var after = t.charAt(m.index + m[0].length);
      if (pre === "（" || pre === "(") continue;
      if ((pre === "[" || pre === "［") && after === "]" && num.indexOf(".") < 0) continue;
      var ctxFull = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ");
      if (/^\d{4}$/.test(num) && +num >= 1900 && +num <= 2100) {
        var around = t.slice(Math.max(0, m.index - 6), m.index + m[0].length + 6);
        if (/年|年份|年度|—|–|至|到/.test(around)) continue;
      }
      hits.push({ num: num, ctx: ctxFull });
    }
    return hits;
  }

  /* ================= 导出到 window ================= */
  window.WQCore = {
    version: "1.0.0",
    LS_DB: LS_DB, LS_AI: LS_AI,
    esc: esc, sleep: sleep, stamp: stamp, uid: uid,
    loadLocal: loadLocal, saveLocal: saveLocal,
    ai: {
      conf: conf, setConf: setConf, estimateTokens: estimateTokens,
      stream: streamAI, call: callAI, usageToday: usageToday, estCostText: estCostText, probeModels: probeModels,
      usageAll: function () { try { return JSON.parse(localStorage.getItem(LS_USAGE) || "{}"); } catch (e) { return {}; } }
    },
    pipeline: WQPipeline,
    diff: { paras: parasDiff, chars: chars, charsHTML: charsHTML, sim: sim },
    ledger: { analyzeText: analyzeText, analyzeProject: analyzeProject, contributionHTML: contributionHTML },
    scanNumHits: scanNumHits
  };
  window.WQStore = WQStore;
})();

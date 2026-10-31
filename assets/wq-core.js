/* 研墨 · 核心底座 wq-core.js
 * v1.0（2026-10-16）：给快速模式与工作台共用的纯前端能力，全部 IIFE 封装、零依赖：
 *   1) WQStore —— localStorage 读写 + IndexedDB 全量镜像/自愈 + 版本档案归档（防 5MB 配额爆掉）
 *   2) WQAI    —— SSE 流式调用（实测 usage 优先，无 usage 用估算）+ 本机用量统计与费用折算
 *   3) WQPipeline —— 带检查点的多步流水线（断网/关页可续跑，逐节落盘不白花钱）
 *   4) WQDiff  —— 段落级 diff（含段内字符级 LCS）
 *   5) WQLedger —— 归属账本：段落来源判定（ai_ref / mixed / user）与本人贡献度
 * 约定：本文件先于 wq-ui.js 加载；quick.html 也可单独使用（不依赖 studio.js）。
 * v1.1.0：载入时校验项目结构；多标签页按「本页是否改过」合并、删除留墓碑；版本档案不再截断、归档用唯一键；
 *         备份含归档正文（buildBackup/parseBackup）；Key 可只存本次会话；超时与手动停止分开提示；用量按本地日期。
 * 存储键名（wenqu_*、wenqu-idb）沿用旧名，不能改——改了用户已有数据会“消失”。
 */
(function () {
  "use strict";

  var LS_DB = "wenqu_studio";   // 与 studio.js 同一把钥匙：快速模式与工作台共享项目库
  var LS_AI = "wenqu_ai";
  var LS_AI_SESSION = "wenqu_ai_session";   // v1.1.0：「仅本次会话保存 Key」存在 sessionStorage
  var LS_USAGE = "wenqu_usage";
  var IDB_NAME = "wenqu-idb";
  var IDB_VER = 1;
  var APP_VERSION = (window.YANMO && window.YANMO.version) || "";   // 版本号只认 version.js，这里不写死，免得发版后过期

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
  /* v1.1.0：结构校验——导入的坏备份、旧版本残留的异常字段不再让页面崩溃（渲染处大量假定字段类型） */
  function asArr(x) { return Array.isArray(x) ? x : []; }
  function asObj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
  function asStr(x) { return typeof x === "string" ? x : (x == null ? "" : String(x)); }
  function sanitizeProject(p, i) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    if (typeof p.id !== "string" || !p.id) p.id = uid("p") + "_" + (i || 0);
    p.name = asStr(p.name || p.topic || "未命名项目");
    p.topic = asStr(p.topic);
    p.status = asStr(p.status || "选题中");
    p.papers = asArr(p.papers).filter(function (f) { return f && typeof f === "object" && !Array.isArray(f); }).map(function (f, j) {
      if (typeof f.id !== "string" || !f.id) f.id = "f" + uid("") + "_" + j;
      f.title = asStr(f.title);
      ["author", "venue", "doi", "abs", "type"].forEach(function (k) { if (f[k] != null && typeof f[k] !== "string") f[k] = asStr(f[k]); });
      if (f.year != null && typeof f.year !== "string") f.year = asStr(f.year);
      if (f.annots != null) f.annots = asArr(f.annots).filter(function (a) { return a && typeof a === "object"; });
      return f;
    });
    p.versions = asArr(p.versions).filter(function (v) { return v && typeof v === "object" && !Array.isArray(v); }).map(function (v) {
      v.content = asStr(v.content); v.kind = asStr(v.kind); v.ts = asStr(v.ts); v.field = asStr(v.field);
      return v;
    });
    p.trail = asArr(p.trail).filter(function (t) { return t && typeof t === "object"; });
    p.draft = asObj(p.draft);
    Object.keys(p.draft).forEach(function (k) { p.draft[k] = asStr(p.draft[k]); });
    if (p.draftRich != null) p.draftRich = asObj(p.draftRich);
    p.outs = asObj(p.outs);
    ["selection", "matrix", "outline", "design"].forEach(function (k) { if (p[k] != null && typeof p[k] !== "string") p[k] = asStr(p[k]); });
    if (p.trend != null) p.trend = Array.isArray(p.trend) ? p.trend.filter(function (g) { return g && typeof g.key === "string"; }) : null;
    if (p.ref != null && (typeof p.ref !== "object" || Array.isArray(p.ref))) delete p.ref;
    if (p.ref) { p.ref.sections = asObj(p.ref.sections); if (!Array.isArray(p.ref.order)) p.ref.order = Object.keys(p.ref.sections); }
    if (p.refDraft != null) p.refDraft = asObj(p.refDraft);
    ["ledger", "nummap", "mapState"].forEach(function (k) { if (p[k] != null) p[k] = asObj(p[k]); });
    ["journal", "checks", "datacards", "reflows"].forEach(function (k) { if (p[k] != null) p[k] = asArr(p[k]); });
    return p;
  }
  function sanitizeDB(d) {
    d = d && typeof d === "object" && !Array.isArray(d) ? d : {};
    var seen = {}, out = [];
    asArr(d.projects).forEach(function (p, i) {
      var q = sanitizeProject(p, i);
      if (!q) return;
      if (seen[q.id]) q.id = q.id + "_" + i;
      seen[q.id] = 1; out.push(q);
    });
    d.projects = out;
    if (d.cur != null && typeof d.cur !== "string") d.cur = null;
    d.deleted = asObj(d.deleted);
    return d;
  }
  /* 删除墓碑：别的标签页的旧快照不能把已删除的项目写回来；30 天后清理 */
  function pruneDeleted(del) {
    var out = {}, now = Date.now();
    Object.keys(asObj(del)).forEach(function (k) { var t = +del[k] || 0; if (now - t < 30 * 86400000) out[k] = t; });
    return out;
  }

  var BASE_RAW = null;   /* v1.1.0：本页最近一次读/写的磁盘原文——用来判断“本页改过哪些项目” */
  /* opts.peek=true：只读一眼（备份/同步用），不改变本页的合并基准 */
  function loadLocal(opts) {
    var peek = !!(opts && opts.peek);
    var empty = { projects: [], cur: null, deleted: {}, _loadedAt: Date.now() };
    var raw = null;
    try { raw = localStorage.getItem(LS_DB); } catch (e) { return empty; }
    if (!raw) { if (!peek) BASE_RAW = null; return empty; }
    try {
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.projects)) {
        sanitizeDB(d);
        /* v1.0.5：页面中途被关/刷新会留下 pipeline.status="running" 的僵尸——
           载入时统一改判为可续跑的中断，否则永远显示"生成中"且状态误导 */
        d.projects.forEach(function (p0) {
          if (p0.pipeline && p0.pipeline.status === "running") {
            p0.pipeline.status = "failed";
            (p0.pipeline.steps || []).forEach(function (st) { if (st.status === "running") st.status = "failed"; });
            if (p0.status === "参考稿生成中") p0.status = "参考稿中断（可续跑）";
          }
        });
        if (!peek) BASE_RAW = raw;
        d._loadedAt = Date.now();
        return d;
      }
      throw new Error("结构异常");
    } catch (e) {
      if (peek) return empty;
      /* 损坏原文先另存一份，绝不静默丢弃（v1.1.0：从 studio.js 收拢到这里，所有页面同一口径） */
      try { localStorage.setItem(LS_DB + ".bak-" + Date.now(), raw); } catch (e2) {}
      try { console.warn("[研墨] 项目库损坏，原文已另存为 " + LS_DB + ".bak-*"); } catch (e3) {}
      BASE_RAW = null;
      return empty;
    }
  }
  /* v1.1.0（多标签页合并）：别的标签页在本页上次读写之后保存过时，逐项目决定用谁——
     本页没改过的项目 → 用磁盘版（别人可能刚改过）；本页改过的 → 用本页版；
     本页删过的 → 不写回；别处删过、本页没改过的 → 尊重删除。 */
  function mergeProjects(db, disk) {
    var base = null;
    try { base = BASE_RAW ? sanitizeDB(JSON.parse(BASE_RAW)) : null; } catch (e) { base = null; }   /* 与内存版同一口径规整后再比 */
    var baseJ = {};
    asArr(base && base.projects).forEach(function (p) { if (p && p.id) baseJ[p.id] = JSON.stringify(p); });
    var changed = function (p) { return !(p.id in baseJ) || JSON.stringify(p) !== baseJ[p.id]; };
    var delDisk = asObj(disk.deleted), delMine = asObj(db.deleted);
    var mine = {};
    asArr(db.projects).forEach(function (p) { mine[p.id] = p; });
    var out = [], seen = {};
    asArr(disk.projects).forEach(function (dp) {
      if (!dp || !dp.id) return;
      seen[dp.id] = 1;
      if (delMine[dp.id] && !mine[dp.id]) return;
      var mp = mine[dp.id];
      out.push(mp && changed(mp) ? mp : dp);
    });
    asArr(db.projects).forEach(function (mp) {
      if (seen[mp.id]) return;
      if (delDisk[mp.id] && !changed(mp)) return;
      if ((mp.id in baseJ) && !changed(mp)) return;   /* 本页读到过、没改过、磁盘上已没有 → 是别处删除的 */
      out.unshift(mp);
    });
    return out;
  }
  function saveLocal(db) {
    var raw = null, disk = null;
    try { raw = localStorage.getItem(LS_DB); if (raw) disk = JSON.parse(raw); } catch (e) { disk = null; }
    if (disk && Array.isArray(disk.projects) && raw !== BASE_RAW) {
      db.projects = mergeProjects(db, disk);
      if (!db.cur && disk.cur) db.cur = disk.cur;
    }
    db.deleted = pruneDeleted(Object.assign({}, asObj(disk && disk.deleted), asObj(db.deleted)));
    /* 仍在列表里的项目不算删除（导入恢复、明确改过后保留的情况） */
    asArr(db.projects).forEach(function (p) { if (p && p.id) delete db.deleted[p.id]; });
    db.savedAt = Date.now();
    db._loadedAt = db.savedAt;
    try {
      var s = JSON.stringify(db);
      localStorage.setItem(LS_DB, s);
      BASE_RAW = s;
      WQStore.mirror(db);           // 异步镜像，失败静默
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e };
    }
  }
  /* 删除项目：记墓碑，防止其他标签页的旧快照把它写回来 */
  function markDeleted(db, pid) {
    db.deleted = asObj(db.deleted);
    db.deleted[pid] = Date.now();
  }

  /* v1.1.0：备份格式 2——仍以 projects/cur 为根（旧版本能直接读），另附归档到 IndexedDB 的版本正文 */
  function buildBackup(db) {
    var src = db || loadLocal({ peek: true });
    var out = {
      format: "yanmo-backup", formatVersion: 2, app: "研墨", appVersion: APP_VERSION, exportedAt: stamp(),
      cur: src.cur || null, projects: src.projects || [], deleted: asObj(src.deleted), archives: {}
    };
    return WQStore.exportArchives(out).then(function (arc) { out.archives = arc || {}; return out; }, function () { return out; });
  }
  function parseBackup(d) {
    if (!d || typeof d !== "object" || !Array.isArray(d.projects)) throw new Error("不是研墨的备份文件（缺少 projects 列表）");
    var archives = asObj(d.archives);
    var clean = sanitizeDB({ projects: d.projects, cur: d.cur });
    return { projects: clean.projects, cur: clean.cur, archives: archives, appVersion: asStr(d.appVersion), format: asStr(d.format) };
  }

  var WQStore = {
    mirror: function (db) { return idbCall("mirror", db); },       // 防抖镜像当前库
    hydrate: function () { return idbCall("hydrate"); },          // 页面启动时用 IDB 自愈 localStorage
    archiveVersions: function (db) { return idbCall("archive", db); }, // 配额满：版本正文归档到 IDB
    /* v1.1.0：传版本对象（按 archiveKey 取）；兼容旧调用传下标 */
    getVersion: function (pid, ref) { return idbCall("getVer", { pid: pid, ref: ref }); },
    exportArchives: function (db) { return idbCall("expArc", db); },
    importArchives: function (map) { return idbCall("impArc", map); },
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
        var local = loadLocal({ peek: true });
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
        (p.versions || []).forEach(function (v) {
          if (v.archived || !v.content || v.content.length < 3000) return;
          freed += v.content.length; moved++;
          /* v1.1.0：唯一键（旧版用「项目:序号」，版本列表一移位就会互相覆盖） */
          var key = p.id + ":" + uid("v");
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
      var ref = arg.ref;
      var vkey = (ref && typeof ref === "object") ? (ref.archiveKey || "") : (arg.pid + ":" + ref);
      if (!vkey) return Promise.resolve(null);
      return tx("vers", "readonly", function (s) { return s.get(vkey); })
        .then(function (c) { return typeof c === "string" ? c : null; }).catch(function () { return null; });
    }
    if (op === "expArc") {
      /* 备份前把归档正文一次性读出来（单个只读事务） */
      var keys = [];
      asArr(arg && arg.projects).forEach(function (p) {
        asArr(p.versions).forEach(function (v) { if (v.archived && v.archiveKey) keys.push(v.archiveKey); });
      });
      if (!keys.length) return Promise.resolve({});
      return idbOpen().then(function (idb) {
        return new Promise(function (resolve) {
          var out = {};
          var t = idb.transaction("vers", "readonly"), s = t.objectStore("vers");
          keys.forEach(function (k) {
            var r = s.get(k);
            r.onsuccess = function () { if (typeof r.result === "string") out[k] = r.result; };
          });
          t.oncomplete = function () { resolve(out); };
          t.onerror = function () { resolve(out); };
        });
      }).catch(function () { return {}; });
    }
    if (op === "impArc") {
      var map = asObj(arg), ks = Object.keys(map).filter(function (k) { return typeof map[k] === "string"; });
      if (!ks.length) return Promise.resolve(0);
      return tx("vers", "readwrite", function (s) { ks.forEach(function (k) { s.put(map[k], k); }); })
        .then(function () { return ks.length; }).catch(function () { return 0; });
    }
    return Promise.resolve(null);
  }

  /* ================= 2) AI：流式 + 计量 ================= */
  var AI_DEF = { base: "https://yingcompute.com/v1", model: "glm-5.3-flash" };
  function storedConf() {
    try { return Object.assign({}, AI_DEF, JSON.parse(localStorage.getItem(LS_AI) || "{}")); }
    catch (e) { return Object.assign({}, AI_DEF); }
  }
  /* v1.1.0：Key 可只存 sessionStorage（关浏览器即失效）；读配置时会话 Key 优先 */
  function conf() {
    var c = storedConf();
    try {
      var s = JSON.parse(sessionStorage.getItem(LS_AI_SESSION) || "null");
      if (s && s.key) { c.key = s.key; c.sessionKey = true; }
    } catch (e) {}
    return c;
  }
  function isSessionMode() { try { return !!sessionStorage.getItem(LS_AI_SESSION); } catch (e) { return false; } }
  function setConf(o) {
    o = Object.assign({}, o || {});
    var withKey = Object.prototype.hasOwnProperty.call(o, "key"), key = o.key;
    delete o.key; delete o.sessionKey;
    try {
      var c = storedConf();
      Object.assign(c, o);
      delete c.sessionKey;
      localStorage.setItem(LS_AI, JSON.stringify(c));
    } catch (e) { return false; }
    /* 带 Key 保存时沿用当前的保存方式（会话 / 本机），不悄悄改变用户的选择 */
    return withKey ? setKey(key, isSessionMode()) : true;
  }
  /* 保存 Key：sessionOnly=true 时只存本次会话，并清掉 localStorage 里的旧 Key */
  function setKey(key, sessionOnly) {
    try {
      var c = storedConf();
      if (sessionOnly) {
        sessionStorage.setItem(LS_AI_SESSION, JSON.stringify({ key: String(key || "") }));
        delete c.key;
      } else {
        sessionStorage.removeItem(LS_AI_SESSION);
        c.key = String(key || "");
      }
      delete c.sessionKey;
      localStorage.setItem(LS_AI, JSON.stringify(c));
      return true;
    } catch (e) { return false; }
  }
  /* API 地址安全检查：非 HTTPS（本机地址除外）时 Key 会明文传输 */
  function baseWarning(base) {
    var b = String(base || "").trim();
    if (!b) return "";
    if (/^https:\/\//i.test(b)) return "";
    if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(b)) return "";
    return "API 地址不是 HTTPS，Key 和论文内容会以明文在网络上传输——请确认这是你信任的服务";
  }
  function localDay() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
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
    var day = localDay();   /* v1.1.0：按本地日期（原 UTC 会把北京时间 0-8 点算进前一天） */
    var d = all[day] || { inTok: 0, outTok: 0, calls: 0 };
    d.inTok += inTok || 0; d.outTok += outTok || 0; d.calls++;
    all[day] = d;
    try { localStorage.setItem(LS_USAGE, JSON.stringify(all)); } catch (e) {}
    return d;
  }
  function usageToday() {
    try {
      var all = JSON.parse(localStorage.getItem(LS_USAGE) || "{}");
      var d = all[localDay()] || { inTok: 0, outTok: 0, calls: 0 };
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
    var c = conf(), X = AIX();
    base = String(base || c.base || "").replace(/\/+$/, "");
    var fmt = X.resolve({ base: base, format: c.format });   /* v1.3.0：Anthropic 格式用 x-api-key 读 /v1/models */
    var r = await fetch(X.endpoint(fmt, base, "models"), { headers: X.headers(fmt, key, false) });
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 404 ? "（这个接口不提供模型列表，可以直接试一次 AI 功能）" : ""));
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

  /* ================= 2.1) v1.3.0：接口格式 · 思考开关 · 上下文自动压缩 · 调试日志 =================
     拼请求体、解析响应这些纯函数在 ym-ai.js（window.YMAI）；这里负责发请求、重试、计量和记日志。 */
  var LS_AI_DEBUG = "yanmo_ai_debug";   // 最近 40 次 AI 请求的摘要（不含 Key），试用页「AI 调试」里查看
  function AIX() {
    if (!window.YMAI) throw new Error("页面缺少 assets/ym-ai.js——请刷新页面（或清除缓存后重开）");
    return window.YMAI;
  }
  function debugVerbose() {   /* 页面地址带 ?debug=1（或 localStorage yanmo_debug=1）时，控制台打印每次请求 */
    try { return /[?&]debug=1(&|$)/.test(location.search) || localStorage.getItem("yanmo_debug") === "1"; } catch (e) { return false; }
  }
  function hostPath(u) { try { var x = new URL(u); return x.host + x.pathname; } catch (e) { return String(u || "").slice(0, 80); } }
  function debugStart(c, fmt, model, url, req) {
    var last = null;
    (req.messages || []).forEach(function (m) { if (m && m.role !== "system") last = m; });
    return {
      t: stamp(), page: location.pathname.split("/").pop() || "index.html", fmt: fmt, set: c.format || "auto", url: hostPath(url),
      model: model, stream: !!req.stream, think: !!c.thinking, win: 0, inEst: 0, cut: 0, max: 0, status: 0, ms: 0,
      ask: String((last && last.content) || "").replace(/\s+/g, " ").slice(0, 80), _t0: Date.now()
    };
  }
  function debugDone(log, x) {
    if (!log || log._done) return;
    log._done = true;
    var rec = Object.assign({}, log, x || {});
    rec.ms = Date.now() - log._t0;
    delete rec._t0; delete rec._done;
    try {
      var all = JSON.parse(localStorage.getItem(LS_AI_DEBUG) || "[]");
      if (!Array.isArray(all)) all = [];
      all.unshift(rec);
      if (all.length > 40) all.length = 40;
      localStorage.setItem(LS_AI_DEBUG, JSON.stringify(all));
    } catch (e) {}
    if (rec.err) console.warn("[研墨 AI]", rec.fmt, rec.model, rec.status || "", rec.err);
    else if (debugVerbose()) console.log("[研墨 AI] 完成", rec);
  }
  function debugLog() { try { var a = JSON.parse(localStorage.getItem(LS_AI_DEBUG) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function debugClear() { try { localStorage.removeItem(LS_AI_DEBUG); } catch (e) {} }

  /* 发一次请求：按格式拼请求 → 输入超过上下文先压缩 → 接口报上下文超限时按它给的上限再压缩、重试一次。
     网络错误原样抛出（由调用方映射成人话）。返回 {res, fmt, model, url, fit, log} */
  async function aiFetch(c, req) {
    var X = AIX(), fmt = X.resolve(c), model = req.model || c.model || AI_DEF.model;
    var url = X.endpoint(fmt, c.base || AI_DEF.base, "chat"), win = X.ctxWindow(c, model);
    var log = debugStart(c, fmt, model, url, req);
    for (var attempt = 0; ; attempt++) {
      var fit = X.fit(req.messages, req.max_tokens, win);
      var body = X.body(fmt, c, { model: model, messages: fit.messages, max_tokens: fit.max_tokens, temperature: req.temperature, stream: req.stream });
      log.win = win; log.inEst = fit.after; log.cut += fit.cut; log.max = body.max_tokens || body.max_completion_tokens || 0;
      if (debugVerbose()) console.log("[研墨 AI] 请求", url, Object.assign({}, body, { messages: "（" + (body.messages || []).length + " 条，约 " + fit.after + " token）" }));
      var res;
      try {
        res = await fetch(url, { method: "POST", headers: X.headers(fmt, c.key, true), body: JSON.stringify(body), signal: req.signal });
      } catch (e) {
        debugDone(log, { err: (e && e.name === "AbortError") ? "已中止（超时或手动停止）" : "网络失败：" + (e && e.message) });
        throw e;
      }
      log.status = res.status;
      if (!res.ok && attempt === 0) {
        var t = await res.clone().text().catch(function () { return ""; });
        var lim = X.ctxError(res.status, t);
        if (lim) {
          win = lim > 0 ? lim : Math.floor((fit.after + fit.max_tokens) * 0.7);
          log.retry = "接口报上下文超限（" + (lim > 0 ? "上限 " + lim + " token" : "未给上限") + "），已压缩后重试";
          continue;
        }
      }
      return { res: res, fmt: fmt, model: model, url: url, fit: fit, log: log };
    }
  }
  function httpErrorMsg(sent, status, t) {
    t = String(t || "");
    if (status === 404 && !/model/i.test(t)) return "HTTP 404：接口地址不存在（" + hostPath(sent.url) + "）——检查「API 地址」和「接口格式」是否匹配";
    /* v1.0.2：模型无渠道是最常见的新手坑，给可执行的指引 */
    if (status === 503 || /model_not_found|无可用渠道|does not exist|not found/i.test(t)) {
      return "模型「" + sent.model + "」在该服务商没有可用渠道——请到「AI / 接口设置」更换模型名（留空保存可自动探测可用模型）。原始信息：" + t.slice(0, 140);
    }
    var hint = AIX().errorHint(status, t);
    return "HTTP " + status + " " + t.slice(0, 180) + (hint ? "——" + hint : "");
  }
  function emptyMsg(r) {
    if (r.error) return "接口返回错误：" + String(r.error).slice(0, 180);
    if (r.reasoning) return "模型把输出额度都花在了思考上、正文为空——到「AI / 接口设置」关掉「思考模式」，或把「接口格式」选成服务商对应的那一项后重试";
    return "模型返回为空（检查 Key / 模型 / 余额；推理型模型可能把 token 花在思维链上）";
  }
  function usageEst(u, messages, text) {
    if (u) return { inTok: u.prompt_tokens || 0, outTok: u.completion_tokens || 0, real: true };
    var s = "";
    (messages || []).forEach(function (m) { s += String((m && m.content) || ""); });
    return { inTok: estimateTokens(s), outTok: estimateTokens(text), real: false };
  }
  function doneInfo(r, est, text) {
    return { finish: r.finish, inTok: est.inTok, outTok: est.outTok, real: est.real, rTok: (r.usage && r.usage.reasoning_tokens) || 0,
      rsn: (r.reasoning || "").length, text: text.length, ans: text.replace(/\s+/g, " ").slice(0, 120) };
  }

  /* 流式调用；onDelta 可选。返回 {text, usage, finish, cut} */
  async function streamAI(userMsg, opts, onDelta) {
    opts = opts || {};
    var c = conf();
    if (!c.key) throw new Error("未配置 API Key（在「AI / 接口设置」里填好并保存）");
    var messages = opts.messages || [{ role: "user", content: userMsg }];
    var ctl = new AbortController();
    var limitMs = opts.timeout || 240000, timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctl.abort(); }, limitMs);
    var timeoutMsg = function (got) {
      return "请求超时：" + Math.round(limitMs / 1000) + " 秒内没有完成" + (got ? "（已收到 " + got + " 字）" : "") +
        "——可能是网络中断或模型输出过慢，请重试，或换更快的模型";
    };
    if (opts.signal) { /* 外部停止按钮：用户点「停止」时中断当前请求 */
      if (opts.signal.aborted) ctl.abort();
      else opts.signal.addEventListener("abort", function () { ctl.abort(); }, { once: true });
    }
    var sent;
    try {
      sent = await aiFetch(c, { model: opts.model, messages: messages, max_tokens: opts.max_tokens || 4096,
        temperature: opts.temperature == null ? 0.3 : opts.temperature, stream: true, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (opts.signal && opts.signal.aborted) throw new Error("已手动停止");
      throw new Error(timedOut ? timeoutMsg(0) : ("网络失败：" + (e && e.message)));
    }
    var res = sent.res, X = AIX();
    if (!res.ok) {
      clearTimeout(timer);
      var t = await res.text().catch(function () { return ""; });
      var em = httpErrorMsg(sent, res.status, t);
      debugDone(sent.log, { err: em });
      throw new Error(em);
    }
    var ctype = res.headers.get("content-type") || "";
    var text = "", acc = X.newAcc();
    if (ctype.indexOf("event-stream") < 0) {
      /* 有的中转站不支持流式：整包 JSON 兜底 */
      var j = await res.json().catch(function () { return null; });
      clearTimeout(timer);
      var pj = X.parse(sent.fmt, j);
      text = pj.text; acc.reasoning = pj.reasoning; acc.finish = pj.finish; acc.usage = pj.usage; acc.error = pj.error;
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
            var d = X.delta(sent.fmt, chunk, acc);
            if (d) { text += d; if (onDelta) { try { onDelta(d, text); } catch (e) {} } }
          }
        }
      } catch (e) {
        /* v1.0.1 修复（QA P0-3）：读流阶段的中止（最常见的停止点）也要映射成人话；
           v1.1.0：超时与手动停止分开提示（原来超时也显示「已手动停止」） */
        debugDone(sent.log, { err: (opts.signal && opts.signal.aborted) ? "已手动停止" : timedOut ? timeoutMsg(text.length) : "读取中断：" + ((e && e.message) || e), text: text.length });
        if (opts.signal && opts.signal.aborted) throw new Error("已手动停止");
        if (timedOut) { var te = new Error(timeoutMsg(text.length)); te.partial = text; throw te; }
        if (e && e.name === "AbortError") throw new Error("已手动停止");
        throw e;
      } finally { clearTimeout(timer); }
    }
    if (!text && opts.signal && opts.signal.aborted) { debugDone(sent.log, { err: "已手动停止" }); throw new Error("已手动停止"); }
    if (!text) {
      var em2 = emptyMsg(acc);
      debugDone(sent.log, { err: em2, finish: acc.finish, rsn: acc.reasoning.length });
      throw new Error(em2);
    }
    var est = usageEst(acc.usage, messages, text);
    usageTodayAdd(est.inTok, est.outTok);
    debugDone(sent.log, doneInfo(acc, est, text));
    return { text: text, usage: est, finish: acc.finish, cut: sent.fit.cut };
  }
  /* 非流式简单调用（短任务；复用流式实现保证计量一致） */
  function callAI(userMsg, maxTokens, opts) {
    return streamAI(userMsg, Object.assign({ max_tokens: maxTokens || 4096 }, opts || null), null).then(function (r) { return r.text; });
  }
  /* v1.3.0：非流式整包调用（工作台 / 工具台原来各自拼请求，现在统一走这里：同一套格式适配、上下文压缩、计量和调试日志）。
     messages 可以是字符串或消息数组；返回 {text, reasoning, finish, usage, cut} */
  async function completeAI(messages, opts) {
    opts = opts || {};
    var c = conf();
    if (!c.key) throw new Error("未配置 API Key（在「AI / 接口设置」里填好并保存）");
    if (!Array.isArray(messages)) messages = [{ role: "user", content: String(messages || "") }];
    var ctl = new AbortController(), timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctl.abort(); }, opts.timeout || 180000);
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort();
      else opts.signal.addEventListener("abort", function () { ctl.abort(); }, { once: true });
    }
    var sent = null;
    try {
      sent = await aiFetch(c, { model: opts.model, messages: messages, max_tokens: opts.max_tokens || 4096,
        temperature: opts.temperature == null ? 0.3 : opts.temperature, stream: false, signal: ctl.signal });
      if (!sent.res.ok) {
        var t = await sent.res.text().catch(function () { return ""; });
        var em = httpErrorMsg(sent, sent.res.status, t);
        debugDone(sent.log, { err: em });
        throw new Error(em);
      }
      var j = await sent.res.json().catch(function (e) { if (e && e.name === "AbortError") throw e; return null; });
      var p = AIX().parse(sent.fmt, j);
      if (!p.text) {
        var em2 = emptyMsg(p);
        debugDone(sent.log, { err: em2, finish: p.finish, rsn: p.reasoning.length });
        throw new Error(em2);
      }
      var est = usageEst(p.usage, messages, p.text);
      usageTodayAdd(est.inTok, est.outTok);
      debugDone(sent.log, doneInfo(p, est, p.text));
      return { text: p.text, reasoning: p.reasoning, finish: p.finish, usage: est, cut: sent.fit.cut };
    } catch (e) {
      var stop = (opts.signal && opts.signal.aborted) ? "已手动停止" : (timedOut || (e && e.name === "AbortError")) ? "请求超时" : "";
      if (sent) debugDone(sent.log, { err: stop || String((e && e.message) || e) });
      if (stop) throw new Error(stop);
      if (!sent && e && e.name === "TypeError") throw new Error("网络失败：" + e.message);
      throw e;
    } finally { clearTimeout(timer); }
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

  /* ================= v3.3（S1）：同步SHA-256 / 账本(哈希链) / 统一提交管线 ================= */
  /* 同步 SHA-256（纯 JS，无依赖；账本哈希链需要同步计算，crypto.subtle 是异步的） */
  var SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256Sync(str) {
    function utf8(s0) {
      var out = [];
      for (var i = 0; i < s0.length; i++) {
        var c = s0.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s0.length) {
          var c2 = s0.charCodeAt(++i);
          c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
          out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return out;
    }
    var msg = utf8(String(str || ""));
    var bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for (var i0 = 0; i0 < msg.length; i0 += 64) {
      var w = new Array(64);
      for (var tA = 0; tA < 16; tA++) w[tA] = (msg[i0 + 4 * tA] << 24) | (msg[i0 + 4 * tA + 1] << 16) | (msg[i0 + 4 * tA + 2] << 8) | msg[i0 + 4 * tA + 3];
      for (var tB = 16; tB < 64; tB++) {
        var S0 = rotr(w[tB - 15], 7) ^ rotr(w[tB - 15], 18) ^ (w[tB - 15] >>> 3);
        var S1 = rotr(w[tB - 2], 17) ^ rotr(w[tB - 2], 19) ^ (w[tB - 2] >>> 10);
        w[tB] = (w[tB - 16] + S0 + w[tB - 7] + S1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var tC = 0; tC < 64; tC++) {
        var S1c = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1c + ch + SHA_K[tC] + w[tC]) | 0;
        var S0c = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0c + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }

  /* 字段统一读写（工作台与导图共用；S1 起所有写入走 commit） */
  function fieldLabelCore(f) {
    f = f || "";
    if (f.indexOf("draft:") === 0) return "④草稿·" + f.slice(6);
    if (f.indexOf("sec:") === 0) return "④草稿·" + f.slice(4);
    if (f.indexOf("ref:") === 0) return "③参考稿·" + f.slice(4);
    if (f.indexOf("outs.") === 0) { var k = f.slice(5); var ON = { internal: "三专家内审", consistency: "一致性检查", aidecl: "AI 使用声明", cover: "投稿信", rebuttal: "回复信" }; return "⑤" + (ON[k] || k); }
    var M = { selection: "①选题卡", trend: "①选题趋势", matrix: "③文献矩阵", outline: "④大纲", design: "④设计审查", topic: "主题" };
    return M[f] || f;
  }
  function readField(p, f) {
    p = p || {}; f = f || "";
    if (f === "selection") return p.selection || "";
    if (f === "matrix") return p.matrix || "";
    if (f === "design") return p.design || "";
    if (f === "outline") return p.outline || "";
    if (f === "topic") return p.topic || "";
    if (f.indexOf("draft:") === 0) return (p.draft || {})[f.slice(6)] || "";
    if (f.indexOf("outs.") === 0) return (p.outs || {})[f.slice(5)] || "";
    if (f.indexOf("ref:") === 0) {
      var sec = f.slice(4);
      var a = ((p.refDraft || {}).sections || {})[sec];
      if (typeof a === "string") return a;
      if (a && typeof a === "object") return a.text || "";
      var b = ((p.ref || {}).sections || {})[sec];
      if (typeof b === "string") return b;
      if (b && typeof b === "object") return b.text || "";
      return "";
    }
    return "";
  }
  function applyField(p, f, txt) {
    p = p || {}; txt = String(txt || "");
    if (f === "selection") { p.selection = txt; return; }
    if (f === "matrix") { p.matrix = txt; return; }
    if (f === "design") { p.design = txt; return; }
    if (f === "outline") { p.outline = txt; p.outs = p.outs || {}; p.outs.outline = txt; return; }
    if (f === "topic") { p.topic = txt; return; }
    if (f.indexOf("draft:") === 0) {
      var sec = f.slice(6);
      p.draft = p.draft || {}; p.draft[sec] = txt;
      if (p.draftRich) delete p.draftRich[sec];   /* 纯文本为真相，富文本缓存作废（与工作台同口径） */
      return;
    }
    if (f.indexOf("outs.") === 0) { p.outs = p.outs || {}; p.outs[f.slice(5)] = txt; return; }
    if (f.indexOf("ref:") === 0) {
      var s0 = f.slice(4);
      var t0 = ((p.refDraft || {}).sections || {})[s0];
      if (typeof t0 === "string" && p.refDraft && p.refDraft.sections) { p.refDraft.sections[s0] = txt; return; }
      if (t0 && typeof t0 === "object") { t0.text = txt; return; }
      var t1 = ((p.ref || {}).sections || {})[s0];
      if (typeof t1 === "string" && p.ref && p.ref.sections) { p.ref.sections[s0] = txt; return; }
      if (t1 && typeof t1 === "object") { t1.text = txt; return; }
      p.refDraft = p.refDraft || {}; p.refDraft.sections = p.refDraft.sections || {};
      p.refDraft.sections[s0] = { text: txt };
    }
  }
  /* 版本推送（⭐星标豁免容量淘汰；淘汰明示） */
  function versionPush(p, entry) {
    p.versions = p.versions || [];
    entry.star = !!entry.star;
    p.versions.unshift(entry);
    var dropped = 0;
    while (p.versions.length > 40) {
      var idx = -1;
      for (var i = p.versions.length - 1; i >= 0; i--) { if (!p.versions[i].star) { idx = i; break; } }
      if (idx < 0) break;
      p.versions.splice(idx, 1); dropped++;
    }
    return dropped;
  }
  /* 引用编号集合差（X2/A1：AI 产出与原文 [n] 不一致时禁止直接采纳） */
  function citeSet(t) {
    var s0 = {}, re = /\[(\d{1,3})\]/g, m;
    while ((m = re.exec(String(t || "")))) s0[m[1]] = 1;
    return s0;
  }
  function citeDiff(a, b) {
    var A = citeSet(a), B = citeSet(b), lost = [], gained = [];
    Object.keys(A).forEach(function (k) { if (!B[k]) lost.push(k); });
    Object.keys(B).forEach(function (k) { if (!A[k]) gained.push(k); });
    return { lost: lost, gained: gained };
  }
  /* 数字绑定按值迁移（迁移件一律标 review 待复核——专家评审 X1：错链比断链危险） */
  function nummapRemap(p, sec, oldText, newText) {
    if (!p.nummap) return 0;
    var oldB = [];
    scanNumHits(oldText).forEach(function (h) {
      var b = p.nummap[(sec + "|" + h.ctx).slice(0, 100)];
      if (b && b.src) oldB.push({ num: h.num, src: b.src });
    });
    var newHits = scanNumHits(newText), newKeys = {}, moved = 0, used = {};
    newHits.forEach(function (h) {
      var k = (sec + "|" + h.ctx).slice(0, 100);
      newKeys[k] = 1;
      if (p.nummap[k] && p.nummap[k].src) return;
      for (var i = 0; i < oldB.length; i++) {
        if (!used[i] && oldB[i].num === h.num) { used[i] = 1; p.nummap[k] = { src: oldB[i].src, ts: stamp(), review: true }; moved++; break; }
      }
    });
    Object.keys(p.nummap).forEach(function (k) {
      if (k.indexOf(sec + "|") === 0 && !newKeys[k]) delete p.nummap[k];
    });
    return moved;
  }
  /* 账本：事件溯源 + 哈希链（新在前）。verify() 从最旧重算，任何篡改断链 */
  function journalAppend(p, ev) {
    p.journal = p.journal || [];
    var prev = p.journal[0];
    var rec = {
      seq: prev ? prev.seq + 1 : 1,
      ts: stamp(),
      actor: ev.actor === "ai" ? "ai" : ev.actor === "external" ? "external" : "user",
      action: String(ev.action || "更新").slice(0, 60),
      target: String(ev.target || "").slice(0, 60),
      model: String(ev.model || "").slice(0, 60),
      cost: String(ev.cost || "").slice(0, 40),
      note: String(ev.note || "").slice(0, 300)
    };
    var base = JSON.stringify({ seq: rec.seq, ts: rec.ts, actor: rec.actor, action: rec.action, target: rec.target, model: rec.model, cost: rec.cost, note: rec.note });
    rec.prev = prev ? prev.hash : "";
    rec.hash = sha256Sync(base + rec.prev);   /* 规范化串=基础字段 JSON + prev（与 journalVerify 同一口径） */
    p.journal.unshift(rec);
    return rec;
  }
  function journalVerify(p) {
    var arr = (p.journal || []).slice().reverse();   /* 最旧在前 */
    var prev = "";
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      var check = sha256Sync(JSON.stringify({ seq: e.seq, ts: e.ts, actor: e.actor, action: e.action, target: e.target, model: e.model, cost: e.cost, note: e.note }) + prev);
      if (check !== e.hash || e.prev !== prev) return { ok: false, brokenAt: e.seq, total: arr.length };
      prev = e.hash;
    }
    return { ok: true, total: arr.length };
  }
  /* 统一提交管线：读旧 → 自动存档 → 写入 → 绑定迁移 → 版本 → 账本 → 轨迹（一次走完） */
  function commit(p, o) {
    o = o || {};
    var f = o.field || "";
    var txt = String(o.content || "");
    var old = readField(p, f);
    var res = { changed: old !== txt, cite: citeDiff(old, txt), migrated: 0, autoSaved: false };
    if (!res.changed) return res;
    if (o.autoSaveCurrent !== false && String(old || "").trim()) {
      /* v1.1.0：不再截断到 12000 字（长章节恢复会拿回残稿）；体积由配额自愈归档兜底 */
      versionPush(p, { ts: stamp(), kind: o.autoSaveKind || "覆盖前自动存档", content: String(old), field: f });
      res.autoSaved = true;
    }
    applyField(p, f, txt);
    if (f.indexOf("draft:") === 0) {
      res.migrated = nummapRemap(p, f.slice(6), old, txt);
      p.ledger = p.ledger || {};
      p.ledger[f.slice(6)] = p.ledger[f.slice(6)] || [];
      p.ledger[f.slice(6)].unshift({ ts: stamp(), action: o.kind || "更新", chars: txt.replace(/\s+/g, "").length });
      if (p.ledger[f.slice(6)].length > 100) p.ledger[f.slice(6)].length = 100;
    }
    if (!o.skipVersion) {
      var dropped = versionPush(p, { ts: stamp(), kind: o.kind || "更新", content: txt, field: f });
      if (dropped && typeof wqNotice === "function") wqNotice("较早的 " + dropped + " 条版本已移出档案（⭐星标版本保留）");
    }
    journalAppend(p, { actor: o.actor, action: o.kind || "更新", target: fieldLabelCore(f), model: o.model || "", cost: o.cost || "", note: o.note || (o.actor === "ai" ? "AI 产出，经用户采纳" : "") });
    p.trail = p.trail || [];
    p.trail.unshift({ ts: stamp(), type: o.actor === "ai" ? "ai" : o.actor === "external" ? "doc" : "act", label: (o.kind || "更新") + "（" + fieldLabelCore(f) + "）", note: [o.model ? "模型 " + o.model : "", o.cost || "", o.note || ""].filter(Boolean).join(" · ").slice(0, 300) });
    if (p.trail.length > 200) p.trail.length = 200;
    return res;
  }

  /* ================= 导出到 window ================= */
  window.WQCore = {
    version: APP_VERSION,
    LS_DB: LS_DB, LS_AI: LS_AI,
    esc: esc, sleep: sleep, stamp: stamp, uid: uid, localDay: localDay,
    loadLocal: loadLocal, saveLocal: saveLocal,
    sanitizeDB: sanitizeDB, sanitizeProject: sanitizeProject, markDeleted: markDeleted,
    buildBackup: buildBackup, parseBackup: parseBackup,
    ai: {
      conf: conf, setConf: setConf, setKey: setKey, baseWarning: baseWarning, estimateTokens: estimateTokens,
      stream: streamAI, call: callAI, usageToday: usageToday, estCostText: estCostText, probeModels: probeModels,
      usageAll: function () { try { return JSON.parse(localStorage.getItem(LS_USAGE) || "{}"); } catch (e) { return {}; } },
      /* v1.3.0 */
      complete: completeAI,
      formats: function () { return AIX().FORMATS; },
      format: function (c) { return AIX().resolve(c || conf()); },
      formatName: function (id) { return AIX().formatName(id); },
      ctxWindow: function (c) { c = c || conf(); return AIX().ctxWindow(c, c.model); },
      debugLog: debugLog, debugClear: debugClear
    },
    pipeline: WQPipeline,
    diff: { paras: parasDiff, chars: chars, charsHTML: charsHTML, sim: sim },
    ledger: { analyzeText: analyzeText, analyzeProject: analyzeProject, contributionHTML: contributionHTML },
    scanNumHits: scanNumHits,
    sha256Hex: sha256Sync,
    fieldLabel: fieldLabelCore,
    readField: readField,
    applyField: applyField,
    versionPush: versionPush,
    citeSet: citeSet,
    citeDiff: citeDiff,
    nummapRemap: nummapRemap,
    journalAppend: journalAppend,
    journalVerify: journalVerify,
    commit: commit
  };
  window.WQStore = WQStore;
})();

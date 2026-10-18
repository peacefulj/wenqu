/* 萤算科研导图 · wq-map.js v1.0（M0-M2）
 * 依赖：wq-core.js（WQCore/WQStore，共享 wenqu_studio 项目库——与 v30 同一份浏览器数据，零迁移）、
 *       vendor/marked.min.js + purify.min.js（可选，降级转义）、vendor/cytoscape.min.js（图渲染）
 * 职责：
 *   1) WQMap.derive(p) —— 从项目对象派生 11 类节点 + 5 种链条（图是投影，不单独落盘；
 *      trail 不进主图，作侧栏时间线 = 思维链）
 *   2) cytoscape 渲染（列式布局 + p.mapState 位置记忆）+ 链条开关
 *   3) 节点详情卡：编辑 / AI 改写·扩写·缩写 / 存版本 / 数字绑定，全部写回原项目对象
 *
 * 节点 id 稳定规则（跨派生不变，位置记忆依赖它）：
 *   t:<pid>  sel:<pid>  out:<pid>:<K>  pp:<pid>:<i>  dc:<pid>:<id>
 *   ol:<pid>:main / ol:<pid>:<节名>  dr:<pid>:<节名>  rf:<pid>:<节名>
 *   ver:<pid>:<ts>  ck:<pid>:<ts>  nm:<pid>:<key>
 */
(function () {
  "use strict";

  /* ================= 元数据 ================= */
  var KINDS = {
    topic:    { label: "主题",     color: "#2456e6", icon: "🎯" },
    selection:{ label: "选题卡",   color: "#7c3aed", icon: "🧭" },
    paper:    { label: "文献",     color: "#0a7a43", icon: "📄" },
    datacard: { label: "数据卡",   color: "#b45309", icon: "🗂" },
    outline:  { label: "提纲节",   color: "#0369a1", icon: "🧱" },
    draft:    { label: "草稿节",   color: "#1d4ed8", icon: "✍️" },
    refdraft: { label: "参考稿节", color: "#6d28d9", icon: "📋" },
    version:  { label: "版本",     color: "#64748b", icon: "🕓" },
    check:    { label: "校验",     color: "#b42318", icon: "🔍" },
    numbind:  { label: "数字绑定", color: "#c2410c", icon: "🔢" },
    out:      { label: "产出",     color: "#475569", icon: "📦" },
    reflow:   { label: "导师稿",   color: "#6b7280", icon: "📥" }
  };
  var CHAINS = {
    logic:    { label: "逻辑链", color: "#2456e6" },
    academic: { label: "学术链", color: "#0a7a43" },
    evidence: { label: "证据链", color: "#c2410c" },
    revision: { label: "修改链", color: "#94a3b8" },
    review:   { label: "质检链", color: "#b42318" },
    think:    { label: "思维链", color: "#7c3aed" }
  };
  var TRAIL_ICON = { act: "🖱", ai: "🤖", cancel: "↩", doc: "📄", export: "⤓", load: "↻", note: "📝", ver: "🕓", misc: "•" };

  /* ================= 派生 ================= */

  /* 数字扫描（与工作台 ckNums 同口径：正则 + [n] 引用排除 + 年份启发式）。
     derive 与改写后的绑定重匹配共用，改口径必须两处同步 */
  function scanNumHits(t) {
    /* v3.2（S0）：唯一实现下沉到 wq-core（WQCore.scanNumHits），三处页面共用同一份口径 */
    return (window.WQCore && WQCore.scanNumHits) ? WQCore.scanNumHits(t) : [];
    t = String(t || "");
    var re = /(?:^|[^\d\[（(]?)(\d+(?:\.\d+)?(?:%|万|千|亿|个百分点)?)/g;
    var hits = [], m;
    while ((m = re.exec(t)) && hits.length < 80) {
      var num = m[1];
      var pre = m.index > 0 ? t.charAt(m.index - 1) : "";
      var after = t.charAt(m.index + m[0].length);
      if (pre === "（" || pre === "(") continue;                              /* (n) 引用式 */
      /* [n] 仅排除"整数+紧跟闭方括号"的引用形态；[0.32, 0.84] 这类置信区间是数据（QA 专家评审 A4） */
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
  function numKey(sec, ctx) { return (sec + "|" + ctx).slice(0, 100); }

  /* P1-2：正文改写/编辑后，把旧文本上的数字绑定按「数字值」迁移到新文本。
     专家评审 X1：按值猜测可能错配——迁移的绑定一律标 review:true（待复核态，图上黄虚线），
     作者确认后才恢复实线；新文本里找不到的旧绑定清理。返回迁移条数 */
  function remapBinds(p, sec, oldText, newText) {
    if (!p.nummap) return 0;
    var oldB = [];
    scanNumHits(oldText).forEach(function (h) {
      var b = p.nummap[numKey(sec, h.ctx)];
      if (b && b.src) oldB.push({ num: h.num, src: b.src });
    });
    var newHits = scanNumHits(newText), newKeys = {}, moved = 0, used = {};
    newHits.forEach(function (h) {
      var k = numKey(sec, h.ctx);
      newKeys[k] = 1;
      if (p.nummap[k] && p.nummap[k].src) return;
      for (var i = 0; i < oldB.length; i++) {
        if (!used[i] && oldB[i].num === h.num) {
          used[i] = 1; p.nummap[k] = { src: oldB[i].src, ts: WQCore.stamp(), review: true }; moved++; break;
        }
      }
    });
    Object.keys(p.nummap).forEach(function (k) {
      if (k.indexOf(sec + "|") === 0 && !newKeys[k]) delete p.nummap[k];
    });
    return moved;
  }

  /* 专家评审 X2/A1：新旧文本的 [n] 引用编号集合差——非空则 AI 产出不得直接采纳 */
  function citeSet(t) {
    var s = {}, re = /\[(\d{1,3})\]/g, m;
    while ((m = re.exec(String(t || "")))) s[m[1]] = 1;
    return s;
  }
  function citeDiff(a, b) {
    var A = citeSet(a), B = citeSet(b), lost = [], gained = [];
    Object.keys(A).forEach(function (k) { if (!B[k]) lost.push(k); });
    Object.keys(B).forEach(function (k) { if (!A[k]) gained.push(k); });
    return { lost: lost, gained: gained };
  }

  function derive(p) {
    var nodes = [], edges = [], have = {}, ehave = {};
    var pid = p.id || "p";
    function node(id, kind, title, body, meta) {
      if (have[id]) return null;
      have[id] = 1;
      var n = { id: id, kind: kind, title: String(title || KINDS[kind].label).slice(0, 60), body: body || "", meta: meta || {} };
      nodes.push(n); return n;
    }
    function edge(from, to, type, lab) {
      if (!from || !to || from === to) return;
      var k = from + "|" + to + "|" + type + "|" + (lab || "");
      if (ehave[k]) return; ehave[k] = 1;
      edges.push({ from: from, to: to, type: type, lab: lab || "" });
    }

    /* --- 主题 / 选题 --- */
    node("t:" + pid, "topic", p.topic || p.name || "未命名项目", p.topic || "", { level: p.level, paradigm: p.paradigm });
    if (p.selection) node("sel:" + pid, "selection", "选题卡", p.selection, {});
    if (p.selection) edge("sel:" + pid, "t:" + pid, "think");

    /* --- 工具产出（matrix/design + p.outs；outs.outline 与提纲节点同文，跳过） --- */
    if (p.matrix) node("out:" + pid + ":matrix", "out", "产出·文献矩阵", p.matrix, { K: "matrix" });
    if (p.matrix) edge("out:" + pid + ":matrix", "t:" + pid, "logic");
    if (p.design) node("out:" + pid + ":design", "out", "产出·设计审查", p.design, { K: "design" });
    if (p.design) edge("out:" + pid + ":design", "t:" + pid, "logic");
    Object.keys(p.outs || {}).forEach(function (K) {
      var v = p.outs[K];
      if (typeof v !== "string" || !v.trim() || K === "outline") return;
      node("out:" + pid + ":" + K, "out", "产出·" + K, v, { K: K });
      edge("out:" + pid + ":" + K, "t:" + pid, "logic");
    });

    /* --- 文献 / 数据卡 --- */
    (p.papers || []).forEach(function (f, i) {
      node("pp:" + pid + ":" + i, "paper", "[" + (i + 1) + "] " + (f.title || "无题"),
        (f.author ? f.author + "　" : "") + (f.year || "") + (f.venue ? " · " + f.venue : "") + (f.doi ? "\nDOI: " + f.doi : "") + (f.abs ? "\n\n" + f.abs : ""),
        { i: i, doi: f.doi || "", year: f.year || "" });
    });
    (p.datacards || []).forEach(function (c) {
      node("dc:" + pid + ":" + c.id, "datacard", "数据卡·" + (c.name || "未名"),
        (c.source ? "来源：" + c.source + "\n" : "") + (c.vars ? "变量：" + c.vars : "") , { id: c.id, name: c.name });
    });

    /* --- 提纲（项目模式=一份 md；快进模式=逐节） --- */
    var olYs = {};   /* 节名 -> 序号，供草稿对齐 */
    if (p.refDraft && p.refDraft.outline && Array.isArray(p.refDraft.outline.sections)) {
      p.refDraft.outline.sections.forEach(function (s, i) {
        var name = s.name || ("第" + (i + 1) + "节");
        olYs[name] = i;
        node("ol:" + pid + ":" + name, "outline", "🧱 " + name,
          s.brief || s.points || s.desc || "", { name: name, i: i });
        edge("t:" + pid, "ol:" + pid + ":" + name, "logic");
      });
    } else if (p.outline) {
      node("ol:" + pid + ":main", "outline", "🧱 提纲（总）", p.outline, { main: true });
      edge("t:" + pid, "ol:" + pid + ":main", "logic");
    }
    /* 文献矩阵喂大纲（阶段③→④的推导关系，QA-P3-4；须在大纲节点建好之后） */
    if (p.matrix && have["ol:" + pid + ":main"]) edge("out:" + pid + ":matrix", "ol:" + pid + ":main", "logic", "支撑大纲");

    /* --- 参考稿节（refDraft 优先，兼容 p.ref.sections） --- */
    var rfSrc = (p.refDraft && p.refDraft.sections) || (p.ref && p.ref.sections) || {};
    Object.keys(rfSrc).forEach(function (name) {
      var ent = rfSrc[name];
      var txt = typeof ent === "string" ? ent : (ent && ent.text) || "";
      if (!String(txt).trim()) return;
      node("rf:" + pid + ":" + name, "refdraft", "📋 " + name, txt,
        { name: name, partial: !!(ent && ent.partial), refs: (ent && ent.refs) || null });
      if (have["ol:" + pid + ":" + name]) edge("ol:" + pid + ":" + name, "rf:" + pid + ":" + name, "logic");
      else edge("t:" + pid, "rf:" + pid + ":" + name, "logic");
    });

    /* --- 草稿节 --- */
    Object.keys(p.draft || {}).forEach(function (name) {
      var txt = p.draft[name];
      if (!String(txt).trim()) return;
      node("dr:" + pid + ":" + name, "draft", "✍️ " + name, txt, { name: name });
      if (have["ol:" + pid + ":" + name]) edge("ol:" + pid + ":" + name, "dr:" + pid + ":" + name, "logic");
      else edge("t:" + pid, "dr:" + pid + ":" + name, "logic");
    });

    /* --- 学术链：正文 [n] → 文献（refDraft 节用落盘的 refs 数组，草稿用正则扫描） --- */
    var nPapers = (p.papers || []).length;
    function citeEdges(fromId, text, refArr) {
      var ns = {};
      (refArr || []).forEach(function (n) { if (n >= 1 && n <= nPapers) ns[n] = 1; });
      if (!refArr || !refArr.length) {
        var re = /\[(\d{1,3})\]/g, m;
        while ((m = re.exec(String(text || "")))) { var n2 = +m[1]; if (n2 >= 1 && n2 <= nPapers) ns[n2] = 1; }
      }
      Object.keys(ns).forEach(function (n) {
        edge(fromId, "pp:" + pid + ":" + (+n - 1), "academic", "[" + n + "]");
      });
    }
    nodes.forEach(function (n) {
      if (n.kind === "draft") citeEdges(n.id, n.body, null);
      if (n.kind === "refdraft") citeEdges(n.id, n.body, n.meta.refs);
    });

    /* --- 数字绑定（scanNumHits 与工作台同口径；QA-P1-2 后单源） --- */
    Object.keys(p.draft || {}).forEach(function (sec) {
      scanNumHits(p.draft[sec]).forEach(function (h) {
        var key = numKey(sec, h.ctx);
        var bind = (p.nummap || {})[key];
        var id = "nm:" + pid + ":" + key;
        node(id, "numbind", "🔢 " + h.num, h.ctx,
          { sec: sec, key: key, num: h.num, src: bind ? bind.src : "", review: !!(bind && bind.review) });
        edge("dr:" + pid + ":" + sec, id, "evidence");
        if (bind && bind.src) {
          var pm = /^文献\[(\d+)\]$/.exec(bind.src);
          if (pm && +pm[1] <= nPapers) edge(id, "pp:" + pid + ":" + (+pm[1] - 1), "evidence", bind.src);
          else if (bind.src.indexOf("数据卡：") === 0) {
            var nm0 = bind.src.slice(4);
            for (var di = 0; di < (p.datacards || []).length; di++)
              if (p.datacards[di].name === nm0) { edge(id, "dc:" + pid + ":" + p.datacards[di].id, "evidence", "数据卡"); break; }
          }
        }
      });
    });

    /* --- 版本（新在前；链 = 旧→新；并从来源节点拉一条 revision 边） --- */
    var vers = p.versions || [];
    for (var vi = vers.length - 1; vi > 0; vi--) {
      var older = vers[vi], newer = vers[vi - 1];
      node("ver:" + pid + ":" + older.ts, "version", "🕓 " + older.kind, older.content, { ts: older.ts, field: older.field || "", kind: older.kind, star: !!older.star });
      edge("ver:" + pid + ":" + older.ts, "ver:" + pid + ":" + newer.ts, "revision");
    }
    if (vers.length) {
      var lastV = vers[0];
      node("ver:" + pid + ":" + lastV.ts, "version", "🕓 " + lastV.kind, lastV.content, { ts: lastV.ts, field: lastV.field || "", kind: lastV.kind, star: !!lastV.star });
    }
    vers.forEach(function (v) {
      var f = v.field || "", src = null;
      if (f === "selection") src = "sel:" + pid;
      else if (f === "outline") src = have["ol:" + pid + ":main"] ? "ol:" + pid + ":main" : "t:" + pid;
      else if (f.indexOf("draft:") === 0) src = "dr:" + pid + ":" + f.slice(6);
      else if (f === "matrix") src = "out:" + pid + ":matrix";
      else if (f === "design") src = "out:" + pid + ":design";
      else if (f.indexOf("outs.") === 0) src = "out:" + pid + ":" + f.slice(5);
      else if (f === "ref") src = "t:" + pid;
      else if (f === "tool") src = "t:" + pid;
      if (src && have[src]) edge(src, "ver:" + pid + ":" + v.ts, "revision");
    });

    /* --- Word 回流（M3：外部批注层——导师稿不混入正文版本链，独立 reflows 字段） --- */
    (p.reflows || []).forEach(function (rf) {
      var baseId = (rf.baseKind === "refdraft" ? "rf:" : "dr:") + pid + ":" + rf.baseField;
      node("rw:" + pid + ":" + rf.id, "reflow", "📥 导师稿·" + rf.baseField, rf.text,
        { id: rf.id, baseField: rf.baseField, baseKind: rf.baseKind, ts: rf.ts, source: rf.source || "导师",
          hash: rf.hash || "", comments: rf.comments || "", items: rf.items || [], truncated: !!rf.truncated, keepHidden: !!rf.keepHidden });
      if (have[baseId]) edge(baseId, "rw:" + pid + ":" + rf.id, "revision", "外部批注");
      else edge("t:" + pid, "rw:" + pid + ":" + rf.id, "revision", "外部批注");
    });

    /* --- 校验 → 主题（质检链；明细全量，QA 后不再截 40 条） --- */
    (p.checks || []).slice(0, 30).forEach(function (c) {
      if (!c || !c.ts) return;
      node("ck:" + pid + ":" + c.ts, "check", "🔍 " + (c.label || c.kind),
        (c.items || []).join("\n"), { kind: c.kind, stats: c.stats || {} });
      edge("ck:" + pid + ":" + c.ts, "t:" + pid, "review");
    });

    return { nodes: nodes, edges: edges };
  }

  /* ================= 布局（列式，y 居中对齐；mapState 位置优先） ================= */
  function layout(p, g) {
    var pid = p.id || "p", pos = (p.mapState && p.mapState.pos) || {};
    var cols = { ver: [], out: [], mid: [], ol: [], dr: [], rf: [], rw: [], pp: [], nm: [], dc: [], ck: [] };
    g.nodes.forEach(function (n) {
      if (n.id.indexOf("ver:" + pid + ":") === 0) cols.ver.push(n);
      else if (n.id.indexOf("out:" + pid + ":") === 0) cols.out.push(n);
      else if (n.kind === "topic" || n.kind === "selection") cols.mid.push(n);
      else if (n.kind === "outline") cols.ol.push(n);
      else if (n.kind === "draft") cols.dr.push(n);
      else if (n.kind === "refdraft") cols.rf.push(n);
      else if (n.kind === "reflow") cols.rw.push(n);
      else if (n.kind === "paper") cols.pp.push(n);
      else if (n.kind === "numbind") cols.nm.push(n);
      else if (n.kind === "datacard") cols.dc.push(n);
      else if (n.kind === "check") cols.ck.push(n);
    });
    function stack(arr, x, step) {
      var y0 = -((arr.length - 1) * step) / 2;
      arr.forEach(function (n, i) { n._x = x; n._y = y0 + i * step; });
    }
    /* 版本按 ts 升序自上而下（与 revision 链方向一致） */
    cols.ver.sort(function (a, b) { return String(a.meta.ts).localeCompare(String(b.meta.ts)); });
    stack(cols.ver, -1150, 84);
    stack(cols.out, -800, 88);
    /* 主题居中，选题卡在其上 */
    cols.mid.forEach(function (n) {
      if (n.kind === "topic") { n._x = -430; n._y = 0; }
      else { n._x = -430; n._y = -320; }
    });
    stack(cols.ol, 60, 96);
    /* 提纲节名 -> y，供草稿/参考稿行对齐（逻辑链成水平直线） */
    var olByName = {};
    cols.ol.forEach(function (n) { if (n.meta.name) olByName[n.meta.name] = n._y; });
    var maxY = 0, usedY = [], extra = [];
    cols.dr.forEach(function (n) {
      if (n.meta.name != null && olByName[n.meta.name] != null) { n._x = 480; n._y = olByName[n.meta.name]; usedY.push(n._y); }
      else extra.push(n);
    });
    var yBase = usedY.length ? Math.max.apply(null, usedY) + 96 : 0;
    extra.forEach(function (n, i) { n._x = 480; n._y = yBase + i * 96; });
    /* 参考稿列：x=800，同名提纲行对齐；未对齐的接在参考稿列底部 */
    var rfYs = [], rfExtra = [];
    cols.rf.forEach(function (n) {
      if (n.meta.name != null && olByName[n.meta.name] != null) { n._x = 800; n._y = olByName[n.meta.name]; rfYs.push(n._y); }
      else rfExtra.push(n);
    });
    var yRf = rfYs.length ? Math.max.apply(null, rfYs) + 96 : yBase;
    rfExtra.forEach(function (n, i) { n._x = 800; n._y = yRf + i * 96; });
    /* 导师稿：挂在对应基准稿正下方（外部批注层，不混入正文版本链） */
    cols.rw.forEach(function (n) {
      var baseId = (n.meta.baseKind === "refdraft" ? "rf:" : "dr:") + pid + ":" + n.meta.baseField;
      var base = null;
      cols.dr.concat(cols.rf).forEach(function (m0) { if (m0.id === baseId) base = m0; });
      n._x = 800;
      n._y = (base ? base._y : 0) + 56;
    });
    cols.dr.concat(cols.rf, cols.rw).forEach(function (n) { maxY = Math.max(maxY, Math.abs(n._y)); });
    stack(cols.pp, 1020, 88);
    /* 数字绑定排在文献下方，数据卡再右 */
    var ppBottom = cols.pp.length ? Math.max.apply(null, cols.pp.map(function (n) { return n._y; })) : 0;
    stack(cols.nm, 1020, 72);
    cols.nm.forEach(function (n, i) { n._y = ppBottom + 140 + i * 72; });
    stack(cols.dc, 1400, 96);
    cols.dc.forEach(function (n, i) { n._y = ppBottom + 120 + i * 96; });
    /* 校验沉底 */
    var yCk = maxY + 220;
    cols.ck.forEach(function (n, i) { n._x = 480 + (i % 4) * 300; n._y = yCk + Math.floor(i / 4) * 90; });

    g.nodes.forEach(function (n) {
      if (pos[n.id]) { n._x = pos[n.id].x; n._y = pos[n.id].y; }
    });
    return g;
  }

  /* ================= 渲染 ================= */
  var ST = { cy: null, p: null, db: null, selId: null, busy: false, prevIds: null, tapTs: {}, flowTimer: null, flowEdges: null, fullFetched: {} };
  var FX = { on: true };   /* 动效总开关（链路流动/新节点飞入；AI 脉冲属状态提示不随此关） */

  function focusNeighborhood(id) {
    if (!ST.cy) return;
    var ele = ST.cy.getElementById(id);
    if (!ele.nonempty()) return;
    ST.cy.elements().addClass("dimmed");
    ele.removeClass("dimmed");
    ele.connectedEdges().removeClass("dimmed");
    ele.neighborhood().removeClass("dimmed");
    startFlow(ele.connectedEdges());
  }

  function mdRender(t) {
    if (window.marked && window.DOMPurify) {
      try { return DOMPurify.sanitize(window.marked.parse(String(t || ""))); } catch (e) {}
    }
    return "<p style='white-space:pre-wrap'>" + WQCore.esc(t) + "</p>";
  }
  function kindIcon(k) { return (KINDS[k] || {}).icon || "•"; }

  function buildCy(p, g, dyn) {
    dyn = dyn || {};
    var els = [], newTargets = {};
    g.nodes.forEach(function (n) {
      var pos0 = { x: n._x, y: n._y };
      /* 新节点从锚点（主题位）飞入，落到布局位——图更动态 */
      if (dyn.newIds && dyn.newIds[n.id]) {
        newTargets[n.id] = pos0;
        pos0 = dyn.anchorPos || { x: 0, y: 0 };
      }
      els.push({ group: "nodes", data: { id: n.id, kind: n.kind, t: n.title, body: n.body, meta: n.meta }, position: pos0 });
    });
    g.edges.forEach(function (e) {
      els.push({ group: "edges", data: { id: e.from + "=>" + e.to + ":" + e.type, source: e.from, target: e.to, chain: e.type, lab: e.lab } });
    });
    var cy = cytoscape({
      container: document.getElementById("cv"),
      elements: els,
      layout: { name: "preset", fit: false },   /* 必须显式 preset，否则默认 grid 会覆盖列式坐标 */
      wheelSensitivity: 0.2,
      style: [
        { selector: "node", style: {
          label: "data(t)", "font-size": 11, color: "#1e293b",
          "text-valign": "bottom", "text-margin-y": 6, "text-wrap": "wrap", "text-max-width": 130,
          width: 30, height: 30, "background-color": "data(bg)",
          "border-width": 1.5, "border-color": "#ffffff", shape: "ellipse",
          "overlay-padding": 3
        } },
        { selector: "node[kind='draft'], node[kind='refdraft']", style: { shape: "round-rectangle", width: 34, height: 34 } },
        { selector: "node[kind='topic']", style: { shape: "round-diamond", width: 46, height: 46, "font-size": 13, "font-weight": "bold" } },
        { selector: "edge", style: {
          width: 1.8, "line-color": "data(cc)", "target-arrow-shape": "triangle",
          "target-arrow-color": "data(cc)", "arrow-scale": 0.7, "curve-style": "bezier",
          label: "data(lab)", "font-size": 9, color: "data(cc)", "text-background-color": "#ffffff",
          "text-background-opacity": 0.85, "text-background-padding": 1
        } },
        { selector: "node:selected", style: { "border-width": 3, "border-color": "#f59e0b" } },
        { selector: ".dimmed", style: { opacity: 0.15 } },
        { selector: ".hot", style: { width: 3.2 } },
        { selector: "node.hov", style: { "border-width": 3.5, "border-color": "#f59e0b", "font-size": 12 } },
        { selector: "edge.hovl", style: { width: 3.2 } },
        { selector: "node.partial", style: { "border-style": "dashed", "border-color": "#c4b5fd" } },
        { selector: "node.recent", style: { "overlay-color": "#f59e0b", "overlay-opacity": 0.16, "overlay-padding": 5 } },
        { selector: "node.star", style: { "border-width": 3, "border-color": "#d97706" } },
        { selector: "node.hit", style: { "overlay-color": "#f59e0b", "overlay-opacity": 0.4, "overlay-padding": 8 } },
        { selector: "edge.revw", style: { "line-style": "dashed", "line-color": "#d97706", "target-arrow-color": "#d97706" } }
      ]
    });
    /* 按 kind 上色（style 里 data(bg) 用映射函数更省事：直接在元素 data 里带 bg/cc） */
    cy.nodes().forEach(function (ele) {
      var k = ele.data("kind");
      ele.data("bg", (KINDS[k] || {}).color || "#64748b");
      var m0 = ele.data("meta") || {};
      if (k === "refdraft" && m0.partial) ele.addClass("partial");                 /* 残稿=虚线框 */
      if (k === "version" && m0.ts) {
        var t0 = new Date(String(m0.ts).replace(" ", "T")).getTime();
        if (isFinite(t0) && Date.now() - t0 < 864e5) ele.addClass("recent");       /* 24h 内动过的版本=光圈 */
      }
      if (k === "version" && m0.star) ele.addClass("star");                        /* ⭐ 星标版本 */
    });
    cy.edges().forEach(function (ele) {
      ele.data("cc", (CHAINS[ele.data("chain")] || {}).color || "#94a3b8");
      /* 待复核的迁移绑定：证据边画黄虚线（专家评审 X1） */
      var tg = ele.target();
      if (ele.data("chain") === "evidence" && tg.data("kind") === "numbind" && (tg.data("meta") || {}).review) ele.addClass("revw");
    });
    /* 新节点飞入到布局位 */
    Object.keys(newTargets).forEach(function (id) {
      var ele = cy.getElementById(id);
      if (ele.nonempty()) ele.animate({ position: newTargets[id] }, { duration: 420, easing: "ease-in-out" });
    });
    /* 单击=节点卡+邻域聚焦；420ms 内再点同一节点=双击 → 全屏查看/修改 */
    cy.on("tap", "node", function (evt) {
      var id = evt.target.id(), now = Date.now();
      if (ST.tapTs[id] && now - ST.tapTs[id] < 420) {
        ST.tapTs[id] = 0;
        showFullView(evt.target.data());
        return;
      }
      ST.tapTs[id] = now;
      showCard(id);
      focusNeighborhood(id);
    });
    cy.on("tap", function (evt) {
      if (evt.target === cy) {
        cy.elements().removeClass("dimmed hot");
        stopFlow();
      }
    });
    /* 悬停：节点亮边框 + 出边加粗（cytoscape 无 ：hover，用事件模拟） */
    cy.on("mouseover", "node", function (evt) {
      evt.target.addClass("hov");
      evt.target.connectedEdges().addClass("hovl");
    });
    cy.on("mouseout", "node", function (evt) {
      evt.target.removeClass("hov");
      evt.target.connectedEdges().removeClass("hovl");
    });
    return cy;
  }

  /* 选中节点的链路「流动」效果：虚线偏移持续推进，表达思路在链路上流动 */
  function startFlow(edges) {
    stopFlow();
    if (!FX.on) return;                       /* 动效开关（C2） */
    if (!edges || !edges.length || edges.length > 30) return;
    try { edges.style({ "line-dash-pattern": [6, 6] }); } catch (e) { return; }
    var off = 0;
    ST.flowEdges = edges;
    ST.flowTimer = setInterval(function () {
      off -= 3;
      try { ST.flowEdges.style("line-dash-offset", off); } catch (e) { stopFlow(); }
    }, 80);
  }
  function stopFlow() {
    if (ST.flowTimer) { clearInterval(ST.flowTimer); ST.flowTimer = null; }
    if (ST.flowEdges) {
      try { ST.flowEdges.removeStyle(); } catch (e) {}
      ST.flowEdges = null;
    }
  }

  /* ================= 详情卡 ================= */
  function findNode(id) { return ST.cy ? ST.cy.getElementById(id) : null; }

  /* 归档版本正文回取（IndexedDB）；返回 null=非归档或回取失败。
     force=true 时无视去重标记（全屏打开每次都回取，附「已回取」注记） */
  function fetchFullIfArchived(d, force) {
    return new Promise(function (resolve) {
      if (d.kind !== "version" || (!force && ST.fullFetched[d.id])) return resolve(null);
      var p = reloadDB();
      var vi = -1;
      (p.versions || []).forEach(function (v, i) { if (v.ts === d.meta.ts) vi = i; });
      if (vi < 0) return resolve(null);
      var v = p.versions[vi];
      if (!v.archived || !window.WQStore) return resolve(null);
      window.WQStore.getVersion(p.id, vi).then(function (c) {
        ST.fullFetched[d.id] = 1;
        resolve(c || null);
      }, function () { resolve(null); });
    });
  }

  function showCard(id) {
    var ele = findNode(id); if (!ele || !ele.nonempty()) return;
    var d = ele.data(), p = ST.p, pid = p.id;
    ST.selId = id;
    var K = KINDS[d.kind] || { label: d.kind, icon: "•" };
    var metaBits = [];
    if (d.meta.ts) metaBits.push("🕓 " + d.meta.ts);
    if (d.meta.year) metaBits.push("年份 " + d.meta.year);
    if (d.meta.model) metaBits.push("模型 " + d.meta.model);
    if (d.meta.review) metaBits.push("⚠ 迁移待复核");
    if (d.meta.src) metaBits.push("来源 " + d.meta.src);
    if (d.meta.stats && d.meta.stats.total != null)
      metaBits.push("⚠ 问题 " + (d.meta.stats.problem || 0) + " / " + d.meta.stats.total + (d.meta.stats.bound != null ? " · 已绑定 " + d.meta.stats.bound : ""));
    if (d.kind === "paper" && d.meta.doi) metaBits.push('<a href="https://doi.org/' + WQCore.esc(d.meta.doi) + '" target="_blank" rel="noopener">doi.org ↗</a>');

    var bodyHTML = "<div class='mbody'>" + mdRender(d.body || "（空）") + "</div>";

    /* 数字绑定节：来源下拉（改完即存） */
    var extra = "";
    if (d.kind === "numbind") {
      var opts = ['<option value="">未绑定</option>'];
      (p.papers || []).forEach(function (f, i) {
        var v = "文献[" + (i + 1) + "]";
        opts.push('<option value="' + WQCore.esc(v) + '"' + (d.meta.src === v ? " selected" : "") + ">文献[" + (i + 1) + "] " + WQCore.esc(String(f.title || "").slice(0, 14)) + "</option>");
      });
      (p.datacards || []).forEach(function (c) {
        var v = "数据卡：" + c.name;
        opts.push('<option value="' + WQCore.esc(v) + '"' + (d.meta.src === v ? " selected" : "") + ">数据卡：" + WQCore.esc(String(c.name || "").slice(0, 12)) + "</option>");
      });
      opts.push('<option value="本人测算"' + (d.meta.src === "本人测算" ? " selected" : "") + ">本人测算</option>");
      extra = "<div class='mrow'><label>来源：</label><select id='mNmSel'>" + opts.join("") + "</select><span class='mhint'>改完即存入校验口径</span></div>";
    }

    /* 操作按钮：可写节点（草稿/参考稿/提纲总/选题/产出 md/主题重命名）给编辑与 AI */
    var editable = { draft: 1, refdraft: 1, topic: 1 }.hasOwnProperty(d.kind) ||
      (d.kind === "outline" && d.meta.main) ||
      (d.kind === "selection") || (d.kind === "out");
    var aiTarget = { draft: 1, refdraft: 1 }.hasOwnProperty(d.kind) || (d.kind === "outline" && d.meta.main);
    var btns = [];
    btns.push("<button class='mbtn' id='mCopy'>📋 复制</button>");
    btns.push("<button class='mbtn' id='mDl'>⤓ .md</button>");
    if (editable) btns.push("<button class='mbtn' id='mEdit'>✏️ 编辑</button>");
    if (aiTarget) {
      btns.push("<button class='mbtn mai' data-verb='改写'>🤖 改写</button>");
      btns.push("<button class='mbtn mai' data-verb='扩写'>➕ 扩写</button>");
      btns.push("<button class='mbtn mai' data-verb='缩写'>➖ 缩写</button>");
    }
    if (editable) btns.push("<button class='mbtn' id='mSnap'>📌 存版本</button>");
    /* 版本节点：可回载的类型给「载入回项目」（QA-P2-7）+ ⭐星标保护 */
    if (d.kind === "version" && /^(selection|outline|matrix|design|draft:|outs\.)/.test(d.meta.field || ""))
      btns.push("<button class='mbtn' id='mVerLoad'>↻ 载入回项目</button>");
    if (d.kind === "version") btns.push("<button class='mbtn' id='mStar'>" + (d.meta.star ? "⭐ 取消星标" : "☆ 星标保护") + "</button>");
    /* M3：Word 回流——基准稿节点给入口；导师稿节点给全套消化操作 */
    if ((d.kind === "draft" || d.kind === "refdraft") && String(d.body || "").trim())
      btns.push("<button class='mbtn' id='mReflow'>📥 Word 回流</button>");
    if (d.kind === "reflow") {
      var it0 = d.meta.items || [];
      var cnt = { 采纳: 0, 部分: 0, 拒绝: 0, 待定: 0 };
      it0.forEach(function (x) { cnt[x.state] = (cnt[x.state] || 0) + 1; });
      metaBits.push("消化：✅" + (cnt["采纳"] || 0) + " / 🔶部分 " + (cnt["部分"] || 0) + " / ✖拒绝 " + (cnt["拒绝"] || 0) + " / ⏳待定 " + (cnt["待定"] || 0));
      if (d.meta.truncated) metaBits.push("⚠ 已截断");
      if (d.meta.keepHidden) metaBits.push("👻 不纳入披露包");
      btns.push("<button class='mbtn' id='mRfDiff'>🔄 与基准 diff</button>");
      btns.push("<button class='mbtn' id='mRfNote'>⤓ 修改说明.md</button>");
      btns.push("<button class='mbtn' id='mRfAdopt'>✅ 以此稿为底稿</button>");
      btns.push("<button class='mbtn' id='mRfHide'>" + (d.meta.keepHidden ? "👁 纳入披露包" : "👻 不纳入披露包") + "</button>");
    }
    /* 待复核的迁移绑定：给「确认无误」按钮（专家评审 X1） */
    if (d.kind === "numbind" && d.meta.review) btns.push("<button class='mbtn' id='mReview'>✅ 确认无误</button>");
    if (d.kind === "draft") btns.push("<a class='mbtn' href='studio.html' target='_blank' rel='noopener'>↗ 工作台</a>");

    document.getElementById("cardKind").textContent = K.icon + " " + K.label;
    document.getElementById("cardTitle").textContent = d.t;
    document.getElementById("cardMeta").innerHTML = metaBits.join(" · ");
    document.getElementById("cardBody").innerHTML = extra + bodyHTML;
    document.getElementById("cardBtns").innerHTML = btns.join("");
    document.getElementById("card").classList.add("open");

    var nmSel = document.getElementById("mNmSel");
    if (nmSel) nmSel.addEventListener("change", function () {
      var p = reloadDB();
      var key = d.meta.key;
      if (nmSel.value) { p.nummap = p.nummap || {}; p.nummap[key] = { src: nmSel.value, ts: WQCore.stamp() }; }
      else { delete (p.nummap || {})[key]; }
      saveDB();
      d.meta.src = nmSel.value;
      rebuild(false, true);
      showCard(id);
    });
    document.getElementById("mCopy").addEventListener("click", function () {
      (navigator.clipboard ? navigator.clipboard.writeText(d.body || "") : Promise.reject()).then(function () { toast("已复制 ✓"); }, function () { toast("复制失败（浏览器限制）"); });
    });
    document.getElementById("mDl").addEventListener("click", function () { dlText(fileNameOf(d), d.body || ""); });
    var bEdit = document.getElementById("mEdit");
    if (bEdit) {
      if (ST.busy) bEdit.disabled = true;   /* AI 生成中不允许进编辑器（QA-P2-5） */
      bEdit.addEventListener("click", function () { openEditor(d); });
    }
    var bVL = document.getElementById("mVerLoad");
    if (bVL) bVL.addEventListener("click", function () { loadVersion(d); });
    var bStar = document.getElementById("mStar");
    if (bStar) bStar.addEventListener("click", function () {
      var p = reloadDB();
      var v0 = null;
      (p.versions || []).forEach(function (x) { if (x.ts === d.meta.ts) v0 = x; });
      if (!v0) { toast("找不到该版本记录"); return; }
      v0.star = !v0.star;
      saveDB(); rebuild(false, true); showCard(d.id);
      toast(v0.star ? "已⭐星标：容量淘汰时此版本豁免" : "已取消星标");
    });
    var bReview = document.getElementById("mReview");
    if (bReview) bReview.addEventListener("click", function () {
      var p = reloadDB();
      var b0 = (p.nummap || {})[d.meta.key];
      if (b0) delete b0.review;
      saveDB(); rebuild(false, true); showCard(d.id);
      toast("已确认：该绑定恢复为已复核状态 ✓");
    });
    var bRf = document.getElementById("mReflow");
    if (bRf) bRf.addEventListener("click", function () { openReflow(d); });
    var bRd = document.getElementById("mRfDiff");
    if (bRd) bRd.addEventListener("click", function () { viewReflowDiff(d); });
    var bRn = document.getElementById("mRfNote");
    if (bRn) bRn.addEventListener("click", function () { exportReflowNote(d); });
    var bRa = document.getElementById("mRfAdopt");
    if (bRa) bRa.addEventListener("click", function () { adoptReflow(d); });
    var bRh = document.getElementById("mRfHide");
    if (bRh) bRh.addEventListener("click", function () {
      var p = reloadDB();
      var r0 = (p.reflows || []).find(function (x) { return x.id === d.meta.id; });
      if (!r0) { toast("记录不存在"); return; }
      r0.keepHidden = !r0.keepHidden;
      saveDB(); rebuild(false, true); showCard(d.id);
      toast(r0.keepHidden ? "已设为👻不纳入披露包（仅内部留存）" : "已重新纳入披露包");
    });
    var bSnap = document.getElementById("mSnap");
    if (bSnap) bSnap.addEventListener("click", function () {
      var p = reloadDB();
      var f = fieldOf(d);
      p.versions.unshift({ ts: WQCore.stamp(), kind: "导图·手动存档", content: String(d.body || "").slice(0, 12000), field: f });
      p.trail.unshift({ ts: WQCore.stamp(), type: "ver", label: "导图存档「" + d.t + "」", note: "" });
      capVersions(p);
      saveDB(); toast("已存版本 ✓"); rebuild(false, true); showCard(id);
    });
    document.querySelectorAll(".mbtn.mai").forEach(function (b) {
      b.addEventListener("click", function () { aiRewrite(d, b.dataset.verb, b); });
    });

    /* 归档版本：自动回取全文，卡上不再只显示 300 字预览 */
    if (d.kind === "version") {
      fetchFullIfArchived(d).then(function (full) {
        if (!full) return;
        d.body = full;
        if (ST.cy) { var ele0 = ST.cy.getElementById(d.id); if (ele0.nonempty()) ele0.data("body", full); }
        if (ST.selId === d.id) showCard(d.id);
      });
    }
  }

  function fieldOf(d) {
    var pid = ST.p.id;
    if (d.kind === "draft") return "draft:" + d.meta.name;
    if (d.kind === "refdraft") return "ref";
    if (d.kind === "outline" && d.meta.main) return "outline";
    if (d.kind === "selection") return "selection";
    if (d.kind === "topic") return "topic";
    if (d.kind === "out") return d.meta.K === "matrix" ? "matrix" : d.meta.K === "design" ? "design" : "outs." + d.meta.K;
    return "tool";
  }
  function fileNameOf(d) {
    /* QA-P2-4：剥离 emoji/符号，避免下载文件名带表情 */
    var base = (d.t || "node")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
      .replace(/[\\/:*?"<>|\[\]]/g, "_").replace(/\s+/g, " ").trim().slice(0, 40);
    return (base || "node") + ".md";
  }

  /* ---- 编辑器（卡内切换 textarea） ---- */
  /* ---- 全屏查看/修改（双击节点或卡内 ✏️ 进入）：可写节点给大编辑器，其余给阅读视图 ---- */
  function openEditor(d) { showFullView(d); }

  function showFullView(d) {
    if (ST.busy) { toast("AI 生成中，请等它完成再编辑"); return; }
    var K = KINDS[d.kind] || { label: d.kind, icon: "•" };
    var editable = { draft: 1, refdraft: 1, topic: 1 }.hasOwnProperty(d.kind) ||
      (d.kind === "outline" && d.meta.main) || d.kind === "selection" || d.kind === "out";
    var metaBits = [];
    if (d.meta.ts) metaBits.push("🕓 " + d.meta.ts);
    if (d.meta.model) metaBits.push("模型 " + d.meta.model);
    if (d.kind === "paper" && d.meta.doi) metaBits.push('<a href="https://doi.org/' + WQCore.esc(d.meta.doi) + '" target="_blank" rel="noopener">doi.org ↗</a>');

    var m = document.createElement("div");
    m.className = "mmodal mfull";
    var inner;
    if (editable) {
      inner = "<textarea id='fvTa' spellcheck='false'></textarea>" +
        "<div class='mrow'><button class='mbtn pri' id='fvSave'>💾 保存</button><button class='mbtn' id='fvCancel'>取消</button>" +
        "<span class='mhint'>保存写入原项目数据并自动存版本；AI 改写/扩写/缩写在左侧节点卡里</span></div>";
    } else {
      inner = "<div class='fvread'>" + mdRender(d.body || "（无内容）") + "</div>" +
        "<div class='mrow'><button class='mbtn' id='fvCopy'>📋 复制</button><button class='mbtn' id='fvDl'>⤓ .md</button><button class='mbtn' id='fvClose'>关闭</button></div>";
    }
    m.innerHTML = "<div class='fvcard'><div class='fvhead'><b>" + K.icon + " " + K.label + " · " + WQCore.esc(d.t) +
      "</b><span class='fmeta'>" + metaBits.join(" · ") + "</span><button class='mclose' id='fvX'>✕</button></div>" + inner + "</div>";
    document.body.appendChild(m);

    var ta = null;
    var origBody = d.body || "";
    function isDirty() { return !!ta && ta.value !== origBody; }
    function cleanupKeys() { document.removeEventListener("keydown", onKey); }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); tryClose(); }                                  /* A5: Esc */
      else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S") && editable) { e.preventDefault(); var b = m.querySelector("#fvSave"); if (b) b.click(); }  /* Ctrl+S=保存 */
    }
    document.addEventListener("keydown", onKey);
    function closeM() { cleanupKeys(); m.remove(); if (ST.selId) focusNeighborhood(ST.selId); }     /* A7: 关闭还原压暗/流动 */
    async function tryClose() {
      if (isDirty()) {
        var ok = await confirmBox({ title: "放弃未保存的修改？", lines: ["全屏编辑器里有未保存的内容，直接关闭将丢失（可先 Ctrl+S 保存）"] });
        if (!ok) return;
      }
      closeM();
    }
    m.querySelector("#fvX").addEventListener("click", tryClose);
    m.addEventListener("click", function (e) { if (e.target === m) tryClose(); });

    if (editable) {
      ta = m.querySelector("#fvTa");
      ta.value = d.body || "";
      m.querySelector("#fvCancel").addEventListener("click", tryClose);
      m.querySelector("#fvSave").addEventListener("click", async function () {
        var txt = ta.value;
        if (!String(txt).trim()) {
          var ok = await confirmBox({ title: "清空「" + d.t + "」？", lines: ["保存后本节内容为空，节点将从导图上消失（版本档案留有记录）"] });
          if (!ok) return;
        }
        var p = reloadDB();
        var moved = writeBack(d, txt, "导图·手动编辑", null);
        saveDB();
        closeM();
        rebuild(false, true);
        if (ST.selId === d.id) showCard(d.id);
        toast("已保存 ✓" + (moved ? "（迁移 " + moved + " 处数字绑定）" : ""));
      });
      setTimeout(function () { ta.focus(); }, 50);
    } else {
      m.querySelector("#fvCopy").addEventListener("click", function () {
        (navigator.clipboard ? navigator.clipboard.writeText(d.body || "") : Promise.reject())
          .then(function () { toast("已复制 ✓"); }, function () { toast("复制失败（浏览器限制）"); });
      });
      m.querySelector("#fvDl").addEventListener("click", function () { dlText(fileNameOf(d), d.body || ""); });
      m.querySelector("#fvClose").addEventListener("click", closeM);
      /* 归档版本：阅读视图自动回取全文（force：不吃卡路径的去重） */
      if (d.kind === "version") {
        fetchFullIfArchived(d, true).then(function (full) {
          if (!full) return;
          d.body = full;
          if (ST.cy) { var ele0 = ST.cy.getElementById(d.id); if (ele0.nonempty()) ele0.data("body", full); }
          var rv = m.querySelector(".fvread");
          if (rv) {
            rv.innerHTML = mdRender(full);
            var hm = m.querySelector(".fmeta");
            if (hm) hm.textContent += " · 已从归档回取全文";
          }
        });
      }
    }
  }

  /* 把文本写回原数据结构（按节点 kind 分派）；返回迁移的数字绑定条数 */
  function writeBack(d, txt, verKind, aiMeta) {
    var p = ST.p, pid = p.id, now = WQCore.stamp();
    var sec = d.meta.name, moved = 0;
    if (d.kind === "draft") {
      var oldText = p.draft[sec] || "";
      p.draft[sec] = txt;
      if (p.draftRich) delete p.draftRich[sec];      /* 纯文本为真相，富文本缓存作废（同工作台口径） */
      ledger(p, sec, verKind, txt);
      moved = remapBinds(p, sec, oldText, txt);      /* QA-P1-2：绑定随文本迁移，死 key 一并清理 */
    } else if (d.kind === "refdraft") {
      var tgt = (p.refDraft && p.refDraft.sections && p.refDraft.sections[sec]) || (p.ref && p.ref.sections && p.ref.sections[sec]);
      if (typeof tgt === "string") { if (p.refDraft.sections) p.refDraft.sections[sec] = txt; else if (p.ref.sections) p.ref.sections[sec] = txt; }
      else if (tgt && typeof tgt === "object") tgt.text = txt;
      ledger(p, sec, verKind, txt);
    } else if (d.kind === "outline" && d.meta.main) {
      p.outline = txt; p.outs = p.outs || {}; p.outs.outline = p.outline;
      ledger(p, "outline", verKind, txt);
    } else if (d.kind === "selection") {
      p.selection = txt; ledger(p, "selection", verKind, txt);
    } else if (d.kind === "topic") {
      p.topic = txt;
    } else if (d.kind === "out") {
      var K = d.meta.K;
      if (K === "matrix") p.matrix = txt;
      else if (K === "design") p.design = txt;
      else { p.outs = p.outs || {}; p.outs[K] = txt; }
    }
    p.versions.unshift({ ts: now, kind: verKind, content: String(txt).slice(0, 12000), field: fieldOf(d) });
    capVersions(p);
    p.trail.unshift({
      ts: now, type: aiMeta ? "ai" : "act",
      label: (aiMeta ? "AI" + aiMeta.verb : "编辑") + "「" + d.t + "」（导图）",
      note: aiMeta ? ("模型 " + aiMeta.model + " · " + aiMeta.cost) : ""
    });
    if (p.trail.length > 200) p.trail.length = 200;        /* 与工作台 trailAdd 同上限 */
    return moved;
  }
  function ledger(p, sec, action, txt) {
    p.ledger = p.ledger || {};
    p.ledger[sec] = p.ledger[sec] || [];
    p.ledger[sec].unshift({ ts: WQCore.stamp(), action: action, chars: String(txt || "").replace(/\s+/g, "").length });
    if (p.ledger[sec].length > 100) p.ledger[sec].length = 100;
  }

  /* 版本容量：40 条上限，⭐星标豁免淘汰；淘汰发生时明示（专家评审 A6，不再静默） */
  function capVersions(p) {
    var dropped = 0;
    while (p.versions.length > 40) {
      var idx = -1;
      for (var i = p.versions.length - 1; i >= 0; i--) { if (!p.versions[i].star) { idx = i; break; } }
      if (idx < 0) break;
      p.versions.splice(idx, 1); dropped++;
    }
    if (dropped) toast("较早的 " + dropped + " 条版本已移出档案（⭐星标版本保留）——重要版本请先星标或 ⤓ 备份");
    return dropped;
  }

  /* ---- AI 改写/扩写/缩写（流式，写回前确认） ---- */
  async function aiRewrite(d, verb, btn) {
    if (ST.busy) { toast("有 AI 任务进行中，请等它完成"); return; }
    var okA = await confirmBox({
      title: "AI" + verb + "「" + d.t + "」？",
      lines: ["产出为学习参考；生成后先看 diff 预览，你点「采纳」才写入正文", "改写会尽量保留 [n] 引用编号——若编号有变化将锁定直接采纳", ST.p && ST.p.level === "bsc" ? "⚠ 本科层级：多数高校禁止 AI 直接生成/改写正文，本次产出仅作对照学习" : "引用-论断抽查建议采纳后再跑一次"].filter(Boolean)
    });
    if (!okA) return;
    ST.busy = true; btn.textContent = "⏳ 生成中…"; btn.disabled = true;
    /* 目标节点脉冲：生成时在图上看得见哪一节在动 */
    var stopPulse = (function () {
      var ele = (ST.cy && ST.cy.getElementById(d.id).nonempty()) ? ST.cy.getElementById(d.id) : null;
      if (!ele) return function () {};
      ele.addClass("busy");
      var on = false;
      var t = setInterval(function () {
        on = !on;
        try { ele.style("border-width", on ? 9 : 3).style("border-color", on ? "#f59e0b" : "#ffffff"); } catch (e) {}
      }, 550);
      return function () {
        clearInterval(t);
        try { ele.style("border-width", 1.5).style("border-color", "#ffffff"); ele.removeClass("busy"); } catch (e) {}
      };
    })();
    var ctl = new AbortController();
    var stopBtn = document.createElement("button");
    stopBtn.className = "mbtn"; stopBtn.textContent = "⏹ 停止";
    stopBtn.addEventListener("click", function () { ctl.abort(); });
    btn.after(stopBtn);
    var box = document.getElementById("cardBody");
    var live = document.createElement("div");
    live.className = "mbody live";
    live.innerHTML = "<p class='mhint'>生成中…</p>";
    box.appendChild(live);
    var PROMPT = {
      "改写": "请改写下面这段学术文稿：仅优化语言表达与逻辑衔接，保持事实、数据、结论与所有 [n] 引用编号完全不变，不新增内容。直接输出改写后的正文，不要任何解释。",
      "扩写": "请扩写下面这段学术文稿：补充论证细节与过渡，保持事实、数据、结论与所有 [n] 引用编号完全不变，篇幅约增加到 1.5 倍。直接输出扩写后的正文，不要任何解释。",
      "缩写": "请缩写下面这段学术文稿：删冗余、保要点，保持事实、数据、结论与所有 [n] 引用编号完全不变，篇幅约压缩到 60%。直接输出缩写后的正文，不要任何解释。"
    }[verb] || ("请润色以下学术文稿，保持 [n] 引用编号不变，直接输出正文：");
    try {
      var r = await WQCore.ai.stream(PROMPT + "\n\n【原文】\n" + (d.body || ""), { max_tokens: 6000, signal: ctl.signal },
        function (delta, full) { live.textContent = full.slice(-1200); });
      var out = String(r.text || "").trim();
      try { stopPulse(); } catch (e) {}
      /* B1 建议态（专家评审 X2/诚信#1）：生成后先看 diff，采纳才写回——默认态不再等于采纳态 */
      openSuggestView(d, out, verb, r.usage, btn);
    } catch (e) {
      toast((e && e.message === "已手动停止") ? "已停止（未写回）" : "AI 失败：" + (e && e.message));
      live.remove();
    } finally {
      /* 建议态：diff 弹窗开着时保持 busy，采纳/放弃才解除 */
      ST.busy = !!ST.suggest; stopBtn.remove();
      try { stopPulse(); } catch (e) {}
      if (btn) { btn.textContent = btn.dataset.verb === "改写" ? "🤖 改写" : btn.dataset.verb === "扩写" ? "➕ 扩写" : "➖ 缩写"; btn.disabled = false; }
      /* busy 期间用户切到了别的节点卡：那张卡的置灰按钮需要解除 */
      if (ST.selId && ST.selId !== d.id && ST.cy && ST.cy.getElementById(ST.selId).nonempty()) showCard(ST.selId);
    }
  }

  /* ---- B1 建议态：AI 产出的 diff 预览（诚信专家"只改一件事"+HCI#7 殊途同归）----
     旧左新右段落对照 + [n] 集合差硬闸 + 采纳才写回；放弃不写回不存版（token 已花） */
  function openSuggestView(d, newText, verb, usage, btn) {
    var oldText = d.body || "";
    var gate = citeDiff(oldText, newText);
    var gated = gate.lost.length || gate.gained.length;
    var cost = WQCore.ai.estCostText(usage.inTok, usage.outTok);
    ST.suggest = { d: d, newText: newText, verb: verb, usage: usage };
    var rows = WQCore.diff.paras(oldText, newText);
    var html = "", sameRun = 0;
    function flushSame() { if (sameRun) { html += "<div class='dsame'>··· " + sameRun + " 段未变 ···</div>"; sameRun = 0; } }
    rows.forEach(function (r0) {
      if (r0.type === "same") { sameRun++; return; }
      flushSame();
      if (r0.type === "del") html += "<div class='ddel'><b>− 删除</b>" + WQCore.esc(r0.ai) + "</div>";
      else if (r0.type === "add") html += "<div class='dadd'><b>+ 新增</b>" + WQCore.esc(r0.mine) + "</div>";
      else html += "<div class='dmod'><div class='do'><b>旧</b>" + WQCore.esc(r0.ai) + "</div><div class='dn'><b>新</b>" + WQCore.esc(r0.mine) + "</div></div>";
    });
    flushSame();
    if (!html) html = "<div class='dsame'>两个版本段落级完全一致</div>";
    var gateLine = gated
      ? "<span class='bad'>⚠ 引用编号有变化" + (gate.lost.length ? "：丢失 [" + gate.lost.join("][") + "]" : "") + (gate.gained.length ? (gate.lost.length ? "，" : "：新增 [") + gate.gained.join("][") + "]" : "") + " —— 可能丢引/错引，已锁定直接采纳；可「放弃」后手动编辑</span>"
      : "<span class='ok'>✓ 引用编号与原文一致</span>";
    var bscLine = (ST.p && ST.p.level === "bsc") ? "<div class='dbsc'>⚠ 本科层级：多数高校禁止 AI 直接生成/改写正文——本预览仅作对照学习，建议逐段手动改写后再采纳</div>" : "";
    var m = document.createElement("div");
    m.className = "mmodal mfull";
    m.innerHTML = "<div class='fvcard'><div class='fvhead'><b>🤖 AI" + verb + " · 建议态预览（采纳才写入正文）</b>" +
      "<span class='fmeta'>模型 " + WQCore.esc(WQCore.ai.conf().model || "默认") + " · " + cost + "</span><button class='mclose' id='svX'>✕</button></div>" +
      "<div class='dstat'>" + gateLine + bscLine + "</div>" +
      "<div class='dbody'>" + html + "</div>" +
      "<div class='mrow'><button class='mbtn pri' id='svAdopt'" + (gated ? " disabled title='引用编号有变化，不允许直接采纳'" : "") + ">✅ 采纳并写回</button>" +
      "<button class='mbtn' id='svDrop'>✕ 放弃（不写回）</button>" +
      "<span class='mhint'>放弃不退 token；采纳后自动存版本，迁移的数字绑定会标「待复核」</span></div></div>";
    document.body.appendChild(m);

    function closeS() { ST.suggest = null; ST.busy = false; m.remove(); }
    async function discard() {
      var ok = await confirmBox({ title: "放弃本次 AI 建议？", lines: ["不写回正文、不存版本；本次生成的 token 不退"] });
      if (!ok) return;
      closeS();
      if (btn) { btn.textContent = "🤖 改写"; btn.disabled = false; }
      toast("已放弃，未写回正文");
    }
    m.querySelector("#svX").addEventListener("click", discard);
    m.addEventListener("click", function (e) { if (e.target === m) discard(); });
    m.querySelector("#svDrop").addEventListener("click", discard);
    m.querySelector("#svAdopt").addEventListener("click", function () {
      if (gated) { toast("引用编号有变化，已锁定直接采纳——请放弃后手动编辑"); return; }
      var p = reloadDB();
      var moved = writeBack(d, newText, "导图·AI" + verb, {
        verb: verb, model: WQCore.ai.conf().model || "默认", cost: cost
      });
      saveDB();
      closeS();
      if (btn) { btn.textContent = "🤖 改写"; btn.disabled = false; }
      rebuild(false, true);
      showCard(d.id);
      toast("已采纳写回 ✓ " + cost + (moved ? "（迁移 " + moved + " 处数字绑定，已标待复核）" : ""));
    });
  }

  /* ================= M3：Word 回流（外部批注层） =================
     三轮评审终版：意见附言框 / 逐条消化四态+修改说明导出 / 写入即哈希 /
     来源声明制（系统未验证）/ 基准守护 / 截断大声警告 / 显式整稿采纳（如实记混合来源） */
  async function sha256Hex(t) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t || "")));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function openReflow(d) {
    if (ST.busy) { toast("有任务进行中，请稍候"); return; }
    var baseText = d.body || "";
    var m = document.createElement("div");
    m.className = "mmodal mfull";
    m.innerHTML = "<div class='fvcard'><div class='fvhead'><b>📥 Word 回流 · " + WQCore.esc(d.t) + "</b>" +
      "<span class='fmeta'>基准=当前稿（" + baseText.replace(/\s+/g, "").length + " 字）· 若发出后你又改过，建议先 📌 存版本再回流</span><button class='mclose' id='rfX'>✕</button></div>" +
      "<div class='dstat'>⚠ Word 的<b>批注气泡</b>不随全文复制进入 diff——请把批注文字粘到「意见附言」框；正文请贴<b>修订接受后</b>的全文。全文与附言至少填一项。</div>" +
      "<label style='font-size:12.5px;font-weight:700'>导师稿正文（粘贴，≤80000 字）</label>" +
      "<textarea id='rfTa' style='height:26vh' placeholder='在 Word 里 Ctrl+A 全选复制，粘贴到这里…'></textarea>" +
      "<label style='font-size:12.5px;font-weight:700;margin-top:8px;display:block'>意见附言（批注气球 / 微信意见，可选）</label>" +
      "<textarea id='rfCm' style='height:10vh' placeholder='批注文字逐条粘到这里…'></textarea>" +
      "<div class='mrow'><label style='font-size:12.5px'>来源人：</label><input id='rfSrc' value='导师' style='width:120px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px'>" +
      "<span class='mhint'>来源由作者声明，系统未验证</span></div>" +
      "<div class='mrow'><button class='mbtn pri' id='rfGen'>🔍 生成改动层</button><button class='mbtn' id='rfCancel'>取消</button>" +
      "<span class='mhint'>落库时对全文与基准各写入 SHA-256 哈希（写入即存证）</span></div></div>";
    document.body.appendChild(m);
    function closeM() { m.remove(); }
    m.querySelector("#rfX").addEventListener("click", closeM);
    m.querySelector("#rfCancel").addEventListener("click", closeM);
    m.querySelector("#rfGen").addEventListener("click", async function () {
      var text = m.querySelector("#rfTa").value;
      var comments = m.querySelector("#rfCm").value;
      var source = m.querySelector("#rfSrc").value.trim() || "导师";
      var truncated = false;
      if (!text.trim() && !comments.trim()) { toast("全文与意见附言至少填一项"); return; }
      if (text.length > 80000) { text = text.slice(0, 80000); truncated = true; }
      if (truncated) {
        var okT = await confirmBox({ title: "全文超过 80000 字", lines: ["已截断到 80000 字——截断会让 diff 失真", "学位论文建议按章回流（每个草稿节点一次）"] });
        if (!okT) return;
      }
      var rows = text.trim() ? WQCore.diff.paras(baseText, text) : [];
      var items = [];
      var i = 0;
      rows.forEach(function (r0) {
        if (r0.type === "same") return;
        i++;
        items.push({ i: i, type: r0.type, old: r0.type === "add" ? "" : r0.ai, new: r0.type === "del" ? "" : r0.mine, state: "待定", note: "" });
      });
      closeM();
      openReflowDigest(d, { text: text, comments: comments, source: source, items: items, truncated: truncated });
    });
  }

  function openReflowDigest(d, draft0) {
    var m = document.createElement("div");
    m.className = "mmodal mfull";
    function itemsHtml() {
      if (!draft0.items.length) return "<div class='dsame'>段落级无改动" + (draft0.comments ? "——意见见附言（共 " + draft0.comments.length + " 字）" : "") + "</div>";
      return draft0.items.map(function (it) {
        var body = "";
        if (it.type === "del") body = "<div class='ddel'><b>− 基准独有（导师删除）</b>" + WQCore.esc(it.old) + "</div>";
        else if (it.type === "add") body = "<div class='dadd'><b>+ 导师新增</b>" + WQCore.esc(it.new) + "</div>";
        else body = "<div class='dmod'><div class='do'><b>基准</b>" + WQCore.esc(it.old) + "</div><div class='dn'><b>导师</b>" + WQCore.esc(it.new) + "</div></div>";
        return "<div class='ditem' data-di='" + it.i + "'>" + body +
          "<div class='dgs'>" + ["采纳", "部分", "拒绝", "待定"].map(function (s0) {
            return "<button class='gs " + (it.state === s0 ? "on" : "") + "' data-st='" + s0 + "'>" + s0 + "</button>";
          }).join("") + "<input class='gnote' placeholder='备注（拒绝理由/部分采纳说明）' value='" + WQCore.esc(it.note || "") + "'></div></div>";
      }).join("");
    }
    m.innerHTML = "<div class='fvcard'><div class='fvhead'><b>📥 逐条消化 · " + WQCore.esc(d.t) + "</b>" +
      "<span class='fmeta'>改动 " + draft0.items.length + " 条 · 来源：" + WQCore.esc(draft0.source) + "（声明制，系统未验证）</span><button class='mclose' id='rfX'>✕</button></div>" +
      (draft0.comments ? "<div class='dstat'>💬 意见附言：" + WQCore.esc(draft0.comments) + "</div>" : "") +
      (draft0.truncated ? "<div class='dstat'><span class='bad'>⚠ 已截断到 80000 字——本次回流为残本</span></div>" : "") +
      "<div class='dbody'>" + itemsHtml() + "</div>" +
      "<div class='mrow'><button class='mbtn pri' id='rfSave'>💾 存入档案</button>" +
      "<button class='mbtn' id='rfAdoptAll'>✅ 以此稿为底稿</button>" +
      "<button class='mbtn' id='rfCancel'>取消</button>" +
      "<span class='mhint'>存档=证据入链（哈希+上图）；整稿采纳=正文被替换，版本链如实记「混合来源（外部采纳）」</span></div></div>";
    document.body.appendChild(m);
    m.querySelectorAll(".ditem").forEach(function (div0) {
      var ii = +div0.dataset.di;
      div0.querySelectorAll(".gs").forEach(function (b0) {
        b0.addEventListener("click", function () {
          var it = draft0.items.find(function (x) { return x.i === ii; });
          it.state = b0.dataset.st;
          div0.querySelectorAll(".gs").forEach(function (x0) { x0.classList.toggle("on", x0 === b0); });
        });
      });
      div0.querySelector(".gnote").addEventListener("input", function () {
        var it = draft0.items.find(function (x) { return x.i === ii; });
        it.note = this.value;
      });
    });
    function closeM() { m.remove(); }
    m.querySelector("#rfX").addEventListener("click", closeM);
    m.querySelector("#rfCancel").addEventListener("click", closeM);
    m.querySelector("#rfSave").addEventListener("click", async function () {
      var p = reloadDB();
      p.reflows = p.reflows || [];
      var entry = {
        id: "rf" + Date.now().toString(36),
        ts: WQCore.stamp(),
        baseField: d.meta.name,
        baseKind: d.kind === "refdraft" ? "refdraft" : "draft",
        text: draft0.text, comments: draft0.comments, source: draft0.source,
        hash: await sha256Hex(draft0.text + "‖" + draft0.comments),
        items: draft0.items, truncated: draft0.truncated, keepHidden: false
      };
      entry.baseHash = await sha256Hex(d.body || "");
      p.reflows.unshift(entry);
      p.trail.unshift({ ts: WQCore.stamp(), type: "doc", label: "Word 回流「" + d.t + "」", note: "来源：" + draft0.source + "（声明制）· 改动 " + draft0.items.length + " 条 · hash " + entry.hash.slice(0, 8) });
      saveDB();
      closeM();
      rebuild(false, true);
      toast("已存入档案 ✓（SHA-256 已写入，导师稿节点上图）");
    });
    m.querySelector("#rfAdoptAll").addEventListener("click", async function () {
      if (!draft0.text.trim()) { toast("导师稿正文为空（仅附言），无可采纳"); return; }
      var ok = await confirmBox({
        title: "整稿采纳「" + d.t + "」？",
        lines: ["正文将被导师稿替换（当前稿自动存版，不会丢失）", "版本链将如实记录为「混合来源（外部采纳）」——这是诚实记录，不是污点", "逐条消化状态仍会保留在导师稿节点上"]
      });
      if (!ok) return;
      var p = reloadDB();
      var cur0 = d.body || "";
      if (cur0.trim() && cur0 !== draft0.text) {
        p.versions.unshift({ ts: WQCore.stamp(), kind: "整稿采纳前自动存档", content: String(cur0).slice(0, 12000), field: fieldOf(d) });
        capVersions(p);
      }
      var moved = writeBack(d, draft0.text, "回流整稿采纳·外部批注", null);
      var t0 = p.trail[0];
      if (t0) t0.note = "来源：" + draft0.source + "（声明制）· 整稿采纳，混合来源";
      saveDB();
      closeM();
      rebuild(false, true);
      showCard(d.id);
      toast("已整稿采纳 ✓（自动存版）" + (moved ? "（迁移 " + moved + " 处数字绑定）" : ""));
    });
  }

  function viewReflowDiff(d) {
    var p = reloadDB();
    var r0 = (p.reflows || []).find(function (x) { return x.id === d.meta.id; });
    if (!r0) { toast("记录不存在"); return; }
    var baseText = "";
    if (r0.baseKind === "refdraft") baseText = ((p.refDraft || {}).sections || {})[r0.baseField];
    else baseText = (p.draft || {})[r0.baseField];
    baseText = typeof baseText === "string" ? baseText : ((baseText || {}).text || "");
    var rows = WQCore.diff.paras(baseText, r0.text);
    var html = "";
    var same = 0;
    rows.forEach(function (r1) {
      if (r1.type === "same") { same++; return; }
      if (same) { html += "<div class='dsame'>··· " + same + " 段未变 ···</div>"; same = 0; }
      if (r1.type === "del") html += "<div class='ddel'><b>− 基准独有</b>" + WQCore.esc(r1.ai) + "</div>";
      else if (r1.type === "add") html += "<div class='dadd'><b>+ 导师新增</b>" + WQCore.esc(r1.mine) + "</div>";
      else html += "<div class='dmod'><div class='do'><b>基准</b>" + WQCore.esc(r1.ai) + "</div><div class='dn'><b>导师</b>" + WQCore.esc(r1.mine) + "</div></div>";
    });
    if (same) html += "<div class='dsame'>··· " + same + " 段未变 ···</div>";
    var m = document.createElement("div");
    m.className = "mmodal mfull";
    m.innerHTML = "<div class='fvcard'><div class='fvhead'><b>🔄 导师稿 vs 当前基准 · " + WQCore.esc(d.t) + "</b>" +
      "<span class='fmeta'>hash " + WQCore.esc((r0.hash || "").slice(0, 10)) + " · 来源：" + WQCore.esc(r0.source || "导师") + "</span><button class='mclose' id='rfX'>✕</button></div>" +
      "<div class='dbody'>" + (html || "<div class='dsame'>与基准一致</div>") + "</div>" +
      "<div class='mrow'><button class='mbtn' id='rfDone'>关闭</button></div></div>";
    document.body.appendChild(m);
    m.querySelector("#rfX").addEventListener("click", function () { m.remove(); });
    m.querySelector("#rfDone").addEventListener("click", function () { m.remove(); });
  }

  function exportReflowNote(d) {
    var p = reloadDB();
    var r0 = (p.reflows || []).find(function (x) { return x.id === d.meta.id; });
    if (!r0) { toast("记录不存在"); return; }
    var lines = ["# 修改说明（基于外部批注回流）", "",
      "- 节：④草稿·" + r0.baseField, "- 回流时间：" + r0.ts, "- 来源：" + (r0.source || "导师") + "（来源由作者声明，系统未验证）",
      "- 哈希：SHA-256 " + (r0.hash || "—").slice(0, 16) + "…", "", "## 逐条处理", ""];
    var items = r0.items || [];
    if (!items.length) lines.push("（段落级无正文改动" + (r0.comments ? "；见意见附言" : "") + "）");
    items.forEach(function (it) {
      lines.push("## 第 " + it.i + " 条【" + it.state + "】");
      if (it.old) lines.push("- 基准：" + String(it.old).slice(0, 200).replace(/\n/g, " "));
      if (it.new) lines.push("- 导师：" + String(it.new).slice(0, 200).replace(/\n/g, " "));
      if (it.note) lines.push("- 说明：" + it.note);
      lines.push("");
    });
    if (r0.comments) lines.push("## 意见附言（原样）", "", r0.comments);
    if (r0.keepHidden) lines.unshift("> 👻 本记录已标记为不纳入披露包", "");
    dlText("修改说明-" + r0.baseField + "-" + String(r0.ts).slice(0, 10) + ".md", lines.join("\n"));
    toast("修改说明已导出 ✓");
  }

  async function adoptReflow(d) {
    var p = reloadDB();
    var r0 = (p.reflows || []).find(function (x) { return x.id === d.meta.id; });
    if (!r0 || !String(r0.text).trim()) { toast("导师稿正文为空，无可采纳"); return; }
    var ok = await confirmBox({
      title: "以此稿为底稿（整稿采纳）？",
      lines: ["「④草稿·" + r0.baseField + "」将被导师稿替换（当前稿自动存版，不会丢失）", "版本链将如实记录为「混合来源（外部采纳）」——诚实记录不是污点", "逐条消化状态保留在导师稿节点上"]
    });
    if (!ok) return;
    var sec = r0.baseField;
    /* A2 不变量：覆盖前为当前稿自动存版 */
    var cur0 = "";
    if (r0.baseKind === "refdraft") {
      var tg0 = (p.refDraft && p.refDraft.sections && p.refDraft.sections[sec]) || (p.ref && p.ref.sections && p.ref.sections[sec]);
      cur0 = typeof tg0 === "string" ? tg0 : ((tg0 || {}).text || "");
    } else {
      cur0 = (p.draft || {})[sec] || "";
    }
    if (cur0.trim() && cur0 !== r0.text) {
      p.versions.unshift({ ts: WQCore.stamp(), kind: "回流整稿前自动存档", content: String(cur0).slice(0, 12000), field: (r0.baseKind === "refdraft" ? "ref" : "draft:" + sec) });
      capVersions(p);
    }
    if (r0.baseKind === "refdraft") {
      var tgt = (p.refDraft && p.refDraft.sections && p.refDraft.sections[sec]) || (p.ref && p.ref.sections && p.ref.sections[sec]);
      if (typeof tgt === "string") { if (p.refDraft.sections) p.refDraft.sections[sec] = r0.text; }
      else if (tgt && typeof tgt === "object") tgt.text = r0.text;
    } else {
      p.draft = p.draft || {}; p.draft[sec] = r0.text;
      if (p.draftRich) delete p.draftRich[sec];
      ledger(p, sec, "回流整稿采纳", r0.text);
    }
    p.versions.unshift({ ts: WQCore.stamp(), kind: "回流整稿采纳·外部批注", content: String(r0.text).slice(0, 12000), field: (r0.baseKind === "refdraft" ? "ref" : "draft:" + sec) });
    capVersions(p);
    p.trail.unshift({ ts: WQCore.stamp(), type: "act", label: "整稿采纳「" + d.t + "」", note: "来源：" + (r0.source || "导师") + "（声明制）· 混合来源" });
    saveDB();
    rebuild(false, true);
    showCard(d.id);
    toast("已整稿采纳 ✓（当前稿已自动存版）");
  }

  /* ---- 版本节点：载入回项目（QA-P2-7；归档版本自动回取 IndexedDB 正文） ---- */
  async function loadVersion(d) {
    var p = reloadDB();
    var vi = -1;
    (p.versions || []).forEach(function (v, i) { if (v.ts === d.meta.ts) vi = i; });
    if (vi < 0) { toast("找不到该版本记录（可能已被容量上限淘汰）"); return; }
    var v = p.versions[vi];
    var lines = ["「" + v.kind + "」将覆盖 " + (v.field || "") + " 的当前内容", "覆盖前会自动为当前内容存一版「回滚前自动存档」（专家评审 A2：凡丢弃必先留版）"];
    if (!v.archived && (v.content || "").length >= 12000) {
      /* 默认拦截式警告：截断残本写回正文比不看更糟 */
      lines.push("⚠ 此版本存档时被截断到 12000 字（原稿可能更长），载入将得到残本——建议先到工作台核对原稿");
    }
    var ok = await confirmBox({ title: "把这个版本载入回项目？", lines: lines });
    if (!ok) return;
    var content = v.content;
    if (v.archived && window.WQStore) content = (await window.WQStore.getVersion(p.id, vi)) || content;
    var f = v.field || "";
    /* A2：覆盖前为当前内容自动存版——回滚不再是唯一不落版的写路径 */
    var cur = null;
    if (f === "selection") cur = p.selection;
    else if (f === "outline") cur = p.outline;
    else if (f.indexOf("draft:") === 0) cur = (p.draft || {})[f.slice(6)];
    else if (f === "matrix") cur = p.matrix;
    else if (f === "design") cur = p.design;
    else if (f.indexOf("outs.") === 0) cur = (p.outs || {})[f.slice(5)];
    if (typeof cur === "string" && cur.trim() && cur !== content) {
      p.versions.unshift({ ts: WQCore.stamp(), kind: "回滚前自动存档", content: String(cur).slice(0, 12000), field: f });
      capVersions(p);
    }
    if (f === "selection") p.selection = content;
    else if (f === "outline") { p.outline = content; p.outs = p.outs || {}; p.outs.outline = content; }
    else if (f.indexOf("draft:") === 0) {
      var sn = f.slice(6);
      p.draft = p.draft || {}; p.draft[sn] = content;
      if (p.draftRich) delete p.draftRich[sn];
    }
    else if (f === "matrix") p.matrix = content;
    else if (f === "design") p.design = content;
    else if (f.indexOf("outs.") === 0) { p.outs = p.outs || {}; p.outs[f.slice(5)] = content; }
    else { toast("该类型版本请在工作台的版本档案里载入"); return; }
    p.trail.unshift({ ts: WQCore.stamp(), type: "load", label: "导图载入版本「" + v.kind + "」", note: "" });
    saveDB();
    rebuild(false, true);
    showCard(d.id);
    toast("已载入 ✓");
  }

  /* ================= 轻量弹层（confirm/toast，页内实现不依赖 studio 队列） ================= */
  function confirmBox(o) {
    return new Promise(function (res) {
      var m = document.createElement("div");
      m.className = "mmodal";
      m.innerHTML = "<div class='mcard'><h4>" + WQCore.esc(o.title) + "</h4>" +
        (o.lines || []).map(function (l) { return "<p>· " + WQCore.esc(l) + "</p>"; }).join("") +
        "<div class='mrow'><button class='mbtn pri' id='_ok'>确定</button><button class='mbtn' id='_no'>取消</button></div></div>";
      document.body.appendChild(m);
      m.querySelector("#_ok").addEventListener("click", function () { m.remove(); res(true); });
      m.querySelector("#_no").addEventListener("click", function () { m.remove(); res(false); });
      m.addEventListener("click", function (e) { if (e.target === m) { m.remove(); res(false); } });
    });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("mtoast");
    if (!t) { t = document.createElement("div"); t.id = "mtoast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function dlText(name, text) {
    var b = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ================= 数据读写（与 studio 同库；改前重读磁盘防跨标签旧快照覆盖） ================= */
  function reloadDB() {
    ST.db = WQCore.loadLocal();
    var np = null;
    (ST.db.projects || []).forEach(function (x) { if (x.id === ST.pid) np = x; });
    if (np) ST.p = np;
    return ST.p;   /* 返回新引用——调用方必须用它，不能用 reload 前捕获的旧 p */
  }
  function saveDB() {
    var r = WQCore.saveLocal(ST.db);
    if (!r.ok) toast("保存失败（存储空间不足？）请先备份");
    return r;
  }

  /* ================= 侧栏：思维链（轨迹时间线） ================= */
  function renderTrail(p) {
    var box = document.getElementById("trailList");
    var items = (p.trail || []).slice(0, 200);
    if (!items.length) { box.innerHTML = "<p class='mhint'>还没有轨迹记录</p>"; return; }
    box.innerHTML = items.map(function (t0) {
      return "<div class='trow'><span class='tico'>" + (TRAIL_ICON[t0.type] || "•") + "</span>" +
        "<div><div class='ttl'>" + WQCore.esc(t0.label || "") + "</div>" +
        "<div class='tts'>" + WQCore.esc(t0.ts || "") + (t0.note ? " · " + WQCore.esc(t0.note) : "") + "</div></div></div>";
    }).join("");
  }

  /* ================= 装配 ================= */
  function rebuild(savePos, keepView) {
    var view = null;
    if (ST.cy) {
      stopFlow();
      if (keepView) view = { z: ST.cy.zoom(), x: ST.cy.pan().x, y: ST.cy.pan().y };  /* QA-P1-4：节点级操作不拉走视口 */
      if (savePos) {
        /* 把当前位置记回 mapState（拖过的节点下次打开保持） */
        var p0 = ST.p;
        p0.mapState = p0.mapState || { pos: {} };
        ST.cy.nodes().forEach(function (n) {
          var pos0 = n.position();
          if (n._moved) p0.mapState.pos[n.id] = { x: Math.round(pos0.x), y: Math.round(pos0.y) };
        });
      }
      ST.cy.destroy();
    }
    reloadDB();
    var g = layout(ST.p, derive(ST.p));
    /* 新节点飞入：与上一次图 diff；首次建图不动画（免全图乱飞）；动效关闭时不飞 */
    var dyn = null;
    if (ST.prevIds && FX.on) {
      var newIds = {};
      g.nodes.forEach(function (n) { if (!ST.prevIds[n.id]) newIds[n.id] = 1; });
      if (Object.keys(newIds).length) {
        var topicN = null;
        g.nodes.forEach(function (n) { if (n.kind === "topic") topicN = n; });
        dyn = { newIds: newIds, anchorPos: topicN ? { x: topicN._x, y: topicN._y } : { x: 0, y: 0 } };
      }
    }
    ST.prevIds = {};
    g.nodes.forEach(function (n) { ST.prevIds[n.id] = 1; });
    ST.cy = buildCy(ST.p, g, dyn);
    applyChainFilter();
    document.getElementById("stCount").textContent = g.nodes.length + " 节点 · " + g.edges.length + " 条链路";
    renderTrail(ST.p);
    var cve = document.getElementById("cvEmpty");
    if (cve) cve.classList.add("hidden");
    ST.cy.nodes().on("dragfree", function (e) { e.target._moved = true; schedulePosSave(); });
    if (ST.selId && ST.cy.getElementById(ST.selId).nonempty()) { ST.cy.getElementById(ST.selId).select(); }
    else { ST.selId = null; document.getElementById("card").classList.remove("open"); }
    if (view) { ST.cy.zoom(view.z); ST.cy.pan({ x: view.x, y: view.y }); }
    else ST.cy.fit(undefined, 50);
  }
  var posTimer = null;
  function schedulePosSave() {
    if (posTimer) clearTimeout(posTimer);
    posTimer = setTimeout(function () {
      reloadDB();
      ST.p.mapState = ST.p.mapState || { pos: {} };
      ST.cy.nodes().forEach(function (n) {
        if (n._moved) { var q = n.position(); ST.p.mapState.pos[n.id] = { x: Math.round(q.x), y: Math.round(q.y) }; }
      });
      saveDB();
    }, 1200);
  }
  function applyChainFilter() {
    if (!ST.cy) return;
    ["logic", "academic", "evidence", "revision", "review"].forEach(function (c) {
      var on = document.getElementById("chk_" + c) ? document.getElementById("chk_" + c).checked : true;
      ST.cy.edges("[chain='" + c + "']").style("display", on ? "element" : "none");
    });
  }

  function init() {
    ST.db = WQCore.loadLocal();
    var qs = new URLSearchParams(location.search);
    ST.pid = qs.get("p") || ST.db.cur || null;
    var sel = document.getElementById("projSel");
    var list = (ST.db.projects || []);
    if (!list.length) {
      document.getElementById("stCount").textContent = "还没有项目——先到工作台新建或生成参考稿";
    }
    sel.innerHTML = list.map(function (p0) {
      return "<option value='" + WQCore.esc(p0.id) + "'" + (p0.id === ST.pid ? " selected" : "") + ">" +
        WQCore.esc((p0.name || p0.topic || p0.id).slice(0, 24)) + "（" + ((p0.draft && Object.keys(p0.draft).length) || 0) + " 节稿）</option>";
    }).join("");
    if (!ST.pid && list.length) ST.pid = list[0].id;
    ST.p = list.find(function (x) { return x.id === ST.pid; }) || null;
    /* QA-P2-2 / QA-P2-3：坏深链与空库都给可行动的引导，不留白屏 */
    if (!ST.p) {
      var cve = document.getElementById("cvEmpty");
      cve.classList.remove("hidden");
      if (!list.length) {
        document.getElementById("cveTitle").textContent = "这里还没有图";
        document.getElementById("cveSub").textContent = "先用参考稿 Agent 十分钟生成一份带真实文献的底稿，或到工作台新建项目——生成后这里自动成图";
        document.getElementById("cveBtns").style.display = "";
        document.getElementById("stCount").textContent = "还没有项目";
      } else {
        document.getElementById("cveTitle").textContent = "未找到项目「" + ST.pid + "」";
        document.getElementById("cveSub").textContent = "项目可能已删除，或链接来自别的浏览器（数据只存本机）。请从首页或工作台重新进入";
        document.getElementById("cveBtns").style.display = "none";
        document.getElementById("stCount").textContent = "项目不存在";
      }
    }
    /* QA-P3：节点颜色图例 */
    var lg = document.getElementById("legend");
    if (lg) lg.innerHTML = Object.keys(KINDS).map(function (k) {
      return "<span><i style='background:" + KINDS[k].color + "'></i>" + KINDS[k].label + "</span>";
    }).join("");
    /* A8：链条标签色从 CHAINS 常量注入（不再手写色值漂移） */
    Object.keys(CHAINS).forEach(function (c) {
      var el = document.getElementById("lbl_" + c);
      if (el) el.style.color = CHAINS[c].color;
    });
    /* C2：动效开关（记住偏好；系统偏好减少动效时默认关） */
    var fxChk = document.getElementById("chk_fx");
    var fxPref = null;
    try { fxPref = localStorage.getItem("wenqu_map_fx"); } catch (e) {}
    FX.on = fxPref === "on" ? true : fxPref === "off" ? false
      : !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    fxChk.checked = FX.on;
    fxChk.addEventListener("change", function () {
      FX.on = fxChk.checked;
      try { localStorage.setItem("wenqu_map_fx", FX.on ? "on" : "off"); } catch (e) {}
      if (!FX.on) stopFlow();
      toast(FX.on ? "动效已开启" : "动效已关闭（专注模式；AI 脉冲保留）");
    });
    /* C1：节点搜索——高亮命中，回车定位第一个 */
    var sInput = document.getElementById("mSearch");
    function clearHits() { if (ST.cy) ST.cy.nodes(".hit").removeClass("hit"); }
    sInput.addEventListener("input", function () {
      var q = sInput.value.trim().toLowerCase();
      clearHits();
      if (!q || !ST.cy) return;
      ST.cy.nodes().forEach(function (n) {
        if (String(n.data("t") || "").toLowerCase().indexOf(q) >= 0) n.addClass("hit");
      });
    });
    sInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { sInput.value = ""; clearHits(); sInput.blur(); return; }
      if (e.key !== "Enter" || !ST.cy) return;
      var hits = ST.cy.nodes(".hit");
      if (!hits.length) { toast("没有命中的节点"); return; }
      var first = hits[0];
      ST.cy.animate({ center: { ele: first } }, { duration: 300 });
      first.select();
      showCard(first.id());
      focusNeighborhood(first.id());
    });
    /* QA-P1-3：别的标签保存了 → 防抖重建（保持视口），双屏左改右看 */
    var syncTimer = null;
    window.addEventListener("storage", function (e) {
      if (e.key !== WQCore.LS_DB || ST.busy) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () { rebuild(false, true); toast("已同步其他标签的修改 ✓"); }, 800);
    });
    document.getElementById("btnBak").addEventListener("click", function () {
      reloadDB();
      var blob = new Blob([JSON.stringify(ST.db)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "萤算导图备份-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast("备份已下载 ✓（含全部项目与版本档案）");
    });
    sel.addEventListener("change", function () {
      ST.pid = sel.value; ST.selId = null;
      ST.db.cur = ST.pid; saveDB();
      rebuild(false);
    });
    ["logic", "academic", "evidence", "revision", "review"].forEach(function (c) {
      var el = document.getElementById("chk_" + c);
      if (el) el.addEventListener("change", applyChainFilter);
    });
    document.getElementById("btnFit").addEventListener("click", function () { if (ST.cy) ST.cy.fit(undefined, 50); });
    document.getElementById("btnReset").addEventListener("click", async function () {
      var ok = await confirmBox({ title: "重置布局？", lines: ["清空本项目的节点位置记忆，恢复默认列式布局"] });
      if (!ok) return;
      reloadDB();
      ST.p.mapState = { pos: {} };
      saveDB(); rebuild(false); toast("已重置 ✓");
    });
    document.getElementById("btnPng").addEventListener("click", function () {
      if (!ST.cy) return;
      var url = ST.cy.png({ bg: "#f6f8fc", full: true });
      var a = document.createElement("a");
      a.href = url; a.download = "导图-" + String(ST.p && (ST.p.name || ST.p.topic) || "项目").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30) + ".png";
      a.click();
    });
    document.getElementById("btnCard").addEventListener("click", function () {
      document.getElementById("trailPane").classList.toggle("hidden");
    });
    document.getElementById("cardClose").addEventListener("click", function () {
      document.getElementById("card").classList.remove("open");
      if (ST.cy) { ST.cy.elements().removeClass("dimmed hot"); ST.cy.nodes().unselect(); }
      stopFlow();
      ST.selId = null;
    });
    if (ST.p) rebuild(false);
  }

  document.addEventListener("DOMContentLoaded", init);

  window.WQMap = { derive: derive, KINDS: KINDS, CHAINS: CHAINS, citeDiff: citeDiff, scanNumHits: scanNumHits, _ST: ST };
})();

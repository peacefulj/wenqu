/* 研墨 · 实证代码与三线表 ym-emp.js（v1.4 新增）
 * ① 按变量与研究设计生成 Stata / R / Python 代码模板（本地拼装，不调用 AI）
 * ② 把 esttab 屏幕输出 / CSV / Excel 复制的单元格转成 Markdown 三线表
 * 纯前端、零依赖；导图与工作台共用。
 */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  var METHODS = {
    ols: { name: "OLS / 多元回归", stata: "reghdfe", note: "基准线性回归" },
    fe: { name: "面板固定效应", stata: "xtreg" },
    twfe: { name: "双向固定效应", stata: "reghdfe" },
    did: { name: "DID（双重差分）", stata: "reghdfe" },
    event: { name: "事件研究 / 动态效应", stata: "reghdfe" },
    iv: { name: "IV（工具变量）", stata: "ivreghdfe" },
    rdd: { name: "RDD（断点回归）", stata: "rdrobust" },
    psm: { name: "PSM（倾向得分匹配）", stata: "psmatch2" },
    scm: { name: "合成控制法", stata: "synth" },
    mediate: { name: "中介效应", stata: "sgmediation" },
    moderate: { name: "调节效应", stata: "reghdfe" },
    threshold: { name: "门槛回归", stata: "xthreg" },
    spatial: { name: "空间计量", stata: "spxtregress" },
    sem: { name: "结构方程 / 问卷 SEM", stata: "sem" },
    logit: { name: "Logit / Probit", stata: "logit" }
  };

  function vlist(v) { return String(v || "").split(/[\s,，]+/).filter(Boolean); }
  function clean(v) { return vlist(v).map(function (s) { return s.replace(/[^\w\u4e00-\u9fff]/g, ""); }).filter(Boolean); }

  function templates(o) {
    var m = o.method || "ols";
    var y = o.y || "Y", xs = clean(o.x) || ["X"], cs = clean(o.ctrl) || [];
    var fe1 = o.fe1 || "id", fe2 = o.fe2 || "year", cl = o.cluster || fe1;
    var data = o.data || "data.dta";
    var ctrl = cs.length ? cs.join(" ") : "";
    var post = o.post || "post";
    var treat = o.treat || "treat";
    var iv = o.iv || "Z";
    var run = o.run || "0.05";
    var st = [], rs = [], py = [];

    st.push("* 研墨生成的 Stata 代码模板 —— 变量与路径请按你的数据核对后运行");
    st.push("clear all"); st.push('use "' + data + '", clear');
    st.push("ssc install reghdfe, replace"); st.push("ssc install estout, replace");
    if (m === "fe" || m === "twfe" || m === "did" || m === "event" || m === "moderate") {
      st.push("xtset " + fe1 + " " + fe2);
    }
    st.push("");
    if (m === "rdd") {
      st.push("ssc install rdrobust, replace");
      st.push("rdrobust " + y + " " + (xs[0] || "X") + ", c(" + (o.cutoff || 0) + ") p(1) kernel(triangular)");
      st.push("esttab using \"result.rtf\", replace b(3) se(3) star(* 0.1 ** 0.05 *** 0.01)");
    } else if (m === "psm") {
      st.push("ssc install psmatch2, replace");
      st.push("psmatch2 " + treat + " " + (ctrl || xs.join(" ")) + ", out(" + y + ") logit neighbor(1) common");
      st.push("pstest " + (ctrl || xs.join(" ")) + ", both graph");
      st.push("esttab using \"result.rtf\", replace b(3) se(3) star(* 0.1 ** 0.05 *** 0.01)");
    } else if (m === "scm") {
      st.push("ssc install synth, replace");
      st.push("synth " + y + " " + xs.join(" " ) + ", trunit(" + (o.unit || 1) + ") trperiod(" + (o.period || 2010) + ") unitnames(" + fe1 + ") timevar(" + fe2 + ")");
    } else if (m === "sem") {
      st.push("ssc install sem, replace");
      st.push("sem (" + (xs[0] || "X") + " -> " + y + ")");
      st.push("estat gof, stats(all)");
      st.push("esttab using \"result.rtf\", replace b(3) se(3) star(* 0.1 ** 0.05 *** 0.01)");
    } else if (m === "iv") {
      st.push("ssc install ivreghdfe, replace");
      st.push("ssc install ivreg2, replace");
      st.push("ivreghdfe " + y + " " + ctrl + " (" + (xs[0] || "X") + " = " + iv + "), absorb(" + fe1 + " " + fe2 + ") cluster(" + cl + ") first");
      st.push("estat firststage");
      st.push("esttab using \"result.rtf\", replace b(3) se(3) star(* 0.1 ** 0.05 *** 0.01) stats(N r2_a, labels(\"观测值\" \"调整R2\"))");
    } else {
      var rhs = "";
      if (m === "did") rhs = treat + "##" + post + (ctrl ? " " + ctrl : "");
      else if (m === "event") rhs = (o.event || "pre4 pre3 pre2 current post1 post2 post3") + (ctrl ? " " + ctrl : "");
      else if (m === "moderate") rhs = (xs[0] || "X") + "##" + (o.mod || "M") + (ctrl ? " " + ctrl : "");
      else if (m === "threshold") rhs = (xs[0] || "X");
      else if (m === "spatial") rhs = (xs.join(" ")) + (ctrl ? " " + ctrl : "");
      else rhs = xs.join(" ") + (ctrl ? " " + ctrl : "");
      var absorb = "absorb(" + fe1 + (m === "twfe" || m === "did" || m === "event" ? " " + fe2 : "") + ")";
      if (m === "fe") {
        st.push("xtreg " + y + " " + rhs + " i." + fe2 + ", fe cluster(" + cl + ")");
      } else if (m === "logit") {
        st.push("logit " + y + " " + rhs + ", cluster(" + cl + ")");
      } else if (m === "threshold") {
        st.push("ssc install xthreg, replace");
        st.push("xthreg " + y + " " + (ctrl ? ctrl + " " : "") + ", rx(" + (xs[0] || "X") + ") qx(" + (o.threshold || "TH") + ") thnum(1) trim(" + run + ") bs(300)");
      } else if (m === "spatial") {
        st.push("ssc install spxtregress, replace");
        st.push("spxtregress " + y + " " + rhs + ", fe");
      } else if (m === "mediate") {
        st.push("* 先安装 sgmediation：ssc install sgmediation, replace");
        st.push("sgmediation " + y + ", iv(" + (xs[0] || "X") + ") mv(" + (o.med || "M") + ")" + (ctrl ? " cv(" + ctrl + ")" : ""));
      } else {
        st.push("reghdfe " + y + " " + rhs + ", " + absorb + " vce(cluster " + cl + ")");
      }
      st.push("est store m1");
      st.push("esttab m1 using \"result.rtf\", replace b(3) se(3) star(* 0.1 ** 0.05 *** 0.01) stats(N r2_a, labels(\"观测值\" \"调整R2\"))");
    }
    st.push("graph export \"coef.png\", replace");

    rs.push("# 研墨生成的 R 代码模板（fixest + modelsummary）");
    rs.push('library(fixest); library(modelsummary); library(readr)');
    rs.push('dat <- read_csv("data.csv")');
    var rf = "feols(" + y + " ~ " + (m === "did" ? treat + " * " + post : m === "event" ? (o.event || "pre4 + pre3 + pre2 + current + post1 + post2 + post3") : xs.join(" + ")) + (ctrl ? " + " + ctrl : "") + " | " + fe1 + (m === "twfe" || m === "did" || m === "event" ? " + " + fe2 : "") + ", data = dat, cluster = ~" + cl + ")";
    if (m === "rdd") {
      rs.push("library(rdrobust)");
      rs.push('rd <- rdrobust(dat$' + y + ', dat$' + (xs[0] || "X") + ', c = ' + (o.cutoff || 0) + ')');
      rs.push("summary(rd)");
    } else if (m === "sem") {
      rs.push("library(lavaan)");
      rs.push("model <- ' " + y + " ~ " + xs.join(" + ") + " '");
      rs.push("fit <- sem(model, data = dat); summary(fit, fit.measures = TRUE, standardized = TRUE)");
    } else {
      rs.push(rf);
      rs.push('modelsummary(' + (m === "logit" ? "feols(" + y + " ~ " + xs.join(" + ") + (ctrl ? " + " + ctrl : "") + ", data = dat, family = logit)" : "feols(" + y + " ~ " + xs.join(" + ") + (ctrl ? " + " + ctrl : "") + " | " + fe1 + ", data = dat)") + ', stars = TRUE, output = "result.docx")');
    }

    py.push("# 研墨生成的 Python 代码模板（linearmodels / statsmodels）");
    py.push("import pandas as pd");
    py.push("from linearmodels.panel import PanelOLS");
    py.push("import statsmodels.formula.api as smf");
    py.push('df = pd.read_stata("data.dta")');
    py.push('df = df.set_index(["' + fe1 + '", "' + fe2 + '"])');
    var formula = y + " ~ " + (m === "did" ? treat + " * " + post : xs.join(" + ")) + (ctrl ? " + " + ctrl : "") + " + EntityEffects + TimeEffects";
    py.push('mod = PanelOLS.from_formula("' + formula + '", data=df).fit(cov_type="clustered", cluster_entity=True)');
    py.push("print(mod.summary)");
    py.push('mod.summary.as_html()  # 可复制到论文或另存为 HTML');
    if (m === "logit") {
      py.push('logit = smf.logit("' + y + " ~ " + xs.join(" + ") + (ctrl ? " + " + ctrl : "") + '", data=df.reset_index()).fit()');
      py.push("print(logit.summary())");
    }

    return { stata: st.join("\n"), r: rs.join("\n"), python: py.join("\n") };
  }

  /* ---------- esttab / CSV → Markdown 三线表 ---------- */
  var STAT_CN = {
    "observations": "观测值", "observation": "观测值", "n": "观测值", "obs": "观测值",
    "r-squared": "R²", "r2": "R²", "r-squared within": "组内 R²", "adjusted r-squared": "调整 R²",
    "adj. r-squared": "调整 R²", "r2_a": "调整 R²", "within r2": "组内 R²",
    "standard errors": "标准误", "standard error": "标准误", "mean": "均值", "sd": "标准差",
    "std. dev.": "标准差", "min": "最小值", "max": "最大值", "pseudo r2": "伪 R²", "f": "F 值"
  };
  function cnStat(s) {
    var k = String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
    return STAT_CN[k] || s;
  }
  function cleanCell(s) { return String(s == null ? "" : s).replace(/^["']|["']$/g, "").replace(/\|/g, "/").trim(); }
  function parseEsttab(text) {
    var raw = String(text || "").replace(/\r/g, "");
    var lines = raw.split("\n").filter(function (l) { return l.trim() && !/^[-=+]{3,}$/.test(l.trim()); });
    if (!lines.length) throw new Error("没有可解析的内容");
    /* CSV / TSV / Excel 粘贴：含制表符或逗号且每行列数一致 */
    var sep = null;
    if (/\t/.test(raw)) sep = "\t";
    else if (/,/.test(raw) && /,/.test(lines[0])) sep = ",";
    var rows = [], indented = [];
    if (sep) {
      lines.forEach(function (l) {
        rows.push(l.split(sep).map(cleanCell)); indented.push(false);
      });
    } else {
      /* 固定宽度：以连续两格以上空白切分 */
      lines.forEach(function (l) {
        var parts = l.trim().split(/\s{2,}/).map(cleanCell);
        if (parts.length === 1) parts = l.trim().split(/\s+/).map(cleanCell);
        rows.push(parts);
        indented.push(/^\s{2,}/.test(l));   /* 以空白开头的行（标准误行）右对齐到模型列 */
      });
    }
    var maxN = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    rows = rows.map(function (r, i) {
      var n0 = r.length;
      while (r.length < maxN) { if (indented[i] && n0 < maxN) r.unshift(""); else r.push(""); }
      return r;
    });
    /* 去掉首列全空 */
    if (rows.every(function (r) { return !r[0]; })) rows = rows.map(function (r) { return r.slice(1); });
    maxN = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    /* 表头：第一行若含 (1)/(2)/模型名，则保留；否则用「变量 / 模型1…」 */
    var head = rows[0].slice();
    if (!head.some(function (c) { return /\(?\d+\)?/.test(c) || c; })) head = ["变量"].concat(Array(maxN - 1).fill("系数"));
    if (!head[0] || /^variables?$/i.test(head[0])) head[0] = "变量";
    var body = rows.slice(1);
    /* 系数行与标准误行：标准误行通常只有括号内容 */
    var md = [];
    md.push("| " + head.join(" | ") + " |");
    md.push("| " + head.map(function () { return "---"; }).join(" | ") + " |");
    body.forEach(function (r) {
      var first = r[0] || "";
      r[0] = cnStat(first);
      md.push("| " + r.join(" | ") + " |");
    });
    return { markdown: md.join("\n"), rows: [head].concat(body), cols: maxN };
  }

  function statNote(md) {
    var note = "";
    if (/\*{1,3}/.test(md)) note = "注：***、**、* 分别表示 1%、5%、10% 的显著性水平；括号内为标准误。";
    return note;
  }

  /* ---------- UI ---------- */
  function mount() {
    var pane = document.getElementById("tab-emp");
    if (!pane || pane.dataset.mounted) return;
    pane.dataset.mounted = "1";
    var defMethod = "ols";
    try {
      if (typeof cur === "function" && cur()) {
        var pm = String(cur().method || "");
        if (/DID|双重差分/i.test(pm)) defMethod = "did";
        else if (/IV|工具变量/i.test(pm)) defMethod = "iv";
        else if (/RDD|断点/i.test(pm)) defMethod = "rdd";
        else if (/面板|固定效应/i.test(pm)) defMethod = "fe";
        else if (/SEM|结构方程/i.test(pm)) defMethod = "sem";
        else if (/PSM|倾向/i.test(pm)) defMethod = "psm";
      }
    } catch (e) {}
    pane.innerHTML = ''
      + '<section class="block"><h2>📊 实证代码模板<small>按变量生成 Stata / R / Python 代码 —— 本地拼装，不调用 AI，不消耗 token</small></h2>'
      + '<div class="row">'
      + '<label class="hint">方法</label><select id="empMethod" style="flex:0 0 200px">' + Object.keys(METHODS).map(function (k) { return '<option value="' + k + '"' + (k === defMethod ? " selected" : "") + ">" + METHODS[k].name + "</option>"; }).join("") + '</select>'
      + '<label class="hint">语言</label><select id="empLang" style="flex:0 0 130px"><option value="stata">Stata</option><option value="r">R</option><option value="python">Python</option></select>'
      + '<label class="hint">数据文件</label><input id="empData" type="text" value="data.dta" style="flex:0 0 180px">'
      + '</div>'
      + '<div class="row">'
      + '<input id="empY" placeholder="被解释变量 Y" style="flex:1;min-width:150px">'
      + '<input id="empX" placeholder="核心解释变量 X（多个用空格）" style="flex:1;min-width:200px">'
      + '<input id="empCtrl" placeholder="控制变量（空格分隔）" style="flex:1;min-width:200px">'
      + '</div>'
      + '<div class="row">'
      + '<input id="empFe1" placeholder="个体维度（如 id）" value="id" style="flex:0 0 160px">'
      + '<input id="empFe2" placeholder="时间维度（如 year）" value="year" style="flex:0 0 160px">'
      + '<input id="empCluster" placeholder="聚类（如 id）" value="id" style="flex:0 0 140px">'
      + '<button id="empGen" class="btn2">生成代码</button>'
      + '<button id="empCopy" class="btn2 ghost">复制</button>'
      + '<button id="empDl" class="btn2 ghost">⤓ 下载</button>'
      + '</div>'
      + '<textarea id="empCode" rows="12" style="width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px" placeholder="点「生成代码」后在这里显示"></textarea>'
      + '<p class="hint" id="empProg"></p></section>'
      + '<section class="block"><h2>📐 esttab / CSV → 三线表<small>粘贴 Stata esttab 屏幕输出、CSV，或从 Excel 复制的单元格</small></h2>'
      + '<textarea id="empRaw" rows="8" style="width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px" placeholder="例：&#10;                 (1)          (2)&#10;VARIABLES      model1       model2&#10;x               0.123***     0.456**&#10;                 (0.05)      (0.06)&#10;Observations      100          200"></textarea>'
      + '<div class="row"><select id="empSec" style="flex:0 0 220px" aria-label="插入到哪一节"></select><button id="empParse" class="btn2">转成三线表</button><button id="empMdCopy" class="btn2 ghost">复制 Markdown</button><button id="empToDraft" class="btn2 ghost">插入到草稿</button><span class="hint" id="empMsg"></span></div>'
      + '<div id="empTable" class="mdpreview mdr" style="margin-top:8px"></div></section>'
      + '<section class="block"><h2>📈 用自己的数据作图<small>粘贴 CSV（第一行表头、第一列标签）→ 生成 ymchart 图表代码块</small></h2>'
      + '<textarea id="empCsv" rows="6" style="width:100%;font-family:var(--mono);font-size:12.5px" placeholder="年份,处理组,对照组&#10;2015,1.2,1.0&#10;2016,1.8,1.3"></textarea>'
      + '<div class="row"><select id="empChartType" style="flex:0 0 180px"><option value="bar">柱状图</option><option value="line">折线图</option><option value="scatter">散点图</option></select>'
      + '<select id="empChartSec" style="flex:0 0 220px" aria-label="图表插入到哪一节"></select>'
      + '<button id="empChart" class="btn2">生成图表</button><button id="empChartToDraft" class="btn2 ghost">插入草稿</button><span class="hint" id="empChartMsg"></span></div>'
      + '<div id="empChartPrev" class="mdpreview mdr" style="margin-top:8px"></div></section>';
    var lastCode = "", lastMd = "";
    var g = function (id) { return document.getElementById(id); };
    /* 目标节：大纲 ∪ 已写草稿；插入时按所选节追加，不再固定第一节 */
    function secOptions() {
      var p = cur(), list = [];
      try { list = (typeof outlineSections === "function" ? outlineSections(p) : []).slice(); } catch (e) {}
      list = list.concat(Object.keys((p && p.draft) || {}));
      list = list.filter(function (s, i) { return s && list.indexOf(s) === i; });
      return list;
    }
    function fillEmpSecs() {
      var p = cur(), list = secOptions();
      ["empSec", "empChartSec"].forEach(function (id) {
        var sel = g(id); if (!sel) return;
        sel.innerHTML = list.length
          ? list.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + ((p && p.draft && p.draft[s]) ? " ✓" : "") + "</option>"; }).join("")
          : '<option value="">（先在②写一节）</option>';
      });
    }
    fillEmpSecs();
    function insertTo(selId, md, msgId, kind) {
      var p = cur(); if (!p) { g(msgId).textContent = "先新建项目"; return; }
      var key = (g(selId) && g(selId).value) || "";
      if (!key) { g(msgId).textContent = "还没有可用节——先在 ② 里生成大纲或写一节"; return; }
      p.draft = p.draft || {};
      var next = (p.draft[key] || "") + (p.draft[key] ? "\n\n" : "") + md;
      if (window.WQCore && WQCore.commit) WQCore.commit(p, { field: "draft:" + key, content: next, kind: kind, actor: "user", note: "实证工具插入" });
      else {
        p.draft[key] = next;
        if (typeof addVersion === "function") addVersion(p, kind, md, "draft:" + key);
      }
      if (typeof save === "function") save();
      if (typeof renderSecBtns === "function") renderSecBtns();
      g(msgId).textContent = "已插入「" + key + "」末尾";
      fillEmpSecs();
      if (g(selId)) g(selId).value = key;
    }
    g("empGen").addEventListener("click", function () {
      var lang = g("empLang").value;
      var t = templates({
        method: g("empMethod").value, y: g("empY").value.trim(), x: g("empX").value,
        ctrl: g("empCtrl").value, fe1: g("empFe1").value.trim(), fe2: g("empFe2").value.trim(),
        cluster: g("empCluster").value.trim(), data: g("empData").value.trim()
      });
      lastCode = t[lang] || t.stata;
      g("empCode").value = lastCode;
      g("empProg").textContent = "✓ 已生成 " + METHODS[g("empMethod").value].name + " · " + ({ stata: "Stata", r: "R", python: "Python" }[lang]) + " 模板";
    });
    g("empCopy").addEventListener("click", function () {
      if (!lastCode) return;
      navigator.clipboard && navigator.clipboard.writeText(lastCode);
      g("empProg").textContent = "已复制到剪贴板";
    });
    g("empDl").addEventListener("click", function () {
      if (!lastCode) return;
      var ext = { stata: "do", r: "R", python: "py" }[g("empLang").value] || "do";
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([lastCode], { type: "text/plain;charset=utf-8" }));
      a.download = "analysis." + ext; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    });
    g("empParse").addEventListener("click", function () {
      try {
        var r = parseEsttab(g("empRaw").value);
        lastMd = r.markdown + (statNote(r.markdown) ? "\n\n" + statNote(r.markdown) : "");
        g("empTable").innerHTML = window.YMMd ? YMMd.mdToHTML(lastMd) : "<pre>" + esc(lastMd) + "</pre>";
        g("empMsg").textContent = "✓ 已转换（" + r.rows.length + " 行 × " + r.cols + " 列）";
      } catch (e) { g("empMsg").textContent = "转换失败：" + e.message; }
    });
    g("empMdCopy").addEventListener("click", function () {
      if (!lastMd) return;
      navigator.clipboard && navigator.clipboard.writeText(lastMd);
      g("empMsg").textContent = "Markdown 已复制";
    });
    g("empToDraft").addEventListener("click", function () {
      if (!lastMd) { g("empMsg").textContent = "先转换一次"; return; }
      try { insertTo("empSec", lastMd, "empMsg", "插入三线表"); }
      catch (e) { g("empMsg").textContent = "插入失败：" + e.message; }
    });
    /* CSV → ymchart 图表代码块 */
    var lastChartMd = "";
    function parseCSV(text) {
      var lines = String(text || "").replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
      if (lines.length < 2) throw new Error("至少需要表头 + 一行数据");
      var sep = /\t/.test(lines[0]) ? "\t" : ",";
      var head = lines[0].split(sep).map(function (s) { return s.trim().replace(/^"|"$/g, ""); });
      var labels = [], cols = head.slice(1).map(function () { return []; });
      lines.slice(1).forEach(function (l) {
        var c = l.split(sep).map(function (s) { return s.trim().replace(/^"|"$/g, ""); });
        labels.push(c[0]);
        for (var i = 1; i < head.length; i++) cols[i - 1].push(parseFloat(c[i]));
      });
      var series = head.slice(1).map(function (name, i) { return { name: name || ("系列" + (i + 1)), values: cols[i] }; })
        .filter(function (s) { return s.values.some(function (v) { return isFinite(v); }); });
      if (!series.length) throw new Error("没有识别到数值列");
      return { labels: labels, series: series };
    }
    g("empChart").addEventListener("click", function () {
      try {
        var d = parseCSV(g("empCsv").value);
        var obj = { type: g("empChartType").value, title: "图 · 自己的数据", labels: d.labels, series: d.series, demo: false };
        lastChartMd = "```ymchart\n" + JSON.stringify(obj, null, 2) + "\n```";
        g("empChartPrev").innerHTML = window.YMMd ? YMMd.mdToHTML(lastChartMd) : "<pre>" + esc(lastChartMd) + "</pre>";
        g("empChartMsg").textContent = "✓ 已生成（" + d.labels.length + " 个标签 / " + d.series.length + " 个系列）";
      } catch (e) { g("empChartMsg").textContent = "生成失败：" + e.message; }
    });
    g("empChartToDraft").addEventListener("click", function () {
      if (!lastChartMd) { g("empChartMsg").textContent = "先生成一次"; return; }
      try { insertTo("empChartSec", lastChartMd, "empChartMsg", "插入数据图"); }
      catch (e) { g("empChartMsg").textContent = "插入失败：" + e.message; }
    });
  }

  window.YMEmp = { templates: templates, parseEsttab: parseEsttab, METHODS: METHODS, mount: mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  /* 切换到工具台时再兜底挂载一次（studio.html 的标签页是后渲染的） */
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest('[data-mode="tools"]')) setTimeout(mount, 0); });
})();

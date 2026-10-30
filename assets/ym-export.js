/* 研墨 · Markdown / LaTeX 导出 ym-export.js（v1.1.0 新增）
 * 阶段④「我的稿」→ Markdown：front matter + 正文 + GB/T 7714 参考文献 + AI 辅助说明
 *               → LaTeX：ctexart + gbt7714，参考文献用 filecontents* 内嵌——单个 .tex 上传 Overleaf 选 XeLaTeX 即可编译。
 * 正文 [n] → \cite{key}；key 由 YMBib.ensureKeys 存回文献卡，与「导出 BibTeX」、MCP 用同一套。
 * 上半部分是纯转换函数（Node 可直接 require，scripts/check.mjs 用它自测）；
 * 下半部分挂按钮，依赖 studio.js 的全局：cur() save() PQ() LV() exportSecList() trailAdd() renderProcessLog()
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YMExport = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var PH = String.fromCharCode(0xE000), BAR = String.fromCharCode(0xE001);
  var PH_RE = new RegExp(PH + "(\\d+)" + PH, "g");
  var META_RE = /〔生成：[^〕]*〕/g;

  /* ================= LaTeX 转义（单遍替换，替换结果不会被二次转义） ================= */
  var TEX_ESC = { "\\": "\\textbackslash{}", "#": "\\#", "$": "\\$", "%": "\\%", "&": "\\&", "~": "\\textasciitilde{}", "_": "\\_", "^": "\\textasciicircum{}", "{": "\\{", "}": "\\}" };
  function texEsc(s) { return String(s == null ? "" : s).replace(/[\\#$%&~_^{}]/g, function (m) { return TEX_ESC[m]; }); }
  function cleanUrl(u) { return String(u).replace(/[\\{}\s]/g, ""); }
  function itemLine(t) { return "\\item " + (t.charAt(0) === "[" ? "{}" : "") + t; }   // \item 后紧跟 [ 会被当成可选参数

  /* ================= 引用：[1] [1,3] [2-5] [1][2] → \cite{k1,k2,...} ================= */
  var CITE_RUN = /\[\s*\d{1,4}(?:\s*[-–—~,，、]\s*\d{1,4})*\s*\](?:\s*\[\s*\d{1,4}(?:\s*[-–—~,，、]\s*\d{1,4})*\s*\])*/g;
  function citeKeys(m, ctx) {
    var nums = [], bad = false;
    m.replace(/\[([^\]]*)\]/g, function (x, inner) {
      inner.split(/[,，、]/).forEach(function (part) {
        var r = part.split(/[-–—~]/).map(function (y) { return parseInt(y, 10); });
        if (r.length === 1 && !isNaN(r[0])) nums.push(r[0]);
        else if (r.length === 2 && !isNaN(r[0]) && !isNaN(r[1]) && r[1] >= r[0] && r[1] - r[0] <= 300) { for (var k = r[0]; k <= r[1]; k++) nums.push(k); }
        else bad = true;
      });
      return x;
    });
    /* 有一个编号对不上文献库就整组原样保留（可能是年份、方程编号之类），并报告给用户 */
    if (bad || !nums.length || nums.some(function (n) { return !(n >= 1 && n <= ctx.keys.length && ctx.keys[n - 1]); })) { ctx.unresolved.push(m.replace(/\s+/g, "")); return null; }
    var seen = {}, keys = [];
    nums.forEach(function (n) { var k = ctx.keys[n - 1]; if (!seen[k]) { seen[k] = 1; keys.push(k); } ctx.cited[k] = 1; });
    return keys;
  }
  function newCtx(keys) { return { keys: keys || [], cited: {}, unresolved: [] }; }

  /* ================= 行内：先把公式 / 代码 / 链接 / 引用换成占位符，转义其余文字，再处理粗体斜体 ================= */
  function inlineTex(s, ctx) {
    ctx = ctx || newCtx();
    var keep = [];
    var put = function (tex) { keep.push(tex); return PH + (keep.length - 1) + PH; };
    s = String(s == null ? "" : s).split(PH).join("").split(BAR).join("");
    s = s.replace(/\$\$[\s\S]+?\$\$/g, function (m) { return put(m); })
      .replace(/\\\[[\s\S]+?\\\]/g, function (m) { return put(m); })
      .replace(/\\\([\s\S]+?\\\)/g, function (m) { return put(m); })
      .replace(/\$[^\s$](?:[^$\n]*?[^\s$])?\$(?!\d)/g, function (m) { return put(m); })   // Pandoc 规则：$ 内侧不能是空格、右 $ 后不能紧跟数字（排除 $5 和 $10）
      .replace(/`([^`\n]+)`/g, function (m, x) { return put("\\texttt{" + texEsc(x) + "}"); })
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, t, u) { return put("\\href{" + cleanUrl(u) + "}{" + texEsc(t) + "}"); })
      .replace(/https?:\/\/[^\s<>"'，。；：、（）【】《》\])]+/g, function (u) {
        var tail = (u.match(/[.,;:!?]+$/) || [""])[0];
        return put("\\url{" + cleanUrl(u.slice(0, u.length - tail.length)) + "}") + tail;
      })
      .replace(CITE_RUN, function (m) { var ks = citeKeys(m, ctx); return ks ? put("\\cite{" + ks.join(",") + "}") : m; });
    s = texEsc(s)
      .replace(/\*\*([^*\n]+?)\*\*/g, "\\textbf{$1}")
      .replace(/(^|[^*\\])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?!\*)/g, "$1\\emph{$2}");
    for (var k = 0; k < 4 && s.indexOf(PH) >= 0; k++) s = s.replace(PH_RE, function (m, i) { return keep[+i] == null ? "" : keep[+i]; });
    return s;
  }

  /* ================= 块级：标题 / 列表 / 引用块 / 表格 / 代码块 / 行间公式 / 段落 ================= */
  var OWN_NUM = /^(?:\d+(?:\.\d+)*[\s.、．]|[（(]?[一二三四五六七八九十百]+[)）、.．]|第[一二三四五六七八九十百\d]+[章节部分篇])/;   // 标题自带编号 → 用星号版，避免「1 一、引言」
  var LIST_RE = /^(?:([-*+])\s+|([•·▪●])\s*|(\d{1,3})[.)]\s+|(\d{1,3})、\s*|[（(](\d{1,3})[)）]\s*)(.+)$/;
  function headCmd(rel, txt, ctx) {
    var cmd = rel <= 0 ? "subsection" : rel === 1 ? "subsubsection" : "paragraph";
    return "\\" + cmd + (OWN_NUM.test(txt) ? "*" : "") + "{" + inlineTex(txt, ctx) + "}";
  }
  function splitRow(line) {
    return line.replace(/\\\|/g, BAR).replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.split(BAR).join("|").trim(); });
  }
  function tableTex(rows, ctx) {
    var w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var row = function (r, head) {
      var cells = [];
      for (var i = 0; i < w; i++) { var t = inlineTex(r[i] || "", ctx); cells.push(head && t ? "\\textbf{" + t + "}" : t); }
      var s = cells.join(" & ");
      return (s.charAt(0) === "[" ? "{}" : "") + s + " \\\\";   // 上一行的 \\ 后紧跟 [ 会被当成行距参数
    };
    return ["\\begin{center}", "\\small", "\\begin{tabularx}{\\linewidth}{" + new Array(w + 1).join("Y") + "}", "\\toprule", row(rows[0], true), "\\midrule"]
      .concat(rows.slice(1).map(function (r) { return row(r, false); }), ["\\bottomrule", "\\end{tabularx}", "\\end{center}"]).join("\n");
  }
  function mdToTex(md, ctx) {
    ctx = ctx || newCtx();
    var lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
    /* 标题层级按本节实际用到的最浅一级算：最浅 → \subsection，再深一级 → \subsubsection，更深 → \paragraph */
    var minH = 7, fence = false;
    lines.forEach(function (l) {
      if (/^\s*```/.test(l)) { fence = !fence; return; }
      var h = !fence && l.match(/^\s*(#{1,6})\s+\S/);
      if (h && h[1].length < minH) minH = h[1].length;
    });
    /* 与 Word 导出一致：正文每一行是一个段落（编辑框里回车即分段） */
    var out = [], list = null;
    function flushList() {
      if (!list) return;
      out.push("\\begin{" + list.type + "}");
      list.items.forEach(function (it) { out.push("  " + itemLine(inlineTex(it, ctx))); });
      out.push("\\end{" + list.type + "}", "");
      list = null;
    }
    var flush = flushList;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i], line = raw.trim(), m;
      if (/^```/.test(line)) {
        flush();
        var code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        out.push("\\begin{verbatim}", code.join("\n"), "\\end{verbatim}", "");
        continue;
      }
      if (!line) { flush(); continue; }
      if ((m = line.match(/^\$\$([\s\S]+)\$\$$/)) && m[1].indexOf("$$") < 0) { flush(); out.push("\\[", m[1].trim(), "\\]", ""); continue; }
      if (/^\$\$/.test(line) && line.indexOf("$$", 2) < 0) {
        flush();
        var buf = [line.slice(2)]; i++;
        while (i < lines.length && lines[i].indexOf("$$") < 0) buf.push(lines[i++]);
        if (i < lines.length) buf.push(lines[i].slice(0, lines[i].indexOf("$$")));
        out.push("\\[", buf.join("\n").trim(), "\\]", "");
        continue;
      }
      /* 已经是 LaTeX 的行间公式：\[ … \] 与 equation / align 等环境原样保留 */
      if (/^\\\[/.test(line) && line.indexOf("\\]") < 0) {
        flush();
        var mb = [line]; i++;
        while (i < lines.length && lines[i].indexOf("\\]") < 0) mb.push(lines[i++]);
        if (i < lines.length) mb.push(lines[i]);
        out.push(mb.join("\n"), "");
        continue;
      }
      if ((m = line.match(/^\\begin\{(equation|align|gather|multline|eqnarray|split)(\*?)\}/))) {
        flush();
        var endTag = "\\end{" + m[1] + m[2] + "}", eb = [line];
        if (line.indexOf(endTag) < 0) { i++; while (i < lines.length && lines[i].indexOf(endTag) < 0) eb.push(lines[i++]); if (i < lines.length) eb.push(lines[i]); }
        out.push(eb.join("\n"), "");
        continue;
      }
      if ((m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/))) { flush(); out.push(headCmd(m[1].length - minH, m[2], ctx), ""); continue; }
      if ((m = line.match(LIST_RE))) {
        var type = (m[1] || m[2]) ? "itemize" : "enumerate";
        if (list && list.type !== type) flushList();
        if (!list) list = { type: type, items: [] };
        list.items.push(m[6]);
        continue;
      }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += "\n" + line; continue; }
      if (/^>/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].trim().replace(/^>\s?/, ""));
        i--;
        out.push("\\begin{quote}", inlineTex(q.filter(Boolean).join("\n\n"), ctx), "\\end{quote}", "");
        continue;
      }
      if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
        flush();
        var rows = [splitRow(line)]; i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) rows.push(splitRow(lines[i++].trim()));
        i--;
        out.push(tableTex(rows, ctx), "");
        continue;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); out.push("\\medskip\\noindent\\rule{\\linewidth}{0.4pt}", ""); continue; }
      flush();
      out.push(inlineTex(line, ctx), "");
    }
    flush();
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ================= 整篇 ================= */
  /* env：{ YMBib, secs:[{name,md}], paradigm, level, ledger, checks:[], model, stamp, day, label, en } —— 由页面部分组装 */
  function prepSecs(env) {
    var metaLines = [];
    var secs = (env.secs || []).map(function (s) {
      var md = String(s.md || "").replace(META_RE, function (m) { metaLines.push(s.name + "：" + m.replace(/^〔|〕$/g, "")); return ""; }).trim();
      return { name: String(s.name || ""), md: md };
    });
    return { secs: secs, metaLines: metaLines, drafted: secs.filter(function (s) { return s.md; }).length };
  }
  function declOf(env, metaLines) {
    var lines = [], led = env.ledger;
    var pct = function (v) { return Math.round((+v || 0) * 100) + "%"; };
    if (led && led.bySec) Object.keys(led.bySec).forEach(function (sec) {
      var a = led.bySec[sec];
      lines.push(sec + "：本人贡献 " + pct(a.contribution) + "（亲笔 " + a.userChars + " 字 / 混合 " + Math.round(a.mixedChars) + " 字 / 参考原样 " + a.aiChars + " 字）");
    });
    var marks = (metaLines || []).map(function (m) { return "AI 起草标记 · " + m; });
    var total = led && led.total && led.total.total ? "本人贡献度合计 " + pct(led.contribution) + "（按字符数估算，混合改写段折半计）" : "";
    return { lines: lines, marks: marks, total: total, any: !!(lines.length || marks.length) };
  }
  function yq(s) { return '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ") + '"'; }
  /* 正文每一行是一个段落（与 Word 导出一致）；Markdown 里单个换行会被并成一段，所以在普通段落行前后补空行 */
  var NOT_PLAIN = /^(?:#{1,6}\s|[-*+]\s|[•·▪●]|\d{1,3}[.)]\s|\d{1,3}、|[（(]\d{1,3}[)）]|>|\||```|\$\$|\\\[|\\\]|\\begin\{|\\end\{)/;
  function paraBreaks(md) {
    var lines = String(md || "").split("\n"), out = [], fence = false, math = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], t = l.trim();
      if (/^```/.test(t)) fence = !fence;
      else if (!fence && (t === "$$" || (/^\$\$/.test(t) && t.indexOf("$$", 2) < 0) || (math && /\$\$$/.test(t)))) math = !math;
      out.push(l);
      var n = i + 1 < lines.length ? lines[i + 1].trim() : "";
      if (fence || math || !t || !n) continue;
      if (!NOT_PLAIN.test(t) || !NOT_PLAIN.test(n)) out.push("");
    }
    return out.join("\n");
  }
  /* 节内标题整体下移，最浅一级落到 ###（## 已用作节标题），层级关系不变 */
  function demoteMd(md) {
    var lines = String(md || "").split("\n"), fence = false, minH = 7;
    lines.forEach(function (l) {
      if (/^\s*```/.test(l)) { fence = !fence; return; }
      var h = !fence && l.match(/^(#{1,6})\s/);
      if (h && h[1].length < minH) minH = h[1].length;
    });
    var shift = minH < 3 ? 3 - minH : 0;
    if (!shift) return lines.join("\n");
    fence = false;
    return lines.map(function (l) {
      if (/^\s*```/.test(l)) { fence = !fence; return l; }
      if (fence) return l;
      return l.replace(/^(#{1,6})(?=\s)/, function (h) { return new Array(Math.min(6, h.length + shift) + 1).join("#"); });
    }).join("\n");
  }

  function buildMarkdown(p, env) {
    var B = env.YMBib, papers = (p && p.papers) || [];
    var pre = prepSecs(env), d = declOf(env, pre.metaLines);
    var title = p.topic || p.name || "未命名";
    var L = ["---", "title: " + yq(title), "project: " + yq(p.name), "paradigm: " + yq(env.paradigm), "level: " + yq(env.level),
      "date: " + yq(env.day), "generator: " + yq(env.label), "---", "", "# " + title, ""];
    pre.secs.forEach(function (s) { L.push("## " + s.name, "", s.md ? demoteMd(paraBreaks(s.md)) : "> 〔本节未写〕", ""); });
    if (papers.length) { L.push("## 参考文献", ""); B.gbList(papers).forEach(function (x) { L.push(x, ""); }); }
    if (d.any || p.ref) {
      L.push("## AI 辅助说明", "", "本稿在研墨辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。" + (d.lines.length ? "各节归属（按字符估算）：" : ""), "");
      d.lines.concat(d.marks).forEach(function (x) { L.push("- " + x); });
      if (d.lines.length || d.marks.length) L.push("");
      if (d.total) L.push(d.total + "。", "");
      L.push("模型：" + (env.model || "未记录") + " · 报告日期：" + env.stamp + "。作者对全部内容与引用的真实性负责。", "");
    }
    if (env.checks && env.checks.length) { L.push("## 校验记录（最近）", ""); env.checks.forEach(function (x) { L.push("- " + x); }); L.push(""); }
    L.push("---", "", "*由 " + env.label + " 辅助完成（" + env.stamp + "）；引用与数据请人工核对*", "");
    return { text: L.join("\n"), drafted: pre.drafted };
  }

  function buildLatex(p, env) {
    var B = env.YMBib, papers = (p && p.papers) || [];
    var newKeys = papers.length ? B.ensureKeys(papers) : 0;
    var ctx = newCtx(papers.map(function (f) { return f.key; }));
    var pre = prepSecs(env), d = declOf(env, pre.metaLines);
    var title = String(p.topic || p.name || "未命名");
    var body = pre.secs.map(function (s) {
      return "\\section" + (OWN_NUM.test(s.name) ? "*" : "") + "{" + texEsc(s.name) + "}\n" + (s.md ? mdToTex(s.md, ctx) : "（本节未写）");
    }).join("\n\n");
    var bib = papers.length ? B.toBibTeX(papers).trim() : "";
    var citedN = Object.keys(ctx.cited).length;
    var L = [
      "% !TEX program = xelatex",
      "% " + title.replace(/[\r\n]+/g, " "),
      "% 由 " + env.label + " 导出（" + env.stamp + "）",
      "% 编译：XeLaTeX → BibTeX → XeLaTeX → XeLaTeX。Overleaf：新建空白项目 → 上传本文件 → 菜单 Compiler 选 XeLaTeX。",
      "% 正文的 \\cite{} 对应文末参考文献；编号由 LaTeX 按首次引用的顺序重新生成，可能与研墨里的 [n] 不同。",
      ""
    ];
    if (bib) L.push("% 参考文献数据内嵌在下面（编译时写出 yanmo-refs.bib），要改题录直接改这里。",
      "\\begin{filecontents*}[overwrite]{yanmo-refs.bib}", bib, "\\end{filecontents*}", "");
    L.push(
      "\\documentclass[UTF8,a4paper,zihao=-4" + (env.en ? ",scheme=plain" : "") + "]{ctexart}",
      "\\usepackage[margin=2.5cm]{geometry}",
      "\\usepackage{amsmath,amssymb}",
      "\\usepackage{graphicx}",
      "\\usepackage{booktabs,tabularx}",
      "\\newcolumntype{Y}{>{\\raggedright\\arraybackslash}X}"
    );
    if (bib) L.push("\\PassOptionsToPackage{sort&compress}{natbib}", "\\usepackage{gbt7714}", "\\bibliographystyle{gbt7714-numerical}");
    L.push("\\usepackage[hidelinks]{hyperref}", "", "\\title{" + texEsc(title) + "}", "\\author{}", "\\date{}", "",
      "\\begin{document}", "\\maketitle", "", body, "");
    if (bib) {
      L.push(citedN ? "% \\nocite{*}   % 取消这行注释，可把文献库里没被引用的条目也列出来" : "\\nocite{*}   % 正文里没有 [n] 引用：列出文献库全部条目");
      L.push("\\bibliography{yanmo-refs}", "");
    }
    if (d.any || p.ref) {
      L.push("\\section*{AI 辅助说明}", "本稿在研墨辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。" + (d.lines.length ? "各节归属（按字符估算）：" : ""));
      var items = d.lines.concat(d.marks);
      if (items.length) L.push("\\begin{itemize}", items.map(function (x) { return "  " + itemLine(texEsc(x)); }).join("\n"), "\\end{itemize}");
      if (d.total) L.push(texEsc(d.total) + "。", "");
      L.push("模型：" + texEsc(env.model || "未记录") + "；报告日期：" + texEsc(env.stamp) + "。作者对全部内容与引用的真实性负责。", "");
    }
    if (env.checks && env.checks.length) {
      L.push("\\section*{校验记录（最近）}", "\\begin{itemize}", env.checks.map(function (x) { return "  " + itemLine(texEsc(x)); }).join("\n"), "\\end{itemize}", "");
    }
    L.push("\\end{document}", "");
    return { text: L.join("\n"), drafted: pre.drafted, cited: citedN, unresolved: ctx.unresolved, newKeys: newKeys };
  }

  return {
    texEsc: texEsc, inlineTex: inlineTex, mdToTex: mdToTex, demoteMd: demoteMd, newCtx: newCtx,
    buildMarkdown: buildMarkdown, buildLatex: buildLatex
  };
});

/* ================= 页面部分：阶段④ 导出按钮 ================= */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined" || !window.YMExport || !window.YMBib) return;
  const X = window.YMExport;
  const $ = (id) => document.getElementById(id);
  const notice = (t, lines) => (window.wqNotice ? wqNotice(t, lines) : alert(t));
  const tip = (t) => (window.toast ? toast(t) : console.log(t));
  const squash = (s) => String(s || "").replace(/\s+/g, "");

  /* 不加 BOM：.tex 开头的 BOM 会被部分引擎当成字符输出 */
  function dl(name, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileBase = (p) => String(p.topic || p.name || "论文").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 60) || "论文";

  /* 富文本 → 纯文本：与 wq-ui.js 的 htmlToPlain 同一算法，只用来判断富文本是否过期 */
  function richPlain(html) {
    const src = String(html || "")
      .replace(/<\s*(\/p|\/div|\/h[1-6]|\/blockquote)[^>]*>/gi, "\n\n")
      .replace(/<\s*br[^>]*>/gi, "\n")
      .replace(/<\s*\/li[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ");
    const doc = new DOMParser().parseFromString("<body>" + src + "</body>", "text/html");
    return (doc.body && doc.body.textContent) || "";
  }
  /* 富文本 → Markdown（保留标题、粗斜体、列表、引用块、表格；DOMParser 文档是惰性的，不执行脚本） */
  const BLOCK = /^(p|div|h[1-6]|ul|ol|li|blockquote|table|pre|hr|section|article|figure)$/;
  function inlineMd(node) {
    let out = "";
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName.toLowerCase();
      if (t === "br") out += "\n";
      else if (t === "b" || t === "strong") { const x = inlineMd(n).trim(); if (x) out += "**" + x + "**"; }
      else if (t === "i" || t === "em") { const x = inlineMd(n).trim(); if (x) out += "*" + x + "*"; }
      else if (t === "code") out += "`" + n.textContent + "`";
      else if (t === "a") { const h = n.getAttribute("href") || "", x = inlineMd(n); out += /^https?:\/\//i.test(h) && x.trim() && x.trim() !== h ? "[" + x.trim() + "](" + h + ")" : x; }
      else out += inlineMd(n);
    });
    return out;
  }
  function richToMd(html) {
    const doc = new DOMParser().parseFromString("<body>" + String(html || "") + "</body>", "text/html");
    const blocks = [];
    const walk = (node) => {
      let buf = "";
      const flush = () => { const x = buf.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim(); if (x) blocks.push(x); buf = ""; };
      node.childNodes.forEach(n => {
        const t = n.nodeType === 1 ? n.tagName.toLowerCase() : "";
        if (!t || !BLOCK.test(t)) {
          if (n.nodeType === 3) buf += n.nodeValue.replace(/\s+/g, " ");
          else if (n.nodeType === 1) { const wrap = doc.createElement("span"); wrap.appendChild(n.cloneNode(true)); buf += inlineMd(wrap); }   // 用惰性文档建容器：节点进了当前页面文档，<img> 会开始加载
          return;
        }
        flush();
        if (/^h[1-6]$/.test(t)) { const x = inlineMd(n).trim(); if (x) blocks.push(new Array(Math.min(6, Math.max(3, +t[1] + 1)) + 1).join("#") + " " + x.replace(/\n+/g, " ")); }
        else if (t === "ul" || t === "ol") {
          const items = Array.from(n.children).filter(c => c.tagName === "LI").map((li, i) => (t === "ol" ? (i + 1) + ". " : "- ") + inlineMd(li).trim().replace(/\n+/g, " "));
          if (items.length) blocks.push(items.join("\n"));
        }
        else if (t === "blockquote") { const x = inlineMd(n).trim(); if (x) blocks.push(x.split("\n").map(l => "> " + l).join("\n")); }
        else if (t === "table") {
          const rows = Array.from(n.querySelectorAll("tr")).map(tr => Array.from(tr.children).map(td => inlineMd(td).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|")));
          if (rows.length) {
            const w = Math.max.apply(null, rows.map(r => r.length));
            const line = (r) => "| " + Array.from({ length: w }, (_, i) => r[i] || "").join(" | ") + " |";
            blocks.push([line(rows[0]), "|" + new Array(w + 1).join(" --- |")].concat(rows.slice(1).map(line)).join("\n"));
          }
        }
        else if (t === "pre") blocks.push("```\n" + n.textContent.replace(/\n$/, "") + "\n```");
        else if (t === "hr") blocks.push("---");
        else if (t === "p" || t === "li") { const x = inlineMd(n).trim(); if (x) blocks.push(x); }
        else if (Array.from(n.children).some(c => BLOCK.test(c.tagName.toLowerCase()))) walk(n);
        else { const x = inlineMd(n).trim(); if (x) blocks.push(x); }
      });
      flush();
    };
    if (doc.body) walk(doc.body);
    return blocks.join("\n\n");
  }
  /* 取一节正文：富文本优先（与 Word 导出一致）；富文本与纯文本对不上（例如载入了旧版本）时用纯文本 */
  function sectionMd(p, s) {
    const plain = (p.draft && p.draft[s]) || "";
    const rich = p.draftRich && p.draftRich[s];
    if (rich && plain && squash(richPlain(rich)) === squash(plain)) {
      try { const md = richToMd(rich); if (md.trim()) return md; } catch (e) {}
    }
    return plain;
  }

  function envOf(p) {
    const pq = PQ(p), lv = LV(p);
    const secs = exportSecList(p, pq).map(s => ({ name: s, md: sectionMd(p, s) }));
    let ledger = null;
    try { ledger = WQCore.ledger.analyzeProject(p); } catch (e) { ledger = null; }
    const latest = {};
    (p.checks || []).forEach(c => { if (c && c.kind && !latest[c.kind]) latest[c.kind] = c; });
    const checks = Object.keys(latest).map(k => {
      const c = latest[k];
      return String(c.label || c.kind) + "：" + (c.stats && c.stats.problem != null ? (c.stats.problem ? c.stats.problem + " 项待处理" : "通过") + "（" + c.ts + "）" : String(c.ts || ""));
    });
    return {
      YMBib: window.YMBib, secs: secs, paradigm: pq.name, level: lv.name, ledger: ledger, checks: checks,
      model: (p.ref && p.ref.model) || WQCore.ai.conf().model || "",
      stamp: WQCore.stamp(), day: WQCore.localDay(), label: (window.YANMO && YANMO.label) || "研墨",
      en: !!($("enMode") && $("enMode").checked)
    };
  }

  function run(kind) {
    const p = cur(); if (!p) return notice("先新建项目");
    const env = envOf(p);
    if (!env.secs.some(s => String(s.md || "").replace(/〔生成：[^〕]*〕/g, "").trim())) {
      return notice("还没有「我的稿」内容", ["先在 ④ 写作或 ⑤ 参考稿修改里写好 / 采用至少一节，再导出"]);
    }
    if (kind === "md") {
      const r = X.buildMarkdown(p, env);
      dl(fileBase(p) + ".md", r.text, "text/markdown");
      trailAdd(p, "export", "导出全文（Markdown）", "已写 " + r.drafted + "/" + env.secs.length + " 节 · 参考文献 " + p.papers.length + " 篇");
      save(); renderProcessLog();
      tip("已导出 Markdown ✓");
      return;
    }
    const r = X.buildLatex(p, env);
    dl(fileBase(p) + ".tex", r.text, "application/x-tex");
    trailAdd(p, "export", "导出全文（LaTeX）", "已写 " + r.drafted + "/" + env.secs.length + " 节 · \\cite " + r.cited + " 篇" + (r.unresolved.length ? " · " + r.unresolved.length + " 处编号未匹配" : ""));
    save(); renderProcessLog();
    const lines = [
      "用 XeLaTeX 编译（Overleaf：上传 .tex → 菜单 Compiler 选 XeLaTeX）；参考文献已内嵌，不用另传 .bib",
      p.papers.length ? "正文里引用到的 " + r.cited + " 篇已转成 \\cite{}，LaTeX 会按首次引用的顺序重新编号" : "文献库是空的，导出的 .tex 没有参考文献"
    ];
    if (r.unresolved.length) lines.push(r.unresolved.length + " 处 [n] 对不上文献库编号，已原样保留：" + r.unresolved.slice(0, 5).join(" ") + (r.unresolved.length > 5 ? " …" : ""));
    notice("已导出 LaTeX ✓", lines);
  }

  (function mount() {
    const anchor = $("btnExportDoc2");
    if (!anchor || $("ymExpMd")) return;
    anchor.insertAdjacentHTML("afterend",
      '<button id="ymExpMd" class="btn2 ghost" title="Markdown：正文 + GB/T 7714 参考文献 + AI 辅助说明（Typora / Obsidian / Pandoc 都能打开）">⤓ Markdown</button>' +
      '<button id="ymExpTex" class="btn2 ghost" title="单个 .tex：ctexart + gbt7714，参考文献内嵌；上传 Overleaf 选 XeLaTeX 即可编译">⤓ LaTeX（Overleaf）</button>');
    $("ymExpMd").addEventListener("click", () => run("md"));
    $("ymExpTex").addEventListener("click", () => run("tex"));
  })();
})();

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
    /* 图片占位符 → includegraphics（由导出前 prepareImageSections 生成） */
    s = s.replace(/@@YMIMG(\d+)\|([^@]*)@@/g, function (m, i) {
      var im = (ctx.images || [])[+i];
      return im ? put("\\includegraphics[width=0.8\\linewidth]{" + im.name + "}") : "";
    });
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
      /* 独占一行的图片：居中，单独成图 */
      if (/^@@YMIMG\d+\|[^@]*@@$/.test(line)) {
        flush();
        out.push("\\begin{center}", inlineTex(line, ctx), "\\end{center}", "");
        continue;
      }
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
    var text = L.join("\n");
    if (env.images && env.images.length) text = spliceImgMd(text, env.images);
    return { text: text, drafted: pre.drafted };
  }
  /* Markdown 里把图片占位符换成内联 dataURL：单文件换机器打开也不丢图 */
  function spliceImgMd(text, images) {
    return String(text || "").replace(/@@YMIMG(\d+)\|([^@]*)@@/g, function (m, i, alt) {
      var im = (images || [])[+i];
      if (!im) return "";
      var a = "";
      try { a = decodeURIComponent(alt || ""); } catch (e) { a = alt || ""; }
      return "![" + a + "](" + im.dataUrl + ")";
    });
  }

  function buildLatex(p, env) {
    var B = env.YMBib, papers = (p && p.papers) || [];
    var newKeys = papers.length ? B.ensureKeys(papers) : 0;
    var ctx = newCtx(papers.map(function (f) { return f.key; }));
    ctx.images = env.images || [];
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
    buildMarkdown: buildMarkdown, buildLatex: buildLatex, spliceImgMd: spliceImgMd
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
  function dlBlob(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
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

  /* ================= 统一导出：所有入口共用一个 bundle ================= */
  function attributionOf(p, sections, env) {
    const marks = [];
    sections.forEach(s => {
      String(s.md || "").replace(/〔生成：[^〕]*〕/g, (m) => {
        marks.push(s.name + "：" + m.replace(/^〔|〕$/g, ""));
        return "";
      });
    });
    const led = env.ledger || {}, lines = [];
    const pct = (v) => Math.round((+v || 0) * 100) + "%";
    Object.keys(led.bySec || {}).forEach((sec) => {
      const a = led.bySec[sec];
      lines.push(sec + "：本人贡献 " + pct(a.contribution) + "（亲笔 " + a.userChars + " 字 / 混合 " + Math.round(a.mixedChars) + " 字 / 参考原样 " + a.aiChars + " 字）");
    });
    const total = led && led.total && led.total.total ? "本人贡献度合计 " + pct(led.contribution) + "（按字符数估算，混合改写段折半计）" : "";
    return { lines: lines, marks: marks, total: total, statement: "本稿在研墨辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。", model: env.model || "" };
  }

  async function bundleOf(p, opts) {
    opts = opts || {};
    const env = envOf(p);
    let secs = env.secs.map((s, i) => ({ key: "s" + (i + 1), name: s.name, md: s.md || "", origin: "draft" }));
    let prep = { texts: secs.map(s => s.md), images: [], missing: 0 };
    if (window.YMMd && YMMd.prepareImageSections) {
      try {
        prep = await YMMd.prepareImageSections(secs.map(s => s.md));
        secs = secs.map((s, i) => ({ ...s, md: prep.texts[i] }));
      } catch (e) { console.warn("图片预处理失败，按原文本导出", e); }
    }
    const refLines = window.YMBib ? YMBib.gbList(p.papers || []) : (p.papers || []).map((f, i) =>
      "[" + (i + 1) + "] " + (f.author || "作者待补") + ". " + (f.title || "题名待补") + "[" + (f.type || "J") + "]. " + (f.venue || "出处待补") + ", " + (f.year || "年份待补") + (f.doi ? ". DOI: " + f.doi : "") + ".");
    const attr = attributionOf(p, secs, env);
    return window.YMDoc.buildBundle({
      meta: {
        title: p.topic || p.name || "未命名", project: p.name || "", paradigm: env.paradigm, level: env.level,
        day: env.day, stamp: env.stamp, label: env.label, model: env.model, missingImages: prep.missing
      },
      sections: secs,
      assets: prep.images,
      refs: { style: "GB/T 7714-2015", items: refLines.map((t, i) => ({ n: i + 1, text: t })) },
      attribution: attr,
      checks: env.checks,
      options: opts
    });
  }

  function warnLines(bundle) {
    const s = window.YMDoc.summary(bundle);
    const lines = ["已写 " + s.drafted + "/" + s.sections + " 节 · 图 " + s.figures + " · 表 " + s.tables + " · 公式 " + s.equations + " · 文献 " + s.refs + " 篇"];
    (bundle.warnings || []).slice(0, 5).forEach(w => lines.push((w.level === "info" ? "提示：" : "注意：") + w.message));
    if (bundle.warnings && bundle.warnings.length > 5) lines.push("另有 " + (bundle.warnings.length - 5) + " 条检查提示");
    return lines;
  }

  async function run(kind, opts) {
    opts = opts || {};
    const p = cur(); if (!p) return notice("先新建项目");
    const bundle = await bundleOf(p, opts);
    const fatal = (bundle.warnings || []).find(w => w.level === "error");
    if (fatal) return notice("导出前检查未通过", [fatal.message, "请先在草稿里修复后再导出"]);
    if (!bundle.sections.some(s => s.drafted)) {
      return notice("还没有「我的稿」内容", ["先在 ② 设计与写作里写好 / 采用至少一节（参考稿修改也在这一阶段），再导出"]);
    }
    const sum = window.YMDoc.summary(bundle);
    const base = fileBase(p);

    if (kind === "md") {
      const text = window.YMDoc.renderMarkdown(bundle, { attribution: opts.attribution !== false, includeUnwritten: !!opts.includeUnwritten });
      dl(base + ".md", text, "text/markdown");
      trailAdd(p, "export", "导出全文（Markdown）", "已写 " + sum.drafted + "/" + sum.sections + " 节 · 图 " + sum.figures + " · 文献 " + sum.refs + " 篇" + (sum.missingImages ? " · 缺图 " + sum.missingImages : ""));
      save(); renderProcessLog();
      tip("已导出 Markdown ✓" + (sum.figures ? "（图片已内联）" : ""));
      if (bundle.warnings.length) notice("导出完成，附质量提示", warnLines(bundle));
      return;
    }

    if (kind === "doc") {
      const md = window.YMDoc.renderWordMarkdown(bundle, { attribution: opts.attribution !== false, includeUnwritten: !!opts.includeUnwritten });
      if (window.YMMd && YMMd.wordBlob) {
        const blob = await YMMd.wordBlob(md, { css: opts.css || "" });
        dlBlob(base + ".doc", blob);
      } else {
        const html = "<html><head><meta charset=\"utf-8\"></head><body>" + md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>") + "</body></html>";
        dl(base + ".doc", html, "application/msword");
      }
      trailAdd(p, "export", "导出全文（Word）", "已写 " + sum.drafted + "/" + sum.sections + " 节 · 图 " + sum.figures + " · 表 " + sum.tables + " · 文献 " + sum.refs + " 篇");
      save(); renderProcessLog();
      notice("已导出 Word ✓", warnLines(bundle));
      return;
    }

    /* LaTeX：复用既有 ctexart + gbt7714 渲染器，但节与图片来自同一 bundle */
    const env = envOf(p);
    env.secs = bundle.sections.map(s => ({ name: s.name, md: s.md }));
    env.images = bundle.assets;
    const r = X.buildLatex(p, env);
    if (bundle.assets.length && window.YMZip && window.YMMd && YMMd.dataUrlBytes) {
      const files = {}; files[base + ".tex"] = r.text;
      bundle.assets.forEach(im => { try { files[im.name] = YMMd.dataUrlBytes(im.dataUrl); } catch (e) {} });
      dlBlob(base + ".zip", new Blob([window.YMZip.build(files)], { type: "application/zip" }));
      trailAdd(p, "export", "导出全文（LaTeX）", "已写 " + sum.drafted + "/" + sum.sections + " 节 · \\cite " + r.cited + " 篇 · 图片 " + bundle.assets.length + " 张");
      save(); renderProcessLog();
      notice("已导出 LaTeX（含图片）✓", [
        "压缩包内：" + base + ".tex + yanmo-images/（" + bundle.assets.length + " 张）",
        "上传 Overleaf 后保持目录结构，菜单 Compiler 选 XeLaTeX；参考文献已内嵌"
      ].concat(warnLines(bundle).slice(1)));
      return;
    }
    dl(base + ".tex", r.text, "application/x-tex");
    trailAdd(p, "export", "导出全文（LaTeX）", "已写 " + sum.drafted + "/" + sum.sections + " 节 · \\cite " + r.cited + " 篇" + (r.unresolved.length ? " · " + r.unresolved.length + " 处编号未匹配" : ""));
    save(); renderProcessLog();
    notice("已导出 LaTeX ✓", [
      "用 XeLaTeX 编译（Overleaf：上传 .tex → 菜单 Compiler 选 XeLaTeX）；参考文献已内嵌，不用另传 .bib"
    ].concat(r.unresolved.length ? [r.unresolved.length + " 处 [n] 对不上文献库编号，已原样保留：" + r.unresolved.slice(0, 5).join(" ")] : []).concat(warnLines(bundle).slice(1)));
  }

  /* 版本档案导出：版本内容来自已回取的全文，不再用 mdRender 直接拼 HTML */
  function versionFileName(v, ext) {
    return ("版本-" + (v.kind || "正文") + "-" + (v.ts || "")).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_") + "." + ext;
  }
  async function exportVersion(v, fmt, opts) {
    opts = opts || {};
    const p = cur();
    let content = String(v && v.content || "");
    if (!content.trim()) return notice("这个版本没有正文可导出");
    let prep = { texts: [content], images: [], missing: 0 };
    if (window.YMMd && YMMd.prepareImageSections) {
      try { prep = await YMMd.prepareImageSections([content]); } catch (e) {}
    }
    const refLines = window.YMBib ? YMBib.gbList((p && p.papers) || []) : [];
    const bundle = window.YMDoc.buildBundle({
      meta: {
        title: v.kind || "版本正文", project: (p && p.name) || "", paradigm: "", level: "",
        day: "", stamp: v.ts || "", label: (window.YANMO && YANMO.label) || "研墨", model: "", missingImages: prep.missing
      },
      sections: [{ key: "version", name: v.kind || "版本正文", md: prep.texts[0] || content, drafted: true, origin: "version" }],
      assets: prep.images,
      refs: { style: "GB/T 7714-2015", items: refLines.map((t, i) => ({ n: i + 1, text: t })) },
      attribution: { lines: [], marks: [], total: "", statement: "" },
      checks: [], options: opts
    });
    if (fmt === "doc") {
      const md = window.YMDoc.renderWordMarkdown(bundle, { attribution: false });
      if (window.YMMd && YMMd.wordBlob) dlBlob(versionFileName(v, "doc"), await YMMd.wordBlob(md));
      else dl(versionFileName(v, "doc"), md, "application/msword");
    } else {
      dl(versionFileName(v, "md"), window.YMDoc.renderMarkdown(bundle, { attribution: false, frontMatter: false }), "text/markdown");
    }
    if (p) {
      const s = window.YMDoc.summary(bundle);
      trailAdd(p, "export", "导出版本", (v.kind || "版本") + " → " + (fmt === "doc" ? "Word(.doc)" : ".md") + " · 图 " + s.figures + " · 表 " + s.tables);
      save(); renderProcessLog();
    }
    tip("已导出" + (fmt === "doc" ? " Word" : " Markdown") + " ✓" + (bundle.assets.length ? "（图片已内联）" : ""));
    if (bundle.warnings.length) notice("导出完成，附质量提示", warnLines(bundle));
  }

  window.wqExportDoc = run;
  window.wqExportVersion = exportVersion;

  /* ================= 审阅包 .ympack：只读、可校验、证据链完整 ================= */
  function encText(s) { return new TextEncoder().encode(String(s || "")); }
  async function sha256Hex(u8) {
    try {
      if (!(window.crypto && crypto.subtle)) return "";
      const h = await crypto.subtle.digest("SHA-256", u8);
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { return ""; }
  }
  async function exportPack(opts) {
    opts = opts || {};
    const p = cur(); if (!p) return notice("先新建项目");
    const bundle = await bundleOf(p, { attribution: true });
    if (!bundle.sections.some(s => s.drafted)) return notice("还没有「我的稿」内容", ["先写好至少一节再导出审阅包"]);
    const md = window.YMDoc.renderMarkdown(bundle, { attribution: true });
    const payload = {
      "document.md": md,
      "citation-report.json": JSON.stringify(bundle.refs, null, 2),
      "ledger.json": JSON.stringify(bundle.attribution || {}, null, 2),
      "checks.json": JSON.stringify({ checks: bundle.checks || [], warnings: bundle.warnings || [], summary: window.YMDoc.summary(bundle) }, null, 2),
      "ai-declaration.txt": "AI 辅助说明\n\n" + (bundle.attribution.statement || "本稿在研墨辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。")
        + "\n\n模型：" + (bundle.attribution.model || bundle.meta.model || "未记录")
        + "\n日期：" + (bundle.meta.stamp || "未记录")
        + "\n\n作者对全部内容与引用的真实性负责。\n"
    };
    const manifest = {
      schema: "yanmo.pack/v1",
      generator: bundle.meta.label || "研墨",
      generatedAt: new Date().toISOString(),
      project: { name: bundle.meta.project || "", title: bundle.meta.title || "", paradigm: bundle.meta.paradigm || "", level: bundle.meta.level || "" },
      summary: window.YMDoc.summary(bundle),
      files: {}
    };
    for (const name of Object.keys(payload)) {
      const u8 = encText(payload[name]);
      manifest.files[name] = { bytes: u8.length, sha256: await sha256Hex(u8) };
    }
    const files = Object.assign({}, payload);
    files["manifest.json"] = JSON.stringify(manifest, null, 2);
    files["README.txt"] = "研墨审阅包（.ympack）\n\n这是一个普通 ZIP：可把扩展名改为 .zip 后用解压工具打开。\n"
      + "document.md 是正文；citation-report.json 是引用闭合报告；ledger.json 是逐节归属；"
      + "ai-declaration.txt 是 AI 声明；checks.json 是导出前检查；manifest.json 列出各文件 SHA-256。\n\n"
      + "本包是只读交付物，不包含可回写的项目数据库，也不含 API Key。\n";
    const blob = new Blob([window.YMZip.build(files)], { type: "application/zip" });
    dlBlob(fileBase(p) + ".ympack", blob);
    const s = window.YMDoc.summary(bundle);
    trailAdd(p, "export", "导出审阅包", "已写 " + s.drafted + "/" + s.sections + " 节 · 图 " + s.figures + " · 文献 " + s.refs + " 篇");
    save(); renderProcessLog();
    notice("已导出审阅包（.ympack）✓", [
      "含：正文 Markdown、引用核验、逐节归属、AI 声明、导出前检查、manifest SHA-256",
      "把扩展名改为 .zip 即可打开；本包只读，不含项目数据库与 API Key"
    ]);
  }

  function themeCss() {
    try { return window.WQTemplate && WQTemplate.activeCss ? WQTemplate.activeCss() : ""; } catch (e) { return ""; }
  }
  function wantAttr() { return $("expAttr") ? $("expAttr").checked : true; }

  async function refreshExportPanel() {
    const box = $("exportSummary"), p = cur();
    if (!box || !p) return;
    box.textContent = "正在检查当前稿件…";
    try {
      const b = await bundleOf(p, {});
      const s = window.YMDoc.summary(b);
      let t = "已写 " + s.drafted + "/" + s.sections + " 节 · 图 " + s.figures + " · 表 " + s.tables + " · 公式 " + s.equations + " · 文献 " + s.refs + " 篇";
      if (s.missingImages) t += " · 缺图 " + s.missingImages;
      if (s.unresolved) t += " · 引用越界 " + s.unresolved;
      if (s.zeroCite) t += " · 零引用节 " + s.zeroCite;
      (b.warnings || []).filter(w => w.level !== "info").slice(0, 2).forEach(w => { t += "；" + w.message; });
      box.textContent = t;
    } catch (e) { box.textContent = "检查失败：" + (e && e.message ? e.message : e); }
  }

  (function mount() {
    const panel = $("exportPanel"), row = $("exportFmtRow"), anchor = $("btnExportDoc2");
    if ($("ymExpMd")) return;
    const host = row || anchor;
    if (!host) return;
    host.insertAdjacentHTML("beforeend",
      (row ? '<button id="ymExpDoc" class="btn2" style="background:#7a3fa8" title="Word：图/表/公式与正文统一编号，图片内联，可直接打开"><b>⤓ Word（.doc）</b><small>图/表/公式统一编号 · 图片内联</small></button>' : "") +
      '<button id="ymExpMd" class="btn2 ghost" title="Markdown：正文 + GB/T 7714 参考文献 + AI 辅助说明（Typora / Obsidian / Pandoc 都能打开）"><b>⤓ Markdown</b><small>正文 + 参考文献 + 归属说明</small></button>' +
      '<button id="ymExpTex" class="btn2 ghost" title="ctexart + gbt7714，参考文献内嵌；无图片时导出单个 .tex，有图片时打包 zip（.tex + yanmo-images/）"><b>⤓ LaTeX（Overleaf）</b><small>ctexart + gbt7714 · 含图自动打包</small></button>' +
      '<button id="ymExpPack" class="btn2 ghost" title="审阅包：正文 + 引用核验 + 逐节归属 + AI 声明 + SHA-256 清单（普通 ZIP，可改名 .zip 打开）"><b>⤓ 审阅包（.ympack）</b><small>正文 + 引用核验 + 归属 + SHA-256</small></button>');
    if (row) {
      $("ymExpDoc").addEventListener("click", () => run("doc", { attribution: wantAttr(), css: themeCss() }));
      if ($("btnExportOpen")) $("btnExportOpen").addEventListener("click", () => {
        const pn = $("exportPanel"); if (!pn) return;
        pn.hidden = !pn.hidden;
        if (!pn.hidden) refreshExportPanel();
      });
    }
    $("ymExpMd").addEventListener("click", () => run("md", { attribution: wantAttr() }));
    $("ymExpTex").addEventListener("click", () => run("tex"));
    $("ymExpPack").addEventListener("click", () => exportPack({ attribution: true }));
    /* 应用型文书隐藏 LaTeX（模板场景下不占入口） */
    try { if (window.syncScene) window.syncScene(); } catch (e) {}
  })();
})();

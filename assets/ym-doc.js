/* 研墨 · 统一文档模型与导出内核 ym-doc.js（v1.5.0）
 * 纯函数：无 DOM、无网络、无 IndexedDB；Node 可直接 require，浏览器挂 window.YMDoc。
 * 目标：让工作台、参考稿、版本档案共用同一份 ExportBundle 与同一套 Markdown/Word 渲染规则。
 *
 * bundle 输入（由页面组装）：
 * { meta, sections:[{key,name,md,drafted,origin}], assets:[{id,dataUrl,fileName,ext,kind,alt}],
 *   refs:{items:[{n,text}]}, attribution:{lines,marks,total,statement,model}, checks:[string] }
 * 输出：同一结构 + floats + refs.cited/uncited/unresolved + warnings。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YMDoc = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var META_RE = /〔生成：[^〕]*〕/g;
  var EXEMPT = /^(摘要|关键词|结论|结语|致谢|参考文献|附录|Abstract|Keywords|Conclusion|References|Acknowledg)/i;
  var IMG_RE = /@@YMIMG(\d+)\|([^@]*)@@/g;

  function str(s) { return String(s == null ? "" : s); }
  function decodeAlt(a) { try { return decodeURIComponent(a || ""); } catch (e) { return a || ""; } }
  function yq(s) { return '"' + str(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ") + '"'; }

  /* ================= 1) 段落与标题层级 ================= */
  /* 与 ym-export.js 同口径：正文一行即一段；导出时补空行，避免 Markdown/Word 把多行并成一段。 */
  var NOT_PLAIN = /^(?:#{1,6}\s|[-*+]\s|[•·▪●]|\d{1,3}[.)]\s|\d{1,3}、|[（(]\d{1,3}[)）]|>|\||```|\$\$|\\\[|\\\]|\\begin\{|\\end\{|@@YMIMG)/;
  function paraBreaks(md) {
    var lines = str(md).replace(/\r\n?/g, "\n").split("\n"), out = [], fence = false, math = false;
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
  function demoteMd(md) {
    var lines = str(md).replace(/\r\n?/g, "\n").split("\n"), fence = false, minH = 7;
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

  /* ================= 2) 全文级图/表/公式编号 ================= */
  function chartTitle(buf) {
    var s = buf.join("\n"), m;
    if ((m = s.match(/"(?:title|caption)"\s*:\s*"([^"]+)"/))) return m[1];
    if ((m = s.match(/^\s*#\s+([^\n]+)$/m))) return m[1].trim();
    return "";
  }
  function isTableSep(line) { return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line); }

  /* 在节内给图表补编号与题注；已有“图 n / 表 n”题注会被规范成新编号，不重复生成 */
  function captionSection(md, sectionKey, st) {
    var lines = str(md).replace(/\r\n?/g, "\n").split("\n");
    var out = [], i = 0;
    function nextNE(k) { for (var j = k; j < lines.length; j++) if (lines[j].trim()) return j; return -1; }
    function prevNE(k) { for (var j = k; j >= 0; j--) if (lines[j].trim()) return j; return -1; }
    function popNE() { while (out.length && !out[out.length - 1].trim()) out.pop(); }

    for (; i < lines.length; i++) {
      var raw = lines[i], line = raw.trim();

      if (/^```/.test(line)) {
        var buf = [raw], isChart = /^```ymchart/.test(line), title = "";
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        if (i < lines.length) buf.push(lines[i]);
        if (isChart) {
          title = chartTitle(buf);
          var cap = "", at = nextNE(i + 1);
          if (at >= 0 && /^图\s*\d+/.test(lines[at].trim())) { cap = lines[at].trim().replace(/^图\s*\d+[\s.、:：]*/, ""); i = at; }
          var fn = ++st.figNo;
          st.figures.push({ no: fn, section: sectionKey, kind: "chart", caption: cap || title || "数据图" });
          out.push.apply(out, buf);
          out.push("", "图 " + fn + "　" + (cap || title || "数据图"));
        } else out.push.apply(out, buf);
        continue;
      }

      if (/^@@YMIMG\d+\|[^@]*@@$/.test(line)) {
        var alt = decodeAlt((line.match(/^@@YMIMG\d+\|([^@]*)@@/) || [])[1]);
        var kat = nextNE(i + 1);
        if (kat >= 0 && /^图\s*\d+/.test(lines[kat].trim())) { alt = lines[kat].trim().replace(/^图\s*\d+[\s.、:：]*/, ""); i = kat; }
        var kn = ++st.figNo;
        st.figures.push({ no: kn, section: sectionKey, kind: "image", caption: alt || "图片" });
        out.push(raw, "", "图 " + kn + "　" + (alt || "图片"));
        continue;
      }

      if (/^\|.*\|$/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1].trim())) {
        var tcap = "", tp = prevNE(i - 1);
        if (tp >= 0 && /^表\s*\d+/.test(lines[tp].trim())) {
          tcap = lines[tp].trim().replace(/^表\s*\d+[\s.、:：]*/, "");
          popNE();
          if (out.length && /^表\s*\d+/.test(out[out.length - 1].trim())) out.pop();
        }
        var tn = ++st.tabNo;
        st.tables.push({ no: tn, section: sectionKey, kind: "table", caption: tcap || "数据表" });
        out.push("表 " + tn + "　" + (tcap || "数据表"));
        out.push(raw, lines[i + 1]);
        i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) out.push(lines[i++]);
        i--;
        continue;
      }

      /* 单行 $$...$$ 公式 */
      if (/^\$\$[^\n]+\$\$$/.test(line)) {
        var e1 = ++st.eqNo;
        st.equations.push({ no: e1, section: sectionKey });
        out.push(raw, "", "（" + e1 + "）");
        continue;
      }
      if (/^\$\$/.test(line) && line.indexOf("$$", 2) < 0) {
        var eb = [raw];
        i++;
        while (i < lines.length && lines[i].indexOf("$$") < 0) eb.push(lines[i++]);
        if (i < lines.length) eb.push(lines[i]);
        var en = nextNE(i + 1);
        if (en >= 0 && /^(?:（|\()?\s*\d+\s*(?:）|\))?$/.test(lines[en].trim())) i = en;
        var eqn = ++st.eqNo;
        st.equations.push({ no: eqn, section: sectionKey });
        out.push.apply(out, eb);
        out.push("", "（" + eqn + "）");
        continue;
      }

      out.push(raw);
    }
    return out.join("\n");
  }

  /* ================= 3) 引用解析 ================= */
  function parseCites(text) {
    var nums = [], re = /\[\s*\d{1,4}(?:\s*[-–—~,，、]\s*\d{1,4})*\s*\]/g, m;
    while ((m = re.exec(str(text)))) {
      var inner = m[0].slice(1, -1);
      inner.split(/[,，、]/).forEach(function (part) {
        var r = part.split(/[-–—~]/).map(function (x) { return parseInt(x, 10); });
        if (r.length === 1 && !isNaN(r[0])) nums.push(r[0]);
        else if (r.length === 2 && !isNaN(r[0]) && !isNaN(r[1]) && r[1] >= r[0] && r[1] - r[0] <= 300) {
          for (var k = r[0]; k <= r[1]; k++) nums.push(k);
        }
      });
    }
    return nums;
  }
  function normalizeRefs(refs) {
    var items = ((refs && refs.items) || []).map(function (x, i) {
      if (typeof x === "string") return { n: i + 1, text: x };
      return { n: +x.n >= 1 ? +x.n : i + 1, text: str(x.text || x.label || "") };
    });
    var seen = {};
    items.forEach(function (x) { if (seen[x.n]) x.n = 0; seen[x.n] = 1; });
    items = items.filter(function (x) { return x.n >= 1; }).sort(function (a, b) { return a.n - b.n; });
    return { style: (refs && refs.style) || "GB/T 7714-2015", items: items, cited: [], uncited: [], unresolved: [], zeroCiteSections: [] };
  }

  /* ================= 4) 组装 bundle ================= */
  function buildBundle(input) {
    input = input || {};
    var b = {
      schema: "yanmo.export/v1",
      meta: input.meta || {},
      sections: [],
      assets: (input.assets || []).map(function (a) { return a; }),
      refs: normalizeRefs(input.refs),
      attribution: input.attribution || {},
      checks: input.checks || [],
      options: input.options || {},
      floats: { figures: [], tables: [], equations: [] },
      warnings: []
    };
    b.meta.missingImages = +(input.meta && input.meta.missingImages) || 0;

    var st = { figNo: 0, tabNo: 0, eqNo: 0, figures: b.floats.figures, tables: b.floats.tables, equations: b.floats.equations };
    b.sections = (input.sections || []).map(function (s, i) {
      var md = str(s.md).replace(/〔生成：[^〕]*〕/g, "").trim();
      return {
        key: str(s.key || ("s" + (i + 1))),
        name: str(s.name || ("第 " + (i + 1) + " 节")),
        md: captionSection(md, str(s.key || ("s" + (i + 1))), st),
        drafted: md ? true : false,
        origin: str(s.origin || "user")
      };
    });
    b.refs = inspectCites(b);
    b.warnings = preflight(b);
    return b;
  }

  function inspectCites(b) {
    var N = b.refs.items.length, cited = {}, unresolved = [], zero = [];
    b.sections.forEach(function (s) {
      var body = str(s.md).replace(META_RE, "");
      var nums = parseCites(body);
      if (!nums.length && !EXEMPT.test(s.name)) zero.push(s.name);
      nums.forEach(function (n) {
        if (n < 1 || n > N) unresolved.push({ section: s.name, n: n });
        else cited[n] = 1;
      });
    });
    b.refs.cited = Object.keys(cited).map(Number).sort(function (a, c) { return a - c; });
    b.refs.uncited = b.refs.items.filter(function (x) { return !cited[x.n]; }).map(function (x) { return x.n; });
    b.refs.unresolved = unresolved;
    b.refs.zeroCiteSections = zero;
    return b.refs;
  }

  function preflight(b) {
    var w = [], N = b.refs.items.length;
    if (b.meta.missingImages) w.push({ code: "IMG_MISSING", level: "warn", message: "有 " + b.meta.missingImages + " 张图片未能从本机取回" });
    if (b.refs.unresolved.length) w.push({ code: "CITE_OUT_OF_RANGE", level: "warn", message: "有 " + b.refs.unresolved.length + " 处引用编号超出文献库范围（共 " + N + " 篇）" });
    if (b.refs.zeroCiteSections.length) w.push({ code: "ZERO_CITE", level: "info", message: "以下节没有引用编号：" + b.refs.zeroCiteSections.join("、") });
    var unwritten = b.sections.filter(function (s) { return !s.drafted; }).map(function (s) { return s.name; });
    if (unwritten.length) w.push({ code: "UNWRITTEN", level: "info", message: "未写节：" + unwritten.join("、") });
    var all = b.sections.map(function (s) { return s.md; }).join("\n");
    if (/ym-img:/.test(all)) w.push({ code: "PLACEHOLDER", level: "warn", message: "正文里仍有未解析的图片编号，导出时会以占位文字代替" });
    return w;
  }

  /* ================= 5) 渲染 ================= */
  function spliceImages(text, assets, mode) {
    /* 预处理失败时可能残留 ym-img: 编号，先降级为可见占位，避免导出坏图 */
    text = str(text).replace(/!\[([^\]]*)\]\(ym-img:[^)]+\)/g, "〔图片缺失：$1〕");
    return text.replace(IMG_RE, function (m, i, alt) {
      var a = (assets || [])[+i], al = decodeAlt(alt);
      if (!a) return "〔图片缺失：" + (al || "未命名") + "〕";
      if (mode === "names") return "![" + al + "](" + (a.fileName || ("yanmo-images/img" + (i + 1) + "." + (a.ext || "png"))) + ")";
      return "![" + al + "](" + str(a.dataUrl) + ")";
    });
  }
  function attrBlock(b, mode) {
    var a = b.attribution || {}, L = [];
    if (!(a.lines && a.lines.length) && !(a.marks && a.marks.length) && !a.statement) return L;
    L.push("## AI 辅助说明", "");
    L.push(a.statement || "本稿在研墨辅助下完成：AI 提供参考稿与改写建议，作者逐节修改并定稿。");
    (a.lines || []).forEach(function (x) { L.push("- " + x); });
    (a.marks || []).forEach(function (x) { L.push("- AI 起草标记 · " + x); });
    if (a.total) L.push("", a.total + "。");
    if (a.model || b.meta.stamp) L.push("", "模型：" + (a.model || b.meta.model || "未记录") + " · 报告日期：" + (b.meta.stamp || "未记录") + "。作者对全部内容与引用的真实性负责。");
    L.push("");
    return L;
  }
  function refsBlock(b) {
    var L = [];
    if (b.refs.items.length) {
      L.push("## 参考文献", "");
      b.refs.items.forEach(function (x) { L.push(x.text, ""); });
    }
    return L;
  }
  function checksBlock(b) {
    var L = [];
    if (b.checks && b.checks.length) {
      L.push("## 校验记录（最近）", "");
      b.checks.forEach(function (x) { L.push("- " + x); });
      L.push("");
    }
    return L;
  }
  function renderMarkdown(b, opts) {
    opts = opts || {};
    var L = [], m = b.meta || {};
    if (opts.frontMatter !== false) {
      L.push("---", "title: " + yq(m.title || "未命名"), "project: " + yq(m.project || ""), "paradigm: " + yq(m.paradigm || ""),
        "level: " + yq(m.level || ""), "date: " + yq(m.day || ""), "generator: " + yq(m.label || "研墨"), "---", "");
    }
    L.push("# " + (m.title || "未命名"), "");
    b.sections.forEach(function (s) {
      if (!s.drafted && !opts.includeUnwritten) return;
      L.push("## " + s.name, "", demoteMd(paraBreaks(s.md || "> 〔本节未写〕")), "");
    });
    L = L.concat(refsBlock(b));
    if (opts.attribution !== false) L = L.concat(attrBlock(b));
    L = L.concat(checksBlock(b));
    L.push("---", "", "*由 " + (m.label || "研墨") + " 辅助完成（" + (m.stamp || "") + "）；引用与数据请人工核对*", "");
    return spliceImages(L.join("\n"), b.assets, "md");
  }
  function renderWordMarkdown(b, opts) {
    opts = opts || {};
    var L = [], m = b.meta || {};
    L.push("# " + (m.title || "未命名"), "");
    b.sections.forEach(function (s) {
      if (!s.drafted && !opts.includeUnwritten) return;
      L.push("## " + s.name, "", demoteMd(paraBreaks(s.md || "〔本节未写〕")), "");
    });
    L = L.concat(refsBlock(b));
    if (opts.attribution !== false) L = L.concat(attrBlock(b));
    L = L.concat(checksBlock(b));
    L.push("", "—— 由" + (m.label || "研墨") + "辅助完成（" + (m.stamp || "") + "）；引用与数据请人工核对 ——", "");
    return spliceImages(L.join("\n"), b.assets, "md");
  }
  function summary(b) {
    return {
      sections: b.sections.length,
      drafted: b.sections.filter(function (s) { return s.drafted; }).length,
      figures: b.floats.figures.length,
      tables: b.floats.tables.length,
      equations: b.floats.equations.length,
      refs: b.refs.items.length,
      cited: b.refs.cited.length,
      uncited: b.refs.uncited.length,
      unresolved: b.refs.unresolved.length,
      zeroCite: b.refs.zeroCiteSections.length,
      missingImages: b.meta.missingImages || 0,
      warnings: b.warnings.length
    };
  }

  return {
    buildBundle: buildBundle, preflight: preflight, summary: summary,
    renderMarkdown: renderMarkdown, renderWordMarkdown: renderWordMarkdown,
    spliceImages: spliceImages, parseCites: parseCites, captionSection: captionSection,
    demoteMd: demoteMd, paraBreaks: paraBreaks
  };
});

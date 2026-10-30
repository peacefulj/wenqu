/* 研墨 · 文献互通 ym-bib.js（v1.1.0 新增）
 * Zotero / EndNote / NoteExpress 等导出的 BibTeX、RIS、CSL-JSON ↔ 项目文献库；
 * GB/T 7714-2015 格式化；BibTeX 引用键（LaTeX 导出与 MCP 共用同一套键）。
 * 纯逻辑、不碰 DOM：浏览器里是 window.YMBib，Node（mcp/、scripts/）里 require 同一个文件。
 * 文献卡（项目 papers 里的一条）字段：id title author authors year venue doi type abs url key csl
 *   - author 是显示用字符串（最多 3 人 + “等”），authors 是完整姓名列表；
 *   - csl 保留导入时的结构化题录（卷期页码、出版社等），导出时与用户后来的修改合并。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YMBib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
  function str(x) { return x == null ? "" : String(x); }
  function clean(s) { return str(s).replace(/\s+/g, " ").trim(); }

  /* ================= 类型映射 ================= */
  /* CSL 类型 → 文献卡 type（GB/T 7714 文献类型标识） */
  var CSL2GB = {
    "article-journal": "J", "article-magazine": "J", "article": "J", "article-newspaper": "N",
    "book": "M", "chapter": "M", "paper-conference": "C", "thesis": "D", "report": "R",
    "webpage": "EB", "post": "EB", "post-weblog": "EB", "dataset": "DS", "patent": "P",
    "standard": "S", "software": "CP", "manuscript": "Z"
  };
  var GB2CSL = { J: "article-journal", N: "article-newspaper", M: "book", C: "paper-conference", D: "thesis", R: "report", EB: "webpage", DS: "dataset", P: "patent", S: "standard", CP: "software", Z: "article" };
  var CONTAINER_TYPES = { "article-journal": 1, "article-magazine": 1, "article-newspaper": 1, "article": 1, "paper-conference": 1, "chapter": 1, "webpage": 1, "post": 1, "post-weblog": 1 };

  /* ================= 人名 ================= */
  var PARTICLES = { von: 1, van: 1, de: 1, del: 1, della: 1, di: 1, da: 1, la: 1, le: 1, du: 1, der: 1, den: 1, ten: 1, ter: 1, dos: 1, das: 1 };
  var INITIAL = /^([A-Z]\.?){1,3}(-[A-Z]\.?)?$/;
  function nameFromString(s) {
    s = clean(s);
    if (!s) return null;
    if (/^\{.*\}$/.test(s)) return { literal: s.slice(1, -1) };
    if (CJK.test(s)) return { family: s.replace(/\s+/g, ""), given: "" };   // 中文姓名整体保留
    if (s.indexOf(",") >= 0) {                                                  // “Family, Given”
      var parts = s.split(",");
      return { family: clean(parts[0]), given: clean(parts.slice(1).join(" ")) };
    }
    var w = s.split(/\s+/);
    if (w.length === 1) return { family: w[0], given: "" };
    var rest = w.slice(1);
    /* “Fama E F”“Fama EF”：姓在前、后面全是首字母；“Fama Eugene F.”：末尾是首字母，也按姓在前 */
    if (rest.every(function (x) { return INITIAL.test(x); }) || INITIAL.test(w[w.length - 1])) {
      return { family: w[0], given: rest.join(" ") };
    }
    var cut = w.length - 1;
    while (cut > 0 && PARTICLES[w[cut - 1].toLowerCase()]) cut--;
    return { family: w.slice(cut).join(" "), given: w.slice(0, cut).join(" ") };
  }
  function nameToDisplay(n) {
    if (!n) return "";
    if (typeof n === "string") return clean(n);
    if (n.literal) return clean(n.literal);
    var fam = clean(n.family), giv = clean(n.given);
    if (CJK.test(fam + giv)) return fam + giv;
    return giv ? fam + " " + giv : fam;
  }
  /* 显示用作者串：最多 3 人，超过加“等”（与工作台原有口径一致） */
  function authorLabel(list) {
    var names = (list || []).map(nameToDisplay).filter(Boolean);
    if (!names.length) return "";
    return names.slice(0, 3).join("，") + (names.length > 3 ? "，等" : "");
  }
  function splitAuthorString(s) {
    s = clean(s).replace(/[，,]?\s*(等|et\s*al\.?)\s*$/i, "");
    if (!s) return [];
    var parts;
    if (!CJK.test(s) && /\s+and\s+/i.test(s)) parts = s.split(/\s+and\s+/i);
    else if (/[;；]/.test(s)) parts = s.split(/[;；]/);
    else if (/[，、]/.test(s)) parts = s.split(/[，、]/);
    else if (CJK.test(s)) parts = s.split(/[\s,]+/);
    else {
      var segs = s.split(/\s*,\s*/);
      /* “Fama, Eugene F., French, Kenneth R.”：单词姓与名交替出现，两两配对 */
      var paired = segs.length % 2 === 0 && segs.every(function (x, i) { return i % 2 === 0 ? !/\s/.test(x) : /^[A-Z]/.test(x); });
      if (paired) { parts = []; for (var i = 0; i < segs.length; i += 2) parts.push(segs[i] + ", " + segs[i + 1]); }
      else parts = segs;
    }
    return parts.map(clean).filter(Boolean);
  }

  /* ================= DOI / 题名规范化 ================= */
  function normDOI(s) {
    var m = str(s).match(/10\.\d{4,9}\/[^\s"<>{}]+/);
    return m ? m[0].replace(/[.,;)\]]+$/, "") : "";
  }
  function normTitle(s) { return str(s).toLowerCase().replace(/[^0-9a-z\u3400-\u9fff]+/g, ""); }

  /* ================= 格式识别 ================= */
  function detectFormat(text) {
    var t = str(text).replace(/^\ufeff/, "").trim();
    if (/^[\[{]/.test(t)) { try { JSON.parse(t); return "csl"; } catch (e) { /* 不是 JSON，继续看 */ } }
    if (/^\s*TY\s{2}-/m.test(t)) return "ris";
    if (/@\s*[A-Za-z]+\s*[({]/.test(t)) return "bibtex";
    return "unknown";
  }

  /* ================= CSL-JSON ================= */
  function parseCSL(text) {
    var d = JSON.parse(str(text).replace(/^\ufeff/, ""));
    if (d && typeof d === "object" && !Array.isArray(d) && Array.isArray(d.projects)) {
      throw new Error("这是研墨的项目备份文件，请用项目栏的「⤒ 导入备份」");
    }
    var arr = Array.isArray(d) ? d : (d && Array.isArray(d.items) ? d.items : (d && typeof d === "object" ? [d] : []));
    return arr.filter(function (x) { return x && typeof x === "object" && !Array.isArray(x); });
  }

  /* ================= RIS ================= */
  var RIS2CSL = {
    JOUR: "article-journal", JFULL: "article-journal", EJOUR: "article-journal", ABST: "article-journal", INPR: "article-journal",
    MGZN: "article-magazine", NEWS: "article-newspaper", BOOK: "book", EBOOK: "book", EDBOOK: "book",
    CHAP: "chapter", ECHAP: "chapter", CONF: "paper-conference", CPAPER: "paper-conference",
    THES: "thesis", RPRT: "report", ELEC: "webpage", WEB: "webpage", BLOG: "post-weblog", DATA: "dataset",
    PAT: "patent", STAND: "standard", COMP: "software", GEN: "article", UNPB: "manuscript"
  };
  function parseRIS(text) {
    var items = [], cur = null, last = null;
    str(text).replace(/^\ufeff/, "").split(/\r?\n/).forEach(function (line) {
      var m = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
      if (!m) {
        if (cur && last && line.trim()) { var a = cur[last]; a[a.length - 1] += " " + line.trim(); }
        return;
      }
      var tag = m[1], val = m[2].trim();
      if (tag === "TY") { if (cur) items.push(risToCSL(cur)); cur = { TY: [val] }; last = null; return; }
      if (!cur) return;
      if (tag === "ER") { items.push(risToCSL(cur)); cur = null; last = null; return; }
      (cur[tag] = cur[tag] || []).push(val); last = tag;
    });
    if (cur) items.push(risToCSL(cur));
    return items;
  }
  function risToCSL(r) {
    var first = function (tags) { for (var i = 0; i < tags.length; i++) { var v = r[tags[i]]; if (v && v.length && clean(v[0])) return clean(v[0]); } return ""; };
    var all = function (tags) { var out = []; tags.forEach(function (t) { (r[t] || []).forEach(function (v) { if (clean(v)) out.push(clean(v)); }); }); return out; };
    var ty = (r.TY && r.TY[0] || "").toUpperCase();
    var c = { type: RIS2CSL[ty] || "article" };
    var title = first(["TI", "T1", "CT"]);
    if (title) c.title = title;
    var cont = c.type === "chapter" ? first(["BT", "T2"]) : c.type === "paper-conference" ? first(["T2", "BT", "C3"]) : first(["T2", "JO", "JF", "JA", "J2"]);
    if (cont) c["container-title"] = cont;
    var au = all(["AU", "A1"]).map(nameFromString).filter(Boolean);
    if (au.length) c.author = au;
    var ed = all(["A2", "ED"]).map(nameFromString).filter(Boolean);
    if (ed.length && c.type === "chapter") c.editor = ed;
    var y = (first(["PY", "Y1", "DA"]).match(/\d{4}/) || [])[0];
    if (y) c.issued = { "date-parts": [[+y]] };
    var vl = first(["VL"]); if (vl) c.volume = vl;
    var is = first(["IS"]); if (is) c.issue = is;
    var sp = first(["SP"]), ep = first(["EP"]);
    if (sp) c.page = ep && ep !== sp ? sp.replace(/[–—]/g, "-") + "-" + ep : sp.replace(/[–—]/g, "-");
    var pb = first(["PB"]); if (pb) c.publisher = pb;
    var cy = first(["CY"]); if (cy) c["publisher-place"] = cy;
    var doi = normDOI(first(["DO"])) || normDOI(all(["UR", "L3", "M3", "N1"]).join(" "));
    if (doi) c.DOI = doi;
    var ur = first(["UR", "L2"]); if (ur && /^https?:/i.test(ur)) c.URL = ur;
    var ab = first(["AB", "N2"]); if (ab) c.abstract = ab;
    var kw = all(["KW"]); if (kw.length) c.keyword = kw.join(", ");
    var sn = first(["SN"]); if (sn) { if (c.type === "book" || c.type === "chapter") c.ISBN = sn; else c.ISSN = sn; }
    var la = first(["LA"]); if (la) c.language = isoLang(la);
    var et = first(["ET"]); if (et) c.edition = et;
    return c;
  }

  /* ================= BibTeX ================= */
  var MONTHS = { jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6", jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12" };
  var ACC = { "`": "\u0300", "'": "\u0301", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307", '"': "\u0308", u: "\u0306", v: "\u030C", H: "\u030B", c: "\u0327", k: "\u0328", r: "\u030A", d: "\u0323", b: "\u0331" };
  var SPECIAL = { ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", o: "ø", O: "Ø", l: "ł", L: "Ł", i: "ı", j: "ȷ" };
  /* 把 BibTeX 里的 LaTeX 写法还原成普通文字（重音、转义符、破折号、格式命令） */
  function delatex(s) {
    s = str(s);
    var nfc = function (x) { return x.normalize ? x.normalize("NFC") : x; };
    s = s.replace(/\{?\\([`'^"~=.])\s*\{?\s*(\\?[A-Za-z])\s*\}?\}?/g, function (m, a, ch) { return nfc(ch.replace("\\", "") + ACC[a]); });
    s = s.replace(/\{?\\([uvHckrdb])\s*\{\s*(\\?[A-Za-z])\s*\}\}?/g, function (m, a, ch) { return nfc(ch.replace("\\", "") + ACC[a]); });
    s = s.replace(/\{?\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)\b\s*(\{\})?\}?/g, function (m, k) { return SPECIAL[k]; });
    s = s.replace(/\\([&%$#_])/g, "$1").replace(/\\\{/g, "\u0001").replace(/\\\}/g, "\u0002");
    s = s.replace(/\\(textendash)\b\s*(\{\})?/g, "–").replace(/\\(textemdash)\b\s*(\{\})?/g, "—").replace(/\\(ldots|dots|textellipsis)\b\s*(\{\})?/g, "…");
    s = s.replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ");
    s = s.replace(/\\href\s*\{[^}]*\}/g, "");   // \href{链接}{文字} 只留文字
    s = s.replace(/\\(emph|textit|textbf|textsc|textrm|textsf|texttt|textup|textmd|mathrm|mathit|mathbf|mbox|text|ensuremath|url|nolinkurl)\s*/g, "");
    s = s.replace(/\\([A-Za-z]+)\s*/g, "$1 ");
    s = s.replace(/[{}$]/g, "").replace(/\u0001/g, "{").replace(/\u0002/g, "}");
    return clean(s);
  }
  function rawUrl(s) { return clean(str(s).replace(/[{}]/g, "").replace(/\\([&%$#_~])/g, "$1")); }
  /* 读到配对的右括号；返回 [内容, 结束位置] */
  function readBalanced(src, i, open, close) {
    var depth = 1, j = i;
    while (j < src.length && depth > 0) {
      var ch = src[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === open) depth++;
      else if (ch === close) depth--;
      j++;
    }
    return depth === 0 ? [src.slice(i, j - 1), j] : null;
  }
  function parseFields(s, strings) {
    var f = {}, i = 0, n = s.length;
    while (i < n) {
      while (i < n && /[\s,]/.test(s[i])) i++;
      var m = /^([A-Za-z][\w:\-.+]*)\s*=\s*/.exec(s.slice(i, i + 80));
      if (!m) break;
      var name = m[1].toLowerCase();
      i += m[0].length;
      var val = "";
      for (;;) {
        while (i < n && /\s/.test(s[i])) i++;
        if (s[i] === "{") {
          var r = readBalanced(s, i + 1, "{", "}"); if (!r) return f;
          val += r[0]; i = r[1];
        } else if (s[i] === '"') {
          var j = i + 1, depth = 0;
          while (j < n) { var ch = s[j]; if (ch === "\\") { j += 2; continue; } if (ch === "{") depth++; else if (ch === "}") depth--; else if (ch === '"' && depth === 0) break; j++; }
          val += s.slice(i + 1, j); i = j + 1;
        } else {
          var m2 = /^[^\s,#}]+/.exec(s.slice(i)); if (!m2) break;
          var tok = m2[0]; i += tok.length;
          var low = tok.toLowerCase();
          val += /^\d+$/.test(tok) ? tok : (strings[low] != null ? strings[low] : (MONTHS[low] || tok));
        }
        while (i < n && /\s/.test(s[i])) i++;
        if (s[i] === "#") { i++; continue; }
        break;
      }
      f[name] = val;
    }
    return f;
  }
  var BIB2CSL = {
    article: "article-journal", book: "book", booklet: "book", inbook: "chapter", incollection: "chapter",
    inproceedings: "paper-conference", conference: "paper-conference", proceedings: "book",
    phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis", techreport: "report", report: "report", manual: "report",
    online: "webpage", electronic: "webpage", www: "webpage", webpage: "webpage", misc: "article", unpublished: "manuscript",
    patent: "patent", standard: "standard", dataset: "dataset", software: "software", newspaper: "article-newspaper"
  };
  function bibNames(raw) {
    return str(raw).split(/\s+and\s+/i).map(function (x) {
      x = x.trim();
      if (/^\{[^{}]*\}$/.test(x)) return { literal: delatex(x) };   // {World Health Organization} 机构作者
      return nameFromString(delatex(x));
    }).filter(Boolean);
  }
  function bibToCSL(type, key, f) {
    var c = { type: BIB2CSL[type] || "article" };
    if (type === "misc" && (f.url || /https?:/.test(f.howpublished || ""))) c.type = "webpage";
    if (key) c["citation-key"] = key;
    var d = function (k) { return f[k] != null ? delatex(f[k]) : ""; };
    if (d("title")) c.title = d("title");
    if (f.author) c.author = bibNames(f.author);
    if (f.editor) c.editor = bibNames(f.editor);
    var cont = "";
    if (c.type === "article-journal" || c.type === "article-newspaper") cont = d("journal") || d("journaltitle");
    else if (c.type === "paper-conference" || c.type === "chapter") cont = d("booktitle");
    else if (c.type === "webpage") cont = d("organization") || d("howpublished").replace(/https?:\S+/g, "").trim();
    if (cont) c["container-title"] = cont;
    var pub = d("publisher") || d("school") || d("institution") || (c.type === "report" ? d("organization") : "");
    if (pub) c.publisher = pub;
    var place = d("address") || d("location");
    if (place) c["publisher-place"] = place;
    var y = (d("year") || d("date")).match(/\d{4}/);
    if (y) {
      var mon = +(MONTHS[str(f.month).toLowerCase().slice(0, 3)] || f.month || 0);
      c.issued = { "date-parts": [mon >= 1 && mon <= 12 ? [+y[0], mon] : [+y[0]]] };
    }
    if (d("volume")) c.volume = d("volume");
    if (d("number") || d("issue")) c.issue = d("number") || d("issue");
    if (d("pages")) c.page = d("pages").replace(/[–—]/g, "-");
    var doi = normDOI(rawUrl(f.doi || "")) || normDOI(rawUrl(f.url || ""));
    if (doi) c.DOI = doi;
    if (f.url) c.URL = rawUrl(f.url);
    if (d("abstract")) c.abstract = d("abstract");
    if (d("keywords")) c.keyword = d("keywords");
    if (d("isbn")) c.ISBN = d("isbn");
    if (d("issn")) c.ISSN = d("issn");
    if (d("langid") || d("language")) c.language = isoLang(d("langid") || d("language"));
    if (d("edition")) c.edition = d("edition");
    if (type === "mastersthesis") c.genre = "硕士学位论文";
    else if (type === "phdthesis") c.genre = "博士学位论文";
    return c;
  }
  function parseBibTeX(text) {
    var src = str(text).replace(/^\ufeff/, "");
    var out = [], strings = {}, i = 0, n = src.length;
    while (i < n) {
      var at = src.indexOf("@", i);
      if (at < 0) break;
      var m = /^@\s*([A-Za-z]+)\s*([({])/.exec(src.slice(at, at + 60));
      if (!m) { i = at + 1; continue; }
      var type = m[1].toLowerCase(), open = m[2], close = open === "{" ? "}" : ")";
      var r = readBalanced(src, at + m[0].length, open, close);
      if (!r) break;                      // 括号不闭合：停止，避免把后半个文件当成一条
      var body = r[0]; i = r[1];
      if (type === "comment" || type === "preamble") continue;
      if (type === "string") {
        var sf = parseFields(body, strings);
        Object.keys(sf).forEach(function (k) { strings[k] = sf[k]; });
        continue;
      }
      var comma = body.indexOf(",");
      var key = (comma >= 0 ? body.slice(0, comma) : body).trim();
      var fields = parseFields(comma >= 0 ? body.slice(comma + 1) : "", strings);
      out.push(bibToCSL(type, key, fields));
    }
    return out;
  }

  /* ================= 统一入口 ================= */
  function parse(text, opts) {
    opts = opts || {};
    var fmt = opts.format || detectFormat(text);
    var items = [], errors = [];
    try {
      if (fmt === "csl") items = parseCSL(text);
      else if (fmt === "ris") items = parseRIS(text);
      else if (fmt === "bibtex") items = parseBibTeX(text);
      else throw new Error("没认出格式：请导出为 BibTeX（.bib）、RIS（.ris）或 CSL JSON（.json）");
    } catch (e) { errors.push(e.message); }
    /* citation.js 兜底：只在浏览器里、内置解析一条都没读出来时用 */
    if (!items.length && opts.Cite && (fmt === "bibtex" || fmt === "ris")) {
      try { items = new opts.Cite(str(text)).get(); errors.push("已用 citation.js 兜底解析"); }
      catch (e2) { errors.push("citation.js 也没能解析：" + e2.message); }
    }
    var bad = 0;
    items = items.filter(function (c) { var ok = c && (clean(c.title) || c.DOI); if (!ok) bad++; return ok; });
    if (bad) errors.push(bad + " 条缺少题名，已跳过");
    return { format: fmt, items: items, errors: errors };
  }

  /* ================= CSL ↔ 文献卡 ================= */
  function cslYear(c) {
    var dp = c && c.issued && c.issued["date-parts"] && c.issued["date-parts"][0];
    if (dp && dp[0]) return String(dp[0]);
    var raw = c && c.issued && (c.issued.raw || c.issued.literal);
    var m = str(raw || (c && c.year)).match(/\d{4}/);
    return m ? m[0] : "";
  }
  var KEEP = ["type", "title", "author", "editor", "issued", "container-title", "container-title-short", "volume", "issue", "page",
    "publisher", "publisher-place", "DOI", "URL", "ISBN", "ISSN", "edition", "genre", "language", "number", "collection-title",
    "event", "event-place", "keyword", "version", "citation-key"];
  function trimCSL(c) {
    var o = {};
    KEEP.forEach(function (k) { if (c[k] != null && c[k] !== "") o[k] = c[k]; });
    if (Array.isArray(o.author)) o.author = o.author.slice(0, 100).map(function (a) { return a && typeof a === "object" ? { family: a.family, given: a.given, literal: a.literal } : nameFromString(a); }).filter(Boolean);
    return JSON.parse(JSON.stringify(o));   // 去掉 undefined
  }
  function cslToPaper(c, from) {
    var type = CSL2GB[c.type] || "J";
    var venue = c["container-title"];
    if (Array.isArray(venue)) venue = venue[0];
    if (!clean(venue) && (type === "M" || type === "D" || type === "R" || type === "S")) venue = c.publisher || "";
    var title = Array.isArray(c.title) ? c.title[0] : c.title;
    var f = {
      id: "",
      title: clean(title) || "（无题名）",
      author: authorLabel(c.author || []),
      authors: (c.author || []).map(nameToDisplay).filter(Boolean).slice(0, 50),
      year: cslYear(c), venue: clean(venue), doi: normDOI(c.DOI || c.doi || ""),
      type: type, abs: clean(str(c.abstract).replace(/<[^>]+>/g, " ")).slice(0, 2500),
      url: /^https?:/i.test(str(c.URL)) ? str(c.URL) : "",
      csl: trimCSL(c)
    };
    var key = c["citation-key"] || c.citationKey || (typeof c.id === "string" ? c.id : "");
    if (/^[A-Za-z][A-Za-z0-9_:\-.]{1,63}$/.test(key)) f.key = key;
    if (from) f.src = { from: from };
    return f;
  }
  /* 文献卡 → CSL：以导入时的结构化题录为底，叠加用户后来改过的字段 */
  function paperToCSL(f) {
    f = f || {};
    var base = f.csl && typeof f.csl === "object" ? JSON.parse(JSON.stringify(f.csl)) : {};
    var c = base;
    var t = str(f.type || "J");
    c.type = (base.type && CSL2GB[base.type] === t) ? base.type : (GB2CSL[t] || base.type || "article-journal");
    c.title = clean(f.title) || base.title || "";
    var label = clean(f.author);
    var full = Array.isArray(f.authors) ? f.authors.map(clean).filter(Boolean) : [];
    if (Array.isArray(base.author) && base.author.length && authorLabel(base.author) === label) { /* 作者没改过：保留结构化姓名 */ }
    else if (full.length && full.slice(0, 3).join("，") + (full.length > 3 ? "，等" : "") === label) c.author = full.map(nameFromString).filter(Boolean);
    else if (label) c.author = splitAuthorString(label).map(nameFromString).filter(Boolean);
    else delete c.author;
    var y = str(f.year).match(/\d{4}/);
    if (y) {
      var bp = base.issued && base.issued["date-parts"] && base.issued["date-parts"][0];
      c.issued = { "date-parts": [bp && String(bp[0]) === y[0] ? bp : [+y[0]]] };
    } else delete c.issued;
    var v = clean(f.venue);
    if (CONTAINER_TYPES[c.type]) { if (v) c["container-title"] = v; else delete c["container-title"]; }
    else if (v) c.publisher = v;
    var doi = normDOI(f.doi);
    if (doi) c.DOI = doi; else delete c.DOI;
    if (f.url && /^https?:/i.test(f.url)) c.URL = f.url;
    if (f.abs) c.abstract = f.abs;
    c.id = f.key || f.id || "";
    return c;
  }

  /* ================= 去重 / 补全 ================= */
  var FILLABLE = ["author", "year", "venue", "doi", "abs", "url"];
  function dedupeKey(f) {
    var t = normTitle(f.title);
    return { doi: normDOI(f.doi).toLowerCase(), title: t.length >= 8 ? t : "" };
  }
  function missingFields(target, src) {
    return FILLABLE.filter(function (k) { return !clean(target[k]) && clean(src[k]); });
  }
  /* 导入计划：哪些是新的，哪些与现有条目重复（按 DOI，其次题名） */
  function planImport(existing, incoming) {
    var byDoi = {}, byTitle = {};
    (existing || []).forEach(function (f) { var k = dedupeKey(f); if (k.doi) byDoi[k.doi] = f; if (k.title) byTitle[k.title] = f; });
    var add = [], dup = [], seen = {};
    (incoming || []).forEach(function (f) {
      var k = dedupeKey(f);
      var hit = (k.doi && byDoi[k.doi]) || (k.title && byTitle[k.title]);
      if (hit) { dup.push({ item: f, existing: hit, fill: missingFields(hit, f) }); return; }
      var nk = k.doi || k.title;
      if (nk && seen[nk]) { dup.push({ item: f, existing: null, fill: [] }); return; }
      if (nk) seen[nk] = 1;
      add.push(f);
    });
    return { add: add, dup: dup };
  }
  /* 只补空缺，不覆盖已有内容；返回补了哪些字段 */
  function fillMissing(target, src) {
    var done = missingFields(target, src);
    done.forEach(function (k) { target[k] = src[k]; });
    if (done.indexOf("author") >= 0 && src.authors) target.authors = src.authors;
    if (!target.csl && src.csl) { target.csl = src.csl; if (done.indexOf("csl") < 0) done.push("题录"); }
    if (!target.key && src.key) target.key = src.key;
    return done;
  }

  /* ================= BibTeX 引用键 ================= */
  var STOP = { a: 1, an: 1, the: 1, of: 1, on: 1, "in": 1, "for": 1, and: 1, to: 1, "with": 1, from: 1, by: 1, at: 1, is: 1, are: 1, via: 1, toward: 1, towards: 1 };
  var KEY_RE = /^[A-Za-z][A-Za-z0-9_:\-.]{0,63}$/;
  function asciiFold(s) {
    s = str(s);
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.replace(/ß/g, "ss").replace(/[æÆ]/g, "ae").replace(/[øØ]/g, "o").replace(/[łŁ]/g, "l");
  }
  function hash4(s) {
    var h = 2166136261; s = str(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ("0000" + (h >>> 0).toString(36)).slice(-4);
  }
  function makeKey(f, taken) {
    taken = taken || {};
    var c = paperToCSL(f);
    var a = (c.author && c.author[0]) || null;
    var fam = a ? (a.family || a.literal || "") : "";
    var famA = asciiFold(fam).toLowerCase().replace(/[^a-z0-9]/g, "");
    var y = (str(f.year).match(/\d{4}/) || [""])[0];
    var words = asciiFold(f.title).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && !STOP[w]; });
    var base = (famA && !CJK.test(fam)) ? famA + y + (words[0] || "") : "ref" + y + hash4(f.title || f.id);
    base = base.slice(0, 40);
    if (!/^[a-z]/.test(base)) base = "ref" + base;
    var k = base, i = 0;
    while (taken[k]) { k = base + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : ""); i++; }
    taken[k] = 1;
    return k;
  }
  /* 给没有键（或键重复/不合法）的条目补键；返回补了几条。键会存回文献卡，导出与 MCP 保持一致 */
  function ensureKeys(papers) {
    var taken = {}, n = 0;
    (papers || []).forEach(function (f) {
      if (f.key && KEY_RE.test(f.key) && !taken[f.key]) taken[f.key] = 1;
      else if (f.key) f.key = "";
    });
    (papers || []).forEach(function (f) { if (!f.key) { f.key = makeKey(f, taken); n++; } });
    return n;
  }

  /* ================= 导出 ================= */
  var CSL2BIB = {
    "article-journal": "article", "article-magazine": "article", "article-newspaper": "newspaper", "article": "misc",
    "book": "book", "chapter": "incollection", "paper-conference": "inproceedings", "thesis": "phdthesis", "report": "techreport",
    "webpage": "online", "post": "online", "post-weblog": "online", "dataset": "misc", "patent": "patent",
    "standard": "standard", "software": "misc", "manuscript": "unpublished"
  };
  function bibEsc(s) { return clean(s).replace(/\\/g, "\\textbackslash ").replace(/([&%$#_])/g, "\\$1").replace(/[{}]/g, ""); }
  function bibName(n) {
    if (!n) return "";
    if (n.literal) return "{" + bibEsc(n.literal) + "}";
    var fam = bibEsc(n.family), giv = bibEsc(n.given);
    if (!fam) return giv;
    return giv ? fam + ", " + giv : fam;
  }
  function pagesBib(p) { return clean(p).replace(/\s*[-–—]+\s*/g, "--"); }
  /* BibTeX 里写 babel 式语言名：gbt7714 / biblatex 只认 chinese、english…，写 zh 会被当成「其他语言」排版；
     导入时再转回 CSL 用的 ISO 代码 */
  var BIB_LANG = { zh: "chinese", en: "english", ja: "japanese", ko: "korean", ru: "russian", de: "german", fr: "french" };
  function bibLang(l) {
    var s = clean(l), k = s.toLowerCase().split(/[-_]/)[0];
    return BIB_LANG[k] || s;
  }
  function isoLang(l) {
    var s = clean(l), low = s.toLowerCase();
    if (low === "american" || low === "british") return "en";
    for (var k in BIB_LANG) if (BIB_LANG[k] === low) return k;
    return s;
  }
  function toBibTeX(papers, opts) {
    opts = opts || {};
    ensureKeys(papers);
    return (papers || []).map(function (f) {
      var c = paperToCSL(f);
      var t = CSL2BIB[c.type] || "misc";
      if (t === "phdthesis" && /硕士|master/i.test(str(c.genre))) t = "mastersthesis";
      var fields = [];
      var add = function (k, v, raw) { v = raw ? clean(str(v).replace(/[{}]/g, "")) : bibEsc(v); if (v) fields.push([k, v]); };
      if (c.author && c.author.length) fields.push(["author", c.author.map(bibName).filter(Boolean).join(" and ")]);
      if (c.title) fields.push(["title", "{" + bibEsc(c.title) + "}"]);
      var cont = c["container-title"];
      if (t === "article" || t === "newspaper") add("journal", cont);
      else if (t === "inproceedings" || t === "incollection") add("booktitle", cont);
      else if (t === "online" && cont) add("organization", cont);
      if (c.editor && c.editor.length) fields.push(["editor", c.editor.map(bibName).join(" and ")]);
      if (t === "phdthesis" || t === "mastersthesis") add("school", c.publisher);
      else if (t === "techreport") add("institution", c.publisher);
      else add("publisher", c.publisher);
      add("address", c["publisher-place"]);
      var dp = c.issued && c.issued["date-parts"] && c.issued["date-parts"][0];
      if (dp && dp[0]) fields.push(["year", String(dp[0])]);
      add("volume", c.volume);
      add("number", c.issue);
      if (c.page) fields.push(["pages", pagesBib(c.page)]);
      add("edition", c.edition);
      add("doi", c.DOI, true);
      add("url", c.URL, true);
      add("isbn", c.ISBN); add("issn", c.ISSN);
      var lg = bibLang(c.language);
      if (CJK.test(str(c.title) + str(cont)) && lg !== "japanese" && lg !== "korean") lg = "chinese";
      add("language", lg);
      if (opts.abstract && c.abstract) add("abstract", c.abstract);
      var w = 0; fields.forEach(function (x) { if (x[0].length > w) w = x[0].length; });
      return "@" + t + "{" + (f.key || c.id) + ",\n" + fields.map(function (x) {
        return "  " + x[0] + new Array(w - x[0].length + 1).join(" ") + " = {" + x[1] + "}";
      }).join(",\n") + "\n}";
    }).join("\n\n") + ((papers || []).length ? "\n" : "");
  }
  var CSL2RIS = {
    "article-journal": "JOUR", "article-magazine": "MGZN", "article-newspaper": "NEWS", "article": "GEN", "book": "BOOK",
    "chapter": "CHAP", "paper-conference": "CPAPER", "thesis": "THES", "report": "RPRT", "webpage": "ELEC", "post": "ELEC",
    "post-weblog": "BLOG", "dataset": "DATA", "patent": "PAT", "standard": "STAND", "software": "COMP", "manuscript": "UNPB"
  };
  function toRIS(papers) {
    return (papers || []).map(function (f) {
      var c = paperToCSL(f);
      var L = [];
      var add = function (tag, v) { v = clean(v); if (v) L.push(tag + "  - " + v); };
      add("TY", CSL2RIS[c.type] || "GEN");
      (c.author || []).forEach(function (a) { add("AU", a.literal ? a.literal : (a.given ? a.family + ", " + a.given : a.family)); });
      add("TI", c.title);
      add(c.type === "chapter" ? "BT" : "T2", c["container-title"]);
      var dp = c.issued && c.issued["date-parts"] && c.issued["date-parts"][0];
      if (dp && dp[0]) add("PY", String(dp[0]));
      add("VL", c.volume); add("IS", c.issue);
      if (c.page) { var pp = String(c.page).split(/\s*[-–—]+\s*/); add("SP", pp[0]); if (pp[1]) add("EP", pp[1]); }
      add("PB", c.publisher); add("CY", c["publisher-place"]);
      add("DO", c.DOI); add("UR", c.URL);
      add("SN", c.ISBN || c.ISSN); add("LA", c.language); add("ET", c.edition);
      add("AB", c.abstract);
      if (c.keyword) String(c.keyword).split(/[,;，；]\s*/).forEach(function (k) { add("KW", k); });
      if (f.key) add("ID", f.key);
      L.push("ER  - ");
      return L.join("\r\n");
    }).join("\r\n\r\n") + ((papers || []).length ? "\r\n" : "");
  }
  function toCSLJSON(papers) {
    ensureKeys(papers);
    return JSON.stringify((papers || []).map(paperToCSL), null, 2);
  }

  /* ================= GB/T 7714-2015（顺序编码制） ================= */
  var GB_TYPE = { "article-journal": "J", "article-magazine": "J", "article-newspaper": "N", "book": "M", "paper-conference": "C", "chapter": "M", "thesis": "D", "report": "R", "post": "EB/OL", "post-weblog": "EB/OL", "webpage": "EB/OL", "dataset": "DS", "standard": "S", "software": "CP", "patent": "P" };
  function normPages(p) { return String(p).replace(/[–—]/g, "-"); }
  function gbName(a) {
    if (!a) return "";
    if (typeof a === "string") a = nameFromString(a) || {};
    if (a.literal) return clean(a.literal);
    var fam = clean(a.family), giv = clean(a.given);
    if (fam && CJK.test(fam) && (!giv || CJK.test(giv))) return fam + giv;
    var famUp = fam.toUpperCase();
    if (!giv) return famUp;
    return (famUp + " " + giv.split(/[\s\-.]+/).filter(Boolean).map(function (w) { return w[0].toUpperCase(); }).join(" ")).trim();
  }
  function gbAuthors(authors) {
    var list = (authors || []).map(gbName).filter(Boolean);
    if (!list.length) return "";
    var etal = CJK.test(list.join("")) ? "等" : "et al";
    return list.length > 3 ? list.slice(0, 3).join(", ") + ", " + etal : list.join(", ");
  }
  function gbEntry(c, idx) {
    c = c || {};
    var t = GB_TYPE[c.type] || "Z";   // 未知类型按国标 [Z] 其他，不冒充期刊
    var title = String(c.title || "[无题]").replace(/\s+/g, " ").trim();
    var dp = c.issued && c.issued["date-parts"] && c.issued["date-parts"][0];
    var yr = dp && dp[0] ? String(dp[0]) : "";
    var au = gbAuthors(c.author);
    var head = (au ? au + ". " : "") + title;
    var pg = c.page ? normPages(c.page) : "";
    var place = c["publisher-place"] || "";
    var pub = c.publisher || "";
    var pubSeg = pub ? (place ? place + ": " + pub : pub) : "";
    var opt = function (arr) { var s = arr.filter(Boolean).join(", "); return s ? " " + s + "." : "."; };
    var tail = "";
    if (c.type === "article-journal" || c.type === "article-magazine") {
      var voliss = [c.volume ? String(c.volume) : "", c.issue ? "(" + c.issue + ")" : ""].join("");
      var seg = [c["container-title"] || "", yr, voliss].filter(Boolean).join(", ");
      tail = "[J]. " + seg + (pg ? ": " + pg : "") + ".";
    } else if (c.type === "article-newspaper") {
      tail = "[N]. " + [c["container-title"] || "", yr].filter(Boolean).join(", ") + (c.issue ? "(" + c.issue + ")" : "") + ".";
    } else if (c.type === "paper-conference") {
      var host = c["container-title"] || "";
      tail = "[C]" + (host ? "//" + host : "") + "." + (yr ? " " + yr : "") + (pg ? ": " + pg : "") + ".";
    } else if (c.type === "chapter") {
      var book = c["container-title"] || "";   // 国标：章名[M]//书名. 出版地: 出版社, 年: 页码
      var main = [pubSeg, yr].filter(Boolean).join(", ");
      tail = "[M]" + (book ? "//" + book : "") + "." + (main ? " " + main : "") + (pg ? ": " + pg : "") + ".";
    } else if (c.type === "book") {
      tail = "[M]." + opt([pubSeg, yr]);
    } else if (c.type === "thesis") {
      tail = "[D]." + opt([pubSeg, yr]);
    } else if (c.type === "report") {
      tail = "[R]." + opt([pub, yr]);
    } else if (c.type === "standard") {
      tail = "[S]." + opt([pub, yr]);
    } else if (c.type === "patent") {
      tail = "[P]." + (yr ? " " + yr + "." : "");
    } else if (c.type === "post" || c.type === "post-weblog" || c.type === "webpage") {
      var url = c.URL || (c.DOI ? "https://doi.org/" + c.DOI : "");
      var d0 = new Date(), p2 = function (n) { return (n < 10 ? "0" : "") + n; };
      var today = d0.getFullYear() + "-" + p2(d0.getMonth() + 1) + "-" + p2(d0.getDate());   // 第二个方括号是引用日期（本地日期）
      tail = "[EB/OL]" + (yr ? ". (" + yr + ")" : "") + "[" + today + "]." + (url ? " " + url + "." : "");
    } else {
      tail = "[" + t + "]." + (c["container-title"] ? " " + c["container-title"] + "," : "") + (yr ? " " + yr + "." : "");
    }
    /* 国标示例里题名与文献类型标识之间不空格：题名[J]. 刊名 */
    var s = (head + tail).replace(/\s+/g, " ").replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").replace(/:\s*\./g, ".").replace(/,\s*\./g, ".");
    if (c.DOI && (c.type === "article-journal" || c.type === "paper-conference" || c.type === "chapter")) s += " DOI: " + c.DOI + ".";
    return "[" + idx + "] " + s;
  }
  function gbList(papers) {
    return (papers || []).map(function (f, i) { return gbEntry(paperToCSL(f), i + 1); });
  }

  return {
    CSL2GB: CSL2GB, GB2CSL: GB2CSL,
    detectFormat: detectFormat, parse: parse, parseBibTeX: parseBibTeX, parseRIS: parseRIS, parseCSL: parseCSL, delatex: delatex,
    cslToPaper: cslToPaper, paperToCSL: paperToCSL, trimCSL: trimCSL,
    nameFromString: nameFromString, nameToDisplay: nameToDisplay, authorLabel: authorLabel, splitAuthorString: splitAuthorString,
    normDOI: normDOI, normTitle: normTitle, dedupeKey: dedupeKey, planImport: planImport, fillMissing: fillMissing,
    makeKey: makeKey, ensureKeys: ensureKeys,
    toBibTeX: toBibTeX, toRIS: toRIS, toCSLJSON: toCSLJSON,
    gbName: gbName, gbAuthors: gbAuthors, gbEntry: gbEntry, gbList: gbList
  };
});

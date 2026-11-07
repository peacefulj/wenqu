/* 研墨 · 增强 Markdown ym-md.js（v1.4 新增）
 * 公式（本地 KaTeX）、图片粘贴/拖入（存 IndexedDB）、脚注、上下标、
 * 结构图（```ymflow）与数据图（```ymchart）本地 SVG 渲染、Word 导出。
 * 依赖：marked + DOMPurify（本地 vendor）；KaTeX 可选，缺失时公式降级为原文。
 * 零网络请求：全部离线可用。
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var INK = "#1c2b3a", ACCENT = "#8c2f1e", LINE = "#4a5568", MUTED = "#7a8699";

  /* ================= 1) 图片仓库（IndexedDB） ================= */
  var imgP = null, imgCache = {};
  function imgOpen() {
    if (imgP) return imgP;
    imgP = new Promise(function (resolve, reject) {
      try {
        if (!window.indexedDB) return reject(new Error("no-idb"));
        var req = indexedDB.open("wenqu-img", 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains("img")) db.createObjectStore("img");
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("idb-fail")); };
      } catch (e) { reject(e); }
    }).catch(function (e) { throw e; });
    return imgP;
  }
  function imgPut(blob) {
    return imgOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var id = "img" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        var t = db.transaction("img", "readwrite");
        t.objectStore("img").put(blob, id);
        t.oncomplete = function () { resolve(id); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function imgGet(id) {
    if (imgCache[id]) return Promise.resolve(imgCache[id]);
    return imgOpen().then(function (db) {
      return new Promise(function (resolve) {
        var r = db.transaction("img", "readonly").objectStore("img").get(id);
        r.onsuccess = function () {
          if (!r.result) return resolve("");
          try {
            var fr = new FileReader();
            fr.onload = function () { imgCache[id] = fr.result; resolve(fr.result); };
            fr.readAsDataURL(r.result);
          } catch (e) { resolve(""); }
        };
        r.onerror = function () { resolve(""); };
      });
    }).catch(function () { return ""; });
  }
  function imgList() {
    return imgOpen().then(function (db) {
      return new Promise(function (resolve) {
        var out = [], r = db.transaction("img", "readonly").objectStore("img").openCursor();
        r.onsuccess = function () {
          var c = r.result;
          if (!c) return resolve(out);
          out.push(c.key); c.continue();
        };
        r.onerror = function () { resolve(out); };
      });
    }).catch(function () { return []; });
  }
  /* 把容器里的 ym-img 占位图换成真实数据（async） */
  function hydrateImages(root) {
    var nodes = (root || document).querySelectorAll("img[data-ymimg]");
    var jobs = [];
    Array.prototype.forEach.call(nodes, function (im) {
      var id = im.getAttribute("data-ymimg");
      jobs.push(imgGet(id).then(function (url) {
        if (url) im.src = url;
        else im.alt = (im.alt || "") + "（图片未能从本机取回）";
      }));
    });
    return Promise.all(jobs);
  }

  /* ================= 1b) 导出用图片预处理 ================= */
  /* 把 ![](ym-img:id) 换成稳定的 @@YMIMG序号|alt@@ 占位符；导出时再按目标格式还原。
     这样 Markdown 可以内联 dataURL，LaTeX 可以写 includegraphics，Word 仍走原链路。 */
  function imgMeta(id, url, i) {
    var m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/i.exec(url);
    var ext = m ? m[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg") : "png";
    return { id: id, dataUrl: url, ext: ext, name: "yanmo-images/img" + (i + 1) + "." + ext };
  }
  function prepareImageSections(mds) {
    mds = (mds || []).map(function (x) { return String(x == null ? "" : x); });
    var all = mds.join("\n\n"), ids = [], altOf = {};
    all.replace(/!\[([^\]]*)\]\(ym-img:([^)]+)\)/g, function (m, alt, id) {
      if (ids.indexOf(id) < 0) { ids.push(id); altOf[id] = alt; }
      return m;
    });
    return Promise.all(ids.map(function (id, i) {
      return imgGet(id).then(function (u) { return u ? imgMeta(id, u, i) : null; });
    })).then(function (arr) {
      var images = arr.filter(Boolean), idx = {};
      images.forEach(function (im, i) { idx[im.id] = i; });
      var texts = mds.map(function (md) {
        return md.replace(/!\[([^\]]*)\]\(ym-img:([^)]+)\)/g, function (m, alt, id) {
          var i = idx[id];
          if (i == null) return m;
          return "@@YMIMG" + i + "|" + encodeURIComponent(alt || altOf[id] || "") + "@@";
        });
      });
      return { texts: texts, images: images, missing: ids.length - images.length };
    });
  }
  function decodeAlt(a) { try { return decodeURIComponent(a || ""); } catch (e) { return a || ""; } }
  function spliceImages(text, images, mode) {
    return String(text || "").replace(/@@YMIMG(\d+)\|([^@]*)@@/g, function (m, i, alt) {
      var im = (images || [])[+i];
      if (!im) return "";
      var a = decodeAlt(alt);
      if (mode === "tex") return "\\includegraphics[width=0.8\\linewidth]{" + im.name + "}";
      if (mode === "names") return "![" + a + "](" + im.name + ")";
      return "![" + a + "](" + im.dataUrl + ")";
    });
  }
  function dataUrlBytes(u) {
    var s = String(u || ""), comma = s.indexOf(",");
    var head = s.slice(0, comma), body = s.slice(comma + 1);
    if (/;base64/i.test(head)) {
      var bin = atob(body), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  }

  /* ================= 2) 公式（KaTeX） ================= */
  var mathTokens = [];
  function katexHTML(tex, display, forWord) {
    if (!window.katex) return display ? '<div class="ym-math-src">' + esc(tex) + "</div>" : '<code class="ym-math-src">' + esc(tex) + "</code>";
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: forWord ? "mathml" : "htmlAndMathml", strict: "ignore" });
    } catch (e) {
      return '<code class="ym-math-err" title="' + esc(e.message) + '">' + esc(tex) + "</code>";
    }
  }
  function protectMath(src, forWord) {
    mathTokens = [];
    var tok = function (tex, display) {
      var i = mathTokens.length;
      mathTokens.push(katexHTML(tex, display, forWord));
      return "@@YMMATH" + i + "@@";
    };
    /* 先把代码块/行内代码抽走，避免公式替换破坏代码 */
    var codes = [];
    src = src.replace(/```[\s\S]*?```|`[^`\n]*`/g, function (m) { codes.push(m); return "@@YMCODE" + (codes.length - 1) + "@@"; });
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, function (m, tex) { return tok(tex.trim(), true); });
    src = src.replace(/(^|[^\\$])\$([^\s$][^$\n]*?)\$/g, function (m, pre, tex) { return pre + tok(tex.trim(), false); });
    src = src.replace(/@@YMCODE(\d+)@@/g, function (m, i) { return codes[+i]; });
    return src;
  }

  /* ================= 3) 脚注 / 上下标 ================= */
  var fnStore = [];
  function protectFootnotes(src) {
    fnStore = [];
    var defs = {};
    src = src.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, function (m, id, text) { defs[id] = text; return ""; });
    src = src.replace(/\[\^([^\]]+)\]/g, function (m, id) {
      fnStore.push({ id: id, text: defs[id] || "" });
      var n = fnStore.length;
      return '<sup class="fnref"><a href="#ymfn-' + n + '">' + n + "</a></sup>";
    });
    return src;
  }
  function footnoteHTML() {
    if (!fnStore.length) return "";
    return '<div class="ym-footnotes"><hr><ol>' + fnStore.map(function (f, i) {
      return '<li id="ymfn-' + (i + 1) + '">' + esc(f.text) + "</li>";
    }).join("") + "</ol></div>";
  }
  function inlineExtras(src) {
    /* 上标 ^x^ / 下标 ~x~（避开 ~~删除线~~ 与数学公式） */
    src = src.replace(/\^([^\s^<>]{1,40})\^/g, "<sup>$1</sup>");
    src = src.replace(/(^|[^~])~([^\s~<>]{1,40})~(?!~)/g, "$1<sub>$2</sub>");
    return src;
  }

  /* ================= 4) ymflow 结构图 ================= */
  var uid = 0;
  function flowParse(code) {
    code = String(code || "").trim();
    var obj = null;
    try { obj = JSON.parse(code); } catch (e) { obj = null; }
    if (obj && Array.isArray(obj.nodes) && obj.nodes.length) {
      var nodes = obj.nodes.map(function (n, i) {
        if (typeof n === "string") return { id: "n" + i, text: n };
        return { id: String(n.id || ("n" + i)), text: String(n.text || n.label || n.name || n.id || "") };
      });
      var byText = {};
      nodes.forEach(function (n) { byText[n.text] = n.id; byText[n.id] = n.id; });
      var edges = (obj.edges || []).map(function (e, i) {
        if (typeof e === "string") {
          var m = e.split(/\s*(?:->|→)\s*/);
          return { from: byText[m[0]] || m[0], to: byText[m[1]] || m[1], label: "" };
        }
        return { from: byText[e.from] || String(e.from || ""), to: byText[e.to] || String(e.to || ""), label: String(e.label || e.text || "") };
      });
      return { title: String(obj.title || ""), nodes: nodes, edges: edges.filter(function (e) { return e.from && e.to; }) };
    }
    /* 简单语法：A[说明] -> B[说明]: 标签（每行一条）；title: xxx */
    var lines = code.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var title = "", nodes = [], map = {}, edges = [];
    lines.forEach(function (ln) {
      var mt = ln.match(/^title\s*[:：]\s*(.+)$/i);
      if (mt) { title = mt[1].trim(); return; }
      var m = ln.match(/^(.+?)\s*(?:->|→|=>)\s*(.+?)(?:\s*[:：]\s*(.+))?$/);
      if (!m) { if (!map[ln]) { map[ln] = "n" + nodes.length; nodes.push({ id: map[ln], text: ln.replace(/\[.*?\]/g, "").trim() }); } return; }
      var add = function (part) {
        var mm = part.match(/^(.+?)(?:\[(.+?)\])?$/);
        var label = (mm[2] || mm[1]).trim(), id = label;
        if (!map[id]) { map[id] = "n" + nodes.length; nodes.push({ id: map[id], text: label }); }
        return map[id];
      };
      edges.push({ from: add(m[1]), to: add(m[2]), label: (m[3] || "").trim() });
    });
    return nodes.length ? { title: title, nodes: nodes, edges: edges } : null;
  }
  function flowSVG(code) {
    var g = flowParse(code);
    if (!g || !g.nodes.length) return "";
    var n = g.nodes.length, idx = {}, depth = {}, rows = {}, colCount = {};
    g.nodes.forEach(function (x, i) { idx[x.id] = x; depth[x.id] = 0; });
    for (var pass = 0; pass < n; pass++) {
      g.edges.forEach(function (e) {
        if (idx[e.from] && idx[e.to] && depth[e.to] < depth[e.from] + 1 && depth[e.to] < 12) depth[e.to] = depth[e.from] + 1;
      });
    }
    var maxD = 0;
    g.nodes.forEach(function (x) { maxD = Math.max(maxD, depth[x.id]); });
    var cols = {};
    g.nodes.forEach(function (x) { var d = depth[x.id]; (cols[d] = cols[d] || []).push(x); });
    Object.keys(cols).forEach(function (d) { rows[d] = cols[d].length; });
    var maxRows = 1;
    Object.keys(cols).forEach(function (d) { maxRows = Math.max(maxRows, cols[d].length); });
    var BW = 132, BH = 46, GX = 74, GY = 26;
    var W = (maxD + 1) * (BW + GX) + 20, H = Math.max(1, maxRows) * (BH + GY) + 26 + (g.title ? 24 : 0);
    var top = g.title ? 34 : 12;
    var pos = {};
    Object.keys(cols).forEach(function (d) {
      var arr = cols[d], colH = arr.length * (BH + GY) - GY;
      var y0 = top + (H - top - colH) / 2;
      arr.forEach(function (x, i) { pos[x.id] = { x: 10 + (+d) * (BW + GX), y: y0 + i * (BH + GY) }; });
    });
    var mk = "ymarrow" + (++uid);
    var s = '<svg class="ymfig-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img">';
    s += '<defs><marker id="' + mk + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + LINE + '"/></marker></defs>';
    if (g.title) s += '<text x="' + (W / 2) + '" y="20" text-anchor="middle" font-size="14" font-weight="700" fill="' + INK + '">' + esc(g.title) + "</text>";
    g.edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to]; if (!a || !b) return;
      var x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2;
      if (a.x === b.x) { x1 = a.x + BW / 2; y1 = a.y + BH; x2 = b.x + BW / 2; y2 = b.y; }
      var d = a.x === b.x ? "M" + x1 + "," + y1 + " L" + x2 + "," + y2 : "M" + x1 + "," + y1 + " C" + (x1 + 34) + "," + y1 + " " + (x2 - 34) + "," + y2 + " " + x2 + "," + y2;
      s += '<path d="' + d + '" fill="none" stroke="' + LINE + '" stroke-width="1.4" marker-end="url(#' + mk + ')"/>';
      if (e.label) {
        var lx = a.x === b.x ? (x1 + 6) : (x1 + x2) / 2, ly = a.x === b.x ? (y1 + y2) / 2 : (y1 + y2) / 2 - 5;
        s += '<text x="' + lx + '" y="' + ly + '" font-size="11" fill="' + MUTED + '" text-anchor="' + (a.x === b.x ? "start" : "middle") + '">' + esc(e.label) + "</text>";
      }
    });
    g.nodes.forEach(function (x) {
      var p = pos[x.id];
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + BW + '" height="' + BH + '" rx="9" fill="#ffffff" stroke="' + INK + '" stroke-width="1.2"/>';
      var words = String(x.text || "").split(/\s+/), line1 = words.slice(0, 2).join(" "), line2 = words.slice(2).join(" ");
      if (!line2 && String(x.text).length > 12) { line1 = String(x.text).slice(0, 12); line2 = String(x.text).slice(12); }
      s += '<text x="' + (p.x + BW / 2) + '" y="' + (p.y + (line2 ? BH / 2 - 3 : BH / 2 + 4)) + '" text-anchor="middle" font-size="12" fill="' + INK + '">' + esc(line1) + "</text>";
      if (line2) s += '<text x="' + (p.x + BW / 2) + '" y="' + (p.y + BH / 2 + 13) + '" text-anchor="middle" font-size="12" fill="' + INK + '">' + esc(line2) + "</text>";
    });
    return s + "</svg>";
  }

  /* ================= 5) ymchart 数据图 ================= */
  function chartParse(code) {
    try { var o = JSON.parse(String(code || "")); return o && o.type ? o : null; } catch (e) { return null; }
  }
  function chartSVG(code) {
    var c = chartParse(code);
    if (!c) return "";
    var W = 720, H = 360, L = 58, R = 20, T = 30, B = 54;
    var iw = W - L - R, ih = H - T - B;
    var type = String(c.type || "bar");
    var labels = c.labels || [];
    var series = c.series || [];
    var demo = !!c.demo;
    var title = c.title || "";
    var s = '<svg class="ymfig-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    if (title) s += '<text x="' + (W / 2) + '" y="18" text-anchor="middle" font-size="13" font-weight="700" fill="' + INK + '">' + esc(title) + "</text>";
    var vals = [];
    series.forEach(function (se) { (se.values || []).forEach(function (v) { if (isFinite(v)) vals.push(+v); }); });
    if (type === "coef" || type === "event") {
      (c.data || []).forEach(function (d) { [d.est, d.lo, d.hi].forEach(function (v) { if (isFinite(v)) vals.push(+v); }); });
      if (c.zero !== false) vals.push(0);
    }
    var min = Math.min.apply(null, vals.concat([0])), max = Math.max.apply(null, vals.concat([1]));
    if (max === min) { max = min + 1; }
    var pad = (max - min) * 0.08; min -= pad; max += pad;
    var yOf = function (v) { return T + ih - (v - min) / (max - min) * ih; };
    var xOf = function (i, n) { return L + (n <= 1 ? iw / 2 : (i + 0.5) * iw / n); };
    /* 轴与网格 */
    for (var k = 0; k <= 4; k++) {
      var yy = T + ih * k / 4, vv = max - (max - min) * k / 4;
      s += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="#e3e8f0" stroke-width="1"/>';
      s += '<text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="10" fill="' + MUTED + '">' + (Math.abs(vv) >= 100 ? vv.toFixed(0) : vv.toFixed(2)) + "</text>";
    }
    s += '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ih) + '" stroke="' + INK + '" stroke-width="1.1"/>';
    s += '<line x1="' + L + '" y1="' + (T + ih) + '" x2="' + (W - R) + '" y2="' + (T + ih) + '" stroke="' + INK + '" stroke-width="1.1"/>';
    var n = labels.length || (series[0] && series[0].values || []).length || 1;
    labels.forEach(function (lb, i) {
      s += '<text x="' + xOf(i, n) + '" y="' + (T + ih + 18) + '" text-anchor="middle" font-size="10.5" fill="' + INK + '">' + esc(String(lb).slice(0, 10)) + "</text>";
    });
    var colors = ["#2456e6", "#8c2f1e", "#0a7a43", "#7a3fa8", "#c98a00"];
    if (type === "bar") {
      var m = series.length || 1, bw = Math.max(6, (iw / n) * 0.62 / m);
      series.forEach(function (se, si) {
        (se.values || []).forEach(function (v, i) {
          var x = xOf(i, n) - (m * bw) / 2 + si * bw, y = yOf(+v || 0);
          s += '<rect x="' + x + '" y="' + Math.min(y, yOf(0)) + '" width="' + (bw - 2) + '" height="' + Math.abs(yOf(0) - y) + '" fill="' + colors[si % colors.length] + '"/>';
        });
      });
    } else if (type === "line") {
      series.forEach(function (se, si) {
        var pts = (se.values || []).map(function (v, i) { return xOf(i, n) + "," + yOf(+v || 0); }).join(" ");
        s += '<polyline points="' + pts + '" fill="none" stroke="' + colors[si % colors.length] + '" stroke-width="2"/>';
        (se.values || []).forEach(function (v, i) { s += '<circle cx="' + xOf(i, n) + '" cy="' + yOf(+v || 0) + '" r="3" fill="' + colors[si % colors.length] + '"/>'; });
      });
    } else if (type === "scatter") {
      series.forEach(function (se, si) {
        (se.points || []).forEach(function (p) {
          s += '<circle cx="' + (L + (p[0] - (c.xMin || 0)) / ((c.xMax || 1) - (c.xMin || 0)) * iw) + '" cy="' + yOf(p[1]) + '" r="3.4" fill="' + colors[si % colors.length] + '" opacity=".82"/>';
        });
      });
    } else {
      /* coef / event：点估计 + 置信区间 */
      var data = c.data || [];
      data.forEach(function (d, i) {
        var x = xOf(i, data.length), y = yOf(+d.est), lo = yOf(+d.lo), hi = yOf(+d.hi), col = (+d.lo > 0 || +d.hi < 0) ? ACCENT : "#2456e6";
        s += '<line x1="' + x + '" y1="' + hi + '" x2="' + x + '" y2="' + lo + '" stroke="' + col + '" stroke-width="1.6"/>';
        s += '<line x1="' + (x - 4) + '" y1="' + hi + '" x2="' + (x + 4) + '" y2="' + hi + '" stroke="' + col + '"/>';
        s += '<line x1="' + (x - 4) + '" y1="' + lo + '" x2="' + (x + 4) + '" y2="' + lo + '" stroke="' + col + '"/>';
        s += '<circle cx="' + x + '" cy="' + y + '" r="3.6" fill="' + col + '"/>';
        s += '<text x="' + x + '" y="' + (T + ih + 18) + '" text-anchor="middle" font-size="10.5" fill="' + INK + '">' + esc(String(d.label || labels[i] || i + 1).slice(0, 10)) + "</text>";
      });
      if (type === "event") s += '<line x1="' + L + '" y1="' + yOf(0) + '" x2="' + (W - R) + '" y2="' + yOf(0) + '" stroke="' + INK + '" stroke-dasharray="4 3"/>';
    }
    if (series.length > 1) {
      series.forEach(function (se, si) {
        s += '<rect x="' + (L + si * 110) + '" y="' + (H - 18) + '" width="10" height="10" fill="' + colors[si % colors.length] + '"/><text x="' + (L + si * 110 + 14) + '" y="' + (H - 9) + '" font-size="10.5" fill="' + INK + '">' + esc(se.name || ("系列" + (si + 1))) + "</text>";
      });
    }
    if (demo) {
      s += '<text x="' + (W / 2) + '" y="' + (T + ih / 2) + '" text-anchor="middle" font-size="26" fill="rgba(140,47,30,.16)" transform="rotate(-18 ' + (W / 2) + " " + (T + ih / 2) + ')">示意数据 · 待替换</text>';
    }
    return s + "</svg>";
  }

  /* ================= 6) Markdown → HTML ================= */
  function countFigs(md) {
    var n = 0;
    String(md == null ? "" : md).replace(/```(ymflow|ymchart)[ \t]*\n[\s\S]*?```/g, function () { n++; return ""; });
    return n;
  }
  function mdToHTML(md, opts) {
    opts = opts || {};
    var src = String(md == null ? "" : md);
    var blocks = [], figN = Math.max(0, +opts.figStart || 0);
    src = src.replace(/```(ymflow|ymchart)[ \t]*\n([\s\S]*?)```/g, function (m, type, body) {
      var svg = type === "ymflow" ? flowSVG(body) : chartSVG(body);
      if (!svg) {
        var err = '<div class="ymfig-err"><b>结构图/图表代码有误，未能渲染</b><pre>' + esc(body.trim()) + "</pre></div>";
        var i0 = blocks.length; blocks.push(err); return "\n\n@@YMBLOCK" + i0 + "@@\n\n";
      }
      var title = "";
      try { var o = JSON.parse(body); title = o.title || ""; } catch (e) {}
      var i1 = blocks.length;
      figN++;
      blocks.push('<figure class="ymfig">' + svg + '<figcaption>图 ' + figN + (title ? " · " + esc(title) : "") + "</figcaption></figure>");
      return "\n\n@@YMBLOCK" + i1 + "@@\n\n";
    });
    src = src.replace(/!\[([^\]]*)\]\(ym-img:([^)]+)\)/g, function (m, alt, id) {
      return '<img data-ymimg="' + esc(id) + '" alt="' + esc(alt) + '" src="' + (imgCache[id] || "data:image/gif;base64,R0lGODlhAQABAAAAACw=") + '">';
    });
    src = protectFootnotes(src);
    src = inlineExtras(src);
    src = protectMath(src, opts.math === "mathml");
    var html;
    if (window.marked) {
      try { html = marked.parse(src, { gfm: true, breaks: true }); } catch (e) { html = "<pre>" + esc(src) + "</pre>"; }
    } else {
      html = "<pre>" + esc(src) + "</pre>";
    }
    if (window.DOMPurify) {
      html = DOMPurify.sanitize(html, {
        ADD_TAGS: ["math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt", "mtext", "mspace", "munder", "mover", "mtable", "mtr", "mtd", "figure", "figcaption"],
        ADD_ATTR: ["target", "rel", "data-ymimg", "xmlns", "display"]
      });
    }
    html = html.replace(/@@YMBLOCK(\d+)@@/g, function (m, i) { return blocks[+i] || ""; });
    html = html.replace(/@@YMMATH(\d+)@@/g, function (m, i) { return mathTokens[+i] || ""; });
    return html + footnoteHTML();
  }
  function render(el, md, opts) {
    if (!el) return;
    el.dataset.rawmd = String(md == null ? "" : md);
    el.innerHTML = mdToHTML(md, opts);
    el.classList.add("mdr");
    el.hidden = false;
    hydrateImages(el);
    return el;
  }

  /* ================= 7) 图片粘贴 / 拖入 ================= */
  function insertAt(t, text) {
    if (t.isContentEditable) {
      t.focus();
      var sel = window.getSelection();
      if (sel && sel.rangeCount) { var r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(text)); r.collapse(false); }
      else t.appendChild(document.createTextNode(text));
      return;
    }
    var s = t.selectionStart || 0, e = t.selectionEnd || 0, v = t.value || "";
    t.value = v.slice(0, s) + text + v.slice(e);
    t.selectionStart = t.selectionEnd = s + text.length;
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function handleFiles(files, target) {
    Array.prototype.forEach.call(files || [], function (f) {
      if (!f || !/^image\//.test(f.type)) return;
      imgPut(f).then(function (id) {
        insertAt(target, "![](ym-img:" + id + ")" + (target.isContentEditable ? "" : "\n"));
      }).catch(function () { alert("图片保存失败（浏览器存储不可用）"); });
    });
  }
  document.addEventListener("paste", function (e) {
    var t = e.target;
    if (!t || !(t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var files = [];
    if (e.clipboardData) {
      Array.prototype.forEach.call(e.clipboardData.items || [], function (it) { if (it.kind === "file" && /^image\//.test(it.type)) files.push(it.getAsFile()); });
    }
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files, t);
  });
  document.addEventListener("dragover", function (e) {
    var t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.isContentEditable)) e.preventDefault();
  });
  document.addEventListener("drop", function (e) {
    var t = e.target;
    if (!t || !(t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    handleFiles(e.dataTransfer.files, t);
  });

  /* ================= 8) Word 导出 ================= */
  function svgToPng(svg, w, h) {
    return new Promise(function (resolve) {
      try {
        var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        var im = new Image();
        im.onload = function () {
          try {
            var c = document.createElement("canvas");
            c.width = Math.max(1, w * 2); c.height = Math.max(1, h * 2);
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(im, 0, 0, c.width, c.height);
            resolve(c.toDataURL("image/png"));
          } catch (e) { resolve(""); }
        };
        im.onerror = function () { resolve(""); };
        im.src = url;
      } catch (e) { resolve(""); }
    });
  }
  function wordBlob(md, opts) {
    opts = opts || {};
    var mdText = String(md || "");
    var html = mdToHTML(mdText, { math: "mathml" });
    var div = document.createElement("div");
    div.innerHTML = html;
    var jobs = [];
    /* 图片：转成内联 data URL（Word 不认 IndexedDB） */
    Array.prototype.forEach.call(div.querySelectorAll("img[data-ymimg]"), function (im) {
      jobs.push(imgGet(im.getAttribute("data-ymimg")).then(function (u) { if (u) im.src = u; }));
    });
    /* 图：SVG → PNG */
    Array.prototype.forEach.call(div.querySelectorAll("svg.ymfig-svg"), function (sv) {
      var w = +sv.getAttribute("width") || 720, h = +sv.getAttribute("height") || 360;
      var code = new XMLSerializer().serializeToString(sv);
      jobs.push(svgToPng(code, w, h).then(function (png) {
        if (!png) return;
        var im = document.createElement("img");
        im.src = png; im.width = w; im.height = h;
        sv.parentNode.replaceChild(im, sv);
      }));
    });
    return Promise.all(jobs).then(function () {
      var body = div.innerHTML;
      var css = "body{font-family:SimSun,serif;font-size:12pt;line-height:1.8;color:#111}h1{font-size:18pt;text-align:center}h2{font-size:15pt;font-family:SimHei,sans-serif;margin-top:18pt}h3{font-size:13pt;font-family:SimHei,sans-serif}table{border-collapse:collapse;width:100%;font-size:10.5pt}th,td{border-top:1px solid #000;border-bottom:1px solid #000;padding:4px 8px}th{border-top:1.6pt solid #000;border-bottom:.8pt solid #000}table{border-bottom:1.6pt solid #000}figure{margin:12pt 0;text-align:center}figcaption{font-size:10.5pt;color:#333}.ym-math-err,.ym-math-src{color:#b42318}.ym-footnotes{font-size:10pt;color:#444}";
      var full = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"><title>研墨导出</title><style>' + css + "</style></head><body>" + body + "</body></html>";
      return new Blob(["\ufeff", full], { type: "application/msword;charset=utf-8" });
    });
  }

  /* ================= 9) ZIP（store，无压缩）：LaTeX 图片包 ================= */
  function crc32(u8) {
    var table = crc32.table || (crc32.table = (function () {
      var t = [], c, k, n;
      for (n = 0; n < 256; n++) {
        c = n;
        for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipFiles(files) {
    var enc = new TextEncoder(), names = Object.keys(files || {});
    var parts = [], central = [], offset = 0;
    names.forEach(function (name) {
      var raw = files[name];
      var data = typeof raw === "string" ? enc.encode(raw) : (raw instanceof Uint8Array ? raw : new Uint8Array(raw));
      var nameU8 = enc.encode(name), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameU8.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nameU8, data);
      central.push({ name: nameU8, crc: crc, size: data.length, off: offset });
      offset += 30 + nameU8.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (e) {
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
      ch.setUint32(16, e.crc, true); ch.setUint32(20, e.size, true); ch.setUint32(24, e.size, true);
      ch.setUint16(28, e.name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
      ch.setUint32(42, e.off, true);
      cdSize += 46 + e.name.length;
      parts.push(ch.buffer, e.name);
    });
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, central.length, true); eocd.setUint16(10, central.length, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, cdStart, true); eocd.setUint16(20, 0, true);
    parts.push(eocd.buffer);
    var total = parts.reduce(function (a, p0) { return a + p0.byteLength; }, 0);
    var out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p0) { out.set(new Uint8Array(p0), pos); pos += p0.byteLength; });
    return out;
  }

  window.YMMd = {
    mdToHTML: mdToHTML,
    render: render,
    flowSVG: flowSVG,
    flowParse: flowParse,
    chartSVG: chartSVG,
    wordBlob: wordBlob,
    hydrateImages: hydrateImages,
    countFigs: countFigs,
    prepareImageSections: prepareImageSections,
    spliceImages: spliceImages,
    dataUrlBytes: dataUrlBytes,
    images: { put: imgPut, get: imgGet, list: imgList }
  };
  window.YMZip = { build: zipFiles };

  /* 让全局 mdRender（wb.js）/ setMD 用上增强渲染；缺失时保持原样 */
  if (typeof window.mdRender === "function") {
    var oldRender = window.mdRender;
    window.mdRender = function (t) {
      try { return mdToHTML(t); } catch (e) { return oldRender(t); }
    };
  }
  /* 注意：不再包装 setMD —— 只替换 mdRender，让 wb.js 的 setMD（以及 wq-ui 的引用增强包装）
     继续按原链路执行；否则会绕过引用增强与文末参考文献。 */
})();

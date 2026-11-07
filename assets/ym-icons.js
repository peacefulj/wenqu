/* 研墨 · 线性图标 ym-icons.js（v1.4 新增）
 * 用自绘 SVG 替换界面里的 emoji，不引入任何外部依赖。
 * 用法：脚本加载后自动扫描页面文本节点；遇到内置 emoji 就换成同义的线性图标。
 * 用户内容（草稿、AI 输出、参考文献、导图正文）不替换，避免改动正文。
 */
(function () {
  "use strict";
  var P = {
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.6 4.6L8.5 15.5l2.6-4.6 4.4-2.4z"/>',
    toolbox: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V5z"/><path d="M8 3v18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 14h9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/>',
    basket: '<path d="M4 9h16l-2 11H6L4 9z"/><path d="M8 9a4 4 0 0 1 8 0M8 13v4M12 13v4M16 13v4"/>',
    rocket: '<path d="M12 2c4 3 6 7 6 11l-3 3H9l-3-3c0-4 2-8 6-11z"/><circle cx="12" cy="9" r="2"/><path d="m9 17-2 4 5-2 5 2-2-4"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    scroll: '<path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    file: '<path d="M6 2h8l4 4v16H6V2z"/><path d="M14 2v4h4M9 12h6M9 16h6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    flow: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M9 5.5h4a2 2 0 0 1 2 2v8.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 2l8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>',
    save: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/><path d="M10 10v7M14 10v7"/>',
    star: '<path d="m12 3 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9z"/>',
    warn: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5M12 18h.01"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    comment: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V5a2 2 0 0 1 2-2h12a4 4 0 0 1 4 4z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sparkles: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
    paperclip: '<path d="M21 11.5 12 20.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6M12 12h9"/>',
    scale: '<path d="M12 3v18M5 7h14"/><path d="m5 7-3 7h6L5 7zM19 7l-3 7h6l-3-7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>'
  };
  /* emoji → 图标名（同一图标的多种写法都列上） */
  var MAP = {
    "⚡": "bolt", "🚀": "rocket", "💡": "bulb", "✨": "sparkles", "🌟": "sparkles",
    "🧭": "compass", "🧰": "toolbox", "🗺": "map", "🔍": "search", "🔎": "search",
    "📖": "book", "🔗": "link", "📝": "pen", "✒": "pen", "🎨": "pen", "🖊": "pen",
    "🧪": "flask", "🔬": "flask", "⚙": "settings", "🧺": "basket", "✅": "check", "✔": "check", "✓": "check",
    "✖": "x", "✕": "x", "❌": "x", "🔄": "refresh", "↻": "refresh", "🔁": "refresh",
    "⤓": "download", "⬇": "download", "📥": "download", "⤒": "upload", "⬆": "upload",
    "📜": "scroll", "📂": "folder", "📁": "folder", "🗂": "folder", "📚": "book", "📖": "book", "📓": "book", "📄": "file", "📑": "file", "🧾": "file",
    "📊": "chart", "📈": "chart", "🖼": "image", "🌪": "flow", "🛠": "toolbox", "🧱": "grid",
    "🔒": "lock", "👁": "eye", "👨‍🏫": "user", "🛡": "shield", "💾": "save", "📋": "copy",
    "🗑": "trash", "⭐": "star", "☆": "star", "⚠": "warn", "✉": "mail", "💬": "comment",
    "🎯": "target", "🏠": "home", "🗄": "database", "🕓": "clock", "🕒": "clock",
    "📎": "paperclip", "📡": "radar", "⚖": "scale", "➕": "plus", "＋": "plus",
    "🔖": "star", "🧠": "sparkles", "🧩": "layers", "🔧": "settings", "🧮": "chart"
  };
  var esc = function (s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function svg(name, cls) {
    var d = P[name] || P.sparkles;
    return '<svg class="' + esc(cls || "ymico-svg") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + "</svg>";
  }
  function iconHTML(name, cls) { return '<span class="ymico">' + svg(name, cls) + "</span>"; }
  /* 把 emoji 与变体选择符拆开，避免残留不可见字符 */
  var keys = [];
  Object.keys(MAP).forEach(function (k) {
    keys.push(k);
    if (/[\u2600-\u27BF\u2B00-\u2BFF]/.test(k)) keys.push(k + "\uFE0F");
  });
  keys.sort(function (a, b) { return b.length - a.length; });
  var reEsc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
  var RE = new RegExp(keys.map(reEsc).join("|"), "g");
  var SKIP = "script,style,textarea,input,select,option,pre,code,.mdr,.paper,.aiout,.wbpara,.vdetail,.disc,.refrow,.refappendix,#toast,.streampre,.mbody,.fvread,.mtraillist,.trailnote,.ymico,.keep-emoji";
  function enhance(root) {
    if (!root || !root.querySelectorAll) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        var v = n.nodeValue || "";
        RE.lastIndex = 0;
        if (!RE.test(v)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var hit = [];
    while (walker.nextNode()) hit.push(walker.currentNode);
    hit.forEach(function (t) {
      var v = t.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      RE.lastIndex = 0;
      while ((m = RE.exec(v))) {
        if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
        var key = m[0].replace(/\uFE0F/g, "");
        var name = MAP[m[0]] || MAP[key] || "sparkles";
        var span = document.createElement("span");
        span.className = "ymico";
        span.innerHTML = svg(name);
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
      if (t.parentNode) t.parentNode.replaceChild(frag, t);
    });
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      pending = false;
      enhance(document.body);
    });
  }
  function boot() {
    enhance(document.body);
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (mut) {
      for (var i = 0; i < mut.length; i++) {
        if (mut[i].addedNodes && mut[i].addedNodes.length) { schedule(); return; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  window.YMIcon = { svg: svg, html: iconHTML, enhance: enhance, map: MAP, icons: P };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

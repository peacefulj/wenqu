/* 萤算科研 · 零依赖 PPTX 生成器 wq-pptx.js
 * v1.0（2026-10-17）：学术答辩版式（16:9，封面+章节要点页+结尾页），真实 .pptx 文件（OOXML）。
 * 用法：WQPptx.build([{t:"标题", b:["要点","要点"], sub:"副题"}, ...], {title:"论文题目", author:"姓名"})
 *      → 返回 Promise<Blob>。 MIT 风格自研，无第三方依赖。
 */
(function () {
  "use strict";
  var EMU_W = 12192000, EMU_H = 6858000; // 16:9
  function esc(x) {
    return String(x == null ? "" : x).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  /* ---------- 静态部件 ---------- */
  var CONTENT_TYPES = function (nSlides) {
    var ov = "";
    for (var i = 1; i <= nSlides; i++) {
      ov += '<Override PartName="/ppt/slides/slide' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      ov +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
  };
  var ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';
  var CORE = function (title) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(title || "答辩演示") + '</dc:title><dc:creator>萤算科研</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, "Z") + '</dcterms:created>' +
      '</cp:coreProperties>';
  };
  var APP = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>萤算科研</Application><PresentationFormat>宽屏</PresentationFormat></Properties>';
  var PRESENTATION = function (nSlides) {
    var ids = "";
    for (var i = 1; i <= nSlides; i++) {
      ids += '<p:sldId id="' + (255 + i) + '" r:id="rId' + (i + 1) + '"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + ids + '</p:sldIdLst>' +
      '<p:sldSz cx="' + EMU_W + '" cy="' + EMU_H + '"/><p:notesSz cx="6858000" cy="9144000"/>' +
      '</p:presentation>';
  };
  var PRESENTATION_RELS = function (nSlides) {
    var rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>';
    for (var i = 1; i <= nSlides; i++) {
      rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + i + '.xml"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>';
  };
  var THEME = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="萤算学术">' +
    '<a:themeElements>' +
    '<a:clrScheme name="学术"><a:dk1><a:srgbClr val="1B2434"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="37465C"/></a:dk2><a:lt2><a:srgbClr val="F6F8FC"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="2456E6"/></a:accent1><a:accent2><a:srgbClr val="0A7A43"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="7A3FA8"/></a:accent3><a:accent4><a:srgbClr val="B42318"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="0A7A43"/></a:accent5><a:accent6><a:srgbClr val="2456E6"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="2456E6"/></a:hlink><a:folHlink><a:srgbClr val="7A3FA8"/></a:folHlink></a:clrScheme>' +
    '<a:fontScheme name="学术"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="学术">' +
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:tint val="30000"/></a:schemeClr></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln><a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill><a:prstDash dash="solid"/></a:ln>' +
    '<a:ln><a:solidFill><a:schemeClr val="phClr"><a:tint val="30000"/></a:schemeClr></a:solidFill><a:prstDash dash="dash"/></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst>' +
    '</a:fmtScheme></a:themeElements></a:theme>';
  var MASTER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '</p:spTree></p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
  var MASTER_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
    '</Relationships>';
  var LAYOUT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
    '<p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  var SLIDE_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    '</Relationships>';
  /* ---------- 幻灯片 ---------- */
  function textbox(id, x, y, cx, cy, paras, opts) {
    opts = opts || {};
    var body = "";
    (paras || []).forEach(function (p0) {
      body += '<a:p><a:pPr' + (opts.bullet ? '><a:buClr><a:srgbClr val="2456E6"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>' : '><a:buNone/>') + '</a:pPr>';
      body += '<a:r><a:rPr lang="zh-CN" sz="' + (p0.sz || opts.sz || 1800) + '"' + (p0.b ? ' b="1"' : '') + '><a:solidFill><a:srgbClr val="' + (p0.color || opts.color || "1B2434") + '"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="微软雅黑"/></a:rPr>';
      body += '<a:t>' + esc(p0.t) + '</a:t></a:r></a:p>';
    });
    if (!body) body = '<a:p><a:endParaRPr lang="zh-CN"/></a:p>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="tb' + id + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" anchor="' + (opts.anchor || "t") + '"><a:normAutofit fontScale="92500" lnSpcReduction="10000"/></a:bodyPr><a:lstStyle/>' + body + '</p:txBody></p:sp>';
  }
  var accentBar = '<p:sp><p:nvSpPr><p:cNvPr id="90" name="bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="1828800" cy="76200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="2456E6"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
  function slideXml(slide, idx, total) {
    var boxes = "";
    if (idx === 0 && slide.cover) {
      boxes += textbox(2, 1143000, 2286000, 9906000, 1600200,
        [{ t: slide.t, sz: 4000, b: true, color: "1B2434" }], { anchor: "ctr" });
      boxes += textbox(3, 1143000, 4000500, 9906000, 800100,
        [{ t: slide.sub || "", sz: 1800, color: "5C6675" }], { anchor: "t" });
      boxes += textbox(4, 1143000, 5715000, 9906000, 457200,
        [{ t: "萤算科研 · 文渠工作台 生成", sz: 1200, color: "9AA4B2" }], { anchor: "t" });
    } else {
      boxes += accentBar;
      boxes += textbox(2, 838200, 596900, 10515600, 1143000,
        [{ t: slide.t, sz: 3000, b: true, color: "1B2434" }], { anchor: "t" });
      var bullets = (slide.b || []).map(function (x) { return { t: x, sz: 1800 }; });
      boxes += textbox(3, 838200, 1905000, 10515600, 4191000, bullets, { bullet: true, anchor: "t" });
      boxes += textbox(4, 10668000, 6286500, 1143000, 304800,
        [{ t: idx + " / " + total, sz: 1200, color: "9AA4B2" }], { anchor: "t" });
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      boxes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }
  /* ---------- 组装 ---------- */
  function build(slides, meta) {
    meta = meta || {};
    var list = (slides || []).slice();
    if (!list.length) list = [{ t: "空演示" }];
    list[0].cover = true;
    if (meta.author && !list[0].sub) list[0].sub = "答辩人：" + meta.author;
    var n = list.length;
    var files = {};
    files["[Content_Types].xml"] = CONTENT_TYPES(n);
    files["_rels/.rels"] = ROOT_RELS;
    files["docProps/core.xml"] = CORE(meta.title);
    files["docProps/app.xml"] = APP;
    files["ppt/presentation.xml"] = PRESENTATION(n);
    files["ppt/_rels/presentation.xml.rels"] = PRESENTATION_RELS(n);
    files["ppt/theme/theme1.xml"] = THEME;
    files["ppt/slideMasters/slideMaster1.xml"] = MASTER;
    files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = MASTER_RELS;
    files["ppt/slideLayouts/slideLayout1.xml"] = LAYOUT;
    list.forEach(function (s, i) {
      files["ppt/slides/slide" + (i + 1) + ".xml"] = slideXml(s, i, n);
      files["ppt/slides/_rels/slide" + (i + 1) + ".xml.rels"] = SLIDE_RELS;
    });
    /* 打包（store 即可，pptx 允许；用 DEFLATE 更小——手写 CRC+DEFLATE 太重，改用浏览器压缩流） */
    return zipAsync(files).then(function (u8) {
      return new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    });
  }
  /* ZIP(store，无压缩)：CRC32 手写。pptx 合法但不压缩——体积稍大，可靠优先 */
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
  function zipAsync(files) {
    var names = Object.keys(files);
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    names.forEach(function (name) {
      var data = enc.encode(files[name]);
      var nameU8 = enc.encode(name);
      var crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
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
      ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
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
    return Promise.resolve(out);
  }
  window.WQPptx = { build: build };
})();

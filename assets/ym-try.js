/* 研墨 · 试用与测试页 ym-try.js（v1.2.0 新增）
 * try.html：一键创建演示项目、浏览器能力检测、网络 / AI 接口测试、AI 调试（v1.3.0：格式 / 思考 / 上下文 / 请求记录 / 桌面版调试端口）、
 * 功能自测（assets/ym-selftest.js，与发布前自检同一批用例）、复制检测报告。
 * 只会写入「演示项目」这一个项目（固定 id，重建会覆盖它），不动用户的其他项目；
 * 打开页面时不发任何外部请求——网络和 AI 接口测试要用户点按钮。
 */
(function () {
  "use strict";
  if (!window.WQCore) return;
  const $ = (id) => document.getElementById(id);
  const esc = WQCore.esc;
  const DEMO_ID = "p-yanmo-demo";
  const VER = (window.YANMO && YANMO.version) || "";
  const ICON = { ok: "✓", warn: "⚠", bad: "✗", info: "•" };
  const R = { env: [], net: [], self: [] };   // 检测结果，复制报告时用

  const row = (list, st, name, info) => { list.push({ st: st, name: name, info: info || "" }); };
  function paint(boxId, list) {
    const box = $(boxId); if (!box) return;
    box.innerHTML = list.map(x => `<div class="ck ck-${x.st}"><b>${ICON[x.st]}</b><span class="ckn${x.info ? "" : " wide"}">${esc(x.name)}</span>${x.info ? `<span class="cki">${esc(x.info)}</span>` : ""}</div>`).join("");
  }
  const kchars = (n) => (n >= 10240 ? Math.round(n / 1024) : Math.round(n / 102.4) / 10) + " K 字符";
  const mb = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + " MB");
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return String(u || ""); } };
  function withTimeout(p, ms, what) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error((what || "操作") + "超时（" + Math.round(ms / 1000) + " 秒）")), ms); })]).finally(() => clearTimeout(t));
  }
  function idbOpen(name, stores) {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("浏览器没有 IndexedDB"));
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => stores.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("打开失败"));
      r.onblocked = () => rej(new Error("被其他标签页占用"));
    });
  }
  function browserName(ua) {
    const m = (re) => (ua.match(re) || [])[1] || "";
    let n;
    if (/MicroMessenger/i.test(ua)) n = "微信内置浏览器";
    else if (/Edg\//.test(ua)) n = "Edge " + m(/Edg\/(\d+)/);
    else if (/OPR\//.test(ua)) n = "Opera " + m(/OPR\/(\d+)/);
    else if (/Firefox\//.test(ua)) n = "Firefox " + m(/Firefox\/(\d+)/);
    else if (/QQBrowser/i.test(ua)) n = "QQ 浏览器";
    else if (/360SE|360EE/i.test(ua)) n = "360 浏览器";
    else if (/Chrome\//.test(ua)) n = "Chrome " + m(/Chrome\/(\d+)/);
    else if (/Safari\//.test(ua)) n = "Safari " + m(/Version\/([\d.]+)/);
    else n = "未知浏览器";
    const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
    return n + (os ? " · " + os : "");
  }

  /* ================= 演示项目 ================= */
  function demoProject() {
    const papers = [
      { id: "f-demo-1", title: "Risk Sharing and Transactions Costs: Evidence from Kenya's Mobile Money Revolution", author: "William Jack，Tavneet Suri", authors: ["William Jack", "Tavneet Suri"], year: "2014", venue: "American Economic Review", type: "J", doi: "", abs: "", csl: { volume: "104", issue: "1", page: "183-223" } },
      { id: "f-demo-2", title: "The long-run poverty and gender impacts of mobile money", author: "Tavneet Suri，William Jack", authors: ["Tavneet Suri", "William Jack"], year: "2016", venue: "Science", type: "J", doi: "10.1126/science.aah5309", abs: "", csl: { volume: "354", issue: "6317", page: "1288-1292" } },
      { id: "f-demo-3", title: "数字金融能促进创业吗？——来自中国的证据", author: "谢绚丽，沈艳，张皓星，等", authors: ["谢绚丽", "沈艳", "张皓星", "郭峰"], year: "2018", venue: "经济学（季刊）", type: "J", doi: "", abs: "" },
      { id: "f-demo-4", title: "Mobile Money and Rural Entrepreneurship: A Fictional Demo Paper", author: "YanMo Demo Team", year: "2026", venue: "研墨演示文档（虚构，仅供测试）", type: "R", doi: "",
        abs: "演示用虚构文献：在「全文」列上传试用页提供的示例 PDF（demo-paper.pdf），就能试阅读器、高亮批注和 AI 精读。内容是虚构的，不能引用。", csl: { author: [{ literal: "YanMo Demo Team" }] } }
    ];
    const draft = {
      "引言": [
        "（演示文本，可以随便改：用来试「修改工作台」、版本档案和 Markdown / LaTeX 导出。）",
        "移动支付等数字金融服务降低了交易成本，被认为能帮助家庭分担风险、积累储蓄[1][2]。",
        "国内研究发现，数字金融的发展与创业活动显著相关[3]，但它对农户创业的作用机制仍有争议。",
        "本文用一份**虚构的演示数据**（见文献 [4] 对应的示例 PDF）说明研墨怎样把文献、批注和正文串起来。"
      ].join("\n"),
      "文献综述": [
        "### 移动支付与风险分担",
        "Jack 和 Suri 利用肯尼亚 M-Pesa 的推广，发现使用移动支付的家庭在遭受收入冲击时消费更平稳[1]。",
        "### 长期影响",
        "后续研究发现，移动支付的普及让一部分家庭摆脱了贫困，对女性户主家庭的作用更明显[2]。",
        "- 机制一：降低汇款和转账成本",
        "- 机制二：方便储蓄与小额借贷"
      ].join("\n"),
      "数据与研究设计": [
        "样本是示例 PDF 里虚构的 2,400 户农户（2018—2022 年）。基准模型如下：",
        "$$Entry_{it} = \\alpha + \\beta MM_{it} + \\gamma X_{it} + \\mu_i + \\lambda_t + \\varepsilon_{it}$$",
        "| 变量 | 含义 | 均值 |",
        "| --- | --- | --- |",
        "| Entry | 当年是否新开非农经营 | 0.078 |",
        "| MM | 是否开通移动支付 | 0.46 |"
      ].join("\n"),
      "实证结果": [
        "基准回归中 $\\beta$ 的估计值为 0.031（标准误 0.009），在 1% 水平显著；女性样本的效应更大（0.044）[4]。",
        "以上数字全部来自虚构的示例 PDF，不能引用——这一节用来试 AI 精读的页码标注和导出时的引用编号转换。"
      ].join("\n")
    };
    return {
      id: DEMO_ID, name: "演示项目：新功能试用（可删除）", topic: "移动支付与农户创业（演示）",
      status: "写作中", createdAt: WQCore.localDay(), paradigm: "quant", level: "journal",
      selection: "（演示选题卡，可以随便改）\n研究问题：移动支付等数字金融服务能否促进农户创业？\n创新点：区分男女户主，考察异质性。\n可行性：演示数据是虚构的，只用来熟悉研墨的功能。",
      outline: "1 引言\n2 文献综述\n3 数据与研究设计\n4 实证结果\n5 结论与讨论",
      papers: papers, draft: draft, matrix: "", design: "", outs: {}, versions: [],
      trail: [{ ts: WQCore.stamp(), type: "importT", label: "创建演示项目", note: "来自「试用与测试」页 try.html（v" + VER + "）" }]
    };
  }
  function demoExists() { return WQCore.loadLocal({ peek: true }).projects.some(p => p.id === DEMO_ID); }
  function showDemoState(justMade) {
    const el = $("tryDemoMsg"); if (!el) return;
    if (justMade) el.innerHTML = "✓ 已创建「演示项目：新功能试用」并设为当前项目——点下面各步骤的链接直接打开它。";
    else el.textContent = demoExists() ? "演示项目已经在了（点按钮会把它恢复成初始状态）。" : "还没有演示项目：先点左边的按钮（只新增这一个项目，不会动你已有的项目）。";
  }
  async function createDemo() {
    const db = WQCore.loadLocal();
    if (db.projects.some(p => p.id === DEMO_ID) && !confirm("已经有一个演示项目了。重新创建会把它恢复成初始状态（在演示项目里做的修改、批注会丢失），继续吗？")) return;
    db.projects = db.projects.filter(p => p.id !== DEMO_ID);
    db.projects.unshift(demoProject());
    db.cur = DEMO_ID;
    const r = WQCore.saveLocal(db);
    if (!r.ok) { $("tryDemoMsg").textContent = "保存失败（浏览器存储不可用或已满）：" + ((r.err && r.err.message) || r.err); return; }
    /* 旧演示项目上传过的 PDF 一并清掉（存在 yanmo-files/pdfs，键为「项目id/文献id」） */
    try {
      const d = await idbOpen("yanmo-files", ["pdfs", "handles"]);
      await new Promise((res) => { const t = d.transaction("pdfs", "readwrite"); t.objectStore("pdfs").delete(IDBKeyRange.bound(DEMO_ID + "/", DEMO_ID + "0", false, true)); t.oncomplete = res; t.onerror = res; });
      d.close();
    } catch (e) {}
    showDemoState(true);
  }

  /* ================= 浏览器检测（打开页面时自动跑，不联网） ================= */
  let pdfLibP = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfLibP) pdfLibP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "assets/vendor/pdf.min.js";
      s.onload = () => (window.pdfjsLib ? res(window.pdfjsLib) : rej(new Error("pdf.js 没有加载")));
      s.onerror = () => { pdfLibP = null; rej(new Error("assets/vendor/pdf.min.js 加载失败")); };
      document.head.appendChild(s);
    });
    return pdfLibP;
  }
  async function pdfProbe() {
    const lib = await loadPdfJs();
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdf.worker.min.js";
    const resp = await fetch("assets/demo/demo-paper.pdf");
    if (!resp.ok) throw new Error("示例 PDF 下载失败（HTTP " + resp.status + "）");
    const doc = await lib.getDocument({ data: new Uint8Array(await resp.arrayBuffer()) }).promise;
    let chars = 0;
    for (let i = 1; i <= doc.numPages; i++) chars += (await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join("").length;
    const pages = doc.numPages;
    doc.destroy();
    return { pages: pages, chars: chars };
  }
  async function envChecks() {
    const L = R.env = [];
    const ua = navigator.userAgent;
    const inApp = /MicroMessenger|\bQQ\/|Weibo|DingTalk|Lark|Feishu|ZhihuHybrid|xiaohongshu|XHS/i.test(ua);
    row(L, inApp ? "warn" : "ok", "浏览器", browserName(ua) + (inApp ? " · App 内置浏览器里下载文件、本地同步可能用不了，建议点右上角「在浏览器中打开」" : ""));
    row(L, window.isSecureContext ? "ok" : "warn", "安全连接（HTTPS）", window.isSecureContext ? "是" : "否——离线缓存、本地同步、剪贴板等功能不可用，请用 https 地址打开");
    try {
      localStorage.setItem("ym_try_probe", "1"); localStorage.removeItem("ym_try_probe");
      const raw = localStorage.getItem("wenqu_studio") || "";
      const n = WQCore.loadLocal({ peek: true }).projects.length;
      row(L, raw.length > 4200000 ? "warn" : "ok", "本机存储（localStorage）", "可用 · 项目库 " + n + " 个项目，约 " + kchars(raw.length) + "（浏览器上限约 5000 K 字符" + (raw.length > 4200000 ? "，快满了，长版本会自动归档到 IndexedDB" : "") + "）");
    } catch (e) { row(L, "bad", "本机存储（localStorage）", "不可用（隐私模式或被禁用）：" + e.message + "——项目无法保存"); }
    try {
      const d = await withTimeout(idbOpen("yanmo-try-probe", ["t"]), 8000, "IndexedDB");
      await new Promise((res, rej) => { const t = d.transaction("t", "readwrite"); t.objectStore("t").put(new Blob(["ok"]), "k"); t.oncomplete = res; t.onerror = () => rej(t.error); });
      d.close(); try { indexedDB.deleteDatabase("yanmo-try-probe"); } catch (e) {}
      row(L, "ok", "IndexedDB", "可用（上传的 PDF、归档的长版本、本地同步的文件记录都存在这里）");
    } catch (e) { row(L, "bad", "IndexedDB", "不可用：" + e.message + "——PDF 上传和版本归档用不了"); }
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        const small = e.quota && e.quota < 200 * 1048576;
        row(L, small ? "warn" : "ok", "存储空间", "已用 " + mb(e.usage || 0) + "，可用上限约 " + mb(e.quota || 0) + (small ? "（偏小，PDF 多了可能存不下）" : "") + (persisted ? " · 已设为持久存储" : " · 浏览器空间紧张时可能清理站点数据，记得备份或开启本地同步"));
      } catch (e) { row(L, "info", "存储空间", "读不到：" + e.message); }
    }
    if (!("serviceWorker" in navigator)) row(L, "warn", "离线缓存（Service Worker）", "当前浏览器不支持，断网时打不开");
    else if (location.protocol === "file:") row(L, "warn", "离线缓存（Service Worker）", "直接打开本地文件时不可用，请用 http(s) 访问");
    else {
      try {
        const keys = (await caches.keys()).filter(k => /^(yanmo|wenqu)-v/.test(k));
        const mine = keys.find(k => k === "yanmo-v" + VER);
        if (navigator.serviceWorker.controller && mine) row(L, "ok", "离线缓存（Service Worker）", "已启用：" + mine + "，" + (await (await caches.open(mine)).keys()).length + " 个文件，断网也能打开");
        else if (navigator.serviceWorker.controller) row(L, "info", "离线缓存（Service Worker）", "新版本缓存还在下载（现有：" + (keys.join("、") || "无") + "），稍后刷新");
        else row(L, "info", "离线缓存（Service Worker）", "第一次打开，正在安装，刷新一次后生效");
      } catch (e) { row(L, "warn", "离线缓存（Service Worker）", "检测失败：" + e.message); }
    }
    const fsa = typeof window.showSaveFilePicker === "function";
    row(L, fsa ? "ok" : "warn", "本地同步（File System Access）", fsa ? "支持：可以在工作台左侧「🔄 开启本地同步」" : "当前浏览器不支持（需要电脑上的 Chrome / Edge），可以用「⤓ 备份全部」代替");
    try {
      const info = await withTimeout(pdfProbe(), 20000, "PDF 解析");
      row(L, info.chars > 100 ? "ok" : "warn", "PDF 阅读（pdf.js）", "示例 PDF 解析正常：" + info.pages + " 页，提取到 " + info.chars + " 个字符");
    } catch (e) { row(L, "bad", "PDF 阅读（pdf.js）", "失败：" + e.message + "——PDF 阅读器用不了"); }
    try {
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yanmo"));
      row(L, "ok", "SHA-256", "可用（项目轨迹、证据链的哈希校验）");
    } catch (e) { row(L, "warn", "SHA-256", "不可用（需要 HTTPS），证据链哈希会跳过"); }
    row(L, navigator.clipboard && navigator.clipboard.writeText ? "ok" : "warn", "剪贴板", navigator.clipboard && navigator.clipboard.writeText ? "可用（复制引用、GB/T 参考文献表）" : "不可用，复制按钮会提示手动复制");
    const c = WQCore.ai.conf();
    if (c.key) row(L, "ok", "AI 接口设置", "已配置 Key" + (c.sessionKey ? "（只在本次会话有效）" : "（保存在本机）") + " · " + hostOf(c.base) + " · 模型 " + (c.model || "默认"));
    else row(L, "info", "AI 接口设置", "还没配置 Key：检索、导入导出、PDF 批注、Markdown / LaTeX 导出都不需要；AI 精读、参考稿要在工作台页头「⚙️ AI / 接口设置」里填");
    const bw = WQCore.ai.baseWarning(c.base);
    if (bw) row(L, "warn", "AI 接口地址", bw);
    paint("tryEnv", L);
  }

  /* ================= 网络 / AI 接口测试（点按钮才跑） ================= */
  async function timed(url) {
    const t0 = performance.now(), ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
    try { const r = await fetch(url, { signal: ctl.signal }); return { ok: r.ok, ms: Math.round(performance.now() - t0), err: r.ok ? "" : "HTTP " + r.status }; }
    catch (e) { return { ok: false, err: e && e.name === "AbortError" ? "12 秒内没有响应" : ((e && e.message) || String(e)) }; }
    finally { clearTimeout(tm); }
  }
  async function netTests() {
    const btn = $("tryNet"); btn.disabled = true;
    const L = R.net = R.net.filter(x => /^AI/.test(x.name));
    $("tryNetMsg").textContent = "测试中…";
    for (const [name, url] of [
      ["OpenAlex（文献检索、补摘要）", "https://api.openalex.org/works?search=mobile%20money&per-page=1&select=id"],
      ["Crossref（引用核验、DOI 题录）", "https://api.crossref.org/works?query=mobile%20money&rows=1&select=DOI"]
    ]) {
      const r = await timed(url);
      row(L, r.ok ? (r.ms > 5000 ? "warn" : "ok") : "bad", name, r.ok ? "连通 · " + r.ms + " ms" + (r.ms > 5000 ? "（较慢）" : "") : "连不上：" + r.err + "——检索、补摘要会失败，稍后再试或换个网络");
    }
    paint("tryNetOut", L); $("tryNetMsg").textContent = ""; btn.disabled = false;
  }
  async function aiTest() {
    const btn = $("tryAI"), c = WQCore.ai.conf();
    const L = R.net = R.net.filter(x => !/^AI/.test(x.name));
    if (!c.key) { row(L, "info", "AI 接口", "还没配置 Key：先到工作台页头「⚙️ AI / 接口设置」填写，再回来测试"); paint("tryNetOut", L); return; }
    btn.disabled = true; $("tryNetMsg").textContent = "正在读取模型列表…";
    const t0 = performance.now();
    try {
      const r = await withTimeout(WQCore.ai.probeModels(c.base, c.key), 20000, "读取模型列表");
      const ms = Math.round(performance.now() - t0), has = !c.model || r.list.indexOf(c.model) >= 0;
      row(L, has ? "ok" : "warn", "AI 接口（" + hostOf(c.base) + "）", "连通 · " + ms + " ms · 可用模型 " + r.list.length + " 个" + (c.model ? (has ? "，包含你设置的「" + c.model + "」" : "，没找到你设置的「" + c.model + "」——名称可能写错，或这个服务商没有该模型") : ""));
    } catch (e) {
      row(L, "bad", "AI 接口（" + hostOf(c.base) + "）", "失败：" + e.message + "——检查 Key 和接口地址；有的服务商不开放模型列表，可以直接在工作台试一次 AI 功能");
    }
    paint("tryNetOut", L); $("tryNetMsg").textContent = ""; btn.disabled = false;
  }

  /* ================= AI 调试（v1.3.0） ================= */
  const fmtTime = (t) => String(t || "").replace("T", " ").slice(5, 19);
  const kt = (n) => (n >= 1000 ? Math.round(n / 100) / 10 + "K" : String(n || 0));
  function thinkParam(f, on) {
    return { thinking: "发送 thinking: " + (on ? "enabled" : "disabled"), enable_thinking: "发送 enable_thinking: " + on, anthropic: "发送 thinking: " + (on ? "enabled" : "disabled"),
      openai_reasoning: on ? "reasoning_effort 用服务商默认" : "发送 reasoning_effort: low" }[f] || "这种格式不发思考参数";
  }
  function aiCfgRows() {
    const c = WQCore.ai.conf(), f = WQCore.ai.format(c), L = [];
    row(L, "info", "接口格式", (c.format && c.format !== "auto" ? "手动选择：" : "自动识别 → ") + WQCore.ai.formatName(f));
    row(L, c.key ? "info" : "warn", "请求地址", c.key ? hostOf(c.base) + "（" + (f === "anthropic" ? "/v1/messages" : "/chat/completions") + "）· 模型 " + (c.model || "默认") : "还没配置 Key");
    row(L, c.thinking ? "warn" : "ok", "思考模式", (c.thinking ? "开：更慢、更费 token；思考 token 算在输出额度里的服务商可能出现正文为空" : "关（默认，更稳）") + " · " + thinkParam(f, !!c.thinking));
    row(L, "info", "上下文上限", Math.round(WQCore.ai.ctxWindow(c) / 1000) + "K token" + (c.ctxK ? "（设置里填的）" : "（自动）") + " · 输入超出时自动从中间压缩；接口报超限时压缩后重试一次");
    const log = WQCore.ai.debugLog(), bad = log.filter(x => x.err).length;
    row(L, bad ? "warn" : "info", "最近请求", log.length ? log.length + " 条，其中失败 " + bad + " 条" : "还没有记录（用过 AI 功能后这里会出现）");
    return L;
  }
  function logRows(n) {
    return WQCore.ai.debugLog().slice(0, n).map(x => {
      const st = x.err ? "bad" : (x.cut || x.retry || x.finish === "length") ? "warn" : "ok";
      const parts = [x.fmt + (x.think ? "·思考开" : ""), x.model, x.status ? "HTTP " + x.status : "", (x.ms / 1000).toFixed(1) + " s",
        (x.inTok || x.outTok) ? "入 " + kt(x.inTok) + " / 出 " + kt(x.outTok) + (x.real === false ? "（估算）" : "") + (x.rTok ? "（含思考 " + kt(x.rTok) + "）" : "") : "",
        x.finish ? "结束：" + x.finish : "", x.cut ? "已压缩约 " + kt(x.cut) + " token" : "", x.retry || ""].filter(Boolean);
      return { st: st, name: fmtTime(x.t) + " · " + x.page, info: parts.join(" · ") + (x.err ? " —— " + x.err : x.ans ? " —— " + x.ans.slice(0, 60) : "") };
    });
  }
  function aiDebugRender() {
    R.ai = aiCfgRows();
    paint("tryAICfg", R.ai);
    const rows = logRows(15);
    if (rows.length) paint("tryDbgLog", rows); else $("tryDbgLog").innerHTML = '<p class="hint" style="margin:8px 12px">还没有记录</p>';
    deskRender();
  }
  async function aiCallTest() {
    const btn = $("tryAICall"), L = R.aiCall = [];
    if (!WQCore.ai.conf().key) { row(L, "info", "AI 调用", "还没配置 Key：先点「⚙️ 调整 AI 设置」填写"); paint("tryAICallOut", L); return; }
    btn.disabled = true; $("tryDbgMsg").textContent = "调用中…";
    const ask = "请只回复两个字母：OK", opt = { max_tokens: 16, temperature: 0, timeout: 60000 };
    for (const [name, fn] of [["流式调用", () => WQCore.ai.stream(ask, opt)], ["非流式调用", () => WQCore.ai.complete(ask, opt)]]) {
      const t0 = performance.now();
      try {
        const r = await fn(), u = r.usage || {};
        row(L, "ok", name, Math.round(performance.now() - t0) + " ms · 回复「" + String(r.text).trim().slice(0, 20) + "」 · " + ((u.inTok || 0) + (u.outTok || 0)) + " token" + (u.real ? "" : "（估算）") + (r.finish ? " · 结束：" + r.finish : ""));
      } catch (e) { row(L, "bad", name, e.message); }
      paint("tryAICallOut", L);
    }
    $("tryDbgMsg").textContent = ""; btn.disabled = false;
    aiDebugRender();
  }
  function debugText() {
    const lines = ["研墨 v" + VER + " AI 调试信息", "时间：" + WQCore.stamp(), "页面：" + location.href.split("#")[0], "UA：" + navigator.userAgent];
    const d = window.YANMO_DESKTOP;
    if (d) lines.push("桌面版：v" + (d.version || "") + " · 调试端口 " + (d.debugPort || "未开启"));
    (R.ai || aiCfgRows()).concat(R.aiCall || []).forEach(x => lines.push(ICON[x.st] + " " + x.name + "：" + x.info));
    lines.push("", "最近请求（新 → 旧，不含 Key）：");
    WQCore.ai.debugLog().slice(0, 20).forEach(x => lines.push(JSON.stringify(x)));
    return lines.join("\n");
  }
  /* 桌面版（exe）：显示调试端口状态，可在这里开关（写数据目录里的 debug-port.txt，重启后生效） */
  function deskRender() {
    const d = window.YANMO_DESKTOP, box = $("tryDesk");
    if (!d || !(window.chrome && chrome.webview)) { box.hidden = true; return; }
    box.hidden = false;
    $("tryDeskInfo").textContent = "桌面版 v" + (d.version || "") + " · 调试端口：" + (d.debugPort ? "已开启（127.0.0.1:" + d.debugPort + "，窗口标题会注明）" : "未开启") + (d.pending ? " · " + d.pending : "");
    $("tryDeskDbg").textContent = d.debugFile ? "关闭调试端口（重启研墨后生效）" : "开启调试端口（重启研墨后生效）";
    $("tryDeskDbg").title = "调试端口只监听本机（127.0.0.1），开着时本机的其他程序可以连上研墨查看页面和数据（包括 Key），排查完问题建议关掉";
  }
  if (window.chrome && chrome.webview) {
    chrome.webview.addEventListener("message", (e) => {
      const m = String(e.data || ""), d = window.YANMO_DESKTOP;
      if (m.indexOf("debug:") !== 0 || !d) return;
      if (m.indexOf("debug:status:") === 0) { const p = m.split(":"); d.debugPort = +p[2] || 0; d.debugFile = p[3] === "1"; }
      else if (m === "debug:on:ok" || m === "debug:off:ok") { d.debugFile = m === "debug:on:ok"; d.pending = (d.debugFile ? "已开启" : "已关闭") + "，重启研墨后生效"; }
      else d.pending = "设置失败：" + m.replace(/^debug:(on|off):/, "");
      deskRender();
    });
    if (window.YANMO_DESKTOP) chrome.webview.postMessage("debug:status");
  }

  /* ================= 功能自测 ================= */
  async function selfTest() {
    const btn = $("trySelf"); btn.disabled = true; $("trySelfSum").textContent = "运行中…";
    const samples = {};
    for (const [k, f] of [["bib", "sample.bib"], ["ris", "sample.ris"], ["csl", "sample-csl.json"]]) {
      try { const r = await fetch("assets/demo/" + f); if (r.ok) samples[k] = await r.text(); } catch (e) {}
    }
    let res;
    try {
      if (!window.YMSelfTest || !window.YMBib || !window.YMExport) throw new Error("自测脚本没有加载完整");
      res = YMSelfTest.run(YMBib, YMExport, samples, window.YMAI);
    } catch (e) { res = [{ name: "运行自测", ok: false, detail: e.message }]; }
    R.self = res.map(x => ({ st: x.ok ? "ok" : "bad", name: x.name, info: x.ok ? "" : String(x.detail).slice(0, 300) }));
    paint("trySelfOut", R.self);
    const bad = res.filter(x => !x.ok).length;
    $("trySelfSum").textContent = bad ? "✗ " + bad + " 项未通过（共 " + res.length + " 项）——请复制检测报告反馈给我们" : "✓ 全部 " + res.length + " 项通过";
    btn.disabled = false;
  }

  /* ================= 报告与反馈 ================= */
  function report() {
    const sec = (title, list) => list.length ? "\n\n[" + title + "]\n" + list.map(x => ICON[x.st] + " " + x.name + (x.info ? "：" + x.info : "")).join("\n") : "";
    return "研墨 v" + VER + " 试用与测试报告\n时间：" + WQCore.stamp() + "\n页面：" + location.href.split("#")[0] + "\nUA：" + navigator.userAgent +
      sec("浏览器检测", R.env) + sec("网络 / AI 接口", R.net) + sec("AI 调试", (R.ai || []).concat(R.aiCall || [])) + sec("功能自测", R.self) + "\n";
  }
  function clip(text, msgId, okText) {
    const done = () => { $(msgId).textContent = okText; };
    const fallback = () => {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { $(msgId).textContent = "浏览器不允许复制，请手动选择下面的文字"; }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function copyReport() {
    const text = report();
    clip(text, "tryCopyMsg", "已复制 ✓ 可以粘贴到反馈里");
    $("tryReport").textContent = text; $("tryReport").hidden = false;
  }
  function issueLink(e) {
    const body = "（请写一下遇到的问题、操作步骤；下面是自动生成的检测报告，可以删掉不想公开的部分）\n\n" + report().slice(0, 3500);
    e.currentTarget.href = "https://github.com/peacefulj/wenqu/issues/new?title=" + encodeURIComponent("[试用反馈] v" + VER + " · " + browserName(navigator.userAgent)) + "&body=" + encodeURIComponent(body);
  }

  /* ================= 绑定 ================= */
  $("tryDemo").addEventListener("click", createDemo);
  $("tryNet").addEventListener("click", netTests);
  $("tryAI").addEventListener("click", aiTest);
  $("trySelf").addEventListener("click", selfTest);
  $("tryCopy").addEventListener("click", copyReport);
  $("tryIssue").addEventListener("click", issueLink);
  $("tryAICall").addEventListener("click", aiCallTest);
  $("tryDbgCopy").addEventListener("click", () => clip(debugText(), "tryDbgMsg", "已复制 ✓（不含 Key）"));
  $("tryDbgClear").addEventListener("click", () => { WQCore.ai.debugClear(); R.aiCall = []; paint("tryAICallOut", []); aiDebugRender(); $("tryDbgMsg").textContent = "已清空"; });
  $("tryDeskDbg").addEventListener("click", () => { const d = window.YANMO_DESKTOP; if (d && window.chrome && chrome.webview) chrome.webview.postMessage(d.debugFile ? "debug:off" : "debug:on"); });
  addEventListener("storage", (e) => { if (e.key === "yanmo_ai_debug") aiDebugRender(); });
  showDemoState(false);
  aiDebugRender();
  envChecks().then(selfTest, selfTest);
  window.YMTry = { demoProject: demoProject, createDemo: createDemo, report: report, results: R, debugText: debugText };
})();

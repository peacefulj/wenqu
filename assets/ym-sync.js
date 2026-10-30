/* 研墨 · 本地同步文件 ym-sync.js（v1.1.0 新增）
 * 用 File System Access API 把项目库自动写进你选的一个本机 .json 文件（可放在坚果云 / OneDrive 等网盘目录）。
 * 文件内容与「⤓ 备份全部」相同（含归档的版本正文），可直接「⤒ 导入备份」恢复；MCP 服务（mcp/yanmo-mcp.mjs）读的也是它。
 * - 只有 Chromium 内核浏览器（Chrome / Edge 等）支持；文件句柄存在 IndexedDB「yanmo-files」/handles（与 ym-pdf.js 同库）。
 * - 浏览器的安全限制：重新打开页面后要点一下「继续同步」授权才能写。
 * - 防覆盖：每次写之前看文件是否在别处被改过（另一台电脑 / 另一个浏览器），改过就暂停，让你选择导入还是覆盖。
 * 所有页面都可以加载：页面里有 #ymSyncBox 时显示控制面板，没有时只在已授权的情况下后台写入。
 */
(function () {
  "use strict";
  if (!window.WQCore || !window.WQStore) return;
  const SUPPORTED = typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function";
  const LS_META = "ym_sync_meta";
  const TYPES = [{ description: "研墨同步文件", accept: { "application/json": [".json"] } }];
  const $ = (id) => document.getElementById(id);
  const esc = WQCore.esc;
  const notice = (t, lines) => (window.wqNotice ? wqNotice(t, lines) : alert(t));
  const tip = (t) => (window.toast ? toast(t) : console.log("[研墨同步] " + t));
  const choose = (t, lines, acts) => (window.wqChoose ? wqChoose(t, lines, acts) : Promise.resolve(confirm(t + "\n" + lines.join("\n")) ? acts[0].key : null));

  /* ---------- IndexedDB「yanmo-files」（结构必须与 ym-pdf.js 一致） ---------- */
  let dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no-idb"));
      const r = indexedDB.open("yanmo-files", 1);
      r.onupgradeneeded = () => { const d = r.result; ["pdfs", "handles"].forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("idb-open-fail"));
    });
    dbP.catch(() => { dbP = null; });
    return dbP;
  }
  function hx(mode, fn) {
    return idb().then(d => new Promise((res, rej) => {
      const t = d.transaction("handles", mode), out = fn(t.objectStore("handles"));
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    }));
  }
  const getHandle = () => hx("readonly", s => s.get("sync"));
  const putHandle = (h) => hx("readwrite", s => s.put(h, "sync"));
  const delHandle = () => hx("readwrite", s => s.delete("sync"));

  /* ---------- 元数据：上次写入后文件的修改时间与内容指纹（同一浏览器的多个标签页共用） ---------- */
  const readMeta = () => { try { return JSON.parse(localStorage.getItem(LS_META) || "{}") || {}; } catch (e) { return {}; } };
  const writeMeta = (m) => { try { localStorage.setItem(LS_META, JSON.stringify(m)); } catch (e) {} };
  function fp(s) {   // FNV-1a + 长度，只用来判断「文件是不是我上次写的那份」
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) + ":" + s.length;
  }

  /* ---------- 状态 ---------- */
  /* unsupported 不支持 · none 未开启 · perm 待授权 · on 同步中 · conflict 文件在别处被改过 · err 写入失败 */
  const S = { state: SUPPORTED ? "none" : "unsupported", handle: null, timer: null, firstAt: 0, writing: false, again: false, err: "" };
  function setState(st, err) { S.state = st; S.err = err || ""; render(); }

  async function writeNow(force) {
    if (!S.handle || (S.state !== "on" && !force)) return false;
    if (S.writing) { S.again = true; return false; }
    clearTimeout(S.timer); S.timer = null; S.firstAt = 0;
    S.writing = true;
    try {
      const meta = readMeta();
      if (!force) {
        /* 文件非空，且不是本浏览器上次写的那份（或本机没有写入记录，比如清过浏览器数据）→ 暂停，让用户决定 */
        const f0 = await S.handle.getFile();
        if (f0.size && (!meta.mod || (f0.lastModified !== meta.mod && fp(await f0.text()) !== meta.fp))) { setState("conflict"); return false; }
      }
      const bk = await WQCore.buildBackup();   // 不传 db：取 localStorage 里最新的全量（含其他标签页刚保存的修改）
      if (!bk.projects.length && !force) return false;   // 本机是空库时不自动写，免得把同步文件清空
      const text = JSON.stringify(bk);
      const w = await S.handle.createWritable();
      await w.write(text);
      await w.close();
      const f1 = await S.handle.getFile();
      writeMeta({ name: S.handle.name, mod: f1.lastModified, fp: fp(text), at: Date.now(), projects: bk.projects.length });
      try { localStorage.setItem("wenqu_lastBackup", new Date().toISOString()); } catch (e) {}
      try { if (typeof renderBackupHint === "function") renderBackupHint(); } catch (e) {}
      if (S.state !== "on") S.state = "on";
      S.err = "";
      return true;
    } catch (e) {
      const name = e && e.name;
      if (name === "NotAllowedError" || name === "SecurityError") setState("perm");
      else if (name === "NotFoundError") setState("err", "同步文件找不到了（被移动、改名或删除？），请重新选择");
      else setState("err", (e && e.message) || String(e));
      return false;
    } finally {
      S.writing = false;
      render();   // 必须在清掉 writing 之后渲染，否则面板一直停在「写入中…」
      if (S.again) { S.again = false; schedule(1000); }
    }
  }
  /* 防抖 3 秒；一直在改的话最多 30 秒写一次 */
  function schedule(ms) {
    if (S.state !== "on" || !S.handle) return;
    const now = Date.now();
    if (!S.firstAt) S.firstAt = now;
    clearTimeout(S.timer);
    const wait = now - S.firstAt > 30000 ? 0 : (ms == null ? 3000 : ms);
    S.timer = setTimeout(() => { writeNow(false); }, wait);
  }

  /* 所有保存都经过 WQCore.saveLocal → WQStore.mirror：在这里挂钩，三个页面都不用改 */
  (function hook() {
    if (WQStore._ymSync) return;
    const orig = WQStore.mirror;
    WQStore.mirror = function () { const r = orig.apply(this, arguments); schedule(); return r; };
    WQStore._ymSync = true;
  })();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && S.timer) writeNow(false); });

  /* ---------- 开启 / 连接 / 恢复授权 / 解除 ---------- */
  async function bindNew() {
    let h;
    try { h = await window.showSaveFilePicker({ suggestedName: "yanmo-sync.json", types: TYPES }); }
    catch (e) { if (e && e.name !== "AbortError") notice("没能创建同步文件：" + e.message); return; }
    await adopt(h);
  }
  async function bindExisting() {
    let h;
    try { [h] = await window.showOpenFilePicker({ types: TYPES, multiple: false }); }
    catch (e) { if (e && e.name !== "AbortError") notice("没能打开文件：" + e.message); return; }
    if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") return notice("没有获得这个文件的写入权限");
    const file = await h.getFile();
    if (file.size) {
      let raw = null, bk = null;
      try { raw = JSON.parse(await file.text()); bk = WQCore.parseBackup(raw); } catch (e) { bk = null; }
      if (bk && bk.projects.length) {
        const act = await choose("这个同步文件里有 " + bk.projects.length + " 个项目", [
          "写入时间：" + (raw.exportedAt || "未知") + (raw.appVersion ? " · 研墨 v" + raw.appVersion : ""),
          "建议先导入（与本机合并，同名项目以文件为准），再开始同步"
        ], [{ key: "import", label: "先导入再同步", primary: true }, { key: "over", label: "用本机数据覆盖它" }, { key: "x", label: "取消" }]);
        if (act !== "import" && act !== "over") return;
        if (act === "import" && !(await importFrom(file))) return;
      } else {
        const act = await choose("这个文件不是研墨的同步文件", ["继续的话，文件内容会被研墨的数据覆盖"], [{ key: "over", label: "覆盖它" }, { key: "x", label: "取消", primary: true }]);
        if (act !== "over") return;
      }
    }
    await adopt(h);
  }
  async function adopt(h) {
    try { await putHandle(h); } catch (e) { return notice("浏览器没能记住这个文件（IndexedDB 不可用？），同步只在本页有效"); }
    S.handle = h; writeMeta({ name: h.name });
    S.state = "on"; render();
    if (await writeNow(true)) tip("已开启本地同步：" + h.name);
  }
  async function importFrom(file) {
    if (typeof window.wqImportBackup !== "function") { notice("请在工作台页面导入这个文件"); return false; }
    return !!(await window.wqImportBackup(file));
  }
  async function regrant() {
    if (!S.handle) return;
    let st = "denied";
    try { st = await S.handle.requestPermission({ mode: "readwrite" }); } catch (e) { st = "denied"; }
    if (st !== "granted") return notice("没有获得写入权限，同步仍暂停", ["可以「解除」后重新选择文件"]);
    S.state = "on"; render();
    writeNow(false);   // 不强制：先检查文件是否在别处被改过
  }
  async function resolveConflict(how) {
    if (!S.handle) return;
    if (how === "import") {
      let file;
      try { file = await S.handle.getFile(); } catch (e) { return setState("err", "读不到同步文件：" + e.message); }
      if (!(await importFrom(file))) return;
    }
    S.state = "on";
    await writeNow(true);
  }
  async function unbind() {
    const ok = await choose("解除本地同步？", ["同步文件本身会保留，只是之后不再自动写入"], [{ key: "y", label: "解除" }, { key: "x", label: "取消", primary: true }]);
    if (ok !== "y") return;
    clearTimeout(S.timer); S.timer = null;
    try { await delHandle(); } catch (e) {}
    S.handle = null; writeMeta({});
    setState(SUPPORTED ? "none" : "unsupported");
  }

  /* ---------- 面板（工作台项目栏 #ymSyncBox） ---------- */
  function render() {
    const box = $("ymSyncBox"); if (!box) return;
    const meta = readMeta();
    const name = esc((S.handle && S.handle.name) || meta.name || "同步文件");
    const at = meta.at ? new Date(meta.at) : null;
    const t = at ? String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0") + ":" + String(at.getSeconds()).padStart(2, "0") : "";
    const btn = (k, label, title) => `<button class="pillbtn" data-ys="${k}"${title ? ` title="${esc(title)}"` : ""}>${label}</button>`;
    let html = "";
    if (S.state === "unsupported") html = `<span class="hint">🔄 本地同步文件：当前浏览器不支持（需要 Chrome / Edge 等 Chromium 内核浏览器），请定期「⤓ 备份全部」</span>`;
    else if (S.state === "none") html = `<div class="ys-row">${btn("new", "🔄 开启本地同步…", "选一个位置新建 .json，之后每次修改自动写入")}${btn("open", "连接已有文件…", "另一台电脑 / 浏览器已经在用的同步文件")}</div><div class="hint">修改会自动写入你选的 .json（可放网盘目录）；内容同「备份全部」，MCP 也读它</div>`;
    else if (S.state === "perm") html = `<div class="ys-row"><b>🔄 ${name}</b> <span class="hint">待授权</span></div><div class="ys-row">${btn("grant", "继续同步", "浏览器要求重新打开页面后授权一次")}${btn("off", "解除")}</div>`;
    else if (S.state === "on") html = `<div class="ys-row"><b>🔄 ${name}</b> <span class="hint">${S.writing ? "写入中…" : t ? "已同步 " + t : "已开启"}</span></div><div class="ys-row">${btn("now", "立即同步")}${btn("off", "解除")}</div>`;
    else if (S.state === "conflict") html = `<div class="ys-row ys-warn">⚠ <b>${name}</b> 在别处被改过（另一台电脑 / 浏览器？），已暂停写入</div><div class="ys-row">${btn("imp", "导入它（合并）")}${btn("over", "用本机覆盖")}${btn("off", "解除")}</div>`;
    else if (S.state === "err") html = `<div class="ys-row ys-warn">⚠ 同步失败：${esc(S.err)}</div><div class="ys-row">${btn("now", "重试")}${btn("new", "重新选择…")}${btn("off", "解除")}</div>`;
    box.innerHTML = html;
    box.dataset.state = S.state;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("#ymSyncBox [data-ys]"); if (!b) return;
    const k = b.dataset.ys;
    if (k === "new") bindNew();
    else if (k === "open") bindExisting();
    else if (k === "grant") regrant();
    else if (k === "now") { S.state = S.handle ? "on" : S.state; writeNow(false).then(ok => { if (ok) tip("已同步 ✓"); }); }
    else if (k === "imp") resolveConflict("import");
    else if (k === "over") choose("用本机数据覆盖同步文件？", ["文件里在别处做的修改会丢失；不确定的话先选「导入它」"], [{ key: "y", label: "覆盖" }, { key: "x", label: "取消", primary: true }]).then(a => { if (a === "y") resolveConflict("over"); });
    else if (k === "off") unbind();
  });

  /* ---------- 启动：恢复上次绑定的文件 ---------- */
  (async function init() {
    if (!SUPPORTED) { render(); return; }
    let h = null;
    try { h = await getHandle(); } catch (e) { h = null; }
    if (!h) { render(); return; }
    S.handle = h;
    let perm = "prompt";
    try { perm = await h.queryPermission({ mode: "readwrite" }); } catch (e) { perm = "prompt"; }
    setState(perm === "granted" ? "on" : "perm");
  })();

  window.YMSync = { state: () => S.state, syncNow: () => writeNow(false), bindNew: bindNew, bindExisting: bindExisting, unbind: unbind };
})();

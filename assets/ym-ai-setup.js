/* 研墨 · 统一 AI 设置 assets/ym-ai-setup.js
 * 全站只有这一处模型配置（ai.html）：参考稿、科研工作台、试用页共用「当前使用」的模型。
 *
 * 模型列表存 localStorage[wenqu_ai_models]，每项字段对齐 Trae 的「编辑模型」：
 *   { id, name, model, format, base, fullUrl, key, ctxIn, ctxOut,
 *     thinking, thinkParam, thinkValues[], temperature, topP, topK }
 * 「设为当前」/保存当前模型时，同步写入旧的单模型配置（wenqu_ai / wenqu_ai_keys），
 * 其余页面照旧通过 WQCore.ai.conf() 读取，不需要改。
 */
(function () {
  "use strict";

  var LS_MODELS = "wenqu_ai_models";
  var AI_DEF = { base: "https://api.yingcompute.com/api/v1", model: "glm-5.3-flash" };

  /* 常用服务商：选一个自动填地址 / 格式 / 模型 */
  var PRESETS = [
    { id: "yanmo", name: "研墨（默认 · 新人送额度）", base: "https://api.yingcompute.com/api/v1",
      model: "glm-5.3-flash", format: "openai" },
    { id: "tokenhub", name: "腾讯 TokenHub（DeepSeek 等）",
      base: window.__YM_DESKTOP__ ? "/__ai/v1" : "https://tokenhub.tencentmaas.com/v1",
      model: "deepseek/deepseek-flash", format: "openai" },
    { id: "deepseek", name: "DeepSeek 官方", base: "https://api.deepseek.com/v1", model: "deepseek-chat", format: "auto" },
    { id: "kimi", name: "Kimi（Moonshot）", base: "https://api.moonshot.cn/v1", model: "kimi-k2-turbo-preview", format: "auto" },
    { id: "zhipu", name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6", format: "thinking" },
    { id: "qwen", name: "通义千问（DashScope）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", format: "enable_thinking" },
    { id: "siliconflow", name: "硅基流动", base: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3", format: "openai" },
    { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini", format: "openai" },
    { id: "anthropic", name: "Anthropic（Claude）", base: "https://api.anthropic.com", model: "claude-sonnet-4-5", format: "anthropic" }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() { return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === "ok" ? "#0a7a43" : kind === "bad" ? "#c62828" : "";
  }

  /* ---------- 存储 ---------- */
  function readModels() {
    var list = null;
    try { list = JSON.parse(localStorage.getItem(LS_MODELS) || "null"); } catch (e) { list = null; }
    if (!Array.isArray(list) || !list.length) list = seedFromLegacy();
    return list.filter(function (m) { return m && typeof m === "object" && m.model; }).map(function (m, i) {
      if (!m.id) m.id = uid() + i;
      if (!m.name) m.name = m.model;
      if (m.format == null) m.format = "auto";
      return m;
    });
  }
  function writeModels(list) {
    try { localStorage.setItem(LS_MODELS, JSON.stringify(list)); } catch (e) {}
  }
  /* 首次使用：把旧的单模型配置迁移成一条模型记录，避免用户重填 */
  function seedFromLegacy() {
    var c = {};
    try { c = (window.WQCore && WQCore.ai.conf()) || {}; } catch (e) { c = {}; }
    var key = c.key || legacyKeyFor(c.base) || "";
    var m = {
      id: uid(), name: c.model || AI_DEF.model, model: c.model || AI_DEF.model,
      format: c.format || "auto", base: c.base || AI_DEF.base, fullUrl: !!c.fullUrl, key: key,
      ctxIn: c.ctxK ? Math.round(parseFloat(c.ctxK) * 1000) : 128000, ctxOut: c.ctxOut || 8192,
      thinking: !!c.thinking, thinkParam: c.thinkParam || "", thinkValues: c.thinkValues || [],
      temperature: c.temperature || "", topP: c.topP || "", topK: c.topK || ""
    };
    var list = [m];
    /* 旧版按服务商分存的 Key（桌面版预置的 TokenHub 测试 Key 等）也迁移成一条记录 */
    try {
      var map = JSON.parse(localStorage.getItem("wenqu_ai_keys") || "{}") || {};
      if (map.tokenhub && !/tokenhub|__ai/i.test(m.base)) {
        list.push({
          id: uid() + "t", name: "腾讯 TokenHub · DeepSeek", model: "deepseek/deepseek-flash",
          format: "openai", base: window.__YM_DESKTOP__ ? "/__ai/v1" : "https://tokenhub.tencentmaas.com/v1",
          fullUrl: false, key: map.tokenhub, ctxIn: 128000, ctxOut: 8192,
          thinking: false, thinkParam: "", thinkValues: [], temperature: "", topP: "", topK: ""
        });
      }
    } catch (e) {}
    writeModels(list);
    try { localStorage.setItem("wenqu_ai_active", m.id); } catch (e) {}
    return list;
  }
  function legacyKeyFor(base) {
    var b = String(base || "");
    var map = {};
    try { map = JSON.parse(localStorage.getItem("wenqu_ai_keys") || "{}") || {}; } catch (e) { return ""; }
    if (/tokenhub|__ai\//i.test(b)) return map.tokenhub || map.desktop || "";
    if (/yingcompute/i.test(b)) return map.yanmo || "";
    return "";
  }
  function activeId() { try { return localStorage.getItem("wenqu_ai_active") || ""; } catch (e) { return ""; } }
  function setActiveId(id) { try { localStorage.setItem("wenqu_ai_active", id); } catch (e) {} }
  function activeModel(list) {
    var id = activeId();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  /* 同步到全站实际读取的那份配置 */
  function applyModel(m) {
    if (!m) return false;
    var cfg = {
      base: String(m.base || AI_DEF.base).trim().replace(/\/+$/, ""),
      model: String(m.model || AI_DEF.model).trim(),
      format: m.format || "auto",
      fullUrl: !!m.fullUrl,
      thinking: !!m.thinking,
      thinkParam: String(m.thinkParam || "").trim(),
      thinkValues: m.thinkValues || [],
      ctxK: num(m.ctxIn) ? String(num(m.ctxIn) / 1000) : "",
      ctxOut: num(m.ctxOut) || "",
      temperature: m.temperature === "" ? "" : (num(m.temperature) == null ? "" : num(m.temperature)),
      topP: m.topP === "" ? "" : (num(m.topP) == null ? "" : num(m.topP)),
      topK: m.topK === "" ? "" : (num(m.topK) == null ? "" : num(m.topK))
    };
    var ok = WQCore.ai.setConf(cfg);
    ok = WQCore.ai.setKey(m.key || "", false) && ok;
    /* 兼容按服务商分存的旧 Key 表 */
    try {
      var map = JSON.parse(localStorage.getItem("wenqu_ai_keys") || "{}") || {};
      var pid = presetOfBase(cfg.base);
      if (pid && m.key) { map[pid] = m.key; localStorage.setItem("wenqu_ai_keys", JSON.stringify(map)); }
    } catch (e) {}
    return ok;
  }
  function presetOfBase(base) {
    var b = String(base || "").replace(/\/+$/, "");
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].base.replace(/\/+$/, "") === b) return PRESETS[i].id;
    if (/tokenhub/i.test(b)) return "tokenhub";
    if (/yingcompute/i.test(b)) return "yanmo";
    return "";
  }

  /* ---------- 渲染 ---------- */
  function renderEnv() {
    var el = $("aiEnvNote"); if (!el) return;
    el.textContent = window.__YM_DESKTOP__
      ? "当前是桌面版：第三方服务商经本机中转，不受浏览器跨域限制。"
      : "当前是网页版：服务商若未放行浏览器跨域（OPTIONS），连接会失败；可改用桌面版或自建中转。";
  }

  function renderList() {
    var list = readModels(), act = activeModel(list);
    var box = $("modelList"); if (!box) return;
    box.innerHTML = list.map(function (m) {
      var on = act && m.id === act.id;
      return '<div class="mcard' + (on ? " on" : "") + '" data-id="' + esc(m.id) + '">' +
        '<div class="mi">' +
          '<div class="mn">' + esc(m.name || m.model) +
            (on ? '<span class="badge-cur">当前使用</span>' : "") +
            (m.key ? "" : '<span class="badge-nokey">未填 Key</span>') +
            (m.fullUrl ? '<span class="badge-key">完整 URL</span>' : "") +
          "</div>" +
          '<div class="mm">' + esc(m.model) + " · " + esc(formatName(m.format)) + "</div>" +
          '<div class="mm">' + esc(m.base) + (m.ctxIn ? " · 上下文 " + Math.round(m.ctxIn / 1000) + "k" : "") + "</div>" +
        "</div>" +
        '<div class="mb">' +
          (on ? "" : '<button class="chip" type="button" data-act="use">设为当前</button>') +
          '<button class="chip" type="button" data-act="edit">编辑</button>' +
          '<button class="chip" type="button" data-act="test">测试</button>' +
        "</div>" +
      "</div>";
    }).join("");
    box.querySelectorAll(".mcard").forEach(function (card) {
      var id = card.getAttribute("data-id");
      card.querySelectorAll("[data-act]").forEach(function (b) {
        b.addEventListener("click", async function () {
          var actn = b.getAttribute("data-act");
          var list2 = readModels();
          var m = list2.filter(function (x) { return x.id === id; })[0];
          if (!m) return;
          if (actn === "use") { setActiveId(m.id); applyModel(m); renderAll(); msg($("aiTestMsg"), "已切换到「" + (m.name || m.model) + "」，全站生效", "ok"); }
          else if (actn === "edit") openDialog(m);
          else if (actn === "test") {
            msg($("aiTestMsg"), "测试中…");
            try {
              var r = await probe(m);
              msg($("aiTestMsg"), "✓ 「" + (m.name || m.model) + "」连接正常" + (r.n ? "，可用模型 " + r.n + " 个" : ""), "ok");
            } catch (e) {
              msg($("aiTestMsg"), "✗ " + errText(e), "bad");
            }
          }
        });
      });
    });
    renderCurrent();
  }

  function renderCurrent() {
    var list = readModels(), m = activeModel(list), box = $("aiCurrent");
    if (!m || !box) return;
    var key = String(m.key || "");
    var mask = key ? key.slice(0, 6) + "…" + key.slice(-4) : "未填写";
    box.innerHTML =
      '<div><span class="hint">当前模型</span><b>' + esc(m.name || m.model) + "</b></div>" +
      '<div><span class="hint">模型 ID</span><code>' + esc(m.model) + "</code></div>" +
      '<div><span class="hint">API 格式</span><b>' + esc(formatName(m.format)) + "</b></div>" +
      '<div><span class="hint">请求地址</span><code>' + esc(m.base) + "</code></div>" +
      '<div><span class="hint">Key</span><b>' + esc(mask) + "</b></div>" +
      '<div><span class="hint">上下文</span><b>' + (m.ctxIn ? Math.round(m.ctxIn / 1000) + "k" : "自动") + (m.ctxOut ? " / 输出上限 " + m.ctxOut : "") + "</b></div>" +
      '<div class="hint" style="grid-column:1/-1">参考稿、科研工作台、试用页共用这个模型；换模型只需「设为当前」。</div>';
    var u = WQCore.ai.usageToday ? WQCore.ai.usageToday() : null;
    if ($("usageBox") && u) {
      $("usageBox").textContent = "📊 本机今日用量：" + (u.inTok + u.outTok).toLocaleString() + " tokens / " + u.calls + " 次" + (u.price != null ? " ≈ ¥" + u.price : "") + "（只存本机）";
    }
  }
  function renderAll() { renderEnv(); renderList(); }

  function formatName(id) { return (window.WQCore && WQCore.ai.formatName) ? WQCore.ai.formatName(id || "auto") : (id || "auto"); }

  /* ---------- 编辑弹窗 ---------- */
  var editingId = "";

  function fillFormatSelect() {
    var sel = $("mFormat");
    sel.innerHTML = WQCore.ai.formats().map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + "</option>"; }).join("");
  }
  function fillPresetSelect() {
    var sel = $("mPreset");
    sel.innerHTML = '<option value="">不填，手动配置</option>' +
      PRESETS.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("") +
      '<option value="custom">自定义（手动填写地址与模型）</option>';
  }
  /* 自定义服务商必须填地址：空着就明确提示，别让人只填个名字就保存 */
  function updateBaseWarn() {
    var w = $("mBaseWarn"); if (!w) return;
    w.style.display = $("mBase").value.trim() ? "none" : "block";
  }

  function openDialog(m) {
    editingId = m ? m.id : "";
    $("dlgTitle").textContent = m ? "编辑模型" : "添加模型";
    $("mDelete").hidden = !m;
    var d = m || { format: "auto", base: "", model: "", name: "", key: "", fullUrl: false, ctxIn: 128000, ctxOut: 8192, thinking: false, thinkParam: "", thinkValues: [], temperature: "", topP: "", topK: "" };
    $("mPreset").value = m ? (presetOfBase(d.base) || "") : "";
    $("mFormat").value = d.format || "auto";
    $("mBase").value = d.base || "";
    $("mFullUrl").checked = !!d.fullUrl;
    $("mModel").value = d.model || "";
    $("mName").value = m ? (d.name || "") : "";
    $("mKey").value = d.key || "";
    $("mCtxIn").value = d.ctxIn || "";
    $("mCtxOut").value = d.ctxOut || "";
    $("mThinking").checked = !!d.thinking;
    $("mThinkParam").value = d.thinkParam || "";
    $("mThinkValues").value = (d.thinkValues || []).join(",");
    $("mTemp").value = d.temperature === "" || d.temperature == null ? "" : d.temperature;
    $("mTopP").value = d.topP === "" || d.topP == null ? "" : d.topP;
    $("mTopK").value = d.topK === "" || d.topK == null ? "" : d.topK;
    $("mNameCount").textContent = ($("mName").value.length) + "/64";
    msg($("mTestMsg"), "");
    syncPathHint();
    updateBaseWarn();
    if (!$("mAdv").open && (d.thinking || d.thinkParam || d.ctxOut || d.temperature || d.topP || d.topK)) $("mAdv").open = true;
    if (typeof $("modelDlg").showModal === "function") $("modelDlg").showModal(); else $("modelDlg").setAttribute("open", "");
  }
  function closeDialog() {
    if (typeof $("modelDlg").close === "function") $("modelDlg").close(); else $("modelDlg").removeAttribute("open");
  }
  function syncPathHint() {
    var fmt = $("mFormat").value;
    $("mPathHint").textContent = fmt === "anthropic" ? "/v1/messages" : "/chat/completions";
    $("mPathHint").style.opacity = $("mFullUrl").checked ? ".45" : "1";
  }
  function formModel() {
    var name = $("mName").value.trim();
    var model = $("mModel").value.trim();
    return {
      id: editingId || uid(),
      name: name || model,
      model: model,
      format: $("mFormat").value || "auto",
      base: $("mBase").value.trim(),
      fullUrl: $("mFullUrl").checked,
      key: $("mKey").value.trim(),
      ctxIn: num($("mCtxIn").value) || "",
      ctxOut: num($("mCtxOut").value) || "",
      thinking: $("mThinking").checked,
      thinkParam: $("mThinkParam").value.trim(),
      thinkValues: $("mThinkValues").value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      temperature: $("mTemp").value.trim(),
      topP: $("mTopP").value.trim(),
      topK: $("mTopK").value.trim()
    };
  }

  async function probe(m) {
    var X = window.YMAI;
    if (!X) throw new Error("页面缺少 assets/ym-ai.js，请刷新");
    var fmt = X.resolve({ base: m.base, format: m.format });
    var url = X.endpoint(fmt, m.base, "models", !!m.fullUrl);
    var r = await fetch(url, { headers: X.headers(fmt, m.key, false) });
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 404 ? "（该服务不提供模型列表，可直接点「测试一次对话」）" : ""));
    var j = await r.json();
    var ids = (j.data || []).map(function (x) { return x.id; });
    return { n: ids.length, ids: ids };
  }
  function errText(e) {
    var m = String((e && e.message) || e || "");
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "浏览器被跨域预检拦下（服务商未放行 OPTIONS）——可改用桌面版或自建中转";
    return m;
  }

  function saveFromForm() {
    var m = formModel();
    if (!m.model) { msg($("mTestMsg"), "请填写模型 ID", "bad"); $("mModel").focus(); return false; }
    if (!m.base) { msg($("mTestMsg"), "请填写请求地址（自定义服务商必填）", "bad"); updateBaseWarn(); $("mBase").focus(); return false; }
    var list = readModels();
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === m.id) i = k;
    if (i >= 0) list[i] = m; else list.push(m);
    writeModels(list);
    /* 新加的模型直接设为当前；编辑的是当前模型则同步生效 */
    if (i < 0 || !activeId() || activeId() === m.id) { setActiveId(m.id); applyModel(m); }
    renderAll();
    return true;
  }

  function bind() {
    fillFormatSelect();
    fillPresetSelect();

    $("addModel").addEventListener("click", function () { openDialog(null); });
    $("dlgClose").addEventListener("click", closeDialog);
    $("mCancel").addEventListener("click", closeDialog);
    $("modelDlg").addEventListener("cancel", function (e) { e.preventDefault(); closeDialog(); });

    $("mName").addEventListener("input", function () { $("mNameCount").textContent = this.value.length + "/64"; });
    $("mFormat").addEventListener("change", syncPathHint);
    $("mFullUrl").addEventListener("change", syncPathHint);
    $("mKeyEye").addEventListener("click", function () {
      var el = $("mKey");
      el.type = el.type === "password" ? "text" : "password";
      this.textContent = el.type === "password" ? "👁" : "🙈";
    });
    $("mPreset").addEventListener("change", function () {
      var id = this.value;
      if (id === "custom") {
        $("mBase").value = "";
        $("mModel").value = "";
        $("mName").value = "";
        $("mFormat").value = "openai";
        $("mBase").focus();
        updateBaseWarn(); syncPathHint();
        return;
      }
      var p = PRESETS.filter(function (x) { return x.id === id; })[0];
      if (!p) { updateBaseWarn(); return; }
      $("mBase").value = p.base;
      $("mModel").value = p.model;
      $("mFormat").value = p.format;
      $("mCtxIn").value = 128000;
      $("mCtxOut").value = 8192;
      /* 之前按服务商存过的 Key 直接带出来，免得重新粘贴 */
      var old = legacyKeyFor(p.base);
      if (old && !$("mKey").value) $("mKey").value = old;
      updateBaseWarn(); syncPathHint();
    });
    $("mBase").addEventListener("input", updateBaseWarn);
    $("modelDlg").querySelectorAll(".chips[data-for] .chip").forEach(function (b) {
      b.addEventListener("click", function () { $(b.parentNode.getAttribute("data-for")).value = b.getAttribute("data-v"); });
    });
    $("modelDlg").querySelectorAll("[data-tv]").forEach(function (b) {
      b.addEventListener("click", function () { $("mThinkValues").value = b.getAttribute("data-tv"); });
    });

    $("mTest").addEventListener("click", async function () {
      var m = formModel();
      if (!m.model) { msg($("mTestMsg"), "先填模型 ID", "bad"); return; }
      if (!m.base) { msg($("mTestMsg"), "先填请求地址", "bad"); return; }
      if (!m.key) { msg($("mTestMsg"), "先填 API 密钥", "bad"); return; }
      var btn = this; btn.disabled = true; msg($("mTestMsg"), "测试中…");
      try {
        var r = await probe(m);
        msg($("mTestMsg"), "✓ 连接正常" + (r.n ? "，可用模型 " + r.n + " 个" : ""), "ok");
      } catch (e) {
        msg($("mTestMsg"), "✗ " + errText(e), "bad");
      } finally { btn.disabled = false; }
    });

    $("mDelete").addEventListener("click", function () {
      if (!editingId) return;
      if (!confirm("删除这个模型？只影响本机保存的配置。")) return;
      var list = readModels().filter(function (x) { return x.id !== editingId; });
      writeModels(list);
      if (activeId() === editingId) {
        if (list.length) { setActiveId(list[0].id); applyModel(list[0]); } else { setActiveId(""); }
      }
      closeDialog(); renderAll();
      msg($("aiTestMsg"), "已删除", "ok");
    });

    $("modelForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (saveFromForm()) closeDialog();
    });

    $("aiTest").addEventListener("click", async function () {
      var list = readModels(), m = activeModel(list);
      if (!m) return;
      var btn = this; btn.disabled = true; msg($("aiTestMsg"), "测试中…");
      try {
        var r = await probe(m);
        msg($("aiTestMsg"), "✓ 连接正常" + (r.n ? "，可用模型 " + r.n + " 个" : ""), "ok");
      } catch (e) {
        msg($("aiTestMsg"), "✗ " + errText(e), "bad");
      } finally { btn.disabled = false; }
    });

    $("aiTestChat").addEventListener("click", async function () {
      var list = readModels(), m = activeModel(list);
      if (!m) return;
      if (!m.key) { msg($("aiTestMsg"), "先给当前模型填 API 密钥", "bad"); return; }
      applyModel(m);
      var btn = this; btn.disabled = true; msg($("aiTestMsg"), "正在发一条很短的消息…");
      try {
        var r = await WQCore.ai.complete([{ role: "user", content: "请只回复两个字：可用" }], { max_tokens: 200, temperature: 0, timeout: 60000 });
        var said = String(r.text || "").replace(/\s+/g, " ").slice(0, 40) || (r.reasoning ? "（有思考内容，可调大输出上限）" : "");
        msg($("aiTestMsg"), "✓ 对话正常：" + said, "ok");
      } catch (e) {
        msg($("aiTestMsg"), "✗ " + errText(e), "bad");
      } finally { btn.disabled = false; }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("modelList")) return;
    bind();
    var list = readModels(), act = activeModel(list);
    if (act) { setActiveId(act.id); applyModel(act); }
    renderAll();
  });
})();

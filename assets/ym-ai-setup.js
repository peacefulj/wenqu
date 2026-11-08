/* 研墨 · 统一 AI 设置 assets/ym-ai-setup.js
 * 全站只有这一份 AI 配置界面（ai.html）：参考稿、科研工作台、试用页都读同一份存储
 *   配置：localStorage  wenqu_ai        （地址 / 模型 / 接口格式 / 思考 / 上下文 / 价格…）
 *   Key ：localStorage  wenqu_ai_keys   （按服务商分开记）
 *         或 sessionStorage wenqu_ai_session（勾「只在本次会话有效」时）
 * 依赖：assets/wq-core.js（WQCore.ai）、assets/ym-ai.js（接口格式解析）
 */
(function () {
  "use strict";

  var AI_DEF = { base: "https://api.yingcompute.com/api/v1", model: "glm-5.3-flash" };
  var KEYMAP = "wenqu_ai_keys";

  /* 服务商预设：选一个就带出地址、接口格式与常用模型，只需再填 Key */
  var PROVIDERS = [
    { id: "yanmo", name: "研墨（默认 · 新人送额度）", base: "https://api.yingcompute.com/api/v1",
      models: ["glm-5.3-flash", "glm-5.3", "deepseek-flash", "deepseek-v4-pro", "kimi-k3", "claude-sonnet-5-5", "claude-haiku-5-5"],
      format: "openai", hint: "按 token 计费、无套餐；检索类功能不需要 Key。" },
    /* 桌面版里 TokenHub 一律走本机中转（直连会被跨域预检拦掉） */
    { id: "tokenhub", name: "腾讯 TokenHub（DeepSeek 等）",
      base: window.__YM_DESKTOP__ ? "/__ai/v1" : "https://tokenhub.tencentmaas.com/v1",
      models: ["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro"],
      format: "openai",
      hint: window.__YM_DESKTOP__
        ? "桌面版经本机中转（同源转发），不需要处理跨域，保存后可直接用。"
        : "网页直连常被跨域预检拦下（OPTIONS 405）；失败可改用桌面版，或填自建中转的地址。" },
    { id: "deepseek", name: "DeepSeek 官方", base: "https://api.deepseek.com/v1",
      models: ["deepseek-chat", "deepseek-reasoner"], format: "auto" },
    { id: "kimi", name: "Kimi（Moonshot）", base: "https://api.moonshot.cn/v1",
      models: ["kimi-k2-turbo-preview", "kimi-k2-0905-preview", "moonshot-v1-32k"], format: "auto" },
    { id: "zhipu", name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4",
      models: ["glm-4.6", "glm-4-plus", "glm-4-flash"], format: "thinking" },
    { id: "qwen", name: "通义千问（DashScope）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: ["qwen-plus", "qwen-max", "qwen-turbo"], format: "enable_thinking" },
    { id: "siliconflow", name: "硅基流动", base: "https://api.siliconflow.cn/v1",
      models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], format: "openai" },
    { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1",
      models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"], format: "openai" },
    { id: "anthropic", name: "Anthropic（Claude）", base: "https://api.anthropic.com",
      models: ["claude-sonnet-4-5", "claude-haiku-4-5"], format: "anthropic" }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var norm = function (b) { return String(b || "").trim().replace(/\/+$/, ""); };
  /* 桌面版：TokenHub 直连地址显示/保存都折算成本机中转 */
  function eff(b) {
    var s = String(b || "").trim();
    return (window.__YM_DESKTOP__ && /tokenhub\.tencentmaas\.com/i.test(s)) ? "/__ai/v1" : s;
  }
  function keyMap() { try { return JSON.parse(localStorage.getItem(KEYMAP) || "{}") || {}; } catch (e) { return {}; } }
  function keyOf(pid) { return (pid && pid !== "custom" && keyMap()[pid]) || ""; }
  function keySave(pid, key) {
    if (!pid || pid === "custom") return;
    var m = keyMap();
    if (key) m[pid] = key; else delete m[pid];
    try { localStorage.setItem(KEYMAP, JSON.stringify(m)); } catch (e) {}
  }
  function providerOf(base) {
    var b = norm(eff(base));
    for (var i = 0; i < PROVIDERS.length; i++) if (norm(eff(PROVIDERS[i].base)) === b) return PROVIDERS[i];
    return null;
  }
  function currentProvider() { return PROVIDERS.filter(function (p) { return p.id === $("aiProvider").value; })[0] || null; }
  function msg(t, kind) {
    var el = $("aiTestMsg"); if (!el) return;
    el.textContent = t;
    el.style.color = kind === "ok" ? "#0a7a43" : kind === "bad" ? "#c62828" : "";
  }

  /* ---------- 渲染 ---------- */
  function fillProviders() {
    var sel = $("aiProvider"); if (!sel) return;
    sel.innerHTML = PROVIDERS.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("")
      + '<option value="custom">自定义（自己填地址与模型）</option>';
  }
  function fillModels(p) {
    var dl = $("aiModelList"); if (!dl) return;
    dl.innerHTML = ((p && p.models) || []).map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join("");
  }
  function applyProvider(id, keep) {
    var p = null;
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) p = PROVIDERS[i];
    if (!p) { fillModels(null); }
    else {
      if (!keep) {
        $("aiBase").value = p.base;
        $("aiModel").value = (p.models && p.models[0]) || "";
        if ($("aiFormat")) $("aiFormat").value = p.format || "auto";
      }
      fillModels(p);
    }
    $("aiProvHint").textContent = (p && p.hint) || "自定义：直接填 API 地址、模型名与 Key；不确定接口格式时选「自动」或「自动识别」。";
    syncProviderFromBase();
    renderExtra();
  }
  function syncProviderFromBase() {
    var p = providerOf($("aiBase").value);
    if ($("aiProvider")) $("aiProvider").value = p ? p.id : "custom";
    fillModels(p);
    $("aiProvHint").textContent = (p && p.hint) || "自定义：直接填 API 地址、模型名与 Key；不确定接口格式时选「自动」或「自动识别」。";
  }
  function renderExtra() {
    /* 接口格式实际生效值 + 上下文窗口 */
    var box = $("aiFmtHint");
    if (box && window.WQCore && WQCore.ai.format) {
      var c = { base: $("aiBase").value.trim() || AI_DEF.base, format: $("aiFormat").value, thinking: $("aiThinking").checked, ctxK: $("aiCtx").value.trim(), model: $("aiModel").value.trim() };
      var f = WQCore.ai.format(c);
      box.textContent = "实际使用：" + WQCore.ai.formatName(f) + "；上下文按 " + Math.round(WQCore.ai.ctxWindow(c) / 1000) + "K token";
    }
    /* 非 HTTPS 提醒 */
    var w = $("aiBaseWarn");
    if (w && WQCore.ai.baseWarning) {
      var warn = WQCore.ai.baseWarning($("aiBase").value);
      w.hidden = !warn;
      w.textContent = warn ? "⚠ " + warn : "";
    }
    renderStatus();
  }

  /* 当前生效配置（读 WQCore，和真正调用时完全一致） */
  function renderStatus() {
    var box = $("aiStatus"); if (!box) return;
    var c = WQCore.ai.conf();
    var p = providerOf(c.base);
    var key = String(c.key || "");
    var mask = key ? key.slice(0, 6) + "…" + key.slice(-4) : "未填写";
    box.innerHTML =
      '<div><span class="hint">服务商</span><b>' + esc(p ? p.name : "自定义") + "</b></div>" +
      '<div><span class="hint">模型</span><b>' + esc(c.model || AI_DEF.model) + "</b></div>" +
      '<div><span class="hint">地址</span><code>' + esc(c.base || AI_DEF.base) + "</code></div>" +
      '<div><span class="hint">Key</span><b>' + esc(mask) + "</b>" + (c.sessionKey ? ' <span class="hint">（仅本次会话）</span>' : "") + "</div>" +
      '<div class="hint" style="grid-column:1/-1">参考稿、科研工作台、试用页共用这一份配置，改一次全站生效。</div>';
    var u = WQCore.ai.usageToday ? WQCore.ai.usageToday() : null;
    if ($("usageBox") && u) {
      $("usageBox").textContent = "📊 本机今日用量：" + (u.inTok + u.outTok).toLocaleString() + " tokens / " + u.calls + " 次" + (u.price != null ? " ≈ ¥" + u.price : "") + "（只存本机）";
    }
  }

  /* ---------- 读取 / 保存 ---------- */
  function load() {
    var c = WQCore.ai.conf();
    $("aiBase").value = c.base || AI_DEF.base;
    $("aiModel").value = c.model || AI_DEF.model;
    $("aiKey").value = c.key || "";
    $("aiConfirmChk").checked = c.confirm !== false;
    $("aiKeySession").checked = !!c.sessionKey;
    $("aiThinking").checked = !!c.thinking;
    $("aiCtx").value = c.ctxK || "";
    $("aiPriceIn").value = c.priceIn || "";
    $("aiPriceOut").value = c.priceOut || "";
    $("upEmail").value = localStorage.getItem("wenqu_email") || "";
    $("grobidUrl").value = localStorage.getItem("wenqu_grobid") || "";
    var fs = $("aiFormat");
    if (fs.options.length === 0) fs.innerHTML = WQCore.ai.formats().map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + "</option>"; }).join("");
    fs.value = c.format || "auto";
    fillProviders();
    /* 旧版「本机中转」Key 迁移到合并后的 tokenhub */
    var m = keyMap();
    if (m.desktop && !m.tokenhub) { m.tokenhub = m.desktop; try { localStorage.setItem(KEYMAP, JSON.stringify(m)); } catch (e) {} }
    syncProviderFromBase();
    if (window.__YM_DESKTOP__ && /tokenhub\.tencentmaas\.com/i.test($("aiBase").value)) $("aiBase").value = "/__ai/v1";
    envNote();
    renderExtra();
  }

  function envNote() {
    var el = $("aiEnvNote"); if (!el) return;
    el.textContent = window.__YM_DESKTOP__
      ? "当前是桌面版：TokenHub 等第三方会经本机中转，不受浏览器跨域限制。"
      : "当前是网页版：第三方服务商若未放行浏览器跨域（OPTIONS），连接会失败；可改用桌面版或自建中转。";
  }

  function saveQuiet() {
    var sessionOnly = $("aiKeySession").checked;
    var ctxK = parseFloat($("aiCtx").value);
    var ok = WQCore.ai.setConf({
      base: eff($("aiBase").value.trim() || AI_DEF.base),
      model: $("aiModel").value.trim() || AI_DEF.model,
      confirm: $("aiConfirmChk").checked,
      format: $("aiFormat").value || "auto",
      thinking: $("aiThinking").checked,
      ctxK: isFinite(ctxK) && ctxK > 0 ? String(ctxK) : "",
      priceIn: $("aiPriceIn").value.trim(),
      priceOut: $("aiPriceOut").value.trim()
    }) && WQCore.ai.setKey($("aiKey").value.trim(), sessionOnly);
    if (!sessionOnly) keySave(currentProvider() ? currentProvider().id : "custom", $("aiKey").value.trim());
    try {
      localStorage.setItem("wenqu_email", $("upEmail").value.trim());
      localStorage.setItem("wenqu_grobid", $("grobidUrl").value.trim());
    } catch (e) {}
    return ok;
  }

  /* ---------- 测试 ---------- */
  async function testConn() {
    var base = eff($("aiBase").value.trim() || AI_DEF.base), key = $("aiKey").value.trim();
    if (!key) { msg("先填 API Key", "bad"); $("aiKey").focus(); return; }
    var btn = $("aiTest"); btn.disabled = true; msg("测试中…");
    try {
      var pr = await WQCore.ai.probeModels(base, key);
      var n = (pr.list || []).length;
      msg("✓ 连接正常" + (n ? "，可用模型 " + n + " 个" : ""), "ok");
      if (n) {
        fillModels({ models: pr.list.slice(0, 80) });
        if (!$("aiModel").value.trim() && pr.pick) $("aiModel").value = pr.pick;
      }
    } catch (e) {
      var m = String((e && e.message) || e || "");
      msg("✗ " + (/Failed to fetch|NetworkError|Load failed/i.test(m)
        ? "浏览器被跨域预检拦下（服务商未放行 OPTIONS）——可改用桌面版，或把地址填成自建中转"
        : m), "bad");
    } finally { btn.disabled = false; }
  }

  async function testChat() {
    var key = $("aiKey").value.trim();
    if (!key) { msg("先填 API Key", "bad"); $("aiKey").focus(); return; }
    if (!saveQuiet()) { msg("设置没保存成功（浏览器存储不可用）", "bad"); return; }
    var btn = $("aiTestChat"); btn.disabled = true; msg("正在发一条很短的消息…");
    try {
      var r = await WQCore.ai.complete([{ role: "user", content: "请只回复两个字：可用" }], { max_tokens: 200, temperature: 0, timeout: 60000 });
      var said = String(r.text || "").replace(/\s+/g, " ").slice(0, 40) || (r.reasoning ? "（有思考内容，可调大输出上限）" : "");
      msg("✓ 对话正常：" + said, "ok");
    } catch (e) {
      var m = String((e && e.message) || e || "");
      msg("✗ " + (/Failed to fetch|NetworkError|Load failed/i.test(m)
        ? "浏览器被跨域预检拦下（服务商未放行 OPTIONS）"
        : m), "bad");
    } finally { btn.disabled = false; renderStatus(); }
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    if (!$("aiProvider")) return;
    $("aiProvider").addEventListener("change", function () {
      var id = this.value;
      applyProvider(id, false);
      $("aiKey").value = keyOf(id);
      msg("");
    });
    $("aiBase").addEventListener("input", function () { syncProviderFromBase(); renderExtra(); });
    ["aiFormat", "aiThinking", "aiCtx", "aiModel"].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", renderExtra);
    });
    $("aiTest").addEventListener("click", testConn);
    $("aiTestChat").addEventListener("click", testChat);
    $("aiSave").addEventListener("click", function () {
      var sessionOnly = $("aiKeySession").checked;
      var ok = saveQuiet();
      renderExtra();
      var btn = this;
      btn.textContent = ok ? (sessionOnly ? "已保存 ✓（Key 仅本次会话）" : "已保存 ✓") : "保存失败";
      setTimeout(function () { btn.textContent = "保存设置"; }, 1800);
      msg(ok ? "已保存，全站生效" : "浏览器存储不可用（隐私模式或配额已满）", ok ? "ok" : "bad");
    });
    $("aiClearKey").addEventListener("click", function () {
      WQCore.ai.setKey("", false);
      keySave(currentProvider() ? currentProvider().id : "custom", "");
      $("aiKey").value = "";
      try { sessionStorage.removeItem("wenqu_ai_session"); } catch (e) {}
      msg("已清除本浏览器保存的 Key", "ok");
      renderStatus();
    });
    $("aiKey").addEventListener("input", function () { msg(""); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("aiProvider")) return;
    bind();
    load();
  });
})();

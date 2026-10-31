/* 研墨 · AI 接口适配 ym-ai.js（v1.3.0 新增）
 * 纯函数、不发请求：不同服务商的接口格式（地址、请求头、请求体、响应解析）、思考模式开关，
 * 以及输入超过模型上下文时的自动压缩。页面里由 wq-core.js 调用；
 * 单元测试在 ym-selftest.js（发布前自检 scripts/check.mjs 和试用页 try.html 跑同一批）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YMAI = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FORMATS = [
    { id: "auto", name: "自动识别（按 API 地址）" },
    { id: "openai", name: "OpenAI 兼容 · 通用（不加思考参数）" },
    { id: "thinking", name: "OpenAI 兼容 + thinking 开关（DeepSeek / 智谱 GLM / 豆包）" },
    { id: "enable_thinking", name: "OpenAI 兼容 + enable_thinking（通义千问 / 硅基流动）" },
    { id: "openai_reasoning", name: "OpenAI 推理模型（o 系列 / GPT-5：reasoning_effort）" },
    { id: "anthropic", name: "Anthropic Messages（Claude 原生 / DeepSeek …/anthropic）" }
  ];
  var CUT_NOTE = "为适配模型上下文，研墨自动省略了中间约 ";

  function str(v) { return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v); }
  function trimBase(base) { return String(base || "").trim().replace(/\/+$/, ""); }
  function formatName(id) {
    for (var i = 0; i < FORMATS.length; i++) if (FORMATS[i].id === id) return FORMATS[i].name;
    return String(id || "");
  }
  function isDeepSeek(base) { return /^https?:\/\/api\.deepseek\.com(\/|$)/i.test(trimBase(base)); }
  function isAnthropicBase(base) {
    var b = trimBase(base);
    return /^https?:\/\/api\.anthropic\.com(\/|$)/i.test(b) || /\/anthropic(\/v1)?$/i.test(b);
  }
  /* 「自动」只认有把握的地址：Anthropic 官方或 …/anthropic → Messages 格式；DeepSeek 官方 → thinking 开关；
     其余一律按通用 OpenAI 兼容，不加任何额外参数（加了不认识的参数，有的服务商会直接报 400） */
  function resolve(c) {
    c = c || {};
    var f = String(c.format || "auto");
    for (var i = 1; i < FORMATS.length; i++) if (FORMATS[i].id === f) return f;
    if (isAnthropicBase(c.base)) return "anthropic";
    if (isDeepSeek(c.base)) return "thinking";
    return "openai";
  }
  function endpoint(fmt, base, kind) {
    var b = trimBase(base);
    if (fmt === "anthropic" && !/\/v1$/i.test(b)) b += "/v1";
    return b + (kind === "models" ? "/models" : fmt === "anthropic" ? "/messages" : "/chat/completions");
  }
  function headers(fmt, key, json) {
    var h = {};
    if (json) h["Content-Type"] = "application/json";
    if (!key) return h;
    if (fmt === "anthropic") {
      h["x-api-key"] = key;
      h["anthropic-version"] = "2023-06-01";
      h["anthropic-dangerous-direct-browser-access"] = "true";   // Anthropic 官方接口允许浏览器直连需要这个头
    } else h.Authorization = "Bearer " + key;
    return h;
  }

  /* b：OpenAI 风格的 {model, messages, max_tokens, temperature, stream}；c.thinking：是否允许模型先思考再回答 */
  function body(fmt, c, b) {
    c = c || {};
    var think = !!c.thinking, mt = b.max_tokens || 4096, temp = b.temperature == null ? 0.3 : b.temperature;
    if (fmt === "anthropic") {
      var sys = [], list = [];
      (b.messages || []).forEach(function (m) {
        var t = str(m.content);
        if (m.role === "system") { sys.push(t); return; }
        var role = m.role === "assistant" ? "assistant" : "user", last = list[list.length - 1];
        if (last && last.role === role) last.content += "\n\n" + t; else list.push({ role: role, content: t });
      });
      if (!list.length || list[0].role !== "user") list.unshift({ role: "user", content: "请继续。" });
      var a = { model: b.model, max_tokens: mt, messages: list };
      if (sys.length) a.system = sys.join("\n\n");
      if (think) {
        /* Claude 要求 budget_tokens ≥ 1024 且小于 max_tokens，开思考时不能带 temperature */
        var bud = Math.max(1024, Math.min(16000, mt));
        a.thinking = { type: "enabled", budget_tokens: bud };
        a.max_tokens = mt + bud;
      } else {
        a.thinking = { type: "disabled" };
        a.temperature = temp;
      }
      if (b.stream) a.stream = true;
      return a;
    }
    var o = { model: b.model, messages: b.messages || [] };
    if (fmt === "openai_reasoning") {
      /* OpenAI 推理模型不收 max_tokens / temperature；思考 token 也算在 max_completion_tokens 里，要多留 */
      o.max_completion_tokens = mt + (think ? 16000 : 2048);
      if (!think) o.reasoning_effort = "low";
    } else {
      o.temperature = temp;
      o.max_tokens = mt;
      if (fmt === "thinking") o.thinking = { type: think ? "enabled" : "disabled" };
      else if (fmt === "enable_thinking") o.enable_thinking = think;
      /* DeepSeek 的思考 token 计入 max_tokens（上限 393216）：开思考时多留 16K，免得正文被挤掉 */
      if (think && fmt === "thinking" && isDeepSeek(c.base)) o.max_tokens = mt + 16384;
    }
    if (b.stream) { o.stream = true; o.stream_options = { include_usage: true }; }
    return o;
  }

  function usageOf(fmt, u) {
    if (!u) return null;
    if (fmt === "anthropic") {
      return { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0 };
    }
    var d = u.completion_tokens_details || {};
    return { prompt_tokens: u.prompt_tokens || 0, completion_tokens: u.completion_tokens || 0, reasoning_tokens: d.reasoning_tokens || 0 };
  }
  /* 非流式响应 → {text, reasoning, finish, usage, error} */
  function parse(fmt, j) {
    j = j || {};
    if (j.error && !j.choices && !j.content) return { text: "", reasoning: "", finish: "", usage: null, error: str(j.error.message || j.error) };
    if (fmt === "anthropic") {
      var t = "", r = "";
      (Array.isArray(j.content) ? j.content : []).forEach(function (p) {
        if (!p) return;
        if (p.type === "text") t += p.text || "";
        else if (p.type === "thinking") r += p.thinking || "";
      });
      return { text: t, reasoning: r, finish: j.stop_reason === "max_tokens" ? "length" : str(j.stop_reason), usage: usageOf(fmt, j.usage), error: "" };
    }
    var ch = (j.choices && j.choices[0]) || {}, m = ch.message || {};
    return { text: typeof m.content === "string" ? m.content : "", reasoning: str(m.reasoning_content || m.reasoning || ""), finish: str(ch.finish_reason || ""), usage: usageOf(fmt, j.usage), error: "" };
  }
  /* 流式：一条 SSE data（已 JSON.parse）→ 返回正文增量；思考内容、结束原因、用量、错误累积在 acc 里 */
  function newAcc() { return { reasoning: "", finish: "", usage: null, inTok: 0, error: "" }; }
  function delta(fmt, o, acc) {
    if (!o) return "";
    if (o.error && !o.choices) { acc.error = str(o.error.message || o.error); return ""; }
    if (fmt === "anthropic") {
      if (o.type === "content_block_delta" && o.delta) {
        if (o.delta.type === "text_delta") return o.delta.text || "";
        if (o.delta.type === "thinking_delta") acc.reasoning += o.delta.thinking || "";
      } else if (o.type === "message_start" && o.message && o.message.usage) {
        acc.inTok = usageOf(fmt, o.message.usage).prompt_tokens;
      } else if (o.type === "message_delta") {
        if (o.delta && o.delta.stop_reason) acc.finish = o.delta.stop_reason === "max_tokens" ? "length" : o.delta.stop_reason;
        if (o.usage) acc.usage = { prompt_tokens: acc.inTok || usageOf(fmt, o.usage).prompt_tokens, completion_tokens: o.usage.output_tokens || 0 };
      }
      return "";
    }
    var ch = (o.choices && o.choices[0]) || {}, d = ch.delta || {};
    if (d.reasoning_content || d.reasoning) acc.reasoning += str(d.reasoning_content || d.reasoning);
    if (ch.finish_reason) acc.finish = ch.finish_reason;
    if (o.usage) acc.usage = usageOf(fmt, o.usage);
    return typeof d.content === "string" ? d.content : "";
  }

  /* token 估算：与 wq-core.js 相同（CJK 约 1 字≈1 token，其他约 4 字符≈1 token） */
  function estimateTokens(text) {
    var s = String(text || ""), cjk = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0x2e80 && c <= 0x9fff) cjk++; }
    return Math.ceil(cjk + (s.length - cjk) / 4);
  }
  /* 模型上下文（token）：设置里填了就用设置；模型名带 32k / 128k 之类就按名字；否则按常见值 */
  function ctxWindow(c, model) {
    c = c || {};
    var k = parseFloat(c.ctxK);
    if (isFinite(k) && k > 0) return Math.round(k * 1000);
    var m = String(model || c.model || "").toLowerCase(), mk = m.match(/(?:^|[-_.:\/])(\d{1,4})k(?=$|[-_.:])/);
    if (mk && +mk[1] >= 2) return +mk[1] * 1000;
    if (/gemini/.test(m)) return 1000000;
    if (/claude/.test(m)) return 200000;
    return 128000;
  }
  /* 输入超过上下文时，从最长的那条消息中间截掉一段（保留开头约 60%、结尾约 40%：开头是要求，结尾常是输出格式），
     并给输出留出 max_tokens；上下文很小的模型，输出预留最多占一半。返回 {messages, max_tokens, before, after, cut} */
  function fit(messages, maxTokens, win) {
    var src = messages || [], mt = maxTokens || 4096;
    win = win || 128000;
    if (mt > win * 0.5) mt = Math.max(256, Math.floor(win * 0.5));
    var budget = Math.floor(win * 0.95) - mt - 512;
    var msgs = src.map(function (m) { return { role: m.role, content: str(m.content) }; });
    var total = function () { var s = 0; for (var i = 0; i < msgs.length; i++) s += estimateTokens(msgs[i].content) + 8; return s; };
    var before = total(), now = before;
    for (var round = 0; now > budget && round < 8; round++) {
      var iMax = -1, tMax = 0;
      for (var i = 0; i < msgs.length; i++) { var tk = estimateTokens(msgs[i].content); if (tk > tMax) { tMax = tk; iMax = i; } }
      if (iMax < 0 || tMax < 300) break;
      var s = msgs[iMax].content;
      var keep = Math.max(Math.floor(s.length * Math.max(0, tMax - (now - budget) - 60) / tMax), Math.min(240, s.length));
      if (keep >= s.length) break;
      var head = Math.ceil(keep * 0.6);
      msgs[iMax].content = s.slice(0, head) + "\n\n…（" + CUT_NOTE + (s.length - keep) + " 字）…\n\n" + s.slice(s.length - (keep - head));
      now = total();
    }
    return { messages: now < before ? msgs : src, max_tokens: mt, before: before, after: now, cut: Math.max(0, before - now), win: win };
  }
  /* 接口报「上下文超限」时返回上限（token）；是超限但没写上限返回 -1；不是这类错误返回 0 */
  function ctxError(status, t) {
    if (status !== 400 && status !== 413 && status !== 422) return 0;
    var s = String(t || "");
    if (!/context|prompt is too long|input length|too many tokens|token limit|上下文|超长|输入.{0,8}(长度|过长|超)|reduce the length/i.test(s)) return 0;
    if (/max_tokens|max_completion_tokens/i.test(s) && !/context|input|prompt/i.test(s)) return 0;
    var m = s.match(/maximum context length is (\d+)/i) || s.match(/(\d{4,})\s*(?:tokens?\s*)?maximum/i) ||
      s.match(/\[\s*1\s*,\s*(\d{4,})\s*\]/) || s.match(/(?:limit|最大|上限)\D{0,12}(\d{4,})/i);
    return m ? +m[1] : -1;
  }
  /* 常见 HTTP 错误给一句可操作的提示（拼在原始错误后面） */
  function errorHint(status, t) {
    var s = String(t || "");
    if (status === 401 || status === 403) return "Key 无效、过期或没有权限——到服务商控制台核对 Key";
    if (status === 404 && !/model/i.test(s)) return "接口地址不存在——检查「API 地址」和「接口格式」是否匹配";
    if (status === 400 && /thinking|enable_thinking|reasoning_effort|max_completion_tokens|unrecognized|unknown (field|param)|extra (fields|inputs)|not permitted/i.test(s)) return "服务商不认识某个参数——把「接口格式」改成「OpenAI 兼容 · 通用」再试";
    if (status === 429) return "请求太频繁或额度不足——稍后再试，或检查余额";
    return "";
  }

  return {
    FORMATS: FORMATS, CUT_NOTE: CUT_NOTE, formatName: formatName, isDeepSeek: isDeepSeek, resolve: resolve,
    endpoint: endpoint, headers: headers, body: body, parse: parse, newAcc: newAcc, delta: delta,
    estimateTokens: estimateTokens, ctxWindow: ctxWindow, fit: fit, ctxError: ctxError, errorHint: errorHint
  };
});

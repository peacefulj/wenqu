/* 研墨 · 功能自测用例 ym-selftest.js（v1.2.0 新增）
 * 文献格式（ym-bib.js）与 Markdown / LaTeX 导出（ym-export.js）的单元测试。
 * 发布前自检（scripts/check.mjs，Node）和试用页（try.html，浏览器）跑的是同一批用例。
 * v1.3.0 起还测 AI 接口适配（ym-ai.js）。
 * 用法：YMSelfTest.run(YMBib, YMExport, samples, YMAI) → [{ name, ok, detail }]
 *       samples 可选：{ bib, ris, csl } 为 assets/demo/ 下示例文件的文本，用来确认示例文件本身能被正确解析；
 *       YMAI 可选，不传就跳过 AI 接口适配用例。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YMSelfTest = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BIB = [
    '@string{jfe = "Journal of Financial Economics"}',
    "@article{fama2015five,",
    "  title = {A five-factor asset pricing model},",
    "  author = {Fama, Eugene F. and French, Kenneth R.},",
    "  journal = jfe, volume = {116}, number = {1}, pages = {1--22}, year = {2015},",
    "  doi = {10.1016/j.jfineco.2014.10.010}",
    "}",
    "@phdthesis{zhang2021,",
    "  author = {张三 and 李四},",
    "  title = {数字经济与农村共同富裕研究},",
    "  school = {北京大学}, address = {北京}, year = {2021}",
    "}"
  ].join("\n");
  var RIS = ["TY  - JOUR", "AU  - Harris, Charles R.", "TI  - Array programming with NumPy", "T2  - Nature", "PY  - 2020",
    "VL  - 585", "IS  - 7825", "SP  - 357", "EP  - 362", "DO  - 10.1038/s41586-020-2649-2", "ER  - ", ""].join("\n");

  function run(Bib, X, samples, AI) {
    var out = [];
    /* 每个用例返回 [是否通过, 失败时的说明] */
    var t = function (name, fn) {
      var r;
      try { r = fn(); } catch (e) { r = [false, "异常：" + ((e && e.message) || e)]; }
      out.push({ name: name, ok: !!r[0], detail: r[0] ? "" : String(r[1] == null ? "" : r[1]) });
    };
    var copy = function (x) { return JSON.parse(JSON.stringify(x)); };

    /* ---------- 文献格式 ---------- */
    var r1 = Bib.parse(BIB);
    var ps1 = r1.items.map(function (c, i) { var f = Bib.cslToPaper(c, "bibtex"); f.id = "f" + i; return f; });
    t("BibTeX 解析（含 @string 宏）", function () { return [r1.format === "bibtex" && r1.items.length === 2 && !r1.errors.length, JSON.stringify({ format: r1.format, n: r1.items.length, errors: r1.errors })]; });
    var gb1 = Bib.gbList(ps1);
    t("GB/T 7714 期刊条目", function () { return [gb1[0] === "[1] FAMA E F, FRENCH K R. A five-factor asset pricing model[J]. Journal of Financial Economics, 2015, 116(1): 1-22. DOI: 10.1016/j.jfineco.2014.10.010.", gb1[0]]; });
    t("GB/T 7714 学位论文条目", function () { return [gb1[1] === "[2] 张三, 李四. 数字经济与农村共同富裕研究[D]. 北京: 北京大学, 2021.", gb1[1]]; });
    var bibOut = Bib.toBibTeX(copy(ps1));
    t("BibTeX 输出保留引用键与页码", function () { return [/@article\{fama2015five,/.test(bibOut) && /pages\s*=\s*\{1--22\}/.test(bibOut), bibOut.slice(0, 300)]; });
    t("中文条目写 language = {chinese}（gbt7714 不认 zh）", function () { return [/language\s*=\s*\{chinese\}/.test(bibOut) && !/language\s*=\s*\{zh\}/.test(bibOut), bibOut]; });
    t("BibTeX 往返：language 转回 CSL 的 zh", function () { var b = Bib.parse(bibOut); return [b.items.length === 2 && b.items[1].language === "zh", JSON.stringify(b.items.map(function (x) { return x.language; }))]; });
    t("RIS 解析 → GB/T 7714", function () {
      var r = Bib.parse(RIS), g = Bib.gbList(r.items.map(function (c) { return Bib.cslToPaper(c, "ris"); }))[0];
      return [r.format === "ris" && g === "[1] HARRIS C R. Array programming with NumPy[J]. Nature, 2020, 585(7825): 357-362. DOI: 10.1038/s41586-020-2649-2.", g];
    });
    t("CSL-JSON 往返", function () { var r = Bib.parse(Bib.toCSLJSON(copy(ps1))); return [r.format === "csl" && r.items.length === 2, JSON.stringify({ f: r.format, n: r.items.length })]; });
    t("按 DOI / 题名查重", function () { var plan = Bib.planImport(ps1, r1.items.map(function (c) { return Bib.cslToPaper(c, "bibtex"); })); return [plan.add.length === 0 && plan.dup.length === 2, JSON.stringify({ add: plan.add.length, dup: plan.dup.length })]; });

    /* ---------- 示例文件（assets/demo/） ---------- */
    var sampleCase = function (label, text, fmt, n) {
      if (text == null) return;
      t("示例文件 " + label + " 可解析（" + n + " 条）", function () { var r = Bib.parse(text); return [r.format === fmt && r.items.length === n && !r.errors.length, JSON.stringify({ format: r.format, n: r.items.length, errors: r.errors })]; });
    };
    if (samples) {
      sampleCase("sample.bib", samples.bib, "bibtex", 3);
      sampleCase("sample.ris", samples.ris, "ris", 2);
      sampleCase("sample-csl.json", samples.csl, "csl", 1);
      var gbOf = function (text, fmt) { return Bib.gbList(Bib.parse(text).items.map(function (c) { return Bib.cslToPaper(c, fmt); })); };
      if (samples.bib) t("GB/T 7714：没有卷号时写「年(期)」", function () { var g = gbOf(samples.bib, "bibtex")[1]; return [g === "[2] 张勋, 万广华, 张佳佳, 等. 数字经济、普惠金融与包容性增长[J]. 经济研究, 2019(8).", g]; });
      if (samples.csl) t("GB/T 7714：报告写「出版地: 出版者, 年」", function () { var g = gbOf(samples.csl, "csl")[0]; return [g === "[1] DEMIRGÜÇ-KUNT A, KLAPPER L, SINGER D, et al. The Global Findex Database 2017: Measuring Financial Inclusion and the Fintech Revolution[R]. Washington, DC: World Bank, 2018.", g]; });
    }

    /* ---------- 导出 ---------- */
    var ctx = X.newCtx(["ka", "kb", "kc", "kd"]);
    var inl = X.inlineTex("见[1,2]与[3-4]、[1][4]，$x_1$ 增长 50% a_b #3 {x}", ctx);
    t("正文 [n] → \\cite，特殊字符转义，公式原样保留", function () { return [inl === "见\\cite{ka,kb}与\\cite{kc,kd}、\\cite{ka,kd}，$x_1$ 增长 50\\% a\\_b \\#3 \\{x\\}", inl]; });
    t("对不上文献库的 [n] 原样保留并报告", function () { X.inlineTex("超出编号[9]", ctx); return [ctx.unresolved.length === 1 && ctx.unresolved[0] === "[9]", JSON.stringify(ctx.unresolved)]; });
    t("金额里的 $ 不当成公式", function () { var s = X.inlineTex("约 $5 到 $10", X.newCtx()); return [s === "约 \\$5 到 \\$10", s]; });
    t("标题 / 表格 / 列表转换", function () {
      var s = X.mdToTex("## 数据\n| 变量 | 来源 |\n| --- | --- |\n| x | [2] |\n- 第一点\n- 第二点", X.newCtx(["ka", "kb"]));
      return [/\\subsection\{数据\}/.test(s) && /\\begin\{tabularx\}/.test(s) && /x & \\cite\{kb\} \\\\/.test(s) && /\\begin\{itemize\}/.test(s), s];
    });
    var papersX = [{ id: "f1", title: "Digital finance", author: "Smith J", year: "2021", venue: "JF", type: "J" }, { id: "f2", title: "数字普惠金融", author: "张三", year: "2020", venue: "经济研究", type: "J" }];
    var envX = function (md) { return { YMBib: Bib, secs: [{ name: "引言", md: md }], paradigm: "定量", level: "期刊", ledger: null, checks: [], model: "m", stamp: "2026-10-30 12:00:00", day: "2026-10-30", label: "研墨", en: false }; };
    t("LaTeX：内嵌 .bib、gbt7714、有引用时 \\nocite 注释掉", function () {
      var r = X.buildLatex({ name: "P", topic: "T", papers: copy(papersX) }, envX("正文[1]。"));
      return [r.text.indexOf("\\begin{filecontents*}[overwrite]{yanmo-refs.bib}") >= 0 && r.text.indexOf("\\bibliographystyle{gbt7714-numerical}") >= 0 && r.cited === 1 && /^% \\nocite\{\*\}/m.test(r.text), r.text.slice(0, 400)];
    });
    t("LaTeX：正文没有引用时列出全部文献（\\nocite{*}）", function () {
      var r = X.buildLatex({ name: "P", topic: "T", papers: copy(papersX) }, envX("没有引用。"));
      return [/^\\nocite\{\*\}/m.test(r.text) && r.cited === 0, r.text.slice(-300)];
    });
    t("Markdown：front matter、每行一段、节内标题降级、参考文献", function () {
      var r = X.buildMarkdown({ name: "P", topic: "T", papers: copy(papersX) }, envX("第一段[1]\n第二段\n## 小节\n内容"));
      return [r.text.indexOf('---\ntitle: "T"') === 0 && r.text.indexOf("第一段[1]\n\n第二段") >= 0 && r.text.indexOf("### 小节") >= 0 && r.text.indexOf("## 参考文献") >= 0, r.text.slice(0, 300)];
    });

    /* ---------- AI 接口适配（v1.3.0，ym-ai.js） ---------- */
    if (AI) {
      var M = [{ role: "user", content: "hi" }];
      t("接口格式：自动识别 DeepSeek / Anthropic / 其他服务商", function () {
        var r = [AI.resolve({ base: "https://api.deepseek.com" }), AI.resolve({ base: "https://api.deepseek.com/anthropic/" }), AI.resolve({ base: "https://api.anthropic.com" }),
          AI.resolve({ base: "https://yingcompute.com/v1" }), AI.resolve({ base: "https://api.deepseek.com", format: "openai" }), AI.resolve({ base: "https://x.com/v1", format: "bogus" })];
        return [r.join() === "thinking,anthropic,anthropic,openai,openai,openai", r.join()];
      });
      t("接口地址与请求头：OpenAI 兼容用 Bearer，Anthropic 用 x-api-key", function () {
        var u = [AI.endpoint("openai", "https://yingcompute.com/v1/", "chat"), AI.endpoint("anthropic", "https://api.deepseek.com/anthropic", "chat"), AI.endpoint("anthropic", "https://api.anthropic.com/v1", "models")];
        var h1 = AI.headers("thinking", "k", true), h2 = AI.headers("anthropic", "k", true);
        return [u.join() === "https://yingcompute.com/v1/chat/completions,https://api.deepseek.com/anthropic/v1/messages,https://api.anthropic.com/v1/models" &&
          h1.Authorization === "Bearer k" && h2["x-api-key"] === "k" && !!h2["anthropic-version"] && !h2.Authorization, JSON.stringify({ u: u, h1: h1, h2: h2 })];
      });
      t("思考模式默认关闭，各格式的思考参数正确", function () {
        var ds = { base: "https://api.deepseek.com" }, b = { model: "m", messages: M, max_tokens: 100 };
        var off = AI.body("thinking", ds, b), on = AI.body("thinking", { base: ds.base, thinking: true }, b);
        var q = AI.body("enable_thinking", {}, b), o = AI.body("openai", { thinking: true }, b), r = AI.body("openai_reasoning", {}, b);
        return [off.thinking.type === "disabled" && off.max_tokens === 100 && off.temperature === 0.3 && on.thinking.type === "enabled" && on.max_tokens === 100 + 16384 &&
          q.enable_thinking === false && !("thinking" in o) && !("enable_thinking" in o) && o.max_tokens === 100 &&
          r.reasoning_effort === "low" && r.max_completion_tokens === 2148 && !("max_tokens" in r) && !("temperature" in r), JSON.stringify({ off: off, on: on.max_tokens, q: q.enable_thinking, r: r })];
      });
      t("Anthropic 请求体：system 单独放、同角色消息合并", function () {
        var a = AI.body("anthropic", {}, { model: "m", max_tokens: 50, stream: true, messages: [{ role: "system", content: "S" }, { role: "user", content: "a" }, { role: "user", content: "b" }] });
        var on = AI.body("anthropic", { thinking: true }, { model: "m", max_tokens: 2000, messages: M });
        return [a.system === "S" && a.messages.length === 1 && a.messages[0].content === "a\n\nb" && a.thinking.type === "disabled" && a.stream === true && a.temperature === 0.3 &&
          on.thinking.budget_tokens === 2000 && on.max_tokens === 4000 && !("temperature" in on), JSON.stringify({ a: a, on: on })];
      });
      t("响应解析：OpenAI / Anthropic（思考内容不混进正文）", function () {
        var p1 = AI.parse("openai", { choices: [{ message: { content: "x", reasoning_content: "r" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 } } });
        var p2 = AI.parse("anthropic", { content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "y" }], stop_reason: "max_tokens", usage: { input_tokens: 3, output_tokens: 4 } });
        var p3 = AI.parse("openai", { error: { message: "bad key" } });
        return [p1.text === "x" && p1.reasoning === "r" && p1.usage.completion_tokens === 2 && p1.usage.reasoning_tokens === 1 &&
          p2.text === "y" && p2.reasoning === "t" && p2.finish === "length" && p2.usage.prompt_tokens === 3 && p2.usage.completion_tokens === 4 && p3.error === "bad key", JSON.stringify([p1, p2, p3])];
      });
      t("流式解析：OpenAI 增量与 Anthropic 事件", function () {
        var a1 = AI.newAcc(), s1 = "";
        [{ choices: [{ delta: { reasoning_content: "想" } }] }, { choices: [{ delta: { content: "你" } }] }, { choices: [{ delta: { content: "好" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } }]
          .forEach(function (o) { s1 += AI.delta("openai", o, a1); });
        var a2 = AI.newAcc(), s2 = "";
        [{ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } }, { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "嗯" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }]
          .forEach(function (o) { s2 += AI.delta("anthropic", o, a2); });
        var a3 = AI.newAcc(); AI.delta("anthropic", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, a3);
        return [s1 === "你好" && a1.reasoning === "想" && a1.finish === "stop" && a1.usage.prompt_tokens === 5 &&
          s2 === "你好" && a2.reasoning === "嗯" && a2.finish === "end_turn" && a2.usage.prompt_tokens === 10 && a2.usage.completion_tokens === 5 && a3.error === "Overloaded", JSON.stringify({ s1: s1, a1: a1, s2: s2, a2: a2, a3: a3 })];
      });
      t("上下文自动压缩：超长输入从中间截断，留出输出空间；没超就原样发送", function () {
        var long = "开头要求" + new Array(30001).join("文") + "结尾格式";
        var f = AI.fit([{ role: "user", content: long }], 6000, 8000), c = f.messages[0].content;
        var small = AI.fit(M, 1000, 128000);
        return [f.max_tokens === 4000 && f.after <= Math.floor(8000 * 0.95) - 4000 - 512 && c.indexOf(AI.CUT_NOTE) > 0 && c.indexOf("开头要求") === 0 && c.slice(-4) === "结尾格式" &&
          small.messages === M && small.cut === 0, JSON.stringify({ mt: f.max_tokens, before: f.before, after: f.after, len: c.length, smallCut: small.cut })];
      });
      t("识别「上下文超限」报错（OpenAI / Anthropic / 通义），不误判输出上限错误", function () {
        var r = [AI.ctxError(400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens."),
          AI.ctxError(400, "prompt is too long: 215000 tokens > 200000 maximum"), AI.ctxError(400, "Range of input length should be [1, 30720]"),
          AI.ctxError(400, "Invalid max_tokens value, the valid range of max_tokens is [1, 393216]"), AI.ctxError(401, "maximum context length is 8192"), AI.ctxError(400, "上下文长度超过限制")];
        return [r.join() === "8192,200000,30720,0,0,-1", r.join()];
      });
      t("模型上下文：按设置 / 模型名推断", function () {
        var r = [AI.ctxWindow({ ctxK: "32" }, "x"), AI.ctxWindow({}, "moonshot-v1-8k"), AI.ctxWindow({}, "claude-sonnet-4-5"), AI.ctxWindow({}, "deepseek-flash"), AI.ctxWindow({ ctxK: "" }, "gemini-2.5-flash")];
        return [r.join() === "32000,8000,200000,128000,1000000", r.join()];
      });
    }
    return out;
  }

  return { run: run };
});

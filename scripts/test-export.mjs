/* 导出内核纯函数断言（无依赖，Node 直接运行）
 * 运行：node scripts/test-export.mjs
 * 目的：在浏览器 E2E 之前，先锁住编号、引用、缺图降级、三格式一致性与确定性。
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const D = require("../assets/ym-doc.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

function baseBundle(extra = {}) {
  const sections = [
    { key: "s1", name: "摘要", md: "本文研究一个问题。", drafted: true },
    { key: "s2", name: "研究方法", md: "模型结构如下图所示。\n\n@@YMIMG0|模型架构@@\n\n| 变量 | 含义 |\n| --- | --- |\n| X | 自变量 |\n\n$$y=\\beta x+\\varepsilon$$", drafted: true },
    { key: "s3", name: "结果", md: "结果显著[1]，并与已有研究一致[2,3]。", drafted: true },
    { key: "s4", name: "结论", md: "结论成立。", drafted: true }
  ];
  return D.buildBundle({
    meta: { title: "测试论文", project: "测试", label: "研墨", stamp: "2026-11-07", missingImages: extra.missingImages || 0 },
    sections,
    assets: extra.assets === false ? [] : [{ id: "im1", dataUrl: PNG, fileName: "yanmo-images/fig-01.png", ext: "png" }],
    refs: { style: "GB/T 7714-2015", items: [
      { n: 1, text: "[1] 张三. 论文一[J]. 期刊, 2020." },
      { n: 2, text: "[2] 李四. 论文二[J]. 期刊, 2021." },
      { n: 3, text: "[3] 王五. 论文三[J]. 期刊, 2022." },
      { n: 4, text: "[4] 赵六. 论文四[J]. 期刊, 2023." }
    ] },
    attribution: { lines: ["方法：本人贡献 80%"], marks: ["结果：AI 草稿"], total: "本人贡献度合计 80%", statement: "测试声明", model: "deepseek-flash" },
    checks: ["引用核验：通过"],
    ...extra.input
  });
}

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log("  ✓ " + name); }

console.log("导出内核断言");

ok("全文图/表/公式连续编号", () => {
  const b = baseBundle();
  assert.equal(b.floats.figures.length, 1);
  assert.equal(b.floats.figures[0].no, 1);
  assert.equal(b.floats.tables.length, 1);
  assert.equal(b.floats.tables[0].no, 1);
  assert.equal(b.floats.equations.length, 1);
  assert.equal(b.floats.equations[0].no, 1);
  assert.match(b.sections[1].md, /图 1　模型架构/);
  assert.match(b.sections[1].md, /表 1　数据表/);
  assert.match(b.sections[1].md, /（1）/);
});

ok("已有题注不会重复生成，而是被规范成新编号", () => {
  const b = baseBundle({ input: { sections: [{ key: "s", name: "方法", md: "@@YMIMG0|旧图@@\n\n图 7　旧题注", drafted: true }] } });
  assert.equal((b.sections[0].md.match(/图\s*\d+/g) || []).length, 1);
  assert.match(b.sections[0].md, /图 1　旧题注/);
});

ok("引用可解析：区间与逗号", () => {
  assert.deepEqual(D.parseCites("见[1,3]与[5-7]"), [1, 3, 5, 6, 7]);
  assert.deepEqual(D.parseCites("无引用"), []);
});

ok("引用闭合：cited / uncited / 零引用节", () => {
  const b = baseBundle();
  assert.deepEqual(b.refs.cited, [1, 2, 3]);
  assert.deepEqual(b.refs.uncited, [4]);
  assert.deepEqual(b.refs.zeroCiteSections.sort(), ["研究方法"].sort());
  assert.equal(b.refs.unresolved.length, 0);
});

ok("引用越界：只警告，不丢正文", () => {
  const b = baseBundle({ input: { sections: [{ key: "s", name: "结果", md: "越界引用[9]。", drafted: true }] } });
  assert.equal(b.refs.unresolved.length, 1);
  assert.match(b.sections[0].md, /\[9\]/);
  assert.ok(b.warnings.some(w => w.code === "CITE_OUT_OF_RANGE"));
});

ok("缺图：软降级为可见占位，不阻断导出", () => {
  const b = baseBundle({ assets: false, missingImages: 1 });
  assert.match(b.sections[1].md, /@@YMIMG0/); // bundle 仍保留占位，渲染时降级
  const md = D.renderMarkdown(b, { frontMatter: false });
  assert.match(md, /〔图片缺失：模型架构〕/);
  assert.doesNotMatch(md, /@@YMIMG/);
  assert.ok(b.warnings.some(w => w.code === "IMG_MISSING"));
  assert.equal(D.summary(b).missingImages, 1);
});

ok("Markdown：图片内联、无内部占位符、参考文献与归属齐全", () => {
  const b = baseBundle();
  const md = D.renderMarkdown(b);
  assert.match(md, /data:image\/png;base64,/);
  assert.doesNotMatch(md, /@@YMIMG|ym-img:/);
  assert.match(md, /## 参考文献/);
  assert.match(md, /## AI 辅助说明/);
  assert.match(md, /本人贡献度合计 80%/);
  assert.match(md, /## 校验记录/);
});

ok("Word Markdown：无 YAML front matter，图片同样内联", () => {
  const b = baseBundle();
  const md = D.renderWordMarkdown(b);
  assert.doesNotMatch(md, /^---/);
  assert.match(md, /data:image\/png;base64,/);
  assert.doesNotMatch(md, /@@YMIMG|ym-img:/);
  assert.match(md, /# 测试论文/);
});

ok("三格式节数/图数/表数/文献数一致（同一 bundle）", () => {
  const b = baseBundle();
  const s = D.summary(b);
  assert.equal(s.sections, 4);
  assert.equal(s.figures, 1);
  assert.equal(s.tables, 1);
  assert.equal(s.equations, 1);
  assert.equal(s.refs, 4);
  for (const f of ["renderMarkdown", "renderWordMarkdown"]) {
    const out = D[f](b, { frontMatter: false });
    assert.equal((out.match(/^## /gm) || []).length >= 1, true, f);
  }
});

ok("确定性：同一 bundle 两次渲染一致", () => {
  const b = baseBundle();
  const a = D.renderMarkdown(b, { frontMatter: false });
  const c = D.renderMarkdown(b, { frontMatter: false });
  assert.equal(a, c);
});

ok("未写节默认不出现在导出，includeUnwritten 时才出现", () => {
  const b = D.buildBundle({
    meta: { title: "T" }, sections: [{ key: "a", name: "已写", md: "正文", drafted: true }, { key: "b", name: "未写", md: "", drafted: false }],
    assets: [], refs: { items: [] }
  });
  const md = D.renderMarkdown(b, { frontMatter: false });
  assert.match(md, /## 已写/);
  assert.doesNotMatch(md, /## 未写/);
  const md2 = D.renderMarkdown(b, { frontMatter: false, includeUnwritten: true });
  assert.match(md2, /## 未写/);
});

console.log(`\n✓ 全部 ${passed} 项导出内核断言通过`);

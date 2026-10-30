# 参与研墨开发

欢迎提 issue 和 PR：修 bug、接新的模型服务商、补文献源、改界面都可以。

## 本地运行

没有构建步骤。在仓库根目录起一个静态服务器即可：

```bash
python -m http.server 8080
# 打开 http://localhost:8080/studio.html
```

直接双击 HTML 也能打开，但 Service Worker（离线缓存、更新提示）只在 http / https 下工作。

## 提交前自检

```bash
node scripts/check.mjs      # 或 npm run check
```

会检查：脚本语法（含页面内联脚本）、版本号是否一致、页面引用的文件是否都在离线缓存清单里、文献格式与导出的自测、MCP 服务冒烟测试。全部通过再提交。

## 版本规则

从 v1.0.0 起，**每次发布都有版本号、更新日志、git 标签和 GitHub Release**。

- 版本号遵循[语义化版本](https://semver.org/lang/zh-CN/) `主版本.次版本.修订号`：
  - 修订号（1.1.**x**）：只修 bug，不改数据结构；
  - 次版本（1.**x**.0）：新功能，向后兼容——旧数据、旧备份照常能用；
  - 主版本（**x**.0.0）：不兼容的变化（例如数据必须迁移），尽量避免。
- 唯一的版本来源是 `assets/version.js`。`sw.js`、`package.json` 和页脚的版本号由发版脚本同步，不要手改。
- 每个用户能感受到的改动，都在 `CHANGELOG.md` 的「## [未发布]」下面记一条，按「新增 / 变更 / 修复 / 安全 / 移除」归类。写给用户看：说清楚变化和影响，不写内部实现细节。

## 发版步骤

```bash
# 1. 确认 CHANGELOG.md「## [未发布]」已经写全
# 2. 改版本号、整理更新日志（可先加 --dry-run 演练）
node scripts/release.mjs 1.2.0
# 3. 自检
node scripts/check.mjs
# 4. 提交、打标签、推送
git add -A
git commit -m "release: v1.2.0"
git tag -a v1.2.0 -m "研墨 v1.2.0"
git push origin main
git push origin v1.2.0
# 5. 发 GitHub Release（说明取自 CHANGELOG）
node scripts/release.mjs --notes 1.2.0 --out release-notes.md
gh release create v1.2.0 --title "研墨 v1.2.0" --notes-file release-notes.md
```

上线后，用户打开页面时新版 Service Worker 会在后台下载，完成后页面底部提示「刷新」。

## 不能改的东西

改了它们，用户已有的数据会“消失”或读不出来：

- **localStorage 键**：`wenqu_studio`（项目库）、`wenqu_ai`（AI 设置）、`wenqu_usage`（用量）、`wenqu_style`（写作档案）、`wenqu_templates` / `wenqu_tpl_active`（排版模板）、`wenqu_basket`（收藏篮）、`wenqu_portals`（常用入口）、`wenqu_lastBackup`、`wenqu_editmode`、`wenqu_email`、`wenqu_grobid`、`wenqu_radar`、`wenqu_readlog`、`wenqu_qlang`、`wenqu_qn`、`wenqu_onboarded`、`wenqu_map_*`、`ym_pdf_scale`、`ym_sync_meta`。名字里的 `wenqu` 是旧品牌名，保留不改。
- **sessionStorage 键**：`wenqu_ai_session`（只在本次会话有效的 Key）。
- **IndexedDB**：`wenqu-idb`（`kv` 全量镜像、`vers` 归档的版本正文）、`yanmo-files`（`pdfs` 上传的 PDF、`handles` 本地同步文件句柄）。
- **备份 / 同步文件格式**：`format: "yanmo-backup"`、`formatVersion: 2`，根上保留 `projects` 和 `cur`（旧版本能直接导入）。要改格式就升 `formatVersion`，并且继续能读旧格式；MCP 服务也读这个文件。
- **项目和文献卡的字段**：只增不删、不改含义；新增字段要在 `WQCore.sanitizeProject` 里做好容错（导入的旧备份可能没有，也可能类型不对）。

## 代码约定

- 纯静态、零构建、零运行时依赖；第三方库放 `assets/vendor/`，附上许可证。
- 新模块用 IIFE（需要在 Node 里测试的用 UMD，例如 `ym-bib.js`、`ym-export.js`），对外只挂一个 `window.YMxxx`。
- 插入页面的数据一律转义（`WQCore.esc`）或经过 DOMPurify；外链只放行 http / https（`wqSafeUrl`）。
- AI 调用统一走 `WQCore.ai.stream` / `WQCore.ai.call`：计量、超时、停止都在里面；花钱的操作先用 `wqConfirmAI` 确认，并防止重复点击。
- 存储统一走 `WQCore.loadLocal` / `WQCore.saveLocal`（多标签页合并、损坏自愈都在里面），不要直接写 `localStorage.wenqu_studio`。
- 新增的 `assets/` 文件要加进 `sw.js` 的 `SHELL`，否则离线不可用（`check.mjs` 会检查）。
- 文档（`*.md`）里不要出现两个连续的左花括号或「左花括号 + 百分号」：GitHub Pages 的 Jekyll 会把它们当模板语法处理。

# 研墨 · 科研工作台

一个纯前端的科研工作台：文献、提纲、草稿、版本、引用放在一张项目导图上，AI 参与过的每一步都有记录。

- 网页版：https://www.yanmo.io/
- 专业版（可安装到桌面）：https://peacefulj.github.io/wenqu/
- 不需要后端，不需要数据库，数据默认只存在你的浏览器里。
- 当前版本：**v1.2.0**（[更新日志](CHANGELOG.md)）

## 在线试用

打开就能用，不用安装、不用注册：

| 页面 | 链接 | 说明 |
| --- | --- | --- |
| 🧪 试用与测试 | [try.html](https://peacefulj.github.io/wenqu/try.html) | 一键创建演示项目，下载示例文件（BibTeX / RIS / CSL-JSON / PDF），检测浏览器支持哪些功能 |
| 🧭 科研工作台 | [studio.html](https://peacefulj.github.io/wenqu/studio.html) | 项目工作流：选题 → 文献 → 阅读 → 写作 → 修改 → 投稿 |
| 🧰 工具台 | [studio.html?tab=search](https://peacefulj.github.io/wenqu/studio.html?tab=search) | 免建项目：检索 + 免费 PDF、AI 读论文、引用格式转换 |
| ⚡ 参考稿 | [quick.html](https://peacefulj.github.io/wenqu/quick.html) | 输入题目，生成真实文献 + 提纲 + 分节底稿（需要 AI Key） |
| 🗺 项目导图 | [map.html](https://peacefulj.github.io/wenqu/map.html) | 主题、提纲、草稿、文献、版本、校验画成一张图 |

第一次用建议从「试用与测试」开始：点「一键创建演示项目」，再按页面上的步骤把导入、PDF 批注、导出、本地同步各试一遍。

![研墨首页](assets/screenshots/home.png)

![研墨工作台](assets/screenshots/studio.png)

## 它适合做什么

- 从题目开始，检索文献、生成可编辑提纲和参考稿；
- 按本科毕设 / 硕博 / 期刊分层，按阶段推进一个研究项目；
- 在项目导图里管理主题、提纲、草稿、文献、版本和校验；
- 用“归属账本”记录哪些段落由 AI 生成、哪些经过你改写；
- 上传 PDF 在研墨里阅读、高亮、写批注，让 AI 按页精读（每条结论标注页码）；
- 引用格式一键转 GB/T 7714，并做正文与文献表的反向核对；
- 和 Zotero、Overleaf、Claude Desktop 等工具互通（见下文）。

## 它不做什么

- 不提供代写、代查、代下文献；
- 不承诺“降 AIGC 率”或规避检测；
- 不保证 AI 输出正确，所有结论都需要回原文核对。

## 快速开始

### 直接使用

打开 https://www.yanmo.io/ ，在页头的「AI / 接口设置」里填写：

- Base URL：兼容 OpenAI 的接口地址，例如 `https://yingcompute.com/v1`
- API Key：你自己的 Key
- Model：模型名

Key 只保存在当前浏览器里，不会上传到我们的服务器；在公共电脑上可以勾选「Key 只在本次会话有效」，关掉浏览器就清除。

### 自己部署

不需要构建工具，也不需要服务器：

1. Fork 本仓库；
2. 在 Settings → Pages 中选择从 `main` 分支根目录发布；
3. 打开分配到的域名；
4. 在设置里填入自己的接口地址、Key 和模型。

也可以直接把仓库放到任意静态托管（Nginx、对象存储、内网服务器）上。

## 和其他工具一起用

### Zotero / EndNote / NoteExpress

阶段②「项目文献库」：

- **导入**：在 Zotero 里选中条目或文件夹 → 右键「导出…」→ 选 BibTeX、RIS 或 CSL JSON，把文件拖进研墨的「📥 导入」窗口。导入前可以预览，重复条目（按 DOI / 题名判断）可以只补空缺字段。
- **导出**：BibTeX、RIS、CSL-JSON，或直接复制 GB/T 7714 参考文献表。

### Word / Markdown / LaTeX（Overleaf）

阶段④的导出按钮：

- **Word**：带排版预设和《AI 使用说明》（归属统计）；
- **Markdown**：带 front matter、GB/T 7714 参考文献和 AI 辅助说明，Typora、Obsidian、Pandoc 都能用；
- **LaTeX**：单个 `.tex` 文件（ctexart + gbt7714），参考文献内嵌在文件里，正文的 [n] 自动转成 `\cite{}`。上传到 Overleaf，菜单 Compiler 选 XeLaTeX 即可编译；本地用 `xelatex → bibtex → xelatex → xelatex`。

### Claude Desktop / Cursor 等 AI 客户端（MCP）

`mcp/yanmo-mcp.mjs` 是一个只读的 [MCP](https://modelcontextprotocol.io) 服务，让支持 MCP 的 AI 客户端读取你的研墨项目：项目概况、各节正文、文献库、PDF 批注与 AI 精读、全文搜索、参考文献导出（BibTeX / RIS / CSL-JSON / GB/T 7714）。零依赖，需要 Node.js 18+，不联网、不修改任何文件。

1. 在研墨工作台左侧点「🔄 开启本地同步」，选一个位置保存 `yanmo-sync.json`（需要 Chrome 或 Edge）；之后每次修改都会自动写进这个文件。也可以用「⤓ 备份全部」导出的备份文件，只是不会自动更新。
2. 下载本仓库（`git clone` 或 Code → Download ZIP）。
3. 在 AI 客户端的 MCP 配置里加上（以 Claude Desktop 的 `claude_desktop_config.json` 为例，路径换成你自己的）：

```json
{
  "mcpServers": {
    "yanmo": {
      "command": "node",
      "args": ["D:/code/wenqu/mcp/yanmo-mcp.mjs", "--file", "D:/研墨/yanmo-sync.json"]
    }
  }
}
```

可用的工具：`list_projects`、`get_project`、`read_section`、`list_papers`、`get_paper`、`search`、`export_references`、`get_annotations`。运行 `node mcp/yanmo-mcp.mjs --help` 查看说明。

## 技术结构

```text
index.html / quick.html / studio.html / map.html     页面（workbench.html、tools.html 是旧地址跳转）
try.html              试用与测试：演示项目、示例文件、浏览器检测、功能自测
assets/
  version.js     版本号（唯一来源）与更新提示
  wq-core.js     存储（多标签页合并、备份格式）、AI 调用、流水线、diff、账本
  wq-quick.js    参考稿：文献检索、提纲、分节写作
  studio.js      项目与章节管理、导出
  wq-ui.js       修改工作台、富文本编辑器、导出增强
  wb.js          工具台：检索、读论文、引用、设置
  wq-map.js      项目导图
  ym-bib.js      BibTeX / RIS / CSL-JSON 解析与输出、GB/T 7714 格式化
  ym-refs.js     文献导入导出界面
  ym-pdf.js      PDF 阅读器、批注、AI 精读
  ym-export.js   Markdown / LaTeX 导出
  ym-sync.js     本地同步文件
  ym-selftest.js 功能自测用例（scripts/check.mjs 与 try.html 共用）
  ym-try.js      试用与测试页
  demo/          示例文件：sample.bib / sample.ris / sample-csl.json、demo-paper.pdf（虚构内容）
  paradigms.js   学科范式与层级配置
  vendor/        cytoscape、marked、pdf.js、DOMPurify、citation.js
mcp/yanmo-mcp.mjs     只读 MCP 服务
scripts/check.mjs     发布前自检
scripts/release.mjs   发版脚本
sw.js                 Service Worker（PWA 离线缓存）
```

- **存储**：localStorage 保存项目快照、AI 设置和用量；IndexedDB 保存全量镜像、归档的长版本和上传的 PDF。多个标签页同时编辑时按项目合并。
- **AI**：标准 Chat Completions 接口，流式输出，优先使用接口返回的 usage 计量。
- **文献**：OpenAlex 公开接口，按 DOI / 标题去重，摘要由倒排索引还原。
- **可追溯**：段落级 diff 计算人工贡献度，修改写入账本，关键操作使用 SHA-256 哈希链。
- **离线**：Service Worker 预缓存应用外壳；文献检索和 AI 请求需要联网。

## 数据与隐私

- 项目数据默认只存在当前浏览器，**没有云端账号同步**；
- 想在别处也留一份，可以开启「本地同步」把数据自动写进本机文件（放在网盘目录里就能跟着网盘走），或定期「⤓ 备份全部」；
- 上传的 PDF 只存在当前浏览器，备份文件里不含 PDF 原文件（批注和精读结果会备份）；
- 使用 AI 功能时，相关文字（包括 AI 精读时的 PDF 全文）会发给你在设置里配置的模型服务——审稿中、涉密、含个人信息的材料请不要用；
- API Key 存在本机浏览器，公共电脑请勾选「Key 只在本次会话有效」；建议使用单独的 Key 并设置额度。

## 版本与更新

- 版本号遵循语义化版本，每次发布都有[更新日志](CHANGELOG.md)、git 标签和 [GitHub Release](https://github.com/peacefulj/wenqu/releases)；
- 页面底部显示当前版本，点击可以查看更新日志；
- 新版本上线后，打开页面时会在后台下载，完成后页面底部提示「刷新」。

## 已知限制

- 中文文献覆盖有限，知网全文需要自行下载后导入；
- 参考稿 Agent 仍在迭代，日常更推荐“项目工作流 + 工具台”；
- 本地同步需要 Chrome / Edge（File System Access API），并且每次重新打开页面要点一下「继续同步」授权；
- PDF 高亮和 AI 精读需要文字版 PDF，扫描版只能阅读；
- LaTeX 导出需要用 XeLaTeX 编译；
- MCP 服务只读，数据以同步文件为准，可能比浏览器里稍旧；
- 依赖较新的 JavaScript 语法，旧浏览器可能无法运行。

## 开发

没有打包步骤，修改 `assets/` 下的文件后刷新页面即可。提交前运行 `node scripts/check.mjs`，并在浏览器里打开 `try.html` 看一遍检测和自测结果；版本规则、发版步骤和不能改动的存储键名见 [CONTRIBUTING.md](CONTRIBUTING.md)。

欢迎提 issue 和 PR：修 bug、接新的模型服务商、补文献源、改界面都可以。

## License

[MIT](LICENSE)

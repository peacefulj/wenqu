# 研墨 · Cloudflare Worker 中转

给**网页版**用：部分服务商（如腾讯 TokenHub）的 `OPTIONS` 返回 405，浏览器带 `Authorization` 的请求会被跨域预检拦下，表现为 `Failed to fetch`。这个 Worker 把请求转发到上游，并自己回答预检。

> 桌面版 exe 不需要它（内置了本机中转）。

## 部署方式一：控制台粘贴（不用装任何东西）

1. 打开 https://dash.cloudflare.com/ → **Workers & Pages** → **Create** → **Worker**
2. 名称填 `yanmo-relay`，**Deploy**
3. 点 **Edit code**，把 `worker.js` 全文粘进去 → **Deploy**
4. 进 **Settings → Variables and Secrets**，加两个变量：
   - `UPSTREAM` = `https://tokenhub.tencentmaas.com/v1`
   - `ALLOWED_ORIGINS` = `https://peacefulj.github.io,https://www.yingcompute.com`
5. 记下地址，形如 `https://yanmo-relay.<你的子域>.workers.dev`

## 部署方式二：命令行

```bash
cd wenqu/relay
npx wrangler login          # 浏览器里授权一次
npx wrangler deploy
```

## 部署方式三：临时预览（不用登录，60 分钟有效）

```bash
cd wenqu/relay
npx wrangler deploy --temporary
```

会创建一个临时账号并给出 `https://yanmo-relay.<随机名>.workers.dev`，同时打印一个 `claim-preview` 认领链接——60 分钟内用 Cloudflare 账号打开该链接认领，Worker 就永久留在你的账号下；不认领则到期自动回收。适合先验证能不能通，再决定是否正式部署。

## 在研墨里接上

打开 https://peacefulj.github.io/wenqu/studio.html → 「⚙️ AI / 接口设置」：

- 服务商：**自定义**
- API 地址：`https://yanmo-relay.<你的子域>.workers.dev/v1`
- 模型：`deepseek/deepseek-flash`
- API Key：你的 TokenHub Key
- 点「测试连接」→ 应显示「连接正常，可用模型 N 个」

接口格式保持「自动识别」即可。

## 说明

- Key 只在每次请求里透传给上游，Worker **不保存、不打印**任何 Key
- 默认只允许 `ALLOWED_ORIGINS` 里的站点调用；别人的站点调用会返回 403
- 想额外加一道口令：设 `RELAY_TOKEN`，但研墨界面目前不会带这个头，需自行在 `ym-ai.js` 里加请求头（一般不必）
- 免费额度：Workers 每天 10 万次请求，个人用足够
- 换服务商只需改 `UPSTREAM`，例如 `https://api.deepseek.com/v1`

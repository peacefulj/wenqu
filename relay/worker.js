/* 研墨 · Cloudflare Worker 中转
 *
 * 作用：给网页版加一层同源/跨域友好的转发，解决部分服务商（如腾讯 TokenHub）
 *       OPTIONS 返回 405、浏览器预检被拒导致的「Failed to fetch」。
 *
 * 用法：部署后把服务地址填到 研墨 → AI 设置 → 自定义 → API 地址，
 *       例如 https://yanmo-relay.你的子域.workers.dev/v1
 *
 * 安全：默认只允许 ALLOWED_ORIGINS 里的站点调用；不保存、不打印任何 Key。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = String(env.ALLOWED_ORIGINS || "https://peacefulj.github.io")
      .split(",").map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const okOrigin = allowed.includes("*") || (origin && allowed.includes(origin));

    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : (allowed[0] || "*"),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Request-ID,X-Relay-Token",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const deny = (code, msg) => new Response(JSON.stringify({ error: { message: msg } }), {
      status: code,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
    });

    /* 预检：直接放行，这一步是关键（上游服务商往往不支持 OPTIONS） */
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "POST") return deny(405, "只支持 GET / POST");
    if (!okOrigin) return deny(403, "来源未授权：" + (origin || "(空)") + "；请在 Worker 变量 ALLOWED_ORIGINS 里加上它");

    if (env.RELAY_TOKEN) {
      const got = request.headers.get("x-relay-token") || url.searchParams.get("k") || "";
      if (got !== env.RELAY_TOKEN) return deny(401, "中转口令不正确（RELAY_TOKEN）");
    }

    const upstream = String(env.UPSTREAM || "https://tokenhub.tencentmaas.com/v1").replace(/\/+$/, "");
    /* 前端把中转地址填成 https://xxx.workers.dev/v1，请求就是 /v1/chat/completions；
       上游本身已带 /v1，这里去掉重复的一段。填成 https://xxx.workers.dev（不带 /v1）也兼容。 */
    let path = url.pathname;
    const upPath = new URL(upstream).pathname.replace(/\/+$/, "");
    if (upPath && upPath !== "/" && (path === upPath || path.startsWith(upPath + "/"))) {
      path = path.slice(upPath.length) || "/";
    }
    const target = upstream + path + url.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("origin");
    headers.delete("referer");
    headers.delete("cf-connecting-ip");

    let res;
    try {
      const init = { method: request.method, headers, redirect: "follow" };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        /* Node 20+ 要求显式 duplex；Workers 运行时没有 process，不受影响 */
        if (typeof process !== "undefined" && process.versions && process.versions.node) init.duplex = "half";
      }
      res = await fetch(target, init);
    } catch (e) {
      return deny(502, "中转连不上上游：" + (e && e.message ? e.message : e));
    }

    /* 流式响应（SSE）直接透传；去掉会干扰浏览器的编码/长度头 */
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    Object.entries(cors).forEach(([k, v]) => out.set(k, v));
    return new Response(res.body, { status: res.status, headers: out });
  }
};

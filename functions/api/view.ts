// POST /api/view — 匿名埋点（前端 sendBeacon 调用）
// 参数：p=路径(页面视图)  click=分类(商品点击)  uid=访客id(当日UV去重, 前端本地生成)
//       ref=流量来源(utm_source/外部 referrer 域名)
//       err=前端错误摘要  src/ln/col=错误来源文件/行/列
// 国家取 Cloudflare 的 request.cf.country，前端无需传。
import { json, rateLimited, type Env } from "../_shared/core";
import { recordView, isBotUA } from "../_shared/analytics";

async function handle({ request, env }: { request: Request; env: Env }): Promise<Response> {
  /* 爬虫/无头浏览器直接丢弃，避免污染 PV/UV */
  if (isBotUA(request.headers.get("user-agent"))) {
    return json({ ok: true, skipped: "bot" });
  }
  /* 限流：每 IP 每分钟最多 60 次埋点，遏制刷量与 KV 键泛滥 */
  if (await rateLimited(env, request, { scope: "view", limit: 60, windowSec: 60 })) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  const u = new URL(request.url);
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  const result = await recordView(env, {
    path: u.searchParams.get("p") || undefined,
    click: u.searchParams.get("click") || undefined,
    uid: u.searchParams.get("uid") || undefined,
    err: u.searchParams.get("err") || undefined,
    src: u.searchParams.get("src") || undefined,
    ln: u.searchParams.get("ln") || undefined,
    col: u.searchParams.get("col") || undefined,
    ref: u.searchParams.get("ref") || undefined,
    country: cf ? cf.country : undefined,
  });
  return json({ ok: true, uvNew: result.uvNew });
}

export const onRequestPost = handle;
export const onRequestGet = handle;
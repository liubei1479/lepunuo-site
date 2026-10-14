// 共享运行时：Env / 响应 / 管理鉴权（精简自 lepunuo-deals）
export interface Env {
  LEPUNUO_ANALYTICS: KVNamespace;
  /** 后台口令：wrangler pages secret put ADMIN_TOKEN --project-name lepunuo */
  ADMIN_TOKEN?: string;
  /** 图表口令：/api/chart 用 query 参数鉴权（图片 URL 带不了 Authorization 头） */
  CHART_TOKEN?: string;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" },
  });
}

/** Bearer 口令鉴权（/admin 后台与报告接口使用） */
export function isAdmin(request: Request, env: Env): boolean {
  const t = env.ADMIN_TOKEN;
  if (!t) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${t}`;
}

/** 简易限流：同一 IP 在时间窗内超过 limit 次即拒绝（KV 计数，近似限流即可）。
    用于 /api/view 等匿名接口，遏制刷量与 KV 键泛滥。返回 true 表示应拒绝。 */
export async function rateLimited(
  env: Env,
  request: Request,
  opts: { scope: string; limit: number; windowSec: number }
): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const bucket = Math.floor(Date.now() / (opts.windowSec * 1000));
  const key = `rl:${opts.scope}:${bucket}:${ip}`;
  const cur = Number((await env.LEPUNUO_ANALYTICS.get(key)) || "0");
  if (cur >= opts.limit) return true;
  await env.LEPUNUO_ANALYTICS.put(key, String(cur + 1), { expirationTtl: opts.windowSec * 2 });
  return false;
}
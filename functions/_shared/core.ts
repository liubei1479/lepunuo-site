// 共享运行时：Env / 响应 / 管理鉴权（精简自 lepunuo-deals）
export interface Env {
  LEPUNUO_ANALYTICS: KVNamespace;
  /** 后台口令：wrangler pages secret put ADMIN_TOKEN --project-name lepunuo */
  ADMIN_TOKEN?: string;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Bearer 口令鉴权（/admin 后台与报告接口使用） */
export function isAdmin(request: Request, env: Env): boolean {
  const t = env.ADMIN_TOKEN;
  if (!t) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${t}`;
}
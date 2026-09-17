// GET /api/analytics — 后台看板数据（Bearer ADMIN_TOKEN）
import { json, isAdmin, type Env } from "../_shared/core";
import { buildAnalytics } from "../_shared/analytics";

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  if (!isAdmin(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const data = await buildAnalytics(env);
  return json({ ok: true, ...data });
};
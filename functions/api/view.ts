// POST /api/view — 匿名埋点（前端 sendBeacon 调用）
// 参数：p=路径(页面视图)  click=分类(商品点击)  uid=会话id(当日UV去重, 非持久)  err=前端错误摘要
import { json, type Env } from "../_shared/core";
import { recordView } from "../_shared/analytics";

async function handle({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const u = new URL(request.url);
  const result = await recordView(env, {
    path: u.searchParams.get("p") || undefined,
    click: u.searchParams.get("click") || undefined,
    uid: u.searchParams.get("uid") || undefined,
    err: u.searchParams.get("err") || undefined,
  });
  return json({ ok: true, uvNew: result.uvNew });
}

export const onRequestPost = handle;
export const onRequestGet = handle;
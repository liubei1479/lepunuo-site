// POST /api/view — 匿名埋点（前端 sendBeacon 调用）
// 参数：p=路径(页面视图)  click=分类(商品点击)  uid=访客id(当日UV去重, 前端本地生成)
//       ref=流量来源(utm_source/外部 referrer 域名)
//       err=前端错误摘要  src/ln/col=错误来源文件/行/列
// 国家取 Cloudflare 的 request.cf.country，前端无需传。
//
// ⚠️ 临时诊断：probe() 记录 UA + IP 网段指纹与访问时间，用于定位固定频率访问源。
//    抓取窗口结束后整体删除本文件中的 PROBE 相关代码。
import { json, rateLimited, type Env } from "../_shared/core";
import { recordView, isBotUA, dateKey } from "../_shared/analytics";

/* ===== 临时诊断（抓完即删）===== */
const PROBE_TTL = 172_800; // 48h 自动过期
const PROBE_MAX_TIMES = 40;

type CfInfo = {
  country?: string;
  city?: string;
  asn?: number;
  asOrganization?: string;
  timezone?: string;
  botManagement?: { score?: number; verifiedBot?: boolean };
};

/** 只保留网段：IPv4 记 /24，IPv6 记 /64，避免落盘完整 IP */
function ipNet(ip: string): string {
  if (!ip) return "-";
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip.split(".").slice(0, 3).join(".") + ".0/24";
}

async function probe(env: Env, request: Request, cf: CfInfo | undefined): Promise<void> {
  const ua = String(request.headers.get("user-agent") || "").slice(0, 220);
  const net = ipNet(String(request.headers.get("cf-connecting-ip") || ""));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ua}|${net}`));
  const id = Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const day = dateKey();
  const cntKey = `v:probe:${day}:${id}`;
  const cur = Number((await env.LEPUNUO_ANALYTICS.get(cntKey)) || "0");
  await env.LEPUNUO_ANALYTICS.put(cntKey, String(cur + 1), { expirationTtl: PROBE_TTL });

  const infoKey = `v:probeinfo:${id}`;
  let prev: { times?: number[]; first?: number } = {};
  const raw = await env.LEPUNUO_ANALYTICS.get(infoKey);
  if (raw) {
    try { prev = JSON.parse(raw); } catch { prev = {}; }
  }
  const now = Date.now();
  const times = ((prev.times || []).concat(now)).slice(-PROBE_MAX_TIMES);
  await env.LEPUNUO_ANALYTICS.put(
    infoKey,
    JSON.stringify({
      ua,
      net,
      cc: cf?.country || "",
      city: cf?.city || "",
      asn: cf?.asn || 0,
      asOrg: cf?.asOrganization || "",
      tz: cf?.timezone || "",
      botScore: cf?.botManagement?.score ?? -1,
      first: prev.first || now,
      last: now,
      times,
    }),
    { expirationTtl: PROBE_TTL }
  );
}
/* ===== 临时诊断结束 ===== */

async function handle({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const cf = (request as unknown as { cf?: CfInfo }).cf;
  /* 诊断放在过滤之前：可疑来源往往伪装 UA，必须看到它再决定是否计入 */
  await probe(env, request, cf);

  /* 爬虫/无头浏览器直接丢弃，避免污染 PV/UV */
  if (isBotUA(request.headers.get("user-agent"))) {
    return json({ ok: true, skipped: "bot" });
  }
  /* 限流：每 IP 每分钟最多 60 次埋点，遏制刷量与 KV 键泛滥 */
  if (await rateLimited(env, request, { scope: "view", limit: 60, windowSec: 60 })) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  const u = new URL(request.url);
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

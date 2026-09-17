// 统计逻辑：匿名 PV/UV/点击/错误计数（无 cookie、不存身份），KV 键 30 天自动过期
// 供 /api/view（埋点）、/api/analytics（看板）、每日报告复用
import { type Env } from "./core";

export const TTL_30D = 2_592_000;
const OFF = 8 * 3600 * 1000; // UTC+8 桶口径

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(ms: number = Date.now()): string {
  const d = new Date(ms + OFF);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function hourKey(ms: number): string {
  const d = new Date(ms + OFF);
  return `${dateKey(ms)}_${pad(d.getUTCHours())}`;
}

async function incr(env: Env, key: string, ttl = TTL_30D): Promise<void> {
  const cur = Number((await env.LEPUNUO_ANALYTICS.get(key)) || "0");
  await env.LEPUNUO_ANALYTICS.put(key, String(cur + 1), { expirationTtl: ttl });
}

/** 路径归一化（空→"/"，去尾斜杠，限长） */
export function normalizePath(raw: string): string {
  let p = String(raw || "").trim().toLowerCase();
  if (!p) return "/";
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p.slice(0, 100);
}

export interface ViewMeta {
  uvNew: boolean;
}

/** 埋点落库：PV + 页面维度 + 当日 UV（会话 uid）+ 可选点击分类 + 可选前端错误 */
export async function recordView(
  env: Env,
  opts: { path?: string; click?: string; uid?: string; err?: string }
): Promise<ViewMeta> {
  const day = dateKey();
  const path = normalizePath(opts.path);
  const uid = String(opts.uid || "").slice(0, 40);
  const click = String(opts.click || "").slice(0, 40);

  await incr(env, `v:pv:${day}`);
  await incr(env, `v:pv:hour:${hourKey(Date.now())}`);
  await incr(env, `v:pg:${day}:${encodeURIComponent(path)}`);

  let uvNew = false;
  if (uid) {
    const uvKey = `v:uv:${day}:${uid}`;
    if (!(await env.LEPUNUO_ANALYTICS.get(uvKey))) {
      await env.LEPUNUO_ANALYTICS.put(uvKey, "1", { expirationTtl: TTL_30D });
      uvNew = true;
    }
  }

  if (click) {
    await incr(env, `v:clk:${day}`);
    await incr(env, `v:clkcat:${day}:${encodeURIComponent(click)}`);
  }

  if (opts.err) {
    await incr(env, `v:err:${day}`);
    await recordErrSample(env, String(opts.err).slice(0, 160));
  }

  return { uvNew };
}

/** 错误样例（保留最近 100 条） */
async function recordErrSample(env: Env, msg: string): Promise<void> {
  const key = "v:errlist";
  let list: string[] = [];
  const raw = await env.LEPUNUO_ANALYTICS.get(key);
  if (raw) {
    try { list = JSON.parse(raw); } catch { list = []; }
  }
  list.unshift(`${dateKey()} ${msg}`);
  list = list.slice(0, 100);
  await env.LEPUNUO_ANALYTICS.put(key, JSON.stringify(list), { expirationTtl: TTL_30D });
}

async function scanKeys(env: Env, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.LEPUNUO_ANALYTICS.list({ prefix, cursor, limit: 1000 });
    out.push(...page.keys.map((k) => k.name));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

function recentDates(count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(dateKey(Date.now() - i * 86_400_000));
  return out;
}

export interface Analytics {
  today: { date: string; pv: number; uv: number; clicks: number; errors: number };
  series30: { date: string; pv: number; uv: number; clicks: number }[];
  hour24: { hour: number; pv: number }[];
  topPaths: { path: string; pv: number }[];
  clickByCat: { cat: string; clicks: number }[];
  errors: { todayCount: number; recent: string[] };
}

export async function buildAnalytics(env: Env): Promise<Analytics> {
  const today = dateKey();
  const last30 = recentDates(30);
  const last7 = new Set(recentDates(7));

  const pvByDay: Record<string, number> = {};
  const hour24 = Array.from({ length: 24 }, (_, i) => ({ hour: i, pv: 0 }));
  for (const k of await scanKeys(env, "v:pv:hour:")) {
    const m = k.match(/^v:pv:hour:(\d{8})_(\d{2})$/);
    if (!m) continue;
    const [, day, hh] = m;
    const v = Number((await env.LEPUNUO_ANALYTICS.get(k)) || 0);
    pvByDay[day] = (pvByDay[day] || 0) + v;
    if (day === today) hour24[Number(hh)].pv += v;
  }

  const uvByDay: Record<string, number> = {};
  for (const k of await scanKeys(env, "v:uv:")) {
    const m = k.match(/^v:uv:(\d{8}):/);
    if (m) uvByDay[m[1]] = (uvByDay[m[1]] || 0) + 1;
  }

  const clkByDay: Record<string, number> = {};
  for (const k of await scanKeys(env, "v:clkcat:")) {
    const m = k.match(/^v:clkcat:(\d{8}):(.+)$/);
    if (!m) continue;
    const v = Number((await env.LEPUNUO_ANALYTICS.get(k)) || 0);
    if (last7.has(m[1])) {
      const cat = decodeURIComponent(m[2]);
      clkByDay[cat] = (clkByDay[cat] || 0) + v;
    }
  }
  const clickByCat = Object.entries(clkByDay)
    .map(([cat, clicks]) => ({ cat, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 12);

  const pageMap: Record<string, number> = {};
  for (const k of await scanKeys(env, "v:pg:")) {
    const m = k.match(/^v:pg:(\d{8}):(.+)$/);
    if (!m || !last7.has(m[1])) continue;
    const path = decodeURIComponent(m[2]);
    pageMap[path] = (pageMap[path] || 0) + Number((await env.LEPUNUO_ANALYTICS.get(k)) || 0);
  }
  const topPaths = Object.entries(pageMap)
    .map(([path, pv]) => ({ path, pv }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 10);

  const todayPv = pvByDay[today] || 0;
  const clicksToday = Number((await env.LEPUNUO_ANALYTICS.get(`v:clk:${today}`)) || 0);
  const errorsToday = Number((await env.LEPUNUO_ANALYTICS.get(`v:err:${today}`)) || 0);
  let errRecent: string[] = [];
  const rawErr = await env.LEPUNUO_ANALYTICS.get("v:errlist");
  if (rawErr) { try { errRecent = JSON.parse(rawErr); } catch { errRecent = []; } }

  const series30: Analytics["series30"] = [];
  for (const day of last30) {
    series30.push({
      date: day,
      pv: pvByDay[day] || 0,
      uv: uvByDay[day] || 0,
      clicks: Number((await env.LEPUNUO_ANALYTICS.get(`v:clk:${day}`)) || 0),
    });
  }

  return {
    today: { date: today, pv: todayPv, uv: uvByDay[today] || 0, clicks: clicksToday, errors: errorsToday },
    series30,
    hour24,
    topPaths,
    clickByCat,
    errors: { todayCount: errorsToday, recent: errRecent },
  };
}
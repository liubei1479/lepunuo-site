// GET /api/chart?token=CHART_TOKEN — 生成流量图表 SVG（供钉钉报告消息内嵌）
// 说明：图片 URL 无法携带 Authorization 头，故用独立 CHART_TOKEN（query 参数）鉴权
import { type Env } from "../_shared/core";
import { buildAnalytics, dateKey } from "../_shared/analytics";

const INK = "#111111";
const MUT = "#8b8b8b";
const LINE = "#eeeeee";
const RED = "#e5484d";

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const u = new URL(request.url);
  const t = u.searchParams.get("token") || "";
  if (!env.CHART_TOKEN || t !== env.CHART_TOKEN) {
    return new Response("Forbidden", { status: 403 });
  }
  const a = await buildAnalytics(env);
  const svg = render(a);
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

function render(a: Awaited<ReturnType<typeof buildAnalytics>>): string {
  const W = 800, H = 420, pad = 28;
  const s30 = a.series30.slice(-30);
  const maxPv = Math.max(1, ...s30.map((x) => x.pv), ...a.hour24.map((x) => x.pv));
  const today = a.today;

  const bars30 = s30
    .map((x, i) => {
      const bw = (W - pad * 2) / s30.length;
      const bh = (x.pv / maxPv) * 150;
      const bx = pad + i * bw;
      const y = 190 - bh;
      const hl = x.pv > 0 ? `fill:${INK};` : `fill:${LINE};`;
      return `<rect x="${bx.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" style="${hl}"/>`;
    })
    .join("");

  let hourCells = "";
  for (let i = 0; i < 24; i++) {
    const v = a.hour24[i].pv;
    const cw = (W - pad * 2) / 24;
    const ch = (v / maxPv) * 60;
    const x = pad + i * cw;
    hourCells += `<rect x="${x.toFixed(1)}" y="${330 - ch}" width="${(cw * 0.7).toFixed(1)}" height="${ch.toFixed(1)}" rx="2" style="fill:${v > 0 ? INK : LINE};"/>`;
  }

  const topCat = a.clickByCat.slice(0, 4)
    .map((c, i) => `<text x="${W - pad}" y="${120 + i * 26}" text-anchor="end" font-size="20" font-family="Segoe UI, sans-serif" fill="${INK}">${esc(c.cat)} … ${c.clicks}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${INK}"/>
  <text x="${pad}" y="34" font-size="22" font-weight="700" font-family="Segoe UI, sans-serif" fill="${INK}">LEPUNUO 流量概况 · ${dateKey()}</text>

  <text x="${pad}" y="66" font-size="15" font-family="Segoe UI, sans-serif" fill="${MUT}">今日</text>
  <text x="${pad}" y="92" font-size="26" font-weight="700" font-family="Segoe UI, sans-serif" fill="${INK}">PV ${today.pv}</text>
  <text x="${pad + 130}" y="92" font-size="26" font-weight="700" font-family="Segoe UI, sans-serif" fill="${INK}">UV ${today.uv}</text>
  <text x="${pad + 260}" y="92" font-size="26" font-weight="700" font-family="Segoe UI, sans-serif" fill="${INK}">点击 ${today.clicks}</text>
  <text x="${pad + 420}" y="92" font-size="26" font-weight="700" font-family="Segoe UI, sans-serif" fill="${today.errors > 0 ? RED : INK}">错误 ${today.errors}</text>

  <text x="${pad}" y="122" font-size="13" font-family="Segoe UI, sans-serif" fill="${MUT}">近 30 天浏览（${s30[0]?.date.slice(4)} - ${s30[29]?.date.slice(4)}）</text>
  <rect x="${pad}" y="132" width="${W - pad * 2}" height="1" fill="${LINE}"/>
  ${bars30}

  <text x="${pad}" y="230" font-size="13" font-family="Segoe UI, sans-serif" fill="${MUT}">今日 24 小时分布</text>
  <rect x="${pad}" y="240" width="${W - pad * 2}" height="1" fill="${LINE}"/>
  ${hourCells}

  <text x="${W - pad}" y="92" text-anchor="end" font-size="15" font-family="Segoe UI, sans-serif" fill="${MUT}">点击 Top 分类（7天）</text>
  ${topCat}
</svg>`;
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
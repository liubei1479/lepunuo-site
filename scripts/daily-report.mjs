// scripts/daily-report.mjs — 每日巡检报告 + 流量预警 + 钉钉推送
// 用法: ADMIN_TOKEN=... node scripts/daily-report.mjs
//       （设置 DINGTALK_WEBHOOK 时推送到钉钉群机器人；未设置则仅打印，供本地调试）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://lepunuo.com";
const DEALS = "https://lepunuodeals.com/digest.json";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const WEBHOOK = process.env.DINGTALK_WEBHOOK || "";

async function check(url, kind = "GET") {
  try {
    const r = await fetch(url, { method: kind, redirect: "follow", signal: AbortSignal.timeout(20000) });
    return { ok: r.ok, status: r.status, ms: 0 };
  } catch (e) {
    return { ok: false, status: "ERR", ms: 0, err: e.message };
  }
}

function pct(a, b) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

const now = new Date();
const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

// 1) 健康巡检
const assets = [
  ["首页", SITE + "/"],
  ["样式", SITE + "/css/style.css"],
  ["主逻辑", SITE + "/js/app.js"],
  ["埋点", SITE + "/js/analytics.js"],
  ["数据", SITE + "/data/data.js"],
];
const health = [];
for (const [name, url] of assets) {
  const r = await check(url);
  health.push({ name, ...r });
}
const badHealth = health.filter((h) => !h.ok || h.status !== 200);

// 2) 流量 + 预警
let analytics = null;
if (ADMIN_TOKEN) {
  try {
    const r = await fetch(SITE + "/api/analytics", { headers: { Authorization: "Bearer " + ADMIN_TOKEN } });
    if (r.ok) analytics = await r.json();
  } catch {}
}

const warn = [];
let flowMd = "· 未配置 ADMIN_TOKEN，跳过流量统计";
let errorLine = false;
let diffText = "数据不足";
if (analytics) {
  const s30 = analytics.series30 || [];
  const prior = s30.slice(-8, -1).map((x) => x.pv).filter((n) => n > 0);
  const avg7 = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  const today = analytics.today || {};
  const diff = pct(today.pv, avg7);

  if (today.pv === 0 && avg7 > 0) warn.push("⚠️ 今日流量为 0（近 7 日均值 " + Math.round(avg7) + "）");
  if (diff !== null && diff <= -50) warn.push("⚠️ 今日 PV 较近 7 日均值下降 " + diff + "%");
  if (diff !== null && diff >= 100) warn.push("ℹ️ 今日 PV 较近 7 日均值上升 " + diff + "%（推广高峰？）");
  if (today.errors > 0) { warn.push("⚠️ 今日前端错误 " + today.errors + " 条"); errorLine = true; }
  if (diff !== null) diffText = diff >= 0 ? "+" + diff + "%" : diff + "%";

  flowMd =
    `**今日**：PV **${today.pv || 0}** ｜ UV **${today.uv || 0}** ｜ 点击 **${today.clicks || 0}** ｜ 错误 **${today.errors || 0}**\n` +
    `**较近7日均值**：${diffText}`;
}

// 3) 促销状态
let dealsActive = "·";
try {
  const r = await fetch(DEALS);
  if (r.ok) {
    const list = await r.json();
    dealsActive = String(list.filter((d) => new Date(d.expiresAt) > new Date()).length);
  }
} catch {}

// 4) 组装（钉钉 markdown：要点式排版 + 内嵌图表图片）
const alertText = badHealth.length ? "⚠️ 巡检发现异常，请尽快处理" : "✅ 全站巡检正常";

let healthMd = "";
for (const h of health) {
  healthMd += `\n> ${h.name} ${h.ok && h.status === 200 ? "✅" : "❌ " + (h.status || h.err)}`;
}

// 内嵌图表：需要 CHART_TOKEN（与后端 chart 端点一致）；缺失时自动省略图片
let chartMd = "";
const chartToken = process.env.CHART_TOKEN || "";
if (chartToken) chartMd = `\n![LEPUNUO 流量图](${SITE}/api/chart?token=${encodeURIComponent(chartToken)})\n`;

const warnMd = warn.length
  ? "\n**预警**\n" + warn.map((w) => `> ${w}`).join("\n")
  : "\n**预警**：✅ 无异常";

const errMd = analytics && errorLine
  ? "\n**最近前端错误**\n" + ((analytics.errors.recent || []).slice(0, 3).map((e) => `> ${e}`).join("\n"))
  : "";

const text =
  `## LEPUNUO 每日巡检\n` +
  `**${alertText}**\n` +
  chartMd +
  `\n**今日指标**\n${flowMd}` +
  `\n\n**站点健康**${healthMd}` +
  `\n\n**促销**：当前有效 ${dealsActive} 款` +
  warnMd +
  errMd +
  `\n\n---\n🤖 *自动生成 · lepunuo-site*`;

console.log(text);

if (WEBHOOK) {
  const body = {
    msgtype: "markdown",
    markdown: { title: "LEPUNUO 巡检 " + dateStr, text },
  };
  const r = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("\n[dingtalk] HTTP", r.status);
  try {
    const j = await r.json();
    console.log("[dingtalk] errcode:", j.errcode, "| errmsg:", j.errmsg);
    if (j.errcode && j.errcode !== 0) process.exitCode = 1;
  } catch { /* response not json */ }
  if (!r.ok) process.exitCode = 1;
}
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

function bar(n, max, w = 18) {
  if (!max) return "·".repeat(w);
  const c = Math.min(w, Math.max(0, Math.round((n / max) * w)));
  return "█".repeat(c) + "░".repeat(w - c);
}

const now = new Date();
const todayStr = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;

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
if (analytics) {
  const s30 = analytics.series30 || [];
  const prior = s30.slice(-8, -1).map((x) => x.pv).filter((n) => n > 0);
  const avg7 = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  const today = analytics.today || {};
  const diff = pct(today.pv, avg7);

  if (today.pv === 0 && avg7 > 0) warn.push("⚠️ 今日流量为 0（近 7 日均值 " + Math.round(avg7) + "），疑似异常");
  if (diff !== null && diff <= -50) warn.push("⚠️ 今日 PV 较近 7 日均值下降 " + diff + "%");
  if (diff !== null && diff >= 100) warn.push("ℹ️ 今日 PV 较近 7 日均值上升 " + diff + "%（可能是推广/曝光高峰）");
  if (today.errors > 0) { warn.push("⚠️ 今日前端错误 " + today.errors + " 条"); errorLine = true; }

  flowMd =
    `今日 PV **${today.pv || 0}** · UV **${today.uv || 0}** · 点击 **${today.clicks || 0}** · 错误 **${today.errors || 0}**\n` +
    `较近7日均值(≈${Math.round(avg7)}): ${diff === null ? "数据不足" : diff >= 0 ? "+" + diff + "%" : diff + "%"}\n\n` +
    `**近7天 PV**\n` +
    s30.slice(-7).map((x) => `\`${x.date.slice(4)}\` ${bar(x.pv, avg7 || 1)} ${x.pv}`).join("\n");
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

// 4) 组装
const alertText = badHealth.length ? "⚠️ 巡检发现异常，请尽快处理" : "✅ 全站巡检正常";
const lines = [
  `## LEPUNUO 每日巡检 · ${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
  "",
  `**${alertText}**`,
  "",
  "**站点健康**",
];
health.forEach((h) => lines.push(`- ${h.name}: ${h.ok && h.status === 200 ? "✅ 200" : "❌ " + (h.status || h.err)}`));
lines.push("", "**流量与预警**", flowMd, "");
lines.push("**有效促销款数**: " + dealsActive);
if (analytics && errorLine) {
  const recent = ((analytics.errors && analytics.errors.recent) || []).slice(0, 3);
  if (recent.length) lines.push("", "**最近前端错误**", ...recent.map((e) => "- " + e));
}
if (warn.length) lines.push("", "**预警**", ...warn);
lines.push("", "— 自动生成 lepunuo-site · daily-report");

const text = lines.join("\n");
console.log(text);

if (WEBHOOK) {
  const body = {
    msgtype: "markdown",
    markdown: { title: "LEPUNUO 巡检", text },
  };
  const r = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("\n[dingtalk] HTTP", r.status);
  if (!r.ok) process.exit(1);
}
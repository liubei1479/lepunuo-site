/* data/sync_deals.js — 促销数据同步脚本
   用法：
     node data/sync_deals.js                       # 读本地 lepunuo-deals/data/deals.json（开发环境）
     node data/sync_deals.js --online              # 读线上 https://lepunuodeals.com/digest.json（CI 用）
   - 数据源优先级：DEALS_JSON(env) > 本地 deals.json > 线上 digest.json(--online)
   - 过滤当前仍有效（expiresAt > now），按 ASIN 去重
   - 以 款号→ASIN→名称词集 三级匹配主库 data.js 并写入 deal 字段
   - 促销过期后重跑脚本即可自动清除旧标记
   依赖：Node 18+（内置 fetch）。 */

const fs = require("fs");
const path = require("path");

const DATA = path.resolve(__dirname, "data.js");
const LOCAL_DEALS = process.env.DEALS_JSON || path.resolve(__dirname, "../../lepunuo-deals/data/deals.json");
const ONLINE_DIGEST = "https://lepunuodeals.com/digest.json";
const useOnline = process.argv.includes("--online") || !!process.env.DEALS_URL;

async function loadDeals() {
  if (useOnline) {
    const url = process.env.DEALS_URL || ONLINE_DIGEST;
    const res = await fetch(url, { headers: { "User-Agent": "lepuno-site-sync/1.0" } });
    if (!res.ok) throw new Error("digest fetch failed: HTTP " + res.status);
    return JSON.parse(await res.text());
  }
  if (!fs.existsSync(LOCAL_DEALS)) {
    console.error("未找到本地 deal 数据:", LOCAL_DEALS);
    console.error('可用 --online 读取线上 digest.json（CI/远程环境）');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(LOCAL_DEALS, "utf8"));
}

/* 从促销标题提取商品名（去掉 "53% off on " 前缀） */
function dealTitleOf(title) {
  return String(title || "").replace(/^\d+%\s*off\s*on\s+/i, "").trim();
}

/* 常见词过滤：匹配名称时忽略这些高频营销词 */
const STOP = new Set(["for", "the", "and", "with", "women", "womens", "summer", "fall", "spring",
  "winter", "casual", "loose", "fit", "plus", "size", "new", "2026", "2025", "2024", "day"]);

function words(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
}

/* 命中学：deal 标题的语义词 ≥85% 都出现在主库名称中（容忍"中间插词"） */
function nameMatch(itemName, dealTitle) {
  const a = new Set(words(itemName)), b = new Set(words(dealTitle));
  if (!b.size) return false;
  let hit = 0;
  for (const w of b) if (a.has(w)) hit++;
  return hit / b.size >= 0.85;
}

function matchItem(item, asin, dealTitle) {
  if (item.asin === asin) return true;
  const styleFromTitle = (dealTitle.match(/\b(LP\d+|LPN\d+)\b/i) || [])[1];
  if (styleFromTitle && item.style === styleFromTitle.toUpperCase()) return true;
  if (dealTitle.length > 12 && nameMatch(item.name, dealTitle)) return true;
  return false;
}

function pctOff(orig, sale) {
  return orig > 0 ? Math.max(1, Math.round((1 - sale / orig) * 100)) + "%" : "";
}

async function main() {
  const all = await loadDeals();
  const now = new Date();
  const seen = new Set();
  const active = all.filter((d) => {
    const rawUrl = d.productUrl || d.destinationUrl;
    if (!d.expiresAt || !rawUrl || seen.has(rawUrl)) return false;
    if (new Date(d.expiresAt) <= now) return false;
    const asin = (rawUrl.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    if (!asin) return false;
    seen.add(rawUrl);
    return true;
  });

  console.log("deal 数据", all.length, "条 | 当前有效促销:", active.length, useOnline ? "(线上 digest)" : "(本地)");

  let src = fs.readFileSync(DATA, "utf8");
  const mj = src.match(/^window\.SITE_DATA = (\{.*\});\s*$/s);
  const data = JSON.parse(mj[1]);

  const markedItems = [], unmatched = [];
  active.forEach((d) => {
    const rawUrl = d.productUrl || d.destinationUrl;
    const asin = rawUrl.match(/\/dp\/([A-Z0-9]{10})/)[1];
    const name = dealTitleOf(d.title);
    const it = data.items.find((x) => matchItem(x, asin, name));
    if (!it) { unmatched.push({ asin, name: name.slice(0, 60) }); return; }
    it.deal = {
      originalPrice: d.originalPrice != null ? d.originalPrice : undefined,
      salePrice: d.salePrice != null ? d.salePrice : undefined,
      discountText: d.discountText || pctOff(d.originalPrice, d.salePrice),
      promoCode: d.promoCode || "",
      ends: d.expiresAt || "",
    };
    markedItems.push(it);
  });

  /* 清除主库中已不属于本轮促销名单的 deal 标记（促销结束后自动还原） */
  const markedStyles = new Set(markedItems.map((it) => it.style));
  let cleared = 0;
  data.items.forEach((it) => {
    if (it.deal && !markedStyles.has(it.style)) { delete it.deal; cleared++; }
  });

  fs.writeFileSync(DATA, "window.SITE_DATA = " + JSON.stringify(data) + ";\n", "utf8");
  console.log("已打标:", markedItems.length, "| 过期清除:", cleared);
  markedItems.forEach((it) => console.log("  ✓", it.style, it.deal.discountText + " off · code " + it.deal.promoCode));
  if (unmatched.length) {
    console.log("\n未匹配到主库商品:");
    unmatched.forEach((x) => console.log("  ✗", x.asin, x.name));
  }
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
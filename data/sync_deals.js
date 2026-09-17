/* data/sync_deals.js — 促销数据同步脚本
   用法：node data/sync_deals.js
   直接读取同项目 lepunuo-deals/data/deals.json（deal 站源数据），
   过滤当前仍有效的促销（expiresAt > now），按 ASIN 去重，
   以 款号→ASIN→名称词集 三级匹配主库 data.js 并写入 deal 字段；
   促销过期后重跑脚本即可自动清除旧标记。
   可通过环境变量 DEALS_JSON 覆盖数据文件路径。 */

const fs = require("fs");
const path = require("path");

const DATA = path.resolve(__dirname, "data.js");
const DEALS_JSON = process.env.DEALS_JSON || path.resolve(__dirname, "../../lepunuo-deals/data/deals.json");

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

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("读取失败:", p, "->", e.message);
    process.exit(1);
  }
}

function main() {
  if (!fs.existsSync(DEALS_JSON)) {
    console.error("未找到 deal 数据:", DEALS_JSON);
    console.error("请确认 lepunuo-deals 项目存在于同目录，或用 DEALS_JSON 指定路径");
    process.exit(1);
  }
  const all = readJson(DEALS_JSON);
  const now = new Date();

  /* 过滤未过期 + ASIN 有效 + 按 ASIN 去重（同款每日多条只取一条） */
  const seen = new Set();
  const active = all.filter((d) => {
    if (!d.expiresAt || !d.destinationUrl || seen.has(d.destinationUrl)) return false;
    if (new Date(d.expiresAt) <= now) return false;
    const asin = (d.destinationUrl.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    if (!asin) return false;
    seen.add(d.destinationUrl);
    return true;
  });

  console.log("deal 源共", all.length, "条 | 当前有效促销:", active.length);

  let src = fs.readFileSync(DATA, "utf8");
  const mj = src.match(/^window\.SITE_DATA = (\{.*\});\s*$/s);
  const data = JSON.parse(mj[1]);

  const markedItems = [], unmatched = [];
  active.forEach((d) => {
    const asin = d.destinationUrl.match(/\/dp\/([A-Z0-9]{10})/)[1];
    const name = dealTitleOf(d.title);
    const it = data.items.find((x) => matchItem(x, asin, name));
    if (!it) { unmatched.push({ asin, name: name.slice(0, 60) }); return; }
    it.deal = {
      originalPrice: d.originalPrice,
      salePrice: d.salePrice,
      discountText: d.discountText,
      promoCode: d.promoCode,
      ends: (d.expiresAt || ""),
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
  markedItems.forEach((it) => console.log("  ✓", it.style, it.deal.discountText + " off · code " + it.deal.promoCode + " · ends " + it.deal.ends));
  if (unmatched.length) {
    console.log("\n未匹配到主库商品（需补数据或核实 ASIN）:");
    unmatched.forEach((x) => console.log("  ✗", x.asin, x.name));
  }
}

main();
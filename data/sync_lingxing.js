#!/usr/bin/env node
/* data/sync_lingxing.js — 从领星 ERP 同步「真实销量 / 上架日期 / 新款」到 data/data.js
   用法：
     node data/sync_lingxing.js            # 预演：只打印将要变更的内容，不写文件
     node data/sync_lingxing.js --apply    # 实际写入 data/data.js
   环境变量：
     LINGXING_MCP_KEY  领星 MCP Key（必填，CI 里放 GitHub Secrets）

   安全约束：
   - 全程只调用领星的只读工具 erp_listing，不做任何写操作
   - 任一关键校验不通过 → 直接退出（exit 2），不写文件、不部署，线上保留上一版数据
   口径：
   - sales30 = 该款号下所有美国站 SKU 的 thirty_volume 之和（近 30 天真实销量）
   - sales7  = 同上，取 total_volume（领星的近 7 天销量；已用 average_seven_volume×7 交叉校验）
   - launch  = 该款号所有 SKU（含已删除）里最早的开售日期，且只允许往前修正、不允许推后
   - 款号严格按 local_name 精确匹配，不做前缀模糊匹配（避免 LP0947 命中 LP09471）
*/

const fs = require("fs");
const path = require("path");

const DATA = path.resolve(__dirname, "data.js");
const MCP_URL = "https://openmcp.lingxing.com/mcp-servers/lingxing-mcp";
const MCP_KEY = process.env.LINGXING_MCP_KEY || "";
const APPLY = process.argv.includes("--apply");
const US_MARKET = "ATVPDKIKX0DER";
const PAGE = 200;          // 领星单页上限
const MAX_PAGES = 300;     // 19676 条约 99 页，留足余量但防止死循环
const NEW_WINDOW_DAYS = 30;   // 只收录最近 30 天内首次开售的款
const MAX_NEW_PER_RUN = 10;   // 单次最多新增款数，防止异常时大量灌入

/* ---------- 致命错误：整批放弃 ---------- */
function abort(msg) {
  console.error("\n❌ 本次更新放弃：" + msg);
  console.error("   线上继续使用上一版数据，未写入任何文件。\n");
  process.exit(2);
}

/* ---------- 领星 MCP（Streamable HTTP JSON-RPC）---------- */
let sid = "", rid = 0;
async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "X-Mcp-Key": MCP_KEY,
  };
  if (sid) headers["mcp-session-id"] = sid;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params: params || {} }),
      signal: ctl.signal,
    });
    const s = r.headers.get("mcp-session-id");
    if (s) sid = s;
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRpc(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  const raw = lines.length ? lines.map((l) => l.slice(5).trim()).join("") : text;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function callTool(name, args) {
  const j = parseRpc(await rpc("tools/call", { name, arguments: args || {} }));
  const r = j.result || j;
  return r.content ? r.content.map((x) => x.text || "").join("\n") : JSON.stringify(r);
}

/* 带重试的 listing 查询 */
async function listingPage(offset) {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const t = await callTool("action", {
        toolId: "erp_listing",
        params: { search_field: "local_name", search_value: [], offset, length: PAGE, pvi_ids: "" },
      });
      const body = JSON.parse(t);
      if (body.code !== 1) { lastErr = body.msg || "code=" + body.code; }
      else {
        const page = body.data && body.data.data ? body.data.data : {};
        return { total: Number(page.total || 0), list: page.list || [] };
      }
    } catch (e) { lastErr = e.message; }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  abort(`领星第 ${offset} 条起的分页拉取失败（${lastErr}）`);
}

/* ---------- 分类推断（宁可跳过，不可错分）---------- */
const CAT_RULES = [
  ["Set", /\b(2|two)[\s-]*piece\b|matching sets?\b|skirt sets?\b|pants sets?\b|short sets?\b/i],
  ["Cardigan", /\bcardigan/i],
  ["Dress", /\bdress(es)?\b/i],
  ["Jumpsuit", /\bjumpsuits?\b|\brompers?\b|\boveralls?\b/i],
  ["Skirt", /\bskirts?\b|\bskorts?\b/i],
  ["Shorts", /\bshorts\b/i],
  ["Pants", /\bpants?\b|\btrousers?\b|\bpalazzo\b|\bcapri\b|\bsweatpants?\b|\bleggings?\b/i],
  ["Top", /\btops?\b|\bblouses?\b|\bshirts?\b|\btees?\b|\btank\b|\bsweaters?\b|\bhoodies?\b|\bsweatshirts?\b/i],
];

/* 亚马逊商品类型兜底（仅当标题无命中时使用） */
const AMZ_TYPE_MAP = {
  PANTS: "Pants", SHORTS: "Shorts", DRESS: "Dress", SKIRT: "Skirt",
  SWEATER: "Top", SHIRT: "Top", TOP: "Top", BLOUSE: "Top", "ACTIVE SHORTS": "Shorts",
};

function inferCategory(title, amzType) {
  const t = String(title || "");
  for (const [cat, re] of CAT_RULES) if (re.test(t)) return cat;
  const byType = AMZ_TYPE_MAP[String(amzType || "").toUpperCase().trim()];
  return byType || "";
}

/* ---------- 工具 ---------- */
function normStyle(s) { return String(s || "").trim().toUpperCase(); }

/* 从 SKU 里取颜色（STYLE-<配色>-<尺码>-<渠道>），用于估算颜色数 */
const SIZE_RE = /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|XXXL|XXXXL)$/i;
function colorOf(style, sku) {
  const rest = String(sku || "").slice(style.length + 1);
  const parts = rest.split("-");
  if (parts.length < 3) return "";
  parts.pop();                               // 渠道 FBA / FBA2 / FBM
  if (SIZE_RE.test(parts[parts.length - 1])) parts.pop();  // 尺码
  return parts.join("-");
}

/* 亚马逊缩略图 → 原图；已知占位图/图标一律视为无图 */
const IMG_BAD = /01RmK\+J4pJL|share-icons|\/images\/G\//i;
function fullImage(u) {
  const s = String(u || "");
  if (!/^https:\/\/m\.media-amazon\.com\/images\/I\//.test(s)) return "";
  if (IMG_BAD.test(s)) return "";
  return s.replace(/\._[A-Z0-9_,]+_\.(jpg|png)$/i, ".$1");
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ---------- 主流程 ---------- */
async function main() {
  if (!MCP_KEY) abort("缺少环境变量 LINGXING_MCP_KEY");

  console.log("→ 连接领星（只读）…");
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "lepuno-site-sync", version: "1.0" },
  });
  await rpc("notifications/initialized", {}).catch(() => {});

  /* 1. 全量扫描 Listing */
  console.log("→ 拉取 Listing 全量数据…");
  let rows = [], total = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await listingPage(p * PAGE);
    if (p === 0) {
      total = page.total;
      if (!total) abort("领星返回 total=0，疑似接口异常");
    }
    if (!page.list.length) break;
    rows.push(...page.list);
    process.stdout.write(`   ${rows.length}/${total}\r`);
    if (rows.length >= total) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`   已拉取 ${rows.length} / ${total} 条`);

  /* 2. 校验：完整性 */
  if (rows.length < total) abort(`分页未拉完（${rows.length}/${total}），数据不完整`);
  if (rows.length < 5000) abort(`返回条数异常偏少（${rows.length}），疑似接口异常`);

  /* 3. 只看美国站；销量只用未删除的，上架日期要连已删除的一起看（老 SKU 删了重挂会推后日期） */
  const usAll = rows.filter((r) => r.marketplace_id === US_MARKET);
  const us = usAll.filter((r) => String(r.is_delete) === "0");
  if (!us.length) abort("美国站 Listing 为空，市场字段口径可能变了");

  /* 3.1 交叉校验「近 7 天销量」字段口径：total_volume 应约等于 average_seven_volume × 7 */
  const both = us.filter((r) => r.total_volume != null && r.average_seven_volume != null);
  const matched = both.filter((r) => {
    const t = Number(r.total_volume), a = Number(r.average_seven_volume) * 7;
    return Math.abs(t - a) <= Math.max(1, t * 0.05);
  });
  if (both.length < 100 || matched.length / both.length < 0.9) {
    abort(`无法确认近 7 天销量字段口径（total_volume ≈ average_seven_volume×7 命中率仅 ${((matched.length / Math.max(1, both.length)) * 100) | 0}%），字段含义可能已变更`);
  }

  /* 4. 按 SKU 去重（同一 SKU 可能因配对返回多行），再按款号聚合 */
  const bySku = new Map();
  for (const r of us) {
    const sku = String(r.local_sku || "");
    if (!sku) continue;
    const prev = bySku.get(sku);
    if (!prev || Number(r.thirty_volume || 0) > Number(prev.thirty_volume || 0)) bySku.set(sku, r);
  }

  const agg = new Map(); // style → { s7, s30, best, colors:Set, onSale }
  for (const r of bySku.values()) {
    const style = normStyle(r.local_name);
    if (!/^LP[A-Z]?\d{3,}$/.test(style)) continue;
    let a = agg.get(style);
    if (!a) {
      a = { s7: 0, s30: 0, best: null, colors: new Set(), onSale: false };
      agg.set(style, a);
    }
    a.s7 += Number(r.total_volume || 0);          // 近 7 天
    a.s30 += Number(r.thirty_volume || 0);        // 近 30 天
    if (Number(r.status) === 1) a.onSale = true;
    const c = colorOf(style, r.local_sku);
    if (c) a.colors.add(c.toUpperCase());
    if (!a.best || Number(r.thirty_volume || 0) > Number(a.best.thirty_volume || 0)) a.best = r;
  }

  /* 4.1 上架日期：含已删除 SKU，取最早；这样老款删了重挂也不会被误判成新款 */
  const firstOpen = new Map();
  for (const r of usAll) {
    const style = normStyle(r.local_name);
    if (!/^LP[A-Z]?\d{3,}$/.test(style)) continue;
    const open = String(r.open_date_time || "").slice(0, 10);
    if (!open) continue;
    const cur = firstOpen.get(style);
    if (!cur || open < cur) firstOpen.set(style, open);
  }
  for (const [style, d] of firstOpen) {
    const a = agg.get(style);
    if (a) a.launch = d;
  }
  console.log(`   美国站未删除 SKU ${bySku.size} 个（含已删除共 ${usAll.length} 条），聚合出 ${agg.size} 个款号`);

  /* 5. 读取站点数据 */
  const src = fs.readFileSync(DATA, "utf8");
  const mj = src.match(/^window\.SITE_DATA = (\{.*\});\s*$/s);
  if (!mj) abort("data.js 格式不符合预期，解析失败");
  const data = JSON.parse(mj[1]);
  const items = data.items || [];
  if (!items.length) abort("data.js 里没有商品");

  /* 6. 校验：站点款号的覆盖率 */
  const missing = items.filter((it) => !agg.has(normStyle(it.style)));
  const coverRate = (items.length - missing.length) / items.length;
  if (coverRate < 0.9) {
    abort(`站点款号在领星只匹配到 ${((coverRate * 100) | 0)}%（${missing.length} 个查不到），低于 90% 阈值`);
  }
  if (missing.length) {
    console.warn(`   ⚠ ${missing.length} 个款号在领星查不到，保留其原销量：${missing.map((x) => x.style).join(", ")}`);
  }

  /* 7. 校验：销量不能大面积归零（接口口径变化的强信号） */
  const wasPositive = items.filter((it) => Number(it.sales30) > 0);
  const nowZero = wasPositive.filter((it) => agg.has(normStyle(it.style)) && agg.get(normStyle(it.style)).s30 === 0);
  if (nowZero.length > wasPositive.length * 0.4) {
    abort(`有 ${nowZero.length}/${wasPositive.length} 个原本有销量的款变成 0，疑似取数口径错误`);
  }

  /* 8. 更新已有款：销量 + 上架日期 */
  const changedSales = [], changedLaunch = [];
  for (const it of items) {
    const a = agg.get(normStyle(it.style));
    if (!a) continue;
    if (Number(it.sales30) !== a.s30 || Number(it.sales7) !== a.s7) {
      changedSales.push({ style: it.style, from30: Number(it.sales30) || 0, to30: a.s30, from7: Number(it.sales7) || 0, to7: a.s7 });
      if (APPLY) { it.sales30 = a.s30; it.sales7 = a.s7; }
    }
    /* 上架日期只往前修正、不往后推：老 SKU 被删后重挂会给出更晚的开售日，
       若直接覆盖会把老款误判成新款，顶掉真正的 new arrivals */
    if (a.launch && (!it.launch || a.launch < it.launch)) {
      changedLaunch.push({ style: it.style, from: it.launch || "", to: a.launch });
      if (APPLY) it.launch = a.launch;
    }
  }

  /* 9. 发现新款：最近 30 天内首次开售、有主图、在售、分类可判定 */
  const known = new Set(items.map((x) => normStyle(x.style)));
  const cutoff = daysAgo(NEW_WINDOW_DAYS);
  const pool = [...agg.entries()]
    .filter(([style, a]) => !known.has(style) && a.launch && a.launch >= cutoff && a.onSale)
    .sort((x, y) => (x[1].launch < y[1].launch ? 1 : -1));   // 最新开售优先

  const newItems = [], skipped = [];
  for (const [style, a] of pool) {
    if (newItems.length >= MAX_NEW_PER_RUN) break;
    const best = a.best || {};
    const name = String(best.item_name || "").trim();
    const image = fullImage(best.small_image_url);
    const cat = inferCategory(name, best.amz_product_type);
    if (!name || name.length < 12) { skipped.push(`${style} 标题缺失`); continue; }
    if (!image) { skipped.push(`${style} 无主图`); continue; }
    if (!/^[A-Z0-9]{10}$/.test(String(best.asin || ""))) { skipped.push(`${style} ASIN 异常`); continue; }
    if (!cat) { skipped.push(`${style} 分类无法判定`); continue; }
    newItems.push({
      style, name, title: name,
      asin: String(best.asin || best.amz_product_id || ""),
      category: cat,
      variants: Math.max(1, a.colors.size),
      sales7: a.s7, sales30: a.s30,
      image, bsr: Number(best.rank || 0) || undefined,
      launch: a.launch,
    });
  }
  for (const [style, a] of pool) {
    if (newItems.some((x) => x.style === style)) continue;
    if (skipped.some((s) => s.startsWith(style + " "))) continue;
    skipped.push(`${style} 超出单次新增上限`);
  }

  /* 10. 输出预演结果 */
  console.log("\n=== 同步结果" + (APPLY ? "（已写入）" : "（预演，未写入）") + " ===");
  console.log(`销量更新 ${changedSales.length} 条`);
  changedSales
    .sort((a, b) => Math.abs(b.to30 - b.from30) - Math.abs(a.to30 - a.from30))
    .slice(0, 15)
    .forEach((c) => console.log(`   ${c.style.padEnd(9)} 30天 ${String(c.from30).padStart(6)} → ${String(c.to30).padStart(6)}｜7天 ${c.from7} → ${c.to7}`));
  if (changedSales.length > 15) console.log(`   … 其余 ${changedSales.length - 15} 条略`);

  console.log(`上架日期校准 ${changedLaunch.length} 条（只往前修正）`);
  changedLaunch.forEach((c) => console.log(`   ${c.style.padEnd(9)} ${c.from || "(空)"} → ${c.to}`));

  console.log(`新增款 ${newItems.length} 个`);
  newItems.forEach((n) => console.log(`   + ${n.style.padEnd(9)} ${n.category.padEnd(8)} 30天 ${String(n.sales30).padStart(5)}｜上架 ${n.launch}｜${n.name.slice(0, 46)}`));
  if (skipped.length) {
    console.log(`跳过 ${skipped.length} 个候选款`);
    skipped.slice(0, 20).forEach((s) => console.log(`   - ${s}`));
    if (skipped.length > 20) console.log(`   … 其余 ${skipped.length - 20} 个略`);
  }

  if (!changedSales.length && !changedLaunch.length && !newItems.length) {
    console.log("\n无需变更，文件未修改。");
    return;
  }

  /* 11. 写入 */
  if (!APPLY) {
    console.log("\n预演结束。确认无误后加 --apply 参数执行写入。");
    return;
  }
  newItems.forEach((n) => {
    const clean = {};
    Object.keys(n).forEach((k) => { if (n[k] !== undefined && n[k] !== "") clean[k] = n[k]; });
    items.push(clean);
  });
  fs.writeFileSync(DATA, "window.SITE_DATA = " + JSON.stringify(data) + ";\n", "utf8");
  console.log(`\n✅ 已写入 ${DATA}（共 ${items.length} 款）`);
}

main().catch((e) => abort(e && e.stack ? e.stack : String(e)));

#!/usr/bin/env node
/* 生成首页的静态 SEO 片段，保证所有款名/分类对不执行 JS 的爬虫可见：
     1) "All Styles" 分类索引（真实可见的链接列表）
     2) JSON-LD（Organization / WebSite / CollectionPage + ItemList）
     3) 刷新 sitemap.xml 的 lastmod
   数据来自 data/data.js；由 .github/workflows/data-sync.yml 在同步后自动执行。
   手动运行：node data/build_seo.js
*/
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "data.js");
const INDEX = path.join(ROOT, "index.html");
const SITEMAP = path.join(ROOT, "sitemap.xml");
const SITE = "https://lepunuo.com";

/* 与 app.js 保持一致的分类顺序与复数名 */
const CATS = ["Dress", "Pants", "Top", "Skirt", "Jumpsuit", "Shorts", "Cardigan", "Set"];
const LABELS = {
  Dress: "Dresses", Pants: "Pants", Top: "Tops", Skirt: "Skirts",
  Jumpsuit: "Jumpsuits", Shorts: "Shorts", Cardigan: "Cardigans", Set: "Sets"
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function amzUrl(it) {
  return "https://www.amazon.com/dp/" + it.asin + "?th=1&psc=1";
}

/* 统一尺寸的缩略图，避免索引区把原图全量拉一遍 */
function thumb(url, w) {
  return /\._AC_SL\d+_\.jpg$/i.test(url) ? url.replace(/\._AC_SL\d+_\.jpg$/i, "._AC_SL" + w + "_.jpg") : url;
}

function replaceBetween(src, startMark, endMark, body, file) {
  const s = src.indexOf(startMark);
  const e = src.indexOf(endMark);
  if (s < 0 || e < 0 || e < s) {
    console.error(`✗ ${file} 缺少标记 ${startMark} / ${endMark}`);
    process.exit(2);
  }
  return src.slice(0, s + startMark.length) + "\n" + body + "\n" + src.slice(e);
}

function main() {
  const raw = fs.readFileSync(DATA, "utf8");
  const data = JSON.parse(raw.replace(/^window\.SITE_DATA\s*=\s*/, "").replace(/;\s*$/, ""));
  const items = (data.items || []).filter((it) => it && it.style && it.asin && it.category);
  if (items.length < 20) {
    console.error(`✗ 商品数异常（${items.length}），已跳过，保留原静态内容`);
    process.exit(2);
  }

  /* ---------- 1. 分类索引 ---------- */
  const groups = [];
  const unknown = [];
  CATS.forEach((cat) => {
    const list = items
      .filter((it) => it.category === cat)
      .sort((a, b) => (b.sales30 || 0) - (a.sales30 || 0));
    if (list.length) groups.push([cat, list]);
  });
  items.forEach((it) => { if (CATS.indexOf(it.category) < 0) unknown.push(it); });

  let html = '<div class="styleindex">';
  groups.forEach(([cat, list]) => {
    html +=
      '<div class="styleindex__col">' +
        '<h3 class="styleindex__h">' + esc(LABELS[cat] || cat) + '<span>' + list.length + "</span></h3>" +
        "<ul>" +
        list.map((it) =>
          '<li><a href="' + esc(amzUrl(it)) + '" target="_blank" rel="noopener nofollow">' + esc(it.name) + "</a></li>"
        ).join("") +
        "</ul>" +
      "</div>";
  });
  if (unknown.length) {
    html +=
      '<div class="styleindex__col"><h3 class="styleindex__h">More<span>' + unknown.length + "</span></h3><ul>" +
      unknown.map((it) =>
        '<li><a href="' + esc(amzUrl(it)) + '" target="_blank" rel="noopener nofollow">' + esc(it.name) + "</a></li>"
      ).join("") +
      "</ul></div>";
  }
  html += "</div>";
  html += '\n<p class="styleindex__note">' + items.length +
    ' styles in total. Prices, sizes and availability are confirmed on each Amazon listing.</p>';

  let idx = fs.readFileSync(INDEX, "utf8");
  idx = replaceBetween(idx, "<!-- SEO:INDEX:START -->", "<!-- SEO:INDEX:END -->", html, "index.html");

  /* ---------- 2. JSON-LD ---------- */
  const top = items.slice().sort((a, b) => (b.sales30 || 0) - (a.sales30 || 0)).slice(0, 30);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": SITE + "/#organization",
        name: "LEPUNUO",
        url: SITE + "/",
        logo: SITE + "/assets/og-cover.jpg",
        sameAs: ["https://www.instagram.com/lepunuo.shop"],
        description: "LEPUNUO designs everyday women's fashion — dresses, pants, tops, skirts, cardigans and matching sets — sold on Amazon."
      },
      {
        "@type": "WebSite",
        "@id": SITE + "/#website",
        url: SITE + "/",
        name: "LEPUNUO",
        inLanguage: "en-US",
        publisher: { "@id": SITE + "/#organization" }
      },
      {
        "@type": "CollectionPage",
        "@id": SITE + "/#webpage",
        url: SITE + "/",
        name: "LEPUNUO Women's Fall Fashion",
        isPartOf: { "@id": SITE + "/#website" },
        about: { "@id": SITE + "/#organization" },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: top.length,
          itemListOrder: "https://schema.org/ItemListOrderDescending",
          itemListElement: top.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: it.name,
            url: amzUrl(it),
            image: it.image ? thumb(it.image, 500) : undefined
          }))
        }
      }
    ]
  };
  idx = replaceBetween(
    idx,
    "<!-- SEO:JSONLD:START -->",
    "<!-- SEO:JSONLD:END -->",
    '<script type="application/ld+json">' + JSON.stringify(ld) + "</script>",
    "index.html"
  );
  fs.writeFileSync(INDEX, idx, "utf8");

  /* ---------- 3. sitemap lastmod ---------- */
  let sm = fs.readFileSync(SITEMAP, "utf8");
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // 北京时间
  sm = sm.replace(/<lastmod>[^<]*<\/lastmod>/g, "<lastmod>" + today + "</lastmod>");
  fs.writeFileSync(SITEMAP, sm, "utf8");

  console.log(`静态索引已生成：${items.length} 个款号 / ${groups.length} 个分类，JSON-LD Top ${top.length}，sitemap lastmod=${today}`);
}

main();

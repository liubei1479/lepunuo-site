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

/* 分类落地页：/dresses/ /pants/ ... */
const SLUGS = {
  Dress: "dresses", Pants: "pants", Top: "tops", Skirt: "skirts",
  Jumpsuit: "jumpsuits", Shorts: "shorts", Cardigan: "cardigans", Set: "sets"
};

const COPY = {
  Dress: { h1: "Women's Dresses", lede: "Boho maxi, breezy tank and easy cover-up dresses — the pieces we reach for when the forecast is warm and plans are last-minute." },
  Pants: { h1: "Women's Pants", lede: "Wide-leg, palazzo, cargo and capri trousers cut for comfort: elastic waists, deep pockets and fluid drape that works from desk to weekend." },
  Top: { h1: "Women's Tops", lede: "Blouses, henleys, knit tees and cropped shirts — polished enough for the office, relaxed enough for everything after." },
  Skirt: { h1: "Women's Skirts", lede: "Maxi, midi, mini and tiered ruffle skirts in flowy silhouettes, most of them with pockets and a comfortable elastic or smocked waist." },
  Jumpsuit: { h1: "Women's Jumpsuits & Rompers", lede: "One-and-done outfits: wide-leg jumpsuits, smocked rompers and bib overalls that pack easily for vacation and everyday wear." },
  Shorts: { h1: "Women's Shorts", lede: "High-waisted, wide-leg and cargo shorts with pockets — easy summer bottoms that pair with everything in your closet." },
  Cardigan: { h1: "Women's Cardigans", lede: "Lightweight open-front cardigans and knit layers to throw over a tee or dress when the evening turns cool." },
  Set: { h1: "Women's Matching Sets", lede: "Two-piece sets that take the guesswork out of getting dressed — tops matched to wide-leg pants, skirts or shorts." }
};

const TRUST = [
  ["Sizing &amp; fit", "Every listing carries its own size chart and model measurements. If you sit between two sizes, the reviews on the Amazon page are the fastest way to judge the fit."],
  ["Shipping &amp; returns", "Delivery estimates, shipping options and returns are handled by Amazon under the terms shown on each product page. Keep the order in your Amazon account for any return or exchange."],
  ["Why we link to Amazon", "LEPUNUO is a product showcase, not a store. We do not take payments and never see your card details — every order is placed and fulfilled on Amazon.com."]
];

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

/* 原图（去掉尺寸后缀），作 <img> 加载失败时的兜底 */
function orig(url) {
  return String(url || "").replace(/\._AC_SL\d+_\.jpg$/i, ".jpg");
}

/* 商品卡：分类页与 All Styles 页共用 */
function pcard(it) {
  return '<a class="pcard" href="' + esc(amzUrl(it)) + '" target="_blank" rel="noopener nofollow">' +
    '<div class="pcard__imgwrap"><img class="pcard__img" src="' + esc(thumb(it.image, 500)) + '"' +
      ' srcset="' + esc(thumb(it.image, 500)) + " 500w, " + esc(thumb(it.image, 1000)) + ' 1000w"' +
      ' sizes="(max-width: 700px) 45vw, 240px" width="300" height="400" alt="' + esc(it.name) + '"' +
      ' loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + esc(orig(it.image)) + '\'">' +
    "</div>" +
    '<span class="pcard__name">' + esc(it.name) + "</span>" +
    '<span class="pcard__cta">Check price on Amazon</span>' +
  "</a>";
}

/* 顶部导航：8 个分类 + All Styles */
function navHtml(counts, activeSlug) {
  const links = CATS.filter((c) => SLUGS[c] && counts[c]).map((c) =>
    '<a href="/' + SLUGS[c] + '/"' + (SLUGS[c] === activeSlug ? ' aria-current="page"' : "") + ">" + LABELS[c] + "</a>"
  );
  links.push('<a href="/all-styles/"' + (activeSlug === "all-styles" ? ' aria-current="page"' : "") + ">All Styles</a>");
  return links.join("");
}

/* 分类页 / All Styles 页共用的页面骨架（head + 导航 + 页脚） */
function pageShell(o) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${o.url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${o.url}">
<meta property="og:site_name" content="LEPUNUO">
<meta property="og:image" content="${SITE}/assets/og-cover.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/css/cats.css">
<script type="application/ld+json">${JSON.stringify(o.ld)}</script>
</head>
<body>

<header class="cathead">
  <a class="cathead__brand" href="/">LEPUNUO</a>
  <nav class="catnav">${o.nav}</nav>
</header>

<main class="catmain">
  <h1>${esc(o.h1)}</h1>
  <p class="catmain__lede">${esc(o.lede)}</p>
  <p class="catmain__count">${o.countLine}</p>
</main>
${o.body}
<footer class="catfoot">
  <p><strong>LEPUNUO is a product showcase, not an online store.</strong> We do not process payments or handle orders — every purchase is completed securely on Amazon.com.</p>
  <p>Prices, sizes and availability are always confirmed on the Amazon product page. <a href="/">Browse all styles</a>.</p>
</footer>

</body>
</html>
`;
}

/* ---------- 分类落地页 ---------- */
function catPage(cat, list, counts) {
  const slug = SLUGS[cat];
  const copy = COPY[cat];
  const url = SITE + "/" + slug + "/";
  const nav = navHtml(counts, slug);
  const cards = list.map(pcard).join("");

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url + "#webpage",
        url: url,
        name: copy.h1 + " — LEPUNUO",
        description: copy.lede,
        isPartOf: { "@id": SITE + "/#website" },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: list.length,
          itemListElement: list.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: it.name,
            url: amzUrl(it),
            image: it.image ? thumb(it.image, 500) : undefined
          }))
        }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: LABELS[cat], item: url }
        ]
      }
    ]
  };

  return pageShell({
    title: copy.h1 + " — LEPUNUO",
    desc: copy.lede,
    url: url,
    h1: copy.h1,
    lede: copy.lede,
    countLine: list.length + " styles · links open the Amazon listing",
    nav: nav,
    ld: ld,
    body: '<div class="pgrid">\n' + cards + "\n</div>\n\n" +
      '<section class="trust">\n  <div class="trust__in">\n' +
      TRUST.map(([t, p]) => '    <div class="trust__item"><h2>' + t + "</h2><p>" + p + "</p></div>").join("\n") +
      "\n  </div>\n</section>\n"
  });
}

/* ---------- All Styles 落地页：全部款号一页看完（首页只保留分类入口） ---------- */
function allStylesPage(ordered, counts) {
  const url = SITE + "/all-styles/";
  const lede = "Every LEPUNUO style currently live on Amazon, grouped by category. Each card opens the listing for sizes, colors and the current price.";
  const body =
    '<div class="pgrid">\n' + ordered.map(pcard).join("\n") + "\n</div>\n\n" +
    '<section class="trust">\n  <div class="trust__in">\n' +
    TRUST.map(([t, p]) => '    <div class="trust__item"><h2>' + t + "</h2><p>" + p + "</p></div>").join("\n") +
    "\n  </div>\n</section>\n";

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url + "#webpage",
        url: url,
        name: "All LEPUNUO Styles",
        description: lede,
        isPartOf: { "@id": SITE + "/#website" },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: ordered.length,
          itemListElement: ordered.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: it.name,
            url: amzUrl(it),
            image: it.image ? thumb(it.image, 500) : undefined
          }))
        }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: "All Styles", item: url }
        ]
      }
    ]
  };

  return pageShell({
    title: "All Styles — LEPUNUO",
    desc: lede,
    url: url,
    h1: "All LEPUNUO Styles",
    lede: lede,
    countLine: ordered.length + " styles · links open the Amazon listing",
    nav: navHtml(counts, "all-styles"),
    ld: ld,
    body: body
  });
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

  /* 首页只放 8 个分类入口；112 个款名集中在 /all-styles/，避免首页出现大段文字墙 */
  let html = '<div class="catlinks">';
  groups.forEach(([cat, list]) => {
    html +=
      '<a class="catlinks__item" href="/' + SLUGS[cat] + '/">' +
        esc(LABELS[cat] || cat) + "<span>" + list.length + "</span>" +
      "</a>";
  });
  html += "</div>";
  html += '\n<p class="styleindex__note">' + items.length +
    ' styles in total — <a href="/all-styles/">browse all styles</a>. Prices, sizes and availability are confirmed on each Amazon listing.</p>';

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

  /* ---------- 3. 分类落地页 ---------- */
  const counts = {};
  groups.forEach(([cat, list]) => { counts[cat] = list.length; });
  groups.forEach(([cat, list]) => {
    const dir = path.join(ROOT, SLUGS[cat]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), catPage(cat, list, counts), "utf8");
  });

  /* All Styles 页：首页不再罗列全部款名，改由这一页承接 */
  const ordered = groups.reduce((acc, [, list]) => acc.concat(list), []).concat(unknown);
  const allDir = path.join(ROOT, "all-styles");
  fs.mkdirSync(allDir, { recursive: true });
  fs.writeFileSync(path.join(allDir, "index.html"), allStylesPage(ordered, counts), "utf8");

  /* ---------- 4. sitemap ---------- */
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // 北京时间
  const urls = [{ loc: SITE + "/", freq: "daily", pri: "1.0" }].concat(
    groups.map(([cat]) => ({ loc: SITE + "/" + SLUGS[cat] + "/", freq: "weekly", pri: "0.8" })),
    [{ loc: SITE + "/all-styles/", freq: "weekly", pri: "0.8" }]
  );
  const sm =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) =>
      "  <url>\n    <loc>" + u.loc + "</loc>\n    <lastmod>" + today + "</lastmod>\n" +
      "    <changefreq>" + u.freq + "</changefreq>\n    <priority>" + u.pri + "</priority>\n  </url>"
    ).join("\n") +
    "\n</urlset>\n";
  fs.writeFileSync(SITEMAP, sm, "utf8");

  console.log(`静态索引已生成：${items.length} 个款号 / ${groups.length} 个分类页，JSON-LD Top ${top.length}，sitemap ${urls.length} 条，lastmod=${today}`);
}

main();

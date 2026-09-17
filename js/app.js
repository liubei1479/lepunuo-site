/* LEPUNUO — site logic: hero banners, nav, carousels, grid, search suggestions, reviews, instagram */

(function () {
  "use strict";

  var items = (window.SITE_DATA || { items: [] }).items;

  var emptyEl = document.getElementById("empty");
  var countEl = document.getElementById("countLabel");
  var searchEl = document.getElementById("searchInput");
  var sugEl = document.getElementById("searchSug");
  var sortEl = document.getElementById("sortSelect");
  var navEl = document.getElementById("nav");
  var bestEl = document.getElementById("bestsellers");
  var newEl = document.getElementById("newArrivals");
  var reviewsEl = document.getElementById("reviews");
  var igEl = document.getElementById("igGrid");
  var footNavEl = document.getElementById("footNav");
  var saleSec = document.getElementById("section-sale");
  var saleEl = document.getElementById("saleGoods");

  var CATS = ["Dress", "Pants", "Top", "Skirt", "Jumpsuit", "Shorts", "Cardigan", "Set", "Jacket"];

  /* 分类名称复数映射（避免 Dress+"s"=Dresss 这类拼写错误） */
  var NAV_LABELS = {
    Dress: "Dresses", Pants: "Pants", Top: "Tops", Skirt: "Skirts",
    Jumpsuit: "Jumpsuits", Shorts: "Shorts", Cardigan: "Cardigans",
    Set: "Sets", Jacket: "Jackets"
  };

  var state = { q: "", sort: "featured", cat: "" };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* 亚马逊追踪 tag（可选）：留空则跳转不带 tag 参数。
     注意：一旦启用 tag 即构成联盟推广，需同时在页脚恢复
     "As an Amazon Associate we earn from qualifying purchases." 披露声明。 */
  var AMZ_TAG = "";

  function amazonUrl(it) {
    var q = "?th=1&psc=1" + (AMZ_TAG ? "&tag=" + encodeURIComponent(AMZ_TAG) : "");
    return "https://www.amazon.com/dp/" + it.asin + q;
  }

  /* Upgrade to the un-cropped source image. Amazon "_AC_SLxxxx_" variants
     return compressed narrow strips (e.g. 561x1500), which look bad when
     scaled up full-bleed. Removing the suffix yields the full-res original
     (e.g. 1912x2560) — crisp and with a natural 3:4 composition. */
  function hiRes(url) {
    return url.replace(/\._AC_SL\d+_\.jpg$/i, ".jpg");
  }

  /* Est. 标注：价格为估算参考值，最终以亚马逊结算为准（合规用途） */
  /* 主体归一缩放系数：由构建期脚本(白底包围盒)写入 zoom 字段，缺省 1 */
  function zoomOf(it) {
    return it.zoom != null ? it.zoom : 1;
  }

  /* 价格不再展示：Amazon 实时价与我们静态快照必然漂移，
     为消除"价格不符"的体验落差与误导风险，卡片统一引导去 Amazon 确认价格 */
  function price(it) {
    return '<span class="card__cta">Check price on Amazon</span>';
  }

  /* 评分不再展示：纯静态站无法获取亚马逊真实评分/评论数，估算数据已于此前移除 */

  /* color palette pool for swatch dots (deterministic by variant count) */
  var SWATCH_COLORS = [
    "#000000", "#ffffff", "#1a1a2e", "#c8a2c8", "#ff6b6b", "#4ecdc4",
    "#45b7d1", "#96ceb4", "#ffeaa7", "#dfe6e9", "#6c5ce7", "#fd79a8",
    "#00b894", "#e17055", "#0984e3", "#e84393", "#f39c12", "#27ae60",
    "#8e44ad", "#16a085", "#d35400", "#2c3e50", "#f1c40f", "#e74c3c"
  ];

  function swatchDots(variants) {
    var n = Math.min(variants || 0, 5);
    var html = "";
    for (var i = 0; i < n; i++) {
      var c = SWATCH_COLORS[(i * 7 + (variants || 0)) % SWATCH_COLORS.length];
      html += '<span class="card__swatch" style="background:' + c + '"></span>';
    }
    if ((variants || 0) > 5) {
      html += '<span class="card__swatch--more">+' + (variants - 5) + '</span>';
    }
    return html;
  }

  function card(it, badge) {
    var b = badge
      ? '<span class="card__badge">' + esc(badge) + "</span>"
      : (it.deal ? '<span class="card__badge card__badge--deal">Deal</span>' : "");
    var swatches = swatchDots(it.variants);
    var swHtml = swatches ? '<div class="card__swatches">' + swatches + '</div>' : "";
    return (
      '<a class="card" href="' + amazonUrl(it) + '" target="_blank" rel="noopener nofollow" title="' + esc(it.name) + '">' +
        '<div class="card__imgwrap">' +
          '<img class="card__img" style="--z:' + zoomOf(it) + '" src="' + hiRes(it.image) + '" alt="' + esc(it.name) + '" loading="lazy" onerror="this.onerror=null;this.outerHTML=\'<div class=&quot;imgph&quot;></div>\'">' +
          b +
        "</div>" +
        '<div class="card__body">' +
          swHtml +
          '<span class="card__name">' + esc(it.name) + "</span>" +
          '<div class="card__row">' +
            price(it) +
          "</div>" +
        "</div>" +
      "</a>"
    );
  }

  function bySales(list, n) {
    return list.slice().sort(function (a, b) { return b.sales30 - a.sales30; }).slice(0, n);
  }

  /* ---------- hero product showcase ---------- */
  function nameShort(n) {
    var s = String(n || "");
    s = s.replace(/\s+(for|with|and|casual|women|womens|plus|summer|spring|fall)\b.*$/i, "");
    s = s.replace(/^(women'?s|womens)\b/i, "").trim();
    return s || "New Style";
  }

  /* 品牌 AI 场景大片（本地 assets/hero），优先作为首屏主视觉；
     点击跳转到对应商品分类。素材缺失时 initHero 会回退 Amazon 商品图。 */
  var HERO_BANNERS = [
    { img: "assets/hero/hero-1.png", eye: "Summer Edit · Dress", title: "Summer Dresses", sub: "Flowy silhouettes made for sun-soaked days.", cat: "Dress" },
    { img: "assets/hero/hero-2.png", eye: "Resort Style · Jumpsuit", title: "Effortless Jumpsuits", sub: "One-and-done looks, from beach to brunch.", cat: "Jumpsuit" },
    { img: "assets/hero/hero-4.png", eye: "City Day · Pants", title: "Wide-Leg Elegance", sub: "Elevated everyday pants with easy comfort.", cat: "Pants" },
    { img: "assets/hero/hero-3.png", eye: "Vacay Ready · Top", title: "Light & Layered Tops", sub: "Breezy pieces to style your way.", cat: "Top" }
  ];

  function initHero() {
    var wrap = document.getElementById("heroSlides");
    var dotsEl = document.getElementById("heroDots");
    var html = "", dots = "";

    /* 组装轮播 slides：优先品牌大片，缺失则回退 Amazon 畅销商品图 */
    var slides = [];
    var banners = window.LEPUNUO_HERO || HERO_BANNERS;
    if (banners && banners.length) {
      banners.forEach(function (b) {
        slides.push({ img: b.img, eye: b.eye, title: b.title, sub: b.sub, cat: b.cat || "", href: "#section-grid", alt: b.title, banner: true });
      });
    } else {
      var picks = bySales(items.filter(function (i) { return i.image; }), 4);
      picks.forEach(function (p) {
        slides.push({
          img: hiRes(p.image),
          eye: p.category + " · Best Seller",
          title: nameShort(p.name),
          sub: p.variants + " colors · Ships from Amazon",
          cat: "", href: amazonUrl(p), alt: p.name, banner: false
        });
      });
    }

    slides.forEach(function (s, idx) {
      var catAttr = s.cat ? ' data-cat="' + esc(s.cat) + '"' : "";
      html +=
        '<div class="hero__slide' + (idx === 0 ? " is-active" : "") + '">' +
          '<a class="hero__wall" href="' + s.href + '"' + (s.banner ? "" : ' target="_blank" rel="noopener nofollow"') + catAttr + ' title="' + esc(s.title) + '">' +
            '<img class="hero__bg" src="' + s.img + '" alt="' + esc(s.alt) + '" onerror="this.onerror=null;this.outerHTML=\'<div class=&quot;imgph imgph--hero&quot;></div>\'">' +
            '<div class="hero__veil"></div>' +
            '<div class="hero__cap">' +
              '<p class="hero__eyebrow">' + esc(s.eye) + "</p>" +
              '<h1 class="hero__title">' + esc(s.title) + "</h1>" +
              '<p class="hero__sub">' + esc(s.sub) + "</p>" +
              '<span class="btn btn--light">Shop Now</span>' +
            "</div>" +
          "</a>" +
        "</div>";
      dots += '<button class="hero__dot' + (idx === 0 ? " is-active" : "") + '" data-idx="' + idx + '" aria-label="Slide ' + (idx + 1) + '"></button>';
    });
    wrap.innerHTML = html;
    dotsEl.innerHTML = dots;

    /* 品牌大片点击 → 平滑滚动到对应商品分类 */
    wrap.addEventListener("click", function (e) {
      var w = e.target && e.target.closest ? e.target.closest(".hero__wall") : null;
      if (!w || !w.dataset.cat) return;
      e.preventDefault();
      setCat(w.dataset.cat);
    });

    var idx = 0, timer = null;
    function go(n) {
      idx = (n + slides.length) % slides.length;
      wrap.querySelectorAll(".hero__slide").forEach(function (el, i) {
        el.classList.toggle("is-active", i === idx);
      });
      dotsEl.querySelectorAll(".hero__dot").forEach(function (el, i) {
        el.classList.toggle("is-active", i === idx);
      });
    }
    function start() { timer = setInterval(function () { go(idx + 1); }, 5000); }
    dotsEl.addEventListener("click", function (e) {
      var d = e.target.closest(".hero__dot");
      if (!d) return;
      clearInterval(timer);
      go(Number(d.dataset.idx));
      start();
    });
    start();
  }

  /* ---------- nav ----------
     导航结构：NEW ARRIVALS → BEST SELLERS → 全部分类。 */
  function buildNav() {
    var html =
      '<a class="nav__link" data-anchor="section-new" href="#section-new">New Arrivals</a>' +
      '<a class="nav__link" data-anchor="section-best" href="#section-best">Best Sellers</a>';
    if (items.some(function (i) { return i.deal; })) {
      html += '<a class="nav__link nav__link--deal" data-anchor="section-sale" href="#section-sale">Deals</a>';
    }
    CATS.forEach(function (c) {
      html += '<a class="nav__link" data-cat="' + c + '" href="#section-grid">' + (NAV_LABELS[c] || c) + "</a>";
    });
    navEl.innerHTML = html;
    navEl.addEventListener("click", function (e) {
      var l = e.target.closest(".nav__link");
      if (!l) return;
      navEl.classList.remove("is-open");
      if (l.dataset.anchor) {
        e.preventDefault();
        var el = document.getElementById(l.dataset.anchor);
        if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      /* 分类链接：阻止默认锚点跳转，避免与平滑滚动冲突 */
      e.preventDefault();
      setCat(l.dataset.cat || "");
    });

    var f =
      '<a data-anchor="section-new" href="#section-new">New Arrivals</a>' +
      '<a data-anchor="section-best" href="#section-best">Best Sellers</a>';
    ["Dress", "Pants", "Top", "Skirt", "Jumpsuit", "Set"].forEach(function (c) {
      f += '<a href="#section-grid" data-cat="' + c + '">' + (NAV_LABELS[c] || c) + "</a>";
    });
    footNavEl.innerHTML = f;
    footNavEl.addEventListener("click", function (e) {
      var l = e.target.closest("a");
      if (!l) return;
      if (l.dataset.anchor) {
        e.preventDefault();
        var el = document.getElementById(l.dataset.anchor);
        if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      /* 分类链接：阻止默认锚点跳转，避免与平滑滚动冲突 */
      e.preventDefault();
      setCat(l.dataset.cat || "");
    });
  }

  function initMenu() {
    var btn = document.getElementById("menuBtn");
    btn.addEventListener("click", function () { navEl.classList.toggle("is-open"); });
  }

  /* ---------- product rows ---------- */
  function initRows() {
    bestEl.innerHTML = bySales(items, 10).map(function (i) { return card(i, "Best Seller"); }).join("");

    var sorted = items.slice().sort(function (a, b) { return (b.sales7 || 0) - (a.sales7 || 0); });
    var fresh = sorted.filter(function (i) { return i.sales7 > 0; });
    fresh = fresh.length >= 10 ? fresh : sorted;
    newEl.innerHTML = fresh.slice(0, 10).map(function (i) { return card(i, "New"); }).join("");
  }

  /* ---------- featured collections ----------
     取代原分类瓷砖：每个重点品类一条横滑轮播（标题 + 箭头），
     结构与 prettygarden 首页的主题合集一致。 */
  var FEATURED_COLS = ["Dress", "Pants", "Jumpsuit", "Set"];

  /* ---------- deals ----------
     促销款由 data/sync_deals.js 从 lepunuodeals.com 同步打标；无促销款时区块整体隐藏 */
  function buildSale() {
    var list = bySales(items.filter(function (i) { return i.deal; }), 12);
    if (!list.length) { saleSec.hidden = true; return; }
    saleSec.hidden = false;
    saleEl.innerHTML = list.map(function (i) { return card(i, null); }).join("");
  }

  function buildCollections() {
    var wrap = document.getElementById("collections");
    var html = "";
    FEATURED_COLS.forEach(function (c) {
      var list = bySales(items.filter(function (i) { return i.category === c && i.image; }), 10);
      if (!list.length) return;
      var id = "col-" + c;
      html +=
        '<div class="rowhead">' +
          '<h2 class="sec__title">' + esc(NAV_LABELS[c] || c) + "</h2>" +
          '<div class="carow__btns" data-carousel="' + id + '">' +
            '<button class="carow__btn" data-dir="prev" aria-label="Previous">‹</button>' +
            '<button class="carow__btn" data-dir="next" aria-label="Next">›</button>' +
          "</div>" +
        "</div>" +
        '<div id="' + id + '" class="carow">' + list.map(function (i) { return card(i); }).join("") + "</div>";
    });
    wrap.innerHTML = html;
  }

  /* ---------- reviews ---------- */
  /* 品牌卖点文案（非顾客评价）：避免虚构"真实评论"的合规风险 */
  var REVIEWS = [
    { t: "Soft fabrics that keep their shape wash after wash — made for everyday wear." },
    { t: "True-to-size fits with an easy, effortless silhouette you can dress up or down." },
    { t: "Quality you can feel at a fair price, shipped fast through Amazon." }
  ];

  function buildReviews() {
    var picks = bySales(items, 3);
    var html = "";
    picks.forEach(function (p, i) {
      var r = REVIEWS[i] || REVIEWS[0];
      html +=
        '<div class="review">' +
          '<a class="review__imgwrap" href="' + amazonUrl(p) + '" target="_blank" rel="noopener nofollow">' +
            '<img class="review__img" style="--z:' + zoomOf(p) + '" src="' + hiRes(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.onerror=null;this.outerHTML=\'<div class=&quot;imgph imgph--review&quot;></div>\'">' +
          "</a>" +
          '<div class="review__body">' +
            '<p class="review__text">"' + esc(r.t) + '"</p>' +
            '<span class="review__author">' + esc(p.category) + " · Lepunuo style pick</span>" +
          "</div>" +
        "</div>";
    });
    reviewsEl.innerHTML = html;
  }

  /* ---------- instagram ---------- */
  function buildIg() {
    var pics = items.slice().sort(function (a, b) { return b.sales90 - a.sales90; }).filter(function (i) { return i.image; }).slice(0, 6);
    var html = "";
    pics.forEach(function (p) {
      html +=
        '<a class="ig__item" href="' + amazonUrl(p) + '" target="_blank" rel="noopener nofollow">' +
          '<img src="' + hiRes(p.image) + '" alt="' + esc(p.name) + '" style="--z:' + zoomOf(p) + '" loading="lazy" onerror="this.onerror=null;this.outerHTML=\'<div class=&quot;imgph&quot;></div>\'">' +
          "<span>✦</span>" +
        "</a>";
    });
    igEl.innerHTML = html;
  }

  /* ---------- grouped grid (by category) ---------- */
  function setCat(c) {
    var el = c ? document.getElementById("cat-" + c) : groupsEl;
    /* 目标分组不存在（被当前搜索过滤掉了）→ 重置搜索后定位，避免点击无响应 */
    if (!el && c && state.q) {
      state.q = "";
      searchEl.value = "";
      renderSuggestions("");
      renderGroups(false);
      el = document.getElementById("cat-" + c);
    }
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  var groupsEl = document.getElementById("catGroups");

  function sortedList(list) {
    switch (state.sort) {
      case "price-asc":
        list.sort(function (a, b) { return (a.price || 1e9) - (b.price || 1e9); });
        break;
      case "price-desc":
        list.sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
        break;
      case "name":
        list.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
        break;
      default:
        list.sort(function (a, b) { return b.sales30 - a.sales30; });
    }
    return list;
  }

  function matches(it, q) {
    if (!q) return true;
    return (
      (it.name && it.name.toLowerCase().indexOf(q) >= 0) ||
      (it.style && it.style.toLowerCase().indexOf(q) >= 0)
    );
  }

  function renderGroups(scroll) {
    var q = state.q.toLowerCase();
    var html = "", total = 0;
    CATS.forEach(function (c) {
      var list = items.filter(function (it) { return it.category === c && matches(it, q); });
      if (!list.length) return;
      total += list.length;
      html +=
        '<div class="catgroup" id="cat-' + c + '">' +
          '<div class="catgroup__head">' +
            '<h3 class="catgroup__title">' + (NAV_LABELS[c] || c) + "</h3>" +
            '<div class="carow__btns">' +
              '<button class="carow__btn" data-dir="prev" aria-label="Previous">‹</button>' +
              '<button class="carow__btn" data-dir="next" aria-label="Next">›</button>' +
            "</div>" +
          "</div>" +
          '<div class="carow">' +
            sortedList(list).map(function (i) { return card(i, null); }).join("") +
          "</div>" +
        "</div>";
    });
    emptyEl.hidden = total > 0;
    groupsEl.innerHTML = html;
    countEl.textContent = total + " style" + (total === 1 ? "" : "s") + " — shop all & checkout on Amazon";
    if (scroll) groupsEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /* ---------- search suggestions (predictive dropdown) ---------- */
  /* 输入即出 Top 5 相关商品：小图 + 名称 + 价格，点击跳亚马逊；
     尾部 "View all" 聚焦下方全量网格（此时已按关键词过滤） */
  function renderSuggestions(q) {
    if (!q) { sugEl.hidden = true; return; }
    var list = items.filter(function (it) { return matches(it, q); })
      .slice().sort(function (a, b) { return b.sales30 - a.sales30; })
      .slice(0, 5);
    if (!list.length) { sugEl.hidden = true; return; }
    var html = list.map(function (it) {
      var thumb = it.image
        ? '<img src="' + hiRes(it.image) + '" alt="" loading="lazy" onerror="this.onerror=null;this.style.visibility=\'hidden\';">'
        : "";
      return (
        '<a class="sug__item" href="' + amazonUrl(it) + '" target="_blank" rel="noopener nofollow">' +
          '<span class="sug__thumb">' + thumb + "</span>" +
          '<span class="sug__meta">' +
            '<span class="sug__name">' + esc(it.name) + "</span>" +
          "</span>" +
        "</a>"
      );
    }).join("");
    html += '<a class="sug__all" href="#section-grid" role="button">View all results →</a>';
    sugEl.innerHTML = html;
    sugEl.hidden = false;
  }

  sugEl.addEventListener("click", function (e) {
    if (e.target.closest(".sug__all")) {
      e.preventDefault();
      sugEl.hidden = true;
      searchEl.blur();
      document.getElementById("section-grid").scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    /* 点商品项：跳到亚马逊，随即收起下拉 */
    if (e.target.closest(".sug__item")) sugEl.hidden = true;
  });

  /* 点击搜索区域外时收起联想下拉 */
  document.addEventListener("click", function (e) {
    if (!sugEl.hidden && !e.target.closest(".search")) sugEl.hidden = true;
  });

  searchEl.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { sugEl.hidden = true; searchEl.blur(); }
    if (e.key === "Enter" && state.q) {
      e.preventDefault();
      sugEl.hidden = true;
      searchEl.blur();
      groupsEl.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });

  /* horizontal carousel arrows (event delegation): flip one full viewport per click.
     适配两种结构：分类组(.catgroup，箭头在组头内) 与独立区块(.rowhead，箭头按 data-carousel 找行) */
  function bindCarouselArrows(scopeEl) {
    scopeEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".carow__btn");
      if (!btn) return;
      var row = null;
      var target = btn.closest(".carow__btns") && btn.closest(".carow__btns").dataset.carousel;
      if (target) {
        row = document.getElementById(target);
      } else {
        var group = btn.closest(".catgroup");
        row = group && group.querySelector(".carow");
      }
      if (!row) return;
      var dir = btn.dataset.dir === "next" ? 1 : -1;
      row.scrollBy({ left: dir * row.clientWidth, behavior: "smooth" });
    });
  }
  bindCarouselArrows(groupsEl);
  bindCarouselArrows(document.getElementById("section-new"));
  bindCarouselArrows(document.getElementById("section-best"));

  /* ---------- events ---------- */
  var t;
  searchEl.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      state.q = searchEl.value.trim();
      renderSuggestions(state.q);
      /* 只同步结果数据，不自动滚动——滚动由用户主动触发（回车/View all） */
      renderGroups(false);
    }, 200);
  });
  sortEl.addEventListener("change", function () { state.sort = sortEl.value; renderGroups(true); });

  /* ---------- external links: fallback when new-window/tab is blocked ----------
     In sandboxed previews (e.g. inner iframe) window.open() returns null, so the
     link would silently do nothing. Fall back to navigating the current page. */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href^="http"]') : null;
    if (!a) return;
    e.preventDefault();
    var w = window.open(a.href, "_blank");
    if (!w) window.location.href = a.href;
  });

  /* ---------- init ---------- */
  initHero();
  initMenu();
  buildNav();
  initRows();
  buildSale();
  bindCarouselArrows(saleSec);
  buildCollections();
  bindCarouselArrows(document.getElementById("collections"));
  buildReviews();
  buildIg();
  renderGroups();
  document.getElementById("year").textContent = String(new Date().getFullYear());
})();
/* ---------- back to top ---------- */
(function () {
  var btn = document.createElement("button");
  btn.className = "to-top";
  btn.type = "button";
  btn.setAttribute("aria-label", "Back to top");
  btn.innerHTML = "\u2191";
  document.body.appendChild(btn);
  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  var toggle = function () {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    btn.classList.toggle("is-visible", y > 600);
  };
  window.addEventListener("scroll", toggle, { passive: true });
  toggle();
})();

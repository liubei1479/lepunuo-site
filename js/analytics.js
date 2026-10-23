/* js/analytics.js — 匿名统计埋点（无 cookie、不收集身份信息）
   - 页面浏览(PV) + 当日去重访客(uid 按 UTC+8 日期分桶，同一浏览器同一天只算一次)
   - 流量来源（utm_source / 外部 referrer 域名）
   - 商品点击量（按分类）
   - 前端 JS 错误上报
   所有请求经 sendBeacon 静默发送，失败不影响页面。 */
(function () {
  "use strict";

  function rnd() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()).slice(-8) + Math.random().toString(36).slice(2));
  }

  /* 访客标识：localStorage 按日分桶，同日刷新/关标签重开不会重复计 UV；
     禁用 localStorage 时退回会话级 sessionStorage（旧行为）。 */
  function uid() {
    var day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    var key = "__lp_uv_" + day;
    try {
      var v = localStorage.getItem(key);
      if (!v) { v = rnd(); localStorage.setItem(key, v); }
      return v;
    } catch (e) { /* 隐私模式：降级 */ }
    try {
      var s = sessionStorage.getItem("__lp_uid");
      if (!s) { s = rnd(); sessionStorage.setItem("__lp_uid", s); }
      return s;
    } catch (e2) { return ""; }
  }

  /* 流量来源：优先 utm_source / ref 参数（便于区分 Pinterest 等分发渠道），
     其次取外部 referrer 域名；直接访问与站内跳转返回空。 */
  function refSource() {
    try {
      var sp = new URLSearchParams(location.search);
      var u = sp.get("utm_source") || sp.get("ref");
      if (u) return u.slice(0, 60);
      var r = document.referrer;
      if (!r) return "";
      var host = new URL(r).hostname;
      if (!host || host === location.hostname) return "";
      return host.slice(0, 60);
    } catch (e) { return ""; }
  }

  function beacon(params) {
    if (!navigator.sendBeacon) return;
    var url = "/api/view?uid=" + encodeURIComponent(uid());
    var val, key;
    for (key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      val = params[key];
      if (val == null || val === "") continue;
      url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(val);
    }
    try { navigator.sendBeacon(url); } catch (e) { /* 静默 */ }
  }

  function isTrackablePath(p) {
    if (!p || p.indexOf("/admin") === 0) return false;
    return true;
  }

  /* 页面浏览（带来源，仅首次进入时 referrer 有意义） */
  var p = location.pathname || "/";
  if (isTrackablePath(p)) beacon({ p: p, ref: refSource() });

  /* 商品点击（按分类记录；卡片由 app.js 渲染并带 data-cat） */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="https://www.amazon.com"]') : null;
    if (!a) return;
    beacon({ click: a.getAttribute("data-cat") || "other" });
  }, true);

  /* 前端错误上报（附来源文件:行:列，便于区分本站脚本与第三方注入） */
  window.addEventListener("error", function (e) {
    var src = "";
    try {
      var fn = String(e.filename || "");
      if (fn) {
        var origin = location.origin;
        /* 本站脚本只留路径；外部/扩展来源保留完整 URL 以便追溯 */
        var sameOrigin = fn === origin || fn.indexOf(origin + "/") === 0;
        src = sameOrigin ? (fn.slice(origin.length) || "/") : fn;
        if (src.length > 100) src = src.slice(0, 100);
      }
    } catch (x) { /* 静默 */ }
    beacon({
      err: (e.message || "js error").slice(0, 120),
      src: src,
      ln: e.lineno == null ? "" : e.lineno,
      col: e.colno == null ? "" : e.colno
    });
  });
})();
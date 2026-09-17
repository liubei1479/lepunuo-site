/* js/analytics.js — 匿名统计埋点（无 cookie、不收集身份信息）
   - 页面浏览(PV) + 当日去重访客(会话级 uid)
   - 商品点击量（按分类）
   - 前端 JS 错误上报
   所有请求经 sendBeacon 静默发送，失败不影响页面。 */
(function () {
  "use strict";

  function uid() {
    try {
      var k = "__lp_uid";
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()).slice(-8) + Math.random().toString(36).slice(2));
        sessionStorage.setItem(k, v);
      }
      return v;
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

  /* 页面浏览 */
  var p = location.pathname || "/";
  if (isTrackablePath(p)) beacon({ p: p });

  /* 商品点击（按分类记录；卡片由 app.js 渲染并带 data-cat） */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="https://www.amazon.com"]') : null;
    if (!a) return;
    beacon({ click: a.getAttribute("data-cat") || "other" });
  }, true);

  /* 前端错误上报 */
  window.addEventListener("error", function (e) {
    beacon({ err: (e.message || "js error").slice(0, 120) });
  });
})();
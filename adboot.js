/* 深夜文库 · Adsterra 广告集中配置（解析期写入层）
 * ============================================================
 * 为什么需要这个文件？
 *   Adsterra 的部分广告格式（尤其 atOptions 横幅）用 document.write 输出，
 *   必须在 HTML 解析期同步执行，不能用 defer/async，也不能靠 JS 动态 innerHTML
 *   注入（那样会清空页面或广告不计数）。所以把官方代码集中放到这个文件，
 *   在各页面 </body> 前同步引入，由 document.write 原样写入。
 *
 * 【总开关】把 ENABLED 改成 false → 全站广告立即全部关闭，不留空白。
 * 【单格式开关】FORMAT 里对应项改 false 即可单独关掉某一种广告。
 * 【弹窗范围】POPUNDER_CONTENT_ONLY=true → 只在书页/阅读器/章节页弹，首页与合规页不弹。
 *
 * 注意：本文件必须用 <script src="/adboot.js"></script>（不带 defer/async）同步加载。
 * data-cfasync="false" 用于避免 Cloudflare Rocket Loader 改写导致广告失效。
 * ============================================================
 */
(function () {
  'use strict';

  // ===== 全站总开关：false = 关闭全部广告 =====
  var ENABLED = true;

  // ===== 单格式开关 =====
  var FORMAT = {
    popunder: true,  // 弹窗（abscloud.org/1）
    native:   true,  // 信息流/原生（bauval.org/21 + container div）
    social:   true   // 社交栏浮层（bauval.org/14）
    // 320x50 横幅在 adfoot.js 中，开关同步读取本文件的 ENABLED/FORMAT.banner
  };
  FORMAT.banner = true; // 320x50 横幅（atOptions + bauval.org/22）

  // ===== 弹窗只在内容页（书页 / 阅读器 / 章节页）=====
  var POPUNDER_CONTENT_ONLY = true;

  window.SY_AD_CONFIG = { enabled: ENABLED, format: FORMAT };
  if (!ENABLED) return;

  var path = location.pathname || '/';
  // 内容页匹配：/book/*  /read  /read.html  /chapter/*
  var isContent = /^\/(book|chapter)(\/|$)/.test(path) || /^\/read(\.html)?$/.test(path);

  function w(s) { document.write(s); }
  function ext(url, extra) {
    return '<script ' + (extra || '') + ' data-cfasync="false" src="' + url + '"><\/script>';
  }

  // 1) 弹窗 Popunder —— 仅内容页
  if (FORMAT.popunder && (!POPUNDER_CONTENT_ONLY || isContent)) {
    w(ext('https://abscloud.org/1/0af312921b8958cf650f130cb9ee40f7'));
  }

  // 2) 原生/信息流广告：脚本 + 对应容器 div
  if (FORMAT.native) {
    w(ext('https://bauval.org/21/c13d2e7fdaaf75d273ad382b3a8dba11', 'async="async"'));
    w('<div id="container-c13d2e7fdaaf75d273ad382b3a8dba11"></div>');
  }

  // 3) 社交栏浮层
  if (FORMAT.social) {
    w(ext('https://bauval.org/14/07158b53e5f5830c39ffe2a59f9e3b25'));
  }
})();

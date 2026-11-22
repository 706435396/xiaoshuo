/* 深夜文库 · 页尾广告集中写入层（解析期 document.write）
 * ============================================================
 * 本文件在 </body> 前同步引入。
 *
 * 【首页】320×50 已静态写进 index.html 格子，本文件在首页跳过写入，避免重复。
 * 【书页/章节页】写 320×50 到页尾底部。
 * 【阅读页】写 320×50 并搬到正文下方 [data-ad-slot="reader-bottom"] 之前。
 *
 * 总开关与格式开关读取 adboot.js 暴露的 window.SY_AD_CONFIG。
 * ============================================================
 */
(function () {
  'use strict';

  var cfg = window.SY_AD_CONFIG || { enabled: true, format: { banner: true } };
  if (!cfg.enabled) return;

  var fmt = cfg.format || {};
  var path = location.pathname || '/';
  var isHome = /^\/(index\.html)?$/.test(path);
  var isRead = /^\/read(\.html)?$/.test(path);
  function w(s) { document.write(s); }

  // ===== Adsterra 320x50 横幅 =====
  // atOptions 必须先定义，再加载 invoke 脚本（顺序不能反）
  // 首页已静态写在格子里，跳过，避免同一 id 重复写入两次。
  if (fmt.banner !== false && !isHome) {
    w('<div id="syAdBanner" class="sy-ad-float" style="margin:0 auto;text-align:center;width:320px;max-width:100%">');
    w('<script>atOptions={' +
      "'key':'0314b76eee5da2a4c14f696662cbe285'," +
      "'format':'iframe'," +
      "'height':50," +
      "'width':320," +
      "'params':{}" +
      '};<\/script>');
    w('<script data-cfasync="false" src="https://bauval.org/22/0314b76eee5da2a4c14f696662cbe285"><\/script>');
    w('<\/div>');
  }

  // ===== 阅读页：把 320x50 搬到正文下方稳定锚点 =====
  // 书页/章节页的 320x50 留在页尾，无需搬运。
  function placeBanner() {
    if (!isRead) return;
    var banner = document.getElementById('syAdBanner');
    var bottom = document.querySelector('[data-ad-slot="reader-bottom"]');
    if (banner && bottom && bottom.parentNode && banner.parentNode !== bottom.parentNode) {
      bottom.parentNode.insertBefore(banner, bottom);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', placeBanner);
  } else {
    placeBanner();
  }
})();

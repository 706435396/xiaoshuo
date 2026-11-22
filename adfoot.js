/* 深夜文库 · 页尾广告集中写入层（解析期 document.write）
 * ============================================================
 * 本文件在 </body> 前同步引入，用 document.write 在 HTML 解析期写入广告代码。
 * 现在只保留 1 类联盟广告 + 1 套位置编排：
 *   1) Adsterra 320x50 横幅（atOptions + bauval.org/22 invoke）
 *   2) placeAds()：把广告容器从页尾"搬"到建议位置的稳定锚点。
 *      移动已渲染的 DOM 节点不会让联盟脚本失效（脚本按容器 id 查找，与位置无关）。
 * 300x250（JuicyAds）已于 2026-11-22 按用户要求关闭，不再写入。
 * 总开关与格式开关统一读取 adboot.js 暴露的 window.SY_AD_CONFIG。
 * ============================================================
 */
(function () {
  'use strict';

  var cfg = window.SY_AD_CONFIG || { enabled: true, format: { banner: true, juicy: false } };
  if (!cfg.enabled) return;

  var fmt = cfg.format || {};
  function w(s) { document.write(s); }

  // ===== 1) Adsterra 320x50 横幅 =====
  // atOptions 必须先定义，再加载 invoke 脚本（顺序不能反）
  if (fmt.banner !== false) {
    w('<div id="syAdBanner" class="sy-ad-float" style="margin:0 auto;text-align:center;width:300px">');
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

  // ===== 2) 位置编排：把广告搬到建议位置的稳定锚点 =====
  // bookGrid 会被分页 innerHTML 重建，所以 Native 放到 bookGrid 之后（书单区底部），
  // 不插进卡片之间——否则翻页时节点被销毁、广告消失。
  //  - 首页：Native → 书单区下方（bookGrid 之后）；320x50 → 分页上方
  //  - 阅读页：320x50 → 正文下方（reader-bottom 之前）；Native 不在阅读页出现
  //  - 章节/书页：保持页尾（无更合适锚点）
  function placeAds() {
    var path = location.pathname || '/';
    var isHome = /^\/(index\.html)?$/.test(path);
    var isRead = /^\/read(\.html)?$/.test(path);
    var native = document.getElementById('syAdNative');
    var banner = document.getElementById('syAdBanner');

    if (isHome) {
      var grid = document.getElementById('bookGrid');
      // Native → 书单区下方（bookGrid 之后）：稳定，不受分页重建影响
      if (native && grid && grid.parentNode && native.parentNode !== grid.parentNode) {
        grid.parentNode.insertBefore(native, grid.nextSibling);
      }
      // 320x50 → 分页上方
      var pag = document.getElementById('pagination');
      if (banner && pag && pag.parentNode && banner.parentNode !== pag.parentNode) {
        pag.parentNode.insertBefore(banner, pag);
      }
    } else if (isRead) {
      // 320x50 → 正文下方（reader-bottom 容器之前）
      var bottom = document.querySelector('[data-ad-slot="reader-bottom"]');
      if (banner && bottom && bottom.parentNode && banner.parentNode !== bottom.parentNode) {
        bottom.parentNode.insertBefore(banner, bottom);
      }
    }
    // 章节页 / 书页：无更合适锚点，广告留在页尾
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', placeAds);
  } else {
    placeAds();
  }
})();

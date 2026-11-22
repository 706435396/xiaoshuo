/* 深夜文库 · 页尾广告集中写入层（解析期 document.write）
 * ============================================================
 * 本文件在 </body> 前同步引入，用 document.write 在 HTML 解析期写入广告代码。
 * 现在保留：
 *   1) Adsterra 320x50 横幅（atOptions + bauval.org/22 invoke）
 *   2) placeAds()：把 3 个"格子广告"从页尾搬到首页 [data-ad-port] 落位。
 *      移动已渲染的 DOM 节点不会让联盟脚本失效（脚本按容器 id / ins id 查找，与位置无关）。
 *
 * 【首页 4 个广告的最终落位】
 *   - 300x250 中矩形（JuicyAds，adboot.js 写入 #syAdRect） → [data-ad-port="rect"]
 *   - Native 原生（Adsterra，adboot.js 写入 #syAdNative）   → [data-ad-port="native"]
 *   - 320x50 横幅（本文件写入 #syAdBanner）                → [data-ad-port="banner"]
 *   - Social Bar：浮层脚本，自身悬浮，不占格子
 *
 * 总开关与格式开关统一读取 adboot.js 暴露的 window.SY_AD_CONFIG。
 * ============================================================
 */
(function () {
  'use strict';

  var cfg = window.SY_AD_CONFIG || { enabled: true, format: { banner: true, juicy: true } };
  if (!cfg.enabled) return;

  var fmt = cfg.format || {};
  function w(s) { document.write(s); }

  // ===== 1) Adsterra 320x50 横幅 =====
  // atOptions 必须先定义，再加载 invoke 脚本（顺序不能反）
  if (fmt.banner !== false) {
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

  // ===== 2) 位置编排：把 3 个格子广告搬到首页落位 =====
  // 说明：这些广告用 document.write 写在页尾，DOMContentLoaded 后移动到目标格子。
  //       移动节点不影响联盟脚本（按 id 查找），且落位是稳定锚点，不受书单分页重建影响。
  function moveTo(portName, node) {
    if (!node) return;
    var port = document.querySelector('[data-ad-port="' + portName + '"]');
    if (port && node.parentNode !== port) {
      port.innerHTML = '';
      port.appendChild(node);
      node.style.width = '';       // 交给格子控制宽度
      node.style.maxWidth = '100%';
      node.className = '';         // 去掉旧的 sy-ad-float（落位后不再悬浮）
    }
  }

  function placeAds() {
    var path = location.pathname || '/';
    var isHome = /^\/(index\.html)?$/.test(path);
    var isRead = /^\/read(\.html)?$/.test(path);
    var rect = document.getElementById('syAdRect');
    var native = document.getElementById('syAdNative');
    var banner = document.getElementById('syAdBanner');

    if (isHome) {
      // 首页：三个格子广告各归其位
      moveTo('rect', rect);
      moveTo('native', native);
      moveTo('banner', banner);
    } else if (isRead) {
      // 阅读页：320x50 通栏放正文下方；300x250/Native 不投放在此页
      var bottom = document.querySelector('[data-ad-slot="reader-bottom"]');
      if (banner && bottom && bottom.parentNode && banner.parentNode !== bottom.parentNode) {
        bottom.parentNode.insertBefore(banner, bottom);
      }
      if (rect) rect.style.display = 'none';
      if (native) native.style.display = 'none';
    }
    // 章节页 / 书页：无格子落位，广告留在页尾底部（read.html 之外的常规页）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', placeAds);
  } else {
    placeAds();
  }
})();

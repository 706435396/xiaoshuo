/* 深夜文库 · 页尾广告集中写入层（解析期 document.write）
 * ============================================================
 * 本文件在 </body> 前同步引入，用 document.write 在 HTML 解析期写入广告代码。
 * 包含两类，互不依赖、可各自单独开关：
 *   1) Adsterra 320x50 横幅（atOptions，invoke 脚本内部 document.write 输出 iframe）
 *   2) JuicyAds 300x250（ins 占位 + jads.js 推送队列，adzone 1133796）
 * 两者都必须在解析期同步写入，不能靠 innerHTML 动态注入（会失败或不计数）。
 * 总开关与格式开关统一读取 adboot.js 暴露的 window.SY_AD_CONFIG（一处控制全站）。
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
    w('<div class="sy-ad-float" style="margin:0 auto;text-align:center;width:300px">');
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

  // ===== 2) JuicyAds 300x250（adzone 1133796）=====
  // 官方顺序：jads.js → <ins> 占位 → push 命令，三者不能调换。
  // 用 div 包裹 ins 仅为居中显示，不影响 adzone 识别。
  if (fmt.juicy !== false) {
    w('<div class="sy-ad-float" style="margin:16px auto;text-align:center;max-width:300px">');
    w('<script type="text/javascript" data-cfasync="false" async src="https://poweredby.jads.co/js/jads.js"><\/script>');
    w('<ins id="1133796" data-width="300" data-height="250"><\/ins>');
    w('<script type="text/javascript" data-cfasync="false" async>(adsbyjuicy = window.adsbyjuicy || []).push({\'adzone\':1133796});<\/script>');
    w('<\/div>');
  }
})();

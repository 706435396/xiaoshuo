/* 深夜文库 · Adsterra 320x50 横幅（atOptions，解析期写入）
 * ============================================================
 * 这段是 Adsterra 的 iframe 横幅，invoke 脚本内部用 document.write 输出 iframe，
 * 必须在 HTML 解析期同步执行，所以单独放在 </body> 前同步引入。
 * 总开关与格式开关统一读取 adboot.js 暴露的 window.SY_AD_CONFIG（一处控制全站）。
 * ============================================================
 */
(function () {
  'use strict';

  var cfg = window.SY_AD_CONFIG || { enabled: true, format: { banner: true } };
  if (!cfg.enabled || !cfg.format.banner) return;

  function w(s) { document.write(s); }

  // atOptions 必须先定义，再加载 invoke 脚本（顺序不能反）
  w('<script>atOptions={' +
    "'key':'0314b76eee5da2a4c14f696662cbe285'," +
    "'format':'iframe'," +
    "'height':50," +
    "'width':320," +
    "'params':{}" +
    '};<\/script>');
  w('<script data-cfasync="false" src="https://bauval.org/22/0314b76eee5da2a4c14f696662cbe285"><\/script>');
})();

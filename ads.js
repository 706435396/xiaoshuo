/* 深夜文库 · 全站广告位集中配置
 * ============================================================
 * 只需修改本文件即可控制全站广告，不用逐个页面改代码。
 *
 * 【怎么启用】把 ENABLED 改成 true，并在 SLOTS 里填入广告联盟给你的代码。
 * 【怎么关闭】把 ENABLED 改回 false，全站广告立即消失，不留空白。
 *
 * 页面里凡是 <div data-ad-slot="名字"></div> 的容器，都会被自动填充。
 * 未填写代码的广告位不会显示，也不会占位置。
 *
 * 成人站注意：Google AdSense 基本不批成人内容。
 * 建议用对成人友好的联盟：ExoClick / Adsterra / TrafficJunky 等，
 * 它们通常给一段 <script> 或 <iframe>，原样粘到对应 SLOT 的字符串里即可。
 * ============================================================
 */
(function () {
  'use strict';

  // 全站总开关：false=全部关闭（默认），true=启用下方已填写的广告位
  var ENABLED = false;

  // 各广告位的广告代码。留空字符串 '' 表示该位置不显示。
  // 支持 HTML（iframe/ins/script 标签均可）。脚本标签在 innerHTML 中不执行，
  // 如需执行 <script>，请改用联盟提供的"异步加载代码片段"并在页面 head 引入。
  var SLOTS = {
    // 首页：搜索栏下方横幅
    'home-top': '',
    // 首页：书列表中部
    'home-mid': '',
    // 书详情/章节页：正文上方横幅
    'content-top': '',
    // 书详情/章节页：正文下方横幅
    'content-bottom': '',
    // 阅读器：章节正文上方
    'reader-top': '',
    // 阅读器：章节正文下方
    'reader-bottom': '',
    // 各页侧边/页脚通用
    'sidebar': '',
    'footer': ''
  };

  function inject() {
    var slots = document.querySelectorAll('[data-ad-slot]');
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      var name = el.getAttribute('data-ad-slot');
      var code = ENABLED ? (SLOTS[name] || '') : '';
      if (!code) {
        el.style.display = 'none';
        continue;
      }
      el.innerHTML = code;
      el.style.display = '';
      // 标记已注入，便于联盟脚本按容器查找
      el.setAttribute('data-ad-filled', '1');
    }
  }

  // DOM 就绪后注入（本脚本统一用 defer，通常 DOM 已就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  // 暴露给控制台/后续脚本：window.SY_ADS.refresh() 可重新注入
  window.SY_ADS = {
    enabled: ENABLED,
    slots: SLOTS,
    refresh: inject
  };
})();

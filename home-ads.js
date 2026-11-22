/* 深夜文库 · 首页网格广告集中配置
 * ============================================================
 * 一处配置控制首页 6 个广告格子，不用逐个页面改代码。
 *
 * 【总开关】ENABLED=false → 全站首页网格全部隐藏，不留空白。
 * 【占位开关】SHOW_PLACEHOLDER=false → 未填代码的格子完全隐藏（默认显示轻量占位）。
 * 【填广告】把联盟代码原样粘到下面对应格子的引号里即可，保存全站生效。
 *
 * 支持的广告类型：
 *   - 普通 HTML / <a> 文字链 / <img> / <iframe>（直接注入）
 *   - "脚本 + 容器"型，如 JuicyAds v3（<script src> + <ins> + push）：
 *     脚本会被动态创建并按原顺序执行，容器/ins 保留在格子内，可正常渲染。
 *   不支持：document.write 型（如 Adsterra atOptions 横幅）——那种必须用解析期写入，
 *   请放在 adfoot.js，不要填到这里。
 *
 * 侧栏格子（cat-ad / shelf-ad）宽度约 208~224px，建议用自适应代码或 ≤208px 的创意，
 * 避免 300px 固定宽 iframe 溢出。
 * ============================================================
 */
(function () {
  'use strict';

  // ===== 总开关 =====
  var ENABLED = true;
  // ===== 未填代码时是否显示轻量占位（false=格子完全隐藏）=====
  var SHOW_PLACEHOLDER = true;

  // ===== 6 个格子的广告代码（留空 '' 表示该格未填）=====
  var SLOTS = {
    // 主内容区：Tabs「最新/精华/热门」上方，2 个横排格子
    'home-hero-1': '',
    'home-hero-2': '',
    // 左侧「分类」栏下方，2 个竖排格子
    'cat-ad-1': '',
    'cat-ad-2': '',
    // 右侧「我的书架」栏下方，2 个竖排格子
    'shelf-ad-1': '',
    'shelf-ad-2': ''
  };

  // 占位样式（轻量，不空一大块）
  var PLACEHOLDER = {
    hero:   '<div style="min-height:96px;border:1px dashed #cbd5e1;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;gap:6px">📐 广告位</div>',
    side:   '<div style="min-height:120px;border:1px dashed #cbd5e1;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;gap:6px">📐 广告位</div>'
  };

  // 保序注入：容器节点留在格内，<script> 动态创建执行（innerHTML 不执行 script）
  function injectHtml(el, html) {
    el.innerHTML = '';
    var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    var wrap = doc.body.firstChild;
    if (!wrap) return;
    var nodes = Array.prototype.slice.call(wrap.childNodes);
    nodes.forEach(function (node) {
      if (node.nodeType === 1 && node.nodeName === 'SCRIPT') {
        var s = document.createElement('script');
        for (var i = 0; i < node.attributes.length; i++) {
          s.setAttribute(node.attributes[i].name, node.attributes[i].value);
        }
        s.textContent = node.textContent;
        // 先插容器后执行脚本的保序：脚本追加到 head，容器已在格内，按 id 可正确查找
        document.head.appendChild(s);
      } else {
        el.appendChild(document.importNode(node, true));
      }
    });
  }

  function sideOf(name) {
    return /^(cat-ad|shelf-ad)/.test(name) ? 'side' : 'hero';
  }

  function injectAll() {
    var cells = document.querySelectorAll('[data-home-ad]');
    for (var i = 0; i < cells.length; i++) {
      var el = cells[i];
      var name = el.getAttribute('data-home-ad');
      if (!ENABLED) { el.style.display = 'none'; continue; }
      var code = SLOTS[name] || '';
      if (code) {
        el.style.display = '';
        injectHtml(el, code);
      } else if (SHOW_PLACEHOLDER) {
        el.style.display = '';
        el.innerHTML = PLACEHOLDER[sideOf(name)] || PLACEHOLDER.hero;
      } else {
        el.style.display = 'none';
      }
    }
  }

  function run() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectAll);
    } else {
      injectAll();
    }
  }

  // 暴露给控制台：SY_HOME_ADS.set('home-hero-1','<代码>') 后 SY_HOME_ADS.refresh()
  window.SY_HOME_ADS = {
    enabled: ENABLED,
    slots: SLOTS,
    set: function (name, code) { SLOTS[name] = code; },
    refresh: injectAll
  };

  run();
})();

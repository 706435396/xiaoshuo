/* 深夜文库 · 后台配置广告渲染器
 * 从 /api/adslots 读取管理后台保存的配置，渲染到 [data-ad-key] 格子。
 * - 无配置/未启用：格子保持隐藏，不留空白
 * - 图片模式：img + 可选跳转链接
 * - HTML 模式：写入代码并重新执行其中的 <script>（支持联盟异步脚本）
 * 本文件用 defer 加载，不阻塞页面。
 */
(function () {
  'use strict';

  var API = '/api/adslots';
  var DONE_ATTR = 'data-ad-rendered';

  function render(host, slot) {
    if (!slot || !slot.enabled || !slot.value) return; // 保持隐藏

    host.innerHTML = '';
    host.classList.remove('hidden');
    host.style.display = '';

    if (slot.type === 'html') {
      // HTML 代码：innerHTML 写入后，script 标签不会自动执行，需重建
      host.innerHTML = slot.value;
      var oldScripts = host.querySelectorAll('script');
      var list = [].slice.call(oldScripts);
      list.forEach(function (old) {
        var s = document.createElement('script');
        // 复制属性（保留 async / src / data-* 等）
        for (var i = 0; i < old.attributes.length; i++) {
          var a = old.attributes[i];
          s.setAttribute(a.name, a.value);
        }
        s.textContent = old.textContent;
        old.parentNode.replaceChild(s, old);
      });
    } else {
      // 图片模式
      var img = document.createElement('img');
      img.src = slot.value;
      img.alt = slot.note || '广告';
      img.loading = 'lazy';
      img.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px';
      if (slot.link && /^https?:\/\//i.test(slot.link)) {
        var a = document.createElement('a');
        a.href = slot.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(img);
        host.appendChild(a);
      } else {
        host.appendChild(img);
      }
    }
  }

  function apply(data) {
    if (!data || !data.slots) return;
    var hosts = document.querySelectorAll('[data-ad-key]');
    for (var i = 0; i < hosts.length; i++) {
      (function (host) {
        if (host.getAttribute(DONE_ATTR)) return;
        host.setAttribute(DONE_ATTR, '1');
        var key = host.getAttribute('data-ad-key');
        // 无配置时确保隐藏（HTML 里默认带 hidden class）
        var slot = data.slots[key];
        if (!slot || !slot.enabled || !slot.value) {
          host.classList.add('hidden');
          host.innerHTML = '';
          return;
        }
        render(host, slot);
      })(hosts[i]);
    }
  }

  function load() {
    return fetch(API + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () { /* 后台不可用时静默降级：所有格子保持隐藏 */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

  // 供手动刷新调用（如后台保存后想立刻更新当前页）
  window.SY_ADS = { refresh: load };
})();

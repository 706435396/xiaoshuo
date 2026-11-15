/**
 * 年龄验证门：本站仅面向成年读者。
 * - 内容始终保留在 DOM 中（不删除/不隐藏正文），搜索引擎与爬虫可正常抓取。
 * - 仅对真人访客显示一次性确认遮罩；确认后写入 localStorage + Cookie，长期有效。
 * - 已知搜索引擎爬虫 UA 直接放行，避免影响收录。
 */
(function () {
  'use strict';
  var KEY = 'shenye_adult_verified';
  var BOT_RE = /bot|spider|crawler|slurp|bingpreview|google|baidu|sogou|so\.com|yisou|360spider|facebookexternalhit|twitterbot|curl|python|headless|lighthouse/i;

  function verified() {
    try { if (localStorage.getItem(KEY) === '1') return true; } catch (e) {}
    try { if (/(?:^|;\s*)sy_adult=1(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
    return false;
  }
  function setVerified() {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    try { document.cookie = 'sy_adult=1; path=/; max-age=31536000; SameSite=Lax'; } catch (e) {}
  }

  if (BOT_RE.test(navigator.userAgent || '') || verified()) return;

  function build() {
    var wrap = document.createElement('div');
    wrap.id = 'agegate';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,8,10,.96);display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    wrap.innerHTML =
      '<div style="max-width:440px;width:100%;background:#161616;border:1px solid #333;border-radius:16px;padding:32px 28px;text-align:center;color:#e8e8e8">' +
        '<div style="font-size:38px;margin-bottom:8px">🌙</div>' +
        '<div style="font-size:22px;font-weight:700;color:#ff9500;margin-bottom:10px">深夜文库</div>' +
        '<p style="font-size:15px;line-height:1.8;color:#cfcfcf;margin:0 0 8px">本站内容仅面向 <strong style="color:#fff">18 周岁及以上</strong> 成年读者。</p>' +
        '<p style="font-size:13px;line-height:1.7;color:#9a9a9a;margin:0 0 22px">每一个夜晚，都有一个值得读完的故事。<br/>继续访问即表示你已确认达到法定成年年龄，并同意遵守本站内容规范。</p>' +
        '<button id="agegate-yes" style="width:100%;background:#ff9500;color:#111;font-size:16px;font-weight:700;border:0;border-radius:10px;padding:13px 0;cursor:pointer">我已满 18 岁，继续访问</button>' +
        '<button id="agegate-no" style="width:100%;margin-top:10px;background:transparent;color:#9a9a9a;font-size:14px;border:1px solid #333;border-radius:10px;padding:11px 0;cursor:pointer">未满 18 岁，离开</button>' +
      '</div>';
    document.body.appendChild(wrap);
    document.getElementById('agegate-yes').addEventListener('click', function () {
      setVerified();
      wrap.parentNode && wrap.parentNode.removeChild(wrap);
    });
    document.getElementById('agegate-no').addEventListener('click', function () {
      try { window.location.href = 'about:blank'; } catch (e) { window.close(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();

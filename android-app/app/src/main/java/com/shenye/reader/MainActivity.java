package com.shenye.reader;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 深夜文库 App —— WebView 在线套壳
 * 只加载 shenye.72tool.com，所有内容/广告走线上，改网站即改 App。
 */
public class MainActivity extends Activity {

    // 站点首页（改这里换地址）
    private static final String HOME_URL = "https://shenye.72tool.com/";
    private static final String SITE_HOST = "shenye.72tool.com";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 标题栏去掉 + 深色状态栏（贴合小说站深色主题；深色底不要加 LIGHT_STATUS_BAR）
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(0xFF0E0E14);

        // 单纯 WebView 铺满全屏
        web = new WebView(this);
        web.setId(View.generateViewId());
        setContentView(web);

        WebSettings s = web.getSettings();

        // —— 基础能力 ——
        s.setJavaScriptEnabled(true);              // 广告脚本 + 章节渲染必须
        s.setDomStorageEnabled(true);              // localStorage（年龄门/广告门控依赖）
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // —— 广告联盟相关 ——
        // 允许混合内容：站点是 https，但部分广告联盟资源走 http
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 第三方 Cookie：Adsterra / JuicyAds 归因和频控靠它，关掉广告会异常或不计收益
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(web, true);
        }

        // 缓存策略：有网用缓存优先，减少重复流量；下拉刷新由 App 自己控制
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // UA 追加 App 标识，方便站点端识别（不影响广告联盟判定）
        String ua = s.getUserAgentString();
        s.setUserAgentString(ua + " ShenyeReaderAndroid/1.0");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String url = req.getUrl().toString();
                return handleUrl(v, url);
            }

            // 兼容老 API
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return handleUrl(v, url);
            }

            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                super.onPageStarted(v, url, favicon);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                super.onPageFinished(v, url);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                // 只在主文档加载失败时显示错误页，广告资源失败不管
                if (req != null && req.isForMainFrame() && v.getUrl() == null) {
                    v.loadUrl("data:text/html;charset=utf-8,"
                            + "<meta name='viewport' content='width=device-width'>"
                            + "<body style='background:#0e0e14;color:#ddd;font:16px sans-serif;"
                            + "display:flex;align-items:center;justify-content:center;height:80vh'>"
                            + "<div style='text-align:center'>网络开小差了<br><br>"
                            + "<a href='" + HOME_URL + "' style='color:#7c9cff'>点击重试</a></div></body>");
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int newProgress) {
                super.onProgressChanged(v, newProgress);
                setTitle("深夜文库");
            }
        });

        // 长按不弹系统菜单（避免误触复制/跳转）
        web.setOnLongClickListener(v -> true);

        if (savedInstanceState == null) {
            web.loadUrl(HOME_URL);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    /** 站内链接在 App 内打开；站外链接（广告落地页等）交给系统浏览器 */
    private boolean handleUrl(WebView v, String url) {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            Uri u = Uri.parse(url);
            String host = u.getHost();
            if (host != null && (host.equals(SITE_HOST) || host.endsWith("." + SITE_HOST))) {
                return false; // 站内，WebView 自己加载
            }
            // 站外：系统浏览器打开，避免广告落地页把小说页顶掉
            try {
                android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(i);
            } catch (Exception ignored) {}
            return true;
        }
        // tel: / mailto: / 其它 scheme
        try {
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(i);
        } catch (Exception ignored) {}
        return true;
    }

    /** 返回键：WebView 有历史就回退，否则退出 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}

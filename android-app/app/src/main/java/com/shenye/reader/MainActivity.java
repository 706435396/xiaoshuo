package com.shenye.reader;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 深夜文库 App —— 原生外壳 + WebView 内容内核
 *
 * 原生部分：冷启动 Splash / 顶部标题栏 / 底部四 Tab / 最近阅读（本地）
 * 网站部分：首页、书架、章节、广告全部走线上，改网站即改 App，不用重装。
 *
 * 站点若要加新 Tab，只改 TAB_URLS 与 TAB_NAMES 两个数组即可。
 */
public class MainActivity extends Activity {

    // ===== 站点配置（改这里换地址 / 换 Tab）=====
    private static final String HOME_URL = "https://shenye.72tool.com/";
    private static final String SITE_HOST = "shenye.72tool.com";
    private static final String[] TAB_NAMES = {"首页", "书架", "分类", "我的"};
    private static final String[] TAB_URLS = {
            HOME_URL,
            null,               // 书架：原生最近阅读弹窗，不加载网页
            HOME_URL + "#catBar",
            HOME_URL + "profile.html"
    };
    // 进首页后要执行的 JS（分类 Tab 滚动到分类横滑栏）
    private static final String JS_SCROLL_CATS =
            "(function(){var e=document.getElementById('catBar');"
            + "if(e){e.scrollIntoView({block:'center'});}return !!e;})()";

    // ===== 配色（与站点主题一致）=====
    private static final int C_BG = 0xFF0E0E14;      // 页面底色
    private static final int C_BAR = 0xFF14141C;    // 顶栏 / 底栏
    private static final int C_ON = 0xFFFF9500;     // 选中橙
    private static final int C_OFF = 0xFF8B8B95;    // 未选中灰
    private static final int C_LINE = 0xFF26262F;   // 分隔线

    private static final String PREF_RECENT = "sy_recent";
    private static final int RECENT_MAX = 20;

    private WebView web;
    private TextView titleView;
    private TextView[] tabViews = new TextView[4];
    private View splash;
    private int currentTab = 0;
    private String pendingJs = null;
    private long lastBackAt = 0;
    private final Handler handler = new Handler();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(C_BG);
        getWindow().setNavigationBarColor(C_BG);

        // ---------- 整体布局：顶栏 + 内容 + 底栏 ----------
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(C_BG);
        setContentView(root);

        root.addView(buildTopBar());

        FrameLayoutHolder holder = new FrameLayoutHolder(this);
        LinearLayout.LayoutParams contentLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        holder.setLayoutParams(contentLp);
        root.addView(holder);

        web = buildWebView();
        holder.addView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splash = buildSplash();
        holder.addView(splash, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildBottomBar());

        // 1.2 秒后收起启动页；内容在网络后台并行加载，不浪费时间
        handler.postDelayed(() -> {
            if (splash != null) splash.setVisibility(View.GONE);
        }, 1200);

        if (savedInstanceState == null) {
            web.loadUrl(HOME_URL);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    // ---------------- 原生顶栏 ----------------
    private View buildTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(C_BAR);
        bar.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(50)));

        TextView back = barButton("‹", 22);
        back.setOnClickListener(v -> onBack());
        bar.addView(back);

        titleView = new TextView(this);
        titleView.setText("深夜文库");
        titleView.setTextSize(16);
        titleView.setTextColor(Color.WHITE);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setGravity(Gravity.CENTER);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.MATCH_PARENT, 1f));
        bar.addView(titleView);

        TextView refresh = barButton("↻", 19);
        refresh.setOnClickListener(v -> {
            web.reload();
            Toast.makeText(this, "刷新中", Toast.LENGTH_SHORT).show();
        });
        bar.addView(refresh);

        // 顶栏下细线
        View line = new View(this);
        line.setBackgroundColor(C_LINE);
        line.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1));
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        wrap.addView(bar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(50)));
        wrap.addView(line);
        return wrap;
    }

    private TextView barButton(String text, int size) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(size);
        t.setTextColor(C_ON);
        t.setGravity(Gravity.CENTER);
        t.setLayoutParams(new LinearLayout.LayoutParams(dp(50),
                LinearLayout.LayoutParams.MATCH_PARENT));
        return t;
    }

    // ---------------- 原生底部 Tab ----------------
    private View buildBottomBar() {
        View line = new View(this);
        line.setBackgroundColor(C_LINE);
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        wrap.addView(line, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(C_BAR);
        bar.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(58)));

        for (int i = 0; i < TAB_NAMES.length; i++) {
            final int idx = i;
            TextView t = new TextView(this);
            t.setText(TAB_NAMES[i]);
            t.setTextSize(12);
            t.setTextColor(i == 0 ? C_ON : C_OFF);
            t.setGravity(Gravity.CENTER);
            t.setLayoutParams(new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.MATCH_PARENT, 1f));
            t.setOnClickListener(v -> switchTab(idx));
            tabViews[i] = t;
            bar.addView(t);
        }
        wrap.addView(bar);
        return wrap;
    }

    private void switchTab(int idx) {
        currentTab = idx;
        for (int i = 0; i < tabViews.length; i++) {
            tabViews[i].setTextColor(i == idx ? C_ON : C_OFF);
        }

        if (idx == 1) {                       // 书架：原生最近阅读，不走网页
            showRecent();
            return;
        }
        if (idx == 2) {                       // 分类：回首页并滚到分类横滑栏
            pendingJs = JS_SCROLL_CATS;
        } else {
            pendingJs = null;
        }
        String url = TAB_URLS[idx];
        if (url == null) return;
        if (url.equals(web.getUrl()) && pendingJs != null) {
            web.evaluateJavascript(pendingJs, null);
            pendingJs = null;
        } else {
            web.loadUrl(url);
        }
    }

    // ---------------- 启动页 ----------------
    private View buildSplash() {
        LinearLayout s = new LinearLayout(this);
        s.setOrientation(LinearLayout.VERTICAL);
        s.setBackgroundColor(C_BG);
        s.setGravity(Gravity.CENTER);

        TextView logo = new TextView(this);
        logo.setText("深夜文库");
        logo.setTextSize(30);
        logo.setTextColor(C_ON);
        logo.setTypeface(Typeface.DEFAULT_BOLD);
        logo.setGravity(Gravity.CENTER);
        s.addView(logo);

        TextView sub = new TextView(this);
        sub.setText("全免费 · 无会员 · 即点即读");
        sub.setTextSize(13);
        sub.setTextColor(0xFF9A9AA6);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, dp(14), 0, 0);
        s.addView(sub);
        return s;
    }

    // ---------------- WebView（广告能力全部保留）----------------
    private WebView buildWebView() {
        WebView v = new WebView(this);
        WebSettings s = v.getSettings();

        s.setJavaScriptEnabled(true);              // 广告脚本 + 章节渲染
        s.setDomStorageEnabled(true);              // 年龄门 / 广告门控依赖 localStorage
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // 广告联盟资源常走 http；第三方 Cookie 关系到归因和频控，不能关
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(v, true);
        }
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        String ua = s.getUserAgentString();
        s.setUserAgentString(ua + " ShenyeReaderAndroid/2.0");

        v.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest req) {
                return handleUrl(w, req.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView w, String url) {
                return handleUrl(w, url);
            }

            @Override
            public void onPageFinished(WebView w, String url) {
                super.onPageFinished(w, url);
                updateTitle(url);
                saveRecentIfReader(url);
                if (pendingJs != null) {
                    w.evaluateJavascript(pendingJs, null);
                    pendingJs = null;
                }
            }

            @Override
            public void onReceivedError(WebView w, WebResourceRequest req, WebResourceError err) {
                if (req != null && req.isForMainFrame() && (w.getUrl() == null
                        || w.getUrl().equals("about:blank"))) {
                    w.loadUrl("data:text/html;charset=utf-8,"
                            + "<meta name='viewport' content='width=device-width'>"
                            + "<body style='background:#0e0e14;color:#ddd;font:16px sans-serif;"
                            + "display:flex;align-items:center;justify-content:center;height:80vh'>"
                            + "<div style='text-align:center'>网络开小差了<br><br>"
                            + "<a href='" + HOME_URL + "' style='color:#ff9500'>点击重试</a></div></body>");
                }
            }
        });

        v.setWebChromeClient(new WebChromeClient());
        v.setOnLongClickListener(w -> true);
        return v;
    }

    /** 站内页在 App 内打开；站外（广告落地页）交给系统浏览器，避免顶掉小说页 */
    private boolean handleUrl(WebView v, String url) {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            Uri u = Uri.parse(url);
            String host = u.getHost();
            if (host != null && (host.equals(SITE_HOST) || host.endsWith("." + SITE_HOST))) {
                return false;
            }
            openExternal(url);
            return true;
        }
        openExternal(url);
        return true;
    }

    private void openExternal(String url) {
        try {
            android.content.Intent i = new android.content.Intent(
                    android.content.Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    /** 顶栏标题跟随页面：首页 / 阅读页书名 / 各功能页 */
    private void updateTitle(String url) {
        if (url == null || url.startsWith("data:")) return;
        String name = "深夜文库";
        try {
            Uri u = Uri.parse(url);
            String path = u.getPath() == null ? "" : u.getPath();
            if (path.contains("read.html")) {
                String t = u.getQueryParameter("t");
                if (!TextUtils.isEmpty(t)) {
                    name = t.length() > 14 ? t.substring(0, 14) + "…" : t;
                } else {
                    name = "正文阅读";
                }
            } else if (path.startsWith("/chapter/")) {
                name = "正文阅读";
            } else if (path.endsWith("profile.html")) {
                name = "个人中心";
            } else if (path.contains("book/")) {
                name = "书籍详情";
            } else if (!path.equals("/") && !path.isEmpty()) {
                name = "深夜文库";
            }
        } catch (Exception ignored) {
        }
        final String title = name;
        runOnUiThread(() -> titleView.setText(title));
    }

    // ---------------- 本地最近阅读 ----------------
    private void saveRecentIfReader(String url) {
        if (url == null || !url.contains("read.html")) return;
        try {
            Uri u = Uri.parse(url);
            String t = u.getQueryParameter("t");
            if (TextUtils.isEmpty(t)) return;
            android.content.SharedPreferences sp =
                    getSharedPreferences(PREF_RECENT, MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString("items", "[]"));
            if (arr.length() > 0) {
                JSONObject first = arr.getJSONObject(0);
                if (url.equals(first.optString("u"))) return; // 同书不重复记
            }
            JSONObject item = new JSONObject();
            item.put("t", t.length() > 30 ? t.substring(0, 30) + "…" : t);
            item.put("u", url);
            JSONArray next = new JSONArray();
            next.put(item);
            for (int i = 0; i < arr.length() && i < RECENT_MAX - 1; i++) {
                next.put(arr.getJSONObject(i));
            }
            sp.edit().putString("items", next.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private void showRecent() {
        final String[] titles;
        final String[] urls;
        try {
            android.content.SharedPreferences sp =
                    getSharedPreferences(PREF_RECENT, MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString("items", "[]"));
            int n = arr.length();
            titles = new String[n];
            urls = new String[n];
            for (int i = 0; i < n; i++) {
                JSONObject o = arr.getJSONObject(i);
                titles[i] = o.optString("t");
                urls[i] = o.optString("u");
            }
        } catch (Exception e) {
            showRecentEmpty();
            return;
        }
        if (titles.length == 0) {
            showRecentEmpty();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("最近阅读（本机保存）")
                .setItems(titles, (d, i) -> web.loadUrl(urls[i]))
                .setPositiveButton("在线书架", (d, i) -> {
                    pendingJs = "(function(){var e=document.getElementById('mobileShelf');"
                            + "if(e){e.scrollIntoView({block:'start'});"
                            + "var b=document.getElementById('shelfBody');"
                            + "if(b)b.classList.remove('hidden');}return !!e;})()";
                    web.loadUrl(HOME_URL);
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private void showRecentEmpty() {
        new AlertDialog.Builder(this)
                .setTitle("书架")
                .setMessage("还没有阅读记录。打开一本书后，这里会自动记住，下次点「书架」直接接着读。")
                .setPositiveButton("去首页找书", (d, i) -> switchTab(0))
                .setNegativeButton("关闭", null)
                .show();
    }

    // ---------------- 返回键 ----------------
    private void onBack() {
        if (splash != null && splash.getVisibility() == View.VISIBLE) {
            finish();
            return;
        }
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        if (currentTab != 0) {
            switchTab(0);
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackAt > 2000) {
            Toast.makeText(this, "再按一次退出深夜文库", Toast.LENGTH_SHORT).show();
            lastBackAt = now;
        } else {
            finish();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
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
        handler.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** 极简 FrameLayout，仅作为 WebView 与 Splash 的容器（避免额外 layout 文件） */
    private static class FrameLayoutHolder extends android.widget.FrameLayout {
        FrameLayoutHolder(android.content.Context c) {
            super(c);
        }
    }
}

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
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 深夜文库 App —— 原生外壳 + WebView 内容内核  v1.2
 *
 * 原生部分：启动页 / 顶栏 / 底部四 Tab / 书架网格 / 开屏广告 / 版本更新
 * 网站部分：首页、章节、广告全部走线上，改网站即改 App，不用重装。
 *
 * 配置均可在文件顶部常量区修改，勿动广告相关 WebView 设置（关系到收益）。
 */
public class MainActivity extends Activity {

    // ===== 站点配置（改这里换地址 / 换 Tab）=====
    private static final String HOME_URL = "https://shenye.72tool.com/";
    private static final String SITE_HOST = "shenye.72tool.com";
    private static final String ADS_API = "https://shenye.72tool.com/api/adslots";
    private static final String ADS_PASS = "shenye2026";
    private static final String UPDATE_URL = "https://shenye.72tool.com/app-update.json";
    private static final String APK_DOWNLOAD_URL =
            "https://github.com/706435396/xiaoshuo/actions/workflows/build-apk.yml";
    private static final int LOCAL_VERSION = 3;   // 与 build.gradle versionCode 保持一致

    // 开屏广告内置代码（SocialBar_1，与后台插屏区一致；首次安装立即可用，后台更新后下次启动生效）
    private static final String SPLASH_AD_DEFAULT =
            "<script data-cfasync='false' src='https://bauval.org/14/"
            + "07158b53e5f5830c39ffe2a59f9e3b25'></script>";

    private static final String[] TAB_NAMES = {"首页", "书架", "分类", "我的"};
    private static final String[] TAB_URLS = {
            HOME_URL,
            null,               // 书架：原生网格，不加载网页
            HOME_URL + "#catBar",
            HOME_URL + "profile.html"
    };
    private static final String JS_SCROLL_CATS =
            "(function(){var e=document.getElementById('catBar');"
            + "if(e){e.scrollIntoView({block:'center'});}return !!e;})()";

    // ===== 配色（与站点主题一致）=====
    private static final int C_BG = 0xFF0E0E14;
    private static final int C_BAR = 0xFF14141C;
    private static final int C_ON = 0xFFFF9500;
    private static final int C_OFF = 0xFF8B8B95;
    private static final int C_LINE = 0xFF26262F;

    private static final String PREF_RECENT = "sy_recent";
    private static final String PREF_FLAGS = "sy_flags";
    private static final int RECENT_MAX = 30;

    // 书架封面渐变色（按书名 hash 取，纯本地生成，不依赖网络图片）
    private static final int[][] COVER_COLORS = {
            {0xFF2B5876, 0xFF4E4376}, {0xFF0F2027, 0xFF2C5364},
            {0xFF8E2DE2, 0xFF4A00E0}, {0xFF11998E, 0xFF38EF7D},
            {0xFFF7971E, 0xFFFFD200}, {0xFFEE0979, 0xFFFF6A00},
            {0xFF136A8A, 0xFF267871}, {0xFF5F2C82, 0xFF49A09D},
            {0xFF800000, 0xFFB23232}, {0xFF1D976C, 0xFF93F9B9}
    };

    private WebView web;
    private TextView titleView;
    private TextView[] tabViews = new TextView[4];
    private View splash;
    private View splashLogo;
    private TextView splashSkip;
    private WebView splashAd;
    private int currentTab = 0;
    private String pendingJs = null;
    private long lastBackAt = 0;
    private boolean splashClosed = false;
    private final Handler handler = new Handler();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(C_BG);
        getWindow().setNavigationBarColor(C_BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(C_BG);
        setContentView(root);

        root.addView(buildTopBar());

        FrameLayoutHolder holder = new FrameLayoutHolder(this);
        holder.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(holder);

        web = buildWebView();
        holder.addView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splash = buildSplash();
        holder.addView(splash, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildBottomBar());

        if (savedInstanceState == null) {
            web.loadUrl(HOME_URL);
        } else {
            web.restoreState(savedInstanceState);
        }

        // 启动页 1.5s：优先用缓存/内置的广告代码（立即可用），网络拉取只更新下次的代码
        handler.postDelayed(() -> {
            if (splashClosed) return;
            String adHtml = getFlag("splash_ad_html");
            if (TextUtils.isEmpty(adHtml)) {
                adHtml = "<!doctype html><html><head><meta name='viewport' "
                        + "content='width=device-width,initial-scale=1'></head><body "
                        + "style='margin:0;background:#0e0e14'>" + SPLASH_AD_DEFAULT + "</body></html>";
            }
            if (shouldShowSplashAd()) {
                showSplashAd(adHtml);
            } else {
                closeSplash();
            }
        }, 1500);
        new Thread(this::prepareSplashAd).start();
        new Thread(this::checkUpdate).start();
    }

    // ---------------- 原生顶栏 ----------------
    private View buildTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(C_BAR);

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

        View line = new View(this);
        line.setBackgroundColor(C_LINE);
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
        if (idx == 1) {                       // 书架：原生网格
            showShelf();
            return;
        }
        if (idx == 2) {
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

    // ---------------- 启动页 + 开屏广告 ----------------
    private View buildSplash() {
        FrameLayoutHolder s = new FrameLayoutHolder(this);
        s.setBackgroundColor(C_BG);

        splashLogo = new LinearLayout(this);
        ((LinearLayout) splashLogo).setOrientation(LinearLayout.VERTICAL);
        ((LinearLayout) splashLogo).setGravity(Gravity.CENTER);

        TextView logo = new TextView(this);
        logo.setText("深夜文库");
        logo.setTextSize(30);
        logo.setTextColor(C_ON);
        logo.setTypeface(Typeface.DEFAULT_BOLD);
        logo.setGravity(Gravity.CENTER);
        ((LinearLayout) splashLogo).addView(logo);

        TextView sub = new TextView(this);
        sub.setText("全免费 · 无会员 · 即点即读");
        sub.setTextSize(13);
        sub.setTextColor(0xFF9A9AA6);
        sub.setGravity(Gravity.CENTER);
        ((LinearLayout) splashLogo).setPadding(0, 0, 0, 0);
        sub.setPadding(0, dp(14), 0, 0);
        ((LinearLayout) splashLogo).addView(sub);
        s.addView(splashLogo, new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));

        splashSkip = new TextView(this);
        splashSkip.setText("跳过");
        splashSkip.setTextSize(13);
        splashSkip.setTextColor(Color.WHITE);
        splashSkip.setBackgroundColor(0x99000000);
        splashSkip.setPadding(dp(14), dp(8), dp(14), dp(8));
        splashSkip.setVisibility(View.GONE);
        splashSkip.setOnClickListener(v -> closeSplash());
        android.widget.FrameLayout.LayoutParams skipLp =
                new android.widget.FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.TOP | Gravity.END);
        skipLp.setMargins(0, dp(36), dp(12), 0);
        splashSkip.setLayoutParams(skipLp);
        s.addView(splashSkip);
        return s;
    }

    /** 后台取插屏区代码，供开屏复用：用户在后台插屏区贴一次，开屏+插屏都生效 */
    private void prepareSplashAd() {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(ADS_API + "?t=" + System.currentTimeMillis()).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("X-Ad-Pass", ADS_PASS);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 ShenyeReaderAndroid/3.0");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            int code = conn.getResponseCode();
            if (code != 200) return;
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            JSONObject j = new JSONObject(sb.toString());
            JSONArray it = j.optJSONObject("zones").optJSONArray("interstitial");
            if (it == null || it.length() == 0) return;
            JSONObject slot = it.getJSONObject(0);
            if (!slot.optBoolean("enabled", false)) return;
            String value = slot.optString("value", "");
            // type=html 直接是联盟 script；type=url 则 iframe 装
            if ("url".equals(slot.optString("type")) && value.startsWith("http")) {
                value = "<iframe src='" + value + "' style='width:100%;height:100%;border:0'></iframe>";
            }
            if (TextUtils.isEmpty(value)) return;
            final String html = "<!doctype html><html><head><meta name='viewport' "
                    + "content='width=device-width,initial-scale=1'>"
                    + "<style>html,body{margin:0;background:#0e0e14;color:#fff;overflow:hidden}"
                    + "iframe{background:#0e0e14}</style></head><body>" + value + "</body></html>";
            setFlag("splash_ad_html", html);
        } catch (Exception ignored) {
        }
    }

    private boolean shouldShowSplashAd() {
        String today = new SimpleDateFormat("yyyyMMdd", Locale.CHINA).format(new Date());
        if (today.equals(getFlag("splash_ad_date"))) return false; // 每天一次
        setFlag("splash_ad_date", today);
        return true;
    }

    private void showSplashAd(String html) {
        if (splashClosed) return;
        runOnUiThread(() -> {
            if (splashLogo != null) splashLogo.setVisibility(View.GONE);
            splashAd = new WebView(MainActivity.this);
            WebSettings s = splashAd.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            s.setUserAgentString(s.getUserAgentString() + " ShenyeReaderAndroid/3.0");
            splashAd.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, String url) {
                    openExternal(url);       // 广告落地页不顶掉小说
                    return true;
                }

                @Override
                public void onReceivedError(WebView v, WebResourceRequest req,
                                            WebResourceError err) {
                    // 联盟主资源加载失败：直接跳过开屏，不让人干等
                    if (req != null && req.isForMainFrame()) closeSplash();
                }
            });
            ((FrameLayoutHolder) splash).addView(splashAd, new android.widget.FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            splashAd.loadDataWithBaseURL(HOME_URL, html, "text/html", "utf-8", null);

            splashSkip.setVisibility(View.VISIBLE);
            final int[] left = {6};
            splashSkip.setText("跳过 6");
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (splashClosed) return;
                    left[0]--;
                    if (left[0] <= 0) {
                        closeSplash();
                    } else {
                        splashSkip.setText("跳过 " + left[0]);
                        handler.postDelayed(this, 1000);
                    }
                }
            }, 1000);
        });
    }

    private void closeSplash() {
        if (splashClosed) return;
        splashClosed = true;
        handler.post(() -> {
            if (splash != null) splash.setVisibility(View.GONE);
            if (splashSkip != null) splashSkip.setVisibility(View.GONE);
            if (splashAd != null) {
                try {
                    splashAd.stopLoading();
                    splashAd.destroy();
                } catch (Exception ignored) {
                }
                splashAd = null;
            }
        });
    }

    // ---------------- 版本更新（轻量 JSON，不打扰）----------------
    private void checkUpdate() {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(
                    UPDATE_URL + "?t=" + System.currentTimeMillis()).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            if (conn.getResponseCode() != 200) return;
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            JSONObject j = new JSONObject(sb.toString());
            int remote = j.optInt("versionCode", 0);
            final String ver = j.optString("versionName", "新版本");
            final String note = j.optString("note", "体验优化与问题修复");
            final String url = j.optString("apkUrl", APK_DOWNLOAD_URL);
            if (remote <= LOCAL_VERSION) return;
            // 同一版本只提示一次（用户点「稍后」后记住版本号）
            if (("v" + remote).equals(getFlag("update_dismissed"))) return;
            runOnUiThread(() -> new AlertDialog.Builder(this)
                    .setTitle("发现新版本 " + ver)
                    .setMessage(note)
                    .setPositiveButton("去更新", (d, i) -> openExternal(url))
                    .setNegativeButton("稍后", (d, i) -> setFlag("update_dismissed", "v" + remote))
                    .show());
        } catch (Exception ignored) {
        }
    }

    // ---------------- WebView（广告能力全部保留）----------------
    private WebView buildWebView() {
        WebView v = new WebView(this);
        WebSettings s = v.getSettings();

        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(v, true);
        }
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        String ua = s.getUserAgentString();
        s.setUserAgentString(ua + " ShenyeReaderAndroid/3.0");

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
            }
        } catch (Exception ignored) {
        }
        final String title = name;
        runOnUiThread(() -> titleView.setText(title));
    }

    // ---------------- 本地书架（网格封面）----------------
    private JSONArray loadShelf() {
        try {
            return new JSONArray(getSharedPreferences(PREF_RECENT, MODE_PRIVATE)
                    .getString("items", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private void saveShelf(JSONArray arr) {
        getSharedPreferences(PREF_RECENT, MODE_PRIVATE)
                .edit().putString("items", arr.toString()).apply();
    }

    private void saveRecentIfReader(String url) {
        if (url == null || !url.contains("read.html")) return;
        try {
            Uri u = Uri.parse(url);
            String t = u.getQueryParameter("t");
            if (TextUtils.isEmpty(t)) return;
            JSONArray arr = loadShelf();
            if (arr.length() > 0 && url.equals(arr.getJSONObject(0).optString("u"))) return;
            JSONObject item = new JSONObject();
            item.put("t", t.length() > 30 ? t.substring(0, 30) + "…" : t);
            item.put("u", url);
            JSONArray next = new JSONArray();
            next.put(item);
            for (int i = 0; i < arr.length() && i < RECENT_MAX - 1; i++) {
                next.put(arr.getJSONObject(i));
            }
            saveShelf(next);
        } catch (Exception ignored) {
        }
    }

    private void showShelf() {
        final JSONArray arr = loadShelf();
        if (arr.length() == 0) {
            showRecentEmpty();
            return;
        }
        GridView grid = new GridView(this);
        grid.setNumColumns(3);
        grid.setColumnWidth(dp(96));
        grid.setVerticalSpacing(dp(12));
        grid.setHorizontalSpacing(dp(8));
        grid.setPadding(dp(10), dp(8), dp(10), dp(8));
        grid.setAdapter(new ShelfAdapter(arr));
        final AlertDialog[] holder = new AlertDialog[1];
        grid.setOnItemClickListener((p, v, pos, id) -> {
            try {
                web.loadUrl(arr.getJSONObject(pos).getString("u"));
            } catch (Exception ignored) {
            }
            holder[0].dismiss();
        });
        grid.setOnItemLongClickListener((p, v, pos, id) -> {
            String title = "";
            try {
                title = arr.getJSONObject(pos).optString("t");
            } catch (Exception ignored) {
            }
            final String t = title;
            new AlertDialog.Builder(this)
                    .setTitle("从书架移除？")
                    .setMessage(t)
                    .setPositiveButton("移除", (d, i) -> {
                        try {
                            JSONArray next = new JSONArray();
                            for (int k = 0; k < arr.length(); k++) {
                                if (k != pos) next.put(arr.getJSONObject(k));
                            }
                            saveShelf(next);
                            holder[0].dismiss();
                            showShelf();
                        } catch (Exception ignored) {
                        }
                    })
                    .setNegativeButton("取消", null)
                    .show();
            return true;
        });
        holder[0] = new AlertDialog.Builder(this)
                .setTitle("我的书架（本机 " + arr.length() + " 本）")
                .setView(grid)
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
                .setMessage("还没有阅读记录。打开一本书后，这里会自动记住，下次点「书架」直接接着读。长按封面可移除。")
                .setPositiveButton("去首页找书", (d, i) -> switchTab(0))
                .setNegativeButton("关闭", null)
                .show();
    }

    /** 书架网格适配器：原生绘制渐变封面（书名首字），不加载网络图片 */
    private class ShelfAdapter extends BaseAdapter {
        private final JSONArray data;

        ShelfAdapter(JSONArray d) {
            data = d;
        }

        @Override
        public int getCount() {
            return data.length();
        }

        @Override
        public Object getItem(int i) {
            try {
                return data.getJSONObject(i);
            } catch (Exception e) {
                return null;
            }
        }

        @Override
        public long getItemId(int i) {
            return i;
        }

        @Override
        public View getView(int i, View reuse, ViewGroup parent) {
            LinearLayout cell = (reuse instanceof LinearLayout)
                    ? (LinearLayout) reuse : new LinearLayout(MainActivity.this);
            cell.removeAllViews();
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setGravity(Gravity.CENTER_HORIZONTAL);
            cell.setPadding(dp(4), dp(4), dp(4), dp(4));

            JSONObject o = (JSONObject) getItem(i);
            String title = o == null ? "" : o.optString("t");

            TextView cover = new TextView(MainActivity.this);
            cover.setText(TextUtils.isEmpty(title) ? "书" : title.substring(0, 1));
            cover.setTextSize(24);
            cover.setTextColor(Color.WHITE);
            cover.setTypeface(Typeface.DEFAULT_BOLD);
            cover.setGravity(Gravity.CENTER);
            cover.setWidth(dp(86));
            cover.setHeight(dp(112));
            int[] pair = COVER_COLORS[Math.abs(title.hashCode()) % COVER_COLORS.length];
            android.graphics.drawable.GradientDrawable gd =
                    new android.graphics.drawable.GradientDrawable(
                            android.graphics.drawable.GradientDrawable.Orientation.TL_BR, pair);
            gd.setCornerRadius(dp(8));
            cover.setBackground(gd);
            cell.addView(cover);

            TextView name = new TextView(MainActivity.this);
            name.setText(title);
            name.setTextSize(11);
            name.setTextColor(0xFFC8C8D0);
            name.setGravity(Gravity.CENTER);
            name.setMaxLines(2);
            name.setEllipsize(TextUtils.TruncateAt.END);
            name.setWidth(dp(86));
            name.setPadding(0, dp(5), 0, 0);
            cell.addView(name);
            return cell;
        }
    }

    // ---------------- 标记（轻量 KV）----------------
    private String getFlag(String key) {
        return getSharedPreferences(PREF_FLAGS, MODE_PRIVATE).getString(key, "");
    }

    private void setFlag(String key, String value) {
        getSharedPreferences(PREF_FLAGS, MODE_PRIVATE).edit().putString(key, value).apply();
    }

    // ---------------- 返回键 / 生命周期 ----------------
    private void onBack() {
        if (!splashClosed) {
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
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (splashAd != null) {
            try {
                splashAd.destroy();
            } catch (Exception ignored) {
            }
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** 极简 FrameLayout：WebView / Splash / 开屏广告共用容器 */
    private static class FrameLayoutHolder extends android.widget.FrameLayout {
        FrameLayoutHolder(android.content.Context c) {
            super(c);
        }
    }
}

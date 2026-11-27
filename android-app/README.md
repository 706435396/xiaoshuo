# 深夜文库 Android App —— 完整打包教程

把 `shenye.72tool.com` 套壳成安卓 App，装到自己手机。
**在线套壳**：App 只加载网站，改网站 = 改 App，不需要重新打包。

---

## 一、原理（30 秒看懂）

```
手机 App（WebView）  ──联网──>  https://shenye.72tool.com
        ↑                              ↑
   全屏 / 返回键 / 状态栏        首页/书架/章节/广告 全部走线上
   Cookie（保广告收益）
```

App 本身只有 13KB，不含任何书或图片，全靠线上加载——所以：
- ✅ 网站更新后，App 立刻看到最新内容，无需重装
- ✅ 体积极小、不占存储
- ⚠️ 国内网络打不开这个域名时，App 里也打不开（网络问题得单独解决）
- ⚠️ 必须有网络才能看（想离线看要另做"离线打包"方案）

---

## 二、拿 APK（推荐：云端构建，本机零环境）

### 步骤 1：触发构建
打开：https://github.com/706435396/xiaoshuo/actions/workflows/build-apk.yml

点右上角 **`Run workflow`** → 选 `main` → **`Run workflow`**（绿色按钮）

等约 1 分钟，状态变绿 ✅（构建成功的那次：`https://github.com/706435396/xiaoshuo/actions/runs/45928745400`）

### 步骤 2：下载 APK
在该次运行页面往下拉，找到 **Artifacts** 区域的 `shenye-reader-apk`，点击下载，得到 zip，解压出 `shenye-reader-v1.0.apk`。

### 步骤 3：装到手机
把 APK 传到手机（微信文件传输助手 / 数据线 / 网盘都行），在手机上点开安装。

- 首次安装会提示"未知来源应用"→ 选**允许**（设置 → 安全 → 安装未知应用 → 给文件管理器/浏览器授权）
- 安装后桌面出现"深夜文库"图标，点开即用

> 以后网站改了不用重新打包；只有改 App 本身（图标、名称、WebView 设置）才重新构建。

---

## 三、本机自己构建（可选，想改代码时用）

需要装 **Android Studio**（自带 JDK + SDK + Gradle），约 3-5GB：

1. 下载安装 Android Studio：https://developer.android.com/studio
2. 首次启动时它会引导安装 SDK（默认组件即可，需 platform 35）
3. 用 Android Studio 打开 `ebook-static-site/android-app` 目录
4. 生成签名密钥（只需一次）：在项目根目录打开终端：

```bash
cd android-app/app
keytool -genkeypair -v -keystore debug.keystore \
  -storepass android -keypass android \
  -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Android Debug,O=Android,C=US"
```

5. 打正式包：Android Studio 菜单 **Build → Generate Signed Bundle / APK → APK**，
   选 `app/debug.keystore`（密码都是 `android`），或命令行：

```bash
cd android-app
./gradlew assembleRelease     # Windows 用 gradlew.bat assembleRelease
```

产物在 `android-app/app/build/outputs/apk/release/app-release.apk`。

---

## 四、关键代码说明（想改就改这几处）

### 1. 改网址 / App 名
- 网址：`app/src/main/java/com/shenye/reader/MainActivity.java` 顶部 `HOME_URL`
- 名称：`app/src/main/res/values/strings.xml` 的 `app_name`
- 改完重新构建（见二、三）

### 2. 广告能正常显示的关键设置（已在代码里配好）
```java
s.setJavaScriptEnabled(true);          // 广告脚本 + 章节渲染必须
s.setDomStorageEnabled(true);          // localStorage（年龄门/广告门控依赖）
s.setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW);  // 广告联盟有的资源走 http
CookieManager.getInstance().setAcceptThirdPartyCookies(web, true); // 广告归因/频控
```
关掉这几项，广告会异常或不计收益——不要动。

### 3. 站外链接处理
广告落地页、外部链接会用**系统浏览器**打开，不会把小说页顶掉（`handleUrl` 方法里控制）。

### 4. 返回键
WebView 有历史就回退上一页，没有才退出 App（`onKeyDown` 方法）。

### 5. 版本升级
改 `app/build.gradle` 里的 `versionCode`（+1）和 `versionName`（如 `1.1`），
重新构建后覆盖安装即可（同一签名库才能覆盖，别删 debug.keystore）。

---

## 五、广告在 App 里的注意点（重要）

1. **Popunder 弹窗广告在 App 里基本不会弹**——这是 WebView 的限制，不是故障。
   反而是好事：避免误点跳出。横幅/信息流广告正常显示。
2. **Adsterra / JuicyAds 需要第三方 Cookie**，代码里已开启；如果关闭，收益会异常。
3. 部分联盟脚本会检测 WebView UA 并降低填充率；代码里 UA 追加了 `ShenyeReaderAndroid/1.0` 标识，
   如发现广告明显变少，可尝试去掉这段 UA 再构建对比。
4. 自己手机装属于个人使用，广告联盟一般不会封；**上架商店**则要单独过隐私政策/合规审核。

---

## 六、常见问题

**Q: 安装提示"应用未安装"？**
A: 之前装过同名但不同签名的包 → 先卸载旧的再装。

**Q: 打开白屏 / 一直转圈？**
A: 手机浏览器先访问 `https://shenye.72tool.com` 确认网络通；App 走的是同一个域名。
   国内网络不稳的话，App 也一样卡——这是网络问题，不是 App 问题。

**Q: 想上架应用商店？**
A: 需要：正式签名密钥（换个非 debug 的 keystore 并妥善保存）、隐私政策页、软件著作权、各商店审核。
   代码本身已具备上架条件，主要是流程材料。

**Q: 想改成离线版（无网也能看）？**
A: 那是另一套方案——需要把书页预渲染后打进 APK，工作量大。需要的话另行讨论。

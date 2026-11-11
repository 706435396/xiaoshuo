# 极简电子书静态网站（epub.js 在线阅读器）

一个**纯静态、无后端、无 Node 构建**的电子书索引网站，可直接部署在 **GitHub + Cloudflare Pages**。
内置 [epub.js](https://github.com/futurepress/epub.js/) 在线阅读器，支持 epub 在线渲染与 pdf 浏览器内置预览。
采用 MIT 协议，**仅做书籍索引，不内置任何电子书实体文件**，合规优先。

## 特性

- 原生 HTML + Tailwind CSS v3（CDN）+ 原生 JavaScript，无 Vue/React 等重型框架
- PC + 移动端自适应，支持暗黑 / 浅色一键切换（主题保存到 `localStorage`）
- 首页：实时搜索（书名 / 作者 / 分类）、分类标签筛选、卡片布局、前端分页（每页 12 本）、空状态提示
- 阅读页：epub.js 渲染，含上一页 / 下一页、字体缩放、背景切换、目录跳转、返回首页；pdf 自动调用浏览器预览
- 书库数据与代码分离：`books.json` 手动增删，电子书文件走外部直链（R2 直链优先）

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `index.html` | 首页：书籍列表、搜索、分类、分页 |
| `read.html` | 阅读页：epub.js 阅读器（pdf 走浏览器预览） |
| `books.json` | 书库数据，手动维护 |
| `_headers` | Cloudflare Pages 缓存策略（Brotli 由 CF 自动压缩） |
| `404.html` | 404 页面 |
| `sitemap.xml` | 站点地图（替换域名后用于 SEO） |
| `README.md` | 本部署文档 |
| `_redirects` | Cloudflare Pages 简单跳转规则 |

## 迭代新增功能（v2）

- **阅读进度记忆**：epub 阅读位置（CFI）自动存入 `localStorage`（key 为 `ebook_progress_<id>`），首页对应书籍显示「续读」徽标，再次打开自动跳到上次页码；阅读器顶部显示「已读 X%」。
- **favicon**：内联 SVG 图标（data URI），无需额外二进制文件，规避中文/空格文件名问题。
- **图片懒加载 + 封面占位**：封面 `loading="lazy"` + `decoding="async"`，加载失败自动显示「无封面」占位图。
- **排序**：首页提供「最新」（id 倒序）/「热门」（`hot` 字段：`true` 排最前，数值越大越靠前，`false` 或省略则回退 id 倒序）切换按钮。
- **`_redirects`**：Cloudflare Pages 简单 301 跳转（如 `/home` → `/`），按需增删。
- **轻量访问统计**：纯前端 `localStorage` 计数，页脚显示「本机访问 N 次」，**不接入任何第三方**。如需站级真实统计，建议在 Cloudflare Pages 控制台开启「Web Analytics」（Cloudflare 自有，非第三方）。

## 迭代新增功能（v3，纯前端 / 无后端）

- **本地收藏**：点击卡片右上角 ♥ 收藏，数据存 `localStorage`（key `ebook_favs`）；首页排序栏新增「收藏」按钮，仅显示已收藏书籍。
- **本地评分**：每张卡片底部 5 颗星点击打分（再次点击同一颗星可取消），数据存 `localStorage`（key `ebook_rating_<id>`）；阅读页顶部也有同样的收藏 / 评分控件。
- **阅读器多配色**：背景切换按钮在 默认 / 羊皮纸 / 护眼绿 / 夜间 四种主题间循环，按钮文字实时显示当前主题名。
- **阅读进度备份 / 恢复**：阅读页顶部「⤓」导出全部收藏、评分、阅读进度为 JSON 文件；「⤒」导入该 JSON 恢复，方便换设备 / 清缓存前备份。
- **首页随机推荐**：首页顶部「随机推荐」区块展示 4 本随机书，点击「换一批」刷新；搜索 / 分类 / 收藏筛选时自动隐藏。

> 以上功能全部基于 `localStorage`，不依赖任何后端与第三方服务，符合纯静态、零构建定位。

> 说明：本项目本身**无需构建**，Cloudflare Pages 自带的 GitHub 监听即可自动部署。仓库内附 `.github/workflows/deploy.yml` 仅为**备用附加校验**（推送时校验 `books.json` 语法），默认不影响部署；待手动 commit 跑稳后再考虑是否开启校验流水线。

## 本地预览

由于浏览器对 `file://` 下的 `fetch('books.json')` 有跨域限制，**不能直接双击打开 `index.html`**，
需要启动一个本地静态服务器：

```bash
# 进入项目目录
cd ebook-static-site

# 方式一：Python（推荐，无需安装额外依赖）
python -m http.server 8080

# 方式二：Node
npx serve .
```

然后浏览器访问 `http://localhost:8080/` 即可预览。

## GitHub 上传步骤

1. 在 GitHub 新建一个仓库（如 `ebook-site`），**无需**添加 `.gitignore`、构建配置。
2. 将本目录下的全部文件（`index.html`、`read.html`、`books.json`、`_headers`、`404.html`、`sitemap.xml`、`README.md`）上传到仓库根目录。
3. 提交并推送到 GitHub。

> 提示：可用 GitHub 网页端直接拖拽上传，或用 Git 命令行。保持这些文件在仓库根目录，无需子目录。

## Cloudflare Pages 部署参数（重点）

在 Cloudflare Pages 控制台 **Create a project → 连接 GitHub 仓库** 后，构建设置如下：

| 配置项 | 值 |
| --- | --- |
| Build command（构建命令） | **留空**（不填） |
| Framework preset（框架） | **None** |
| Build output directory（输出目录） | `/`（根目录） |

> 因为是纯静态、无构建，Cloudflare 会直接把仓库源码作为站点文件发布。
> 保存后点击 **Save and Deploy** 即可。后续每次 push 到 GitHub 都会自动重新部署。

部署完成后，记得把 `sitemap.xml` 里的 `https://your-domain.pages.dev` 替换成你的真实域名，并提交。

## 如何新增 / 修改书籍

只编辑 `books.json`，保持数组结构，每条记录字段如下（**严格遵守**）：

```json
{
  "id": 1,
  "title": "书名",
  "author": "作者",
  "category": "文学",
  "cover": "封面图片直链",
  "intro": "简短简介",
  "type": "epub",
  "url": "epub 文件直链（R2 直链优先）"
}
```

字段说明：

- `id`：唯一数字，首页跳转与阅读页读取都依赖它，**不要重复**
- `title` / `author` / `category` / `intro`：展示用文本
- `cover`：封面图直链；加载失败会自动显示「无封面」占位
- `type`：**仅支持 `epub` 或 `pdf`** 两种
- `url`：电子书文件公共直链

新增一本书 = 在数组中追加一个对象；删除 = 移除对应对象。改完保存即生效（Cloudflare 会按 `no-cache` 实时拉取 `books.json`）。

## 推荐存储方案：Cloudflare R2

电子书文件（epub / pdf）与封面图建议存放在 **Cloudflare R2**，获取公共直链填入 `books.json`：

1. 在 Cloudflare 控制台创建 R2 存储桶（如 `ebooks`）。
2. 上传 epub / pdf / 封面图，设置为**公共访问**（Public），复制其 `https://<bucket>.<account>.r2.cloudflarestorage.com/...` 直链，或绑定自定义域。
3. 将直链填入 `books.json` 的 `url` / `cover`。

> ⚠️ **epub 必须开启 CORS**：epub.js 通过 XHR/fetch 读取 epub 文件，存储桶需允许跨域。
> 在 R2 桶的 CORS 设置中添加允许你的站点域名（`Access-Control-Allow-Origin: https://你的域名`）。
> pdf 走浏览器原生预览，对 CORS 要求较宽松，但仍建议开启。

## 合规提醒

- 本站**仅作索引**，仓库内不存放任何 epub / pdf 实体文件。
- 请**只上传你拥有版权或已获授权的作品**，严禁收录盗版内容。
- 若收到版权投诉，请第一时间下架对应条目并移除其存储链接。

## 部署前复查清单

手动 commit 上线前，逐项核对：

- [ ] `books.json` 里所有 `url` / `cover` 均为 **https** 直链，且不是网盘跳转页 / 中转页（应是文件本体可直接访问或下载）。
- [ ] 仓库内**文件名无中文、无空格**（当前 10 个文件均为 ASCII，已合规）。
- [ ] 每条 `type` 与文件后缀一致：`epub` 对应 `.epub`，`pdf` 对应 `.pdf`。
- [ ] `sitemap.xml` 里的 `https://your-domain.pages.dev` 已替换成你自己的真实域名。
- [ ] 本地先用 `python -m http.server 8080` 跑一遍，确认首页列表、搜索、分类、排序正常，且阅读器能加载 epub / 预览 pdf。
- [ ] （epub）R2 直链已开启 CORS（`Access-Control-Allow-Origin` 包含你的域名）。

## 开源协议

[MIT](https://opensource.org/licenses/MIT) —— 可自由使用、修改、分发，请保留版权声明。

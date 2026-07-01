# gblog

[English](README.md) · **简体中文**

[特性](#特性) · [截图](#截图) · [快速开始](#快速开始) · [写作](#写作) · [配置](#配置) · [主题指南](docs/THEME_GUIDE.zh-CN.md) · [演示站点](https://night2049.github.io/gblog-demo/)

## 概览

完全基于GitHub生态的个人博客构建器

**无需维护服务器和数据库，也不依赖第三方服务，即可轻松享受在线编辑与管理您的博客。**

Issues 在线编写和管理文章

Actions 免费构建

Pages 免费托管

giscus 免费评论

纯静态、最佳访问性能、移动端自适应、无需图床、代码高亮、数学公式、目录、阅读时长、图片转码、RSS、SEO、社交卡片、自定义主题。

> 构建和开发环境：**Bun ≥ 1.3.14**

## 截图

截取自[在线演示站点](https://night2049.github.io/gblog-demo/)（默认主题）。

|                     浅色                      |                    深色                     |
| :-------------------------------------------: | :-----------------------------------------: |
| ![首页 浅色](assets/screenshots/home-light.webp) | ![首页 深色](assets/screenshots/home-dark.webp) |
| ![文章 浅色](assets/screenshots/post-light.webp) | ![文章 深色](assets/screenshots/post-dark.webp) |

## 特性

- **双仓概念**：使用私有仓库保护你的隐私，公开仓库部署您的想公开的内容。
- **双数据源**：既可以选择GitHub Issues写文章，也可将本地 Markdown 文件导入。
- **在线管理**：使用GitHub即可在线发布文章或撤回文章，不用担心草稿丢失。
- **主题可切换**：内置多套皮肤，改一行配置即可切换，支持自定义。
- **内容增强**：代码高亮、KaTeX 公式、目录 TOC、阅读时长、图片懒加载与 WebP 转码、图片灯箱、分享。
- **分发与评论**：RSS / Atom / JSON Feed，giscus 评论。
- **SEO 与社交**：OG / Twitter 卡片、canonical、JSON-LD 结构化数据。

## AI帮你部署

复制以下内容交给你的openclaw或hermes，让AI帮你完成部署：
```
https://raw.githubusercontent.com/night2049/g-blog/refs/heads/main/gblog-deploy-verify/SKILL.md

阅读此技能，并帮我完成部署工作。
```

## 快速开始

本项目是 GitHub **模板仓库**，用它创建你自己的私有内容仓，再改几个配置即可上线，不需要本地构建。内容仓（私有）负责写作与构建，站点仓（公开）承载 GitHub Pages 产物。

1. **用本模板创建私有内容仓**：点仓库页的 **Use this template → Create a new repository**，Visibility 选 **Private**。文章、配置、构建流程都在这里。（命令行等价：`gh repo create <你的内容仓> --template night2049/g-blog --private --clone`。）

2. **建公开站点仓**：另建一个公开的空仓库（如 `you/blog`；GitHub Pages 免费版只支持公开仓）存放生成的站点，在它的 Settings → Pages 把来源设为 `Deploy from a branch`（分支 `main`、根目录）。

3. **打通推送**：让内容仓能把产物推到站点仓。
   - 本地生成密钥：`ssh-keygen -t ed25519 -f deploy_key -N ""`
   - 公钥 `deploy_key.pub` 加到站点仓 Settings → Deploy keys，勾选 *Allow write access*
   - 私钥 `deploy_key` 加到内容仓 Settings → Secrets and variables → Actions，命名为 `BLOG_DEPLOY_KEY`
   - 编辑内容仓 `.github/workflows/build.yml`，把 `repository: your-name/your-site-repo` 改成你的站点仓

4. **改配置**（`config/` 下，至少改这些）：
   - `site.json`：`title`、`url`（填站点最终地址，如 `https://you.github.io/blog`）、`author`
   - `appearance.json`：`logo`、`links`、`footer`（示例里的 ICP / 公安备案换成你自己的或留空）

5. **写第一篇**：在内容仓新建一个 Issue，标题即文章标题，正文写 Markdown，打上 `published` 标签。Actions 自动构建并推送到站点仓，稍候 GitHub Pages 即上线。

> 内容仓私有时，issue 里贴的图片在构建时下载需要一个 **classic PAT（勾选 `repo`）**——fine-grained token 与默认的 `GITHUB_TOKEN` 都拉不到私有附件图。在 Settings → Developer settings → Personal access tokens (classic) 生成后，加到内容仓 Settings → Secrets and variables → Actions，命名为 `CONTENT_PAT`（纯文字文章可先不配）。所有密钥只放在 Actions Secrets，切勿提交进仓库。

## 写作

在私有仓库创建一个新的 GitHub Issue：标题即文章标题，正文写 Markdown。给 issue 打上 `published` 标签即发布，关闭 issue 或移除`published`标签即撤回文章。

issue 上的其他标签会变成文章标签，其中 `dir:` 开头的标签（如 `dir:随笔`）会生成目录。正文里贴的图片会在构建时下载到站点（私有仓需配 `CONTENT_PAT`）。

> 也支持本地 Markdown：把 `.md` 放进 `content/` 目录即可，适合习惯本地写作的场景，写法见[本地 Markdown 指南](docs/LOCAL_MARKDOWN_GUIDE.zh-CN.md)。

## 配置

配置位于 `config/`，由 `loadConfig` 合并校验。`site.json` 与 `build.json` 必需。

<details>
<summary>配置字段说明</summary>

#### site.json（必需）

| 字段 | 必填 | 含义 | 默认 / 后果 |
| --- | --- | --- | --- |
| `title` | 是 | 站点标题 | 缺失即报错 |
| `description` | 否 | 站点描述（SEO 回退） | 空串 |
| `author` | 否 | 作者名 | 空串 |
| `url` | 启用 RSS 时必填 | 站点绝对地址（绝对链接 / canonical / feed 用） | 空则 feed 启用时报错；OG / canonical / JSON-LD 降级省略 |
| `language` | 否 | `<html lang>` | `zh-CN` |

#### build.json（必需，含 build 与 pagination）

`build` 段：

| 字段 | 必填 | 含义 | 默认 |
| --- | --- | --- | --- |
| `publishedLabel` | 是 | 发布标签名（issue 含此标签且 open 才上线；本地 md 非草稿自动加） | 无 |
| `metaMarker` | 是 | 正文 meta 注释块标记 | 无 |
| `pageLabel` | 是 | 独立页标签名 | 无 |
| `dirPrefix` | 是 | 目录标签前缀（如 `dir:随笔`） | 无 |
| `postDir` | 否 | 文章页输出目录 | `post` |
| `contentDir` | 否 | 本地 md 内容根目录 | `content` |
| `excludedLabels` | 否 | 额外排除的标签 | `[]` |

`pagination` 段：`home` / `archive` / `directory` / `tag` 各为每页条数，必须为正整数。

#### appearance.json（可选，缺省默认主题）

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `theme.name` | 主题文件夹名（`themes/<name>`） | `default` |
| `theme.skin` | 皮肤令牌文件名（不含 `.css`）；空串取主题 `defaultSkin` | 空串 |
| `logo.type` | `text` 或 `image` | `text` |
| `logo.value` | 文本内容或图片 URL | 站点标题 |
| `links[]` | 导航尾部外链（`label` + `href`，`href` 须 http(s)） | `[]` |
| `footer.copyright` / `icp` / `police` / `policeCode` | 页脚版权、ICP / 公安备案文案与号码 | 空 |

换主题只改 `theme.name` / `theme.skin`，深度定制见[主题指南](docs/THEME_GUIDE.zh-CN.md)。

#### content.json（功能增强开关，可选）

各项可独立开关，数值有区间校验。

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `toc` | 目录：`minHeadings` 少于此不渲染；`pcCollapseBelow` 条目少于此 PC 折叠 | 开 / 2 / 5 |
| `readingTime` | 阅读时长：`cpm` 中文字/分，`wpm` 英文词/分 | 开 / 400 / 250 |
| `summary` | 卡片 / SEO 摘要长度 | 开 / 120 |
| `cover` | 列表卡片首图缩略 | 开 |
| `math` | KaTeX 数学公式 | 开 |
| `codeCopy` | 代码复制按钮 | 开 |
| `imageZoom` | 图片灯箱 | 开 |
| `share` | 分享；`networks` 属白名单（copy/x/telegram/weibo/facebook/linkedin/reddit/whatsapp/email） | 开 / copy,x,telegram,weibo |
| `widgets` | 回顶部 / 回首页 / 阅读进度 | 开 |
| `og` | OG / 社交卡片 meta | 开 |
| `canonical` | canonical 规范链接 | 开 |
| `jsonLd` | JSON-LD 结构化数据 | 开 |
| `webp` | 图片转 WebP；`quality` 1-100 | 开 / 80 |
| `errorPages.codes` | 生成的错误页 HTTP 码（100-599） | [404,403,500] |

#### feed.json（可选，缺省关闭）

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `enabled` | 是否生成 feed | 布尔 |
| `formats` | 输出格式 | `enabled` 时须为 `rss`/`atom`/`json` 的非空子集 |
| `count` | 收录最新 N 篇 | 正整数 |
| `summaryLength` | >0 用摘要，=0 用全文 | ≥0 整数 |

启用 feed 时 `site.url` 必填。

#### comments.json（可选，缺省关闭）

| 字段 | 含义 |
| --- | --- |
| `enabled` | 是否启用 giscus 评论 |
| `repo` | 评论仓 `owner/repo` |
| `repoId` | giscus 仓库 ID（giscus.app 生成，公开值） |
| `category` | 讨论分类名 |
| `categoryId` | 分类 ID（公开值） |
| `mapping` | 映射方式（默认 `pathname`） |

`repoId` 与 `categoryId` 在 [giscus.app](https://giscus.app) 生成，是公开值，非密钥。

</details>

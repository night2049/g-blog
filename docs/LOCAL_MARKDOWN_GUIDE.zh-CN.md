# 本地 Markdown 写作指南

[English](LOCAL_MARKDOWN_GUIDE.md) · **简体中文**

除 GitHub Issues 外，gblog 支持把本地 Markdown 文件构建为站点内容。两种数据源长期并存、合并到同一站点。

## 目录约定

```
content/                       # 由 config/build.json 的 build.contentDir 配置 (默认 content)
├─ posts/                      # 文章 (进入时间线/归档/标签/目录)
│  ├─ hello-world.md
│  └─ 2025/some-post.md        # 可任意子层级
└─ pages/                      # 独立页 (不进时间线; 由 slug/文件名决定 URL)
   └─ about.md
```

子目录名 `posts` / `pages` 硬编码（本轮不可配）。

## Front Matter

文件开头用 `---` 围栏写 YAML（[YAML 1.2 core schema](https://yaml.org)，由 `Bun.YAML` 解析）：

```yaml
---
title: 你好世界          # 缺省取文件名 (去扩展名)
date: 2025-06-01        # 缺省取文件 mtime; 形如 YYYY-MM-DD 按 UTC 当日零点
draft: false            # true = 不发布 (不加发布标签)
tags: [bun, 教程]        # → 内容标签
categories: [随笔]       # → 目录 (等价 issue 的 dir: 标签)
slug: about             # 仅 pages 用作 URL (<slug>.html); posts 忽略 (用 md5)
---
正文 Markdown……
```

字段说明：

| 字段 | 适用 | 说明 |
| --- | --- | --- |
| `title` | 全部 | 缺省取文件名（去 `.md`） |
| `date` | 全部 | 字符串；`YYYY-MM-DD` 按 UTC 当日零点；缺省取文件修改时间 |
| `draft` | 全部 | `true` 则不发布 |
| `tags` | 全部 | 字符串数组（或单字符串），映射为内容标签 |
| `categories` | 全部 | 字符串数组，映射为目录（`dirPrefix:` 标签） |
| `slug` | 仅 pages | 决定独立页 URL（`<slug>.html`）；缺省取文件名。须过保留名/非法校验，否则该页跳过 |

> 空 Front Matter（仅 `---\n---`）或无围栏（裸 Markdown）都合法；后者全文为正文。

## 文章身份与 URL（重要）

- 文章 `node_id = md5(规范化相对路径)`（如 `posts/2025/some-post.md`），URL 为 `<postDir>/<md5>.html`（默认 `post/<md5>.html`）。
- **路径是稳定身份**：改正文不变 URL。
- **重命名/移动文件 = 删除旧 + 新增**：URL 随之改变（旧 URL 失效，新 URL 生成）。如需保持链接稳定，不要移动文件。

## 本地图片

正文用**相对路径**引用图片（相对当前 md 文件所在目录）：

```markdown
![示意图](images/diagram.png)     # 相对当前 md 目录
```

构建时：相对图片被读取、（按 `content.webp` 配置）转码为 WebP、落盘到 `post/<md5>/`，正文引用改写为站点相对路径并补 `width`/`height`（消 CLS）。绝对 URL（`http(s)://`、`//`、`/`、`data:`）不走本地通道。

> 注意：本地增量只在 `.md` 改动时触发该文重建。若**只改图片文件而不动 md**，不会触发重建——可一并 touch md，或跑全量。

## 构建触发（自动选策略）

- push 改 `content/**.md`（且未同时改 `src/`/`scripts/`/`themes/`/`config/`）→ **本地增量**：只重建受影响篇目。
- 与主题/配置同改，或改了 `src/`/`scripts/` → 全量重建。
- issue 事件（webhook）→ issue 增量（与本地 md 互不干扰）。

## 本地预览

```bash
bun run preview:local      # 读 content/ 构建到 _preview + 起服务器
# 浏览器打开 http://localhost:3000
```

该命令离线构建（不需要 GitHub），仅由本地 md 建站，便于边写边看。

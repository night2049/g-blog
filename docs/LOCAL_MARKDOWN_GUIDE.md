# Local Markdown Writing Guide

**English** · [简体中文](LOCAL_MARKDOWN_GUIDE.zh-CN.md)

In addition to GitHub Issues, gblog supports building local Markdown files into site content. The two content sources coexist long-term and merge into the same site.

## Directory Convention

```
content/                       # Configured by build.contentDir in config/build.json (default: content)
├─ posts/                      # Posts (enter the timeline/archive/tags/directories)
│  ├─ hello-world.md
│  └─ 2025/some-post.md        # Any nesting level is allowed
└─ pages/                      # Standalone pages (not in the timeline; URL determined by slug/filename)
   └─ about.md
```

The subdirectory names `posts` / `pages` are hardcoded (not configurable for now).

## Front Matter

Write YAML at the top of the file inside a `---` fence ([YAML 1.2 core schema](https://yaml.org), parsed by `Bun.YAML`):

```yaml
---
title: Hello World      # Defaults to the filename (without extension)
date: 2025-06-01        # Defaults to the file mtime; a YYYY-MM-DD value maps to midnight UTC that day
draft: false            # true = not published (no publish label added)
tags: [bun, tutorial]   # → content tags
categories: [essays]    # → directories (equivalent to an issue's dir: label)
slug: about             # Only pages use this as the URL (<slug>.html); posts ignore it (they use md5)
---
Markdown body...
```

Field reference:

| Field | Applies to | Description |
| --- | --- | --- |
| `title` | All | Defaults to the filename (without `.md`) |
| `date` | All | String; `YYYY-MM-DD` maps to midnight UTC that day; defaults to the file's modification time |
| `draft` | All | `true` means not published |
| `tags` | All | Array of strings (or a single string), mapped to content tags |
| `categories` | All | Array of strings, mapped to directories (`dirPrefix:` labels) |
| `slug` | Pages only | Determines the standalone page URL (`<slug>.html`); defaults to the filename. Must pass reserved-name / invalid-character validation, otherwise the page is skipped |

> Empty front matter (just `---\n---`) or no fence at all (bare Markdown) are both valid; in the latter case the whole file is the body.

## Post Identity and URL (Important)

- A post's `node_id = md5(normalized relative path)` (e.g. `posts/2025/some-post.md`), and its URL is `<postDir>/<md5>.html` (default `post/<md5>.html`).
- **The path is the stable identity**: editing the body does not change the URL.
- **Renaming/moving a file = delete the old + add a new one**: the URL changes accordingly (the old URL breaks, a new one is generated). To keep links stable, do not move files.

## Local Images

Reference images in the body with a **relative path** (relative to the directory of the current md file):

```markdown
![Diagram](images/diagram.png)     # Relative to the current md directory
```

At build time: relative images are read, transcoded to WebP (per the `content.webp` config), written to `post/<md5>/`, and their references in the body are rewritten to site-relative paths with `width`/`height` added (to eliminate CLS). Absolute URLs (`http(s)://`, `//`, `/`, `data:`) do not go through the local pipeline.

> Note: local incremental builds only rebuild a file when its `.md` changes. If you **only change an image file without touching the md**, no rebuild is triggered — either touch the md as well, or run a full build.

## Build Triggers (Strategy Chosen Automatically)

- A push changing `content/**.md` (without also changing `src/`/`scripts/`/`themes/`/`config/`) → **local incremental**: rebuild only the affected posts.
- Changed together with the theme/config, or changes to `src/`/`scripts/` → full rebuild.
- Issue events (webhook) → issue incremental (independent of local md).

## Local Preview

```bash
bun run preview:local      # Reads content/, builds to _preview, and starts a server
# Open http://localhost:3000 in your browser
```

This command builds offline (no GitHub required), building the site from local md only, making it easy to write and preview as you go.

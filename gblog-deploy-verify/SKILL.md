---
name: gblog-deploy-verify
description: 全程托管给 AI：用 gh CLI 从零初始化并部署一个 gblog 博客（从开源模板创建私有内容仓 + 建公开站点仓 + Deploy Key + 可选 CONTENT_PAT fallback + 改配置/workflow + 写 issue 文章与本地 md 文章），再校验 Pages 上线，并可选配置 giscus 评论。上游开源仓库 night2049/g-blog。涉及 部署/初始化/上线/私有仓库/fork/deploy key/github pages/验证博客/issue 发文/双仓库/评论/giscus 时使用。
---

# gblog 部署与验证（AI 托管）

用 `gh` CLI 建好一个 gblog 博客并验证上线。内容仓私有（写作、草稿、未发布 issue 都不公开），站点仓公开（承载 GitHub Pages 成品），两仓用 Deploy Key 打通跨仓推送。上游：`night2049/g-blog`。

**构建全在 GitHub Actions 远程执行，本机不需要 bun 或任何构建环境**，只需 `git`、`gh`、`ssh-keygen`。

## 前置

1. **安装 GitHub CLI**：见 https://cli.github.com （Windows `winget install --id GitHub.cli`；macOS `brew install gh`）。
2. **登录并授权**：`gh auth login`（依次选 GitHub.com → HTTPS → 浏览器登录）。完成后 `gh auth status` 应显示已登录且 token scopes 含 `repo` 和 `workflow`；若缺，执行 `gh auth refresh -h github.com -s repo,workflow`。
3. 本机有 `git`、`ssh-keygen`（Git for Windows / OpenSSH 自带）。（`bun` 非必需，仅本地跑 `verify.ts` 或 `preview:local` 时才用。）
4. 本流程会创建真实的 GitHub 仓库、Deploy Key、Secret、Issue。开始前与用户确认内容仓名、站点仓名，不要覆盖已有仓库。

参数：`OWNER`（账号，取 `gh api user -q .login`）、`CONTENT`（私有内容仓名）、`SITE`（公开站点仓名）；站点 URL 形如 `https://<OWNER>.github.io/<SITE>`。

环境说明：Windows PowerShell 下命令用 `;` 分隔，`&` 会被当后台任务。

## 步骤

### 1. 创建私有内容仓

```bash
# 用模板一键建私有副本并克隆(公开仓的 fork 无法私有, 故不用 gh repo fork)
gh repo create <OWNER>/<CONTENT> --template night2049/g-blog --private --clone
cd <CONTENT>
# 注: 私有仓的 Actions 消耗账号每月额度(免费版 2000 分钟/月); 公开仓免费无限.
```

### 2. 创建公开站点仓 + 开 Pages

```bash
# Pages 免费版只支持公开仓, 所以站点仓必须公开; 私有内容仓不要开 Pages.
gh repo create <OWNER>/<SITE> --public --add-readme --description "gblog site/Pages repo"

# 坑: --add-readme 的默认分支取决于账号设置, 常见为 master, 而本流程统一用 main.
#     先核对, 若为 master 就重命名(否则下面开 Pages 会报 "main branch must exist").
gh api repos/<OWNER>/<SITE>/branches -q ".[].name"
gh api -X POST repos/<OWNER>/<SITE>/branches/master/rename -f new_name=main

# 开 Pages(分支须已存在)
gh api -X POST repos/<OWNER>/<SITE>/pages -f "source[branch]=main" -f "source[path]=/"
```

### 3. Deploy Key（打通跨仓推送）

```bash
# 跨仓推送时 Actions 默认的 GITHUB_TOKEN 没权限, 必须用 Deploy Key.
# 坑: PowerShell 的 -N "" 可能被设成非空口令, 用 cmd 包一层保证空口令:
cmd /c "ssh-keygen -t ed25519 -f %TEMP%\gblog_deploy_key -N `"`" -C gblog-deploy"
# 验证空口令: 下面能直接导出公钥即为空口令
ssh-keygen -y -f $env:TEMP\gblog_deploy_key -P ""

# 公钥 -> 站点仓 Deploy keys(可写)
gh repo deploy-key add "$env:TEMP\gblog_deploy_key.pub" --repo <OWNER>/<SITE> --title "gblog deploy" --allow-write
# 私钥 -> 内容仓 Secret BLOG_DEPLOY_KEY
Get-Content $env:TEMP\gblog_deploy_key -Raw | gh secret set BLOG_DEPLOY_KEY --repo <OWNER>/<CONTENT>
```

### 4. 配置 CONTENT_PAT（可选 fallback）

私有内容仓里 issue 贴的 GitHub 附件图片会先通过 GitHub Markdown API 解析为带签名的 `private-user-images.githubusercontent.com` 媒体 URL，再匿名下载；构建不会把 token 直接发给图片 CDN。默认使用当前 workflow 的 `GITHUB_TOKEN`。如果你的权限模型导致 Markdown API 无法读取私有内容，可额外配置 **classic PAT（`repo` scope）** 到 `CONTENT_PAT` 作为 fallback。**PAT 无法用命令行创建**（需网页端 sudo 验证），在浏览器创建后用 gh 配置为 Secret：

- 创建：打开 https://github.com/settings/tokens/new?scopes=repo，仅在确有需要时创建，选择最短可接受有效期并定期轮换；生成后复制。
- 配置：

```bash
gh secret set CONTENT_PAT --repo <OWNER>/<CONTENT>   # 按提示粘贴 token
```

### 5. 改 workflow 与 config，推送（触发首次 full 构建）

- `.github/workflows/build.yml`：把 `repository:` 改成 `<OWNER>/<SITE>`（模板里是占位符 `your-name/your-site-repo`）。
- `config/site.json`：`title`、`url`（填 `https://<OWNER>.github.io/<SITE>`，注意含 `<SITE>` 子路径）、`author`。
- `config/appearance.json`：`logo`、`links`、`footer`（示例的 ICP/备案换成自己的或留空）。

```bash
git add .github/workflows/build.yml config/site.json config/appearance.json
git commit -m "chore: configure deployment"
git push origin main
```

### 6. Issues 文章（触发 incremental）

```bash
# 坑: 新建的内容仓不带 published 等标签, 直接打标签会失败, 必须先建标签.
gh label create published --repo <OWNER>/<CONTENT> --color 0e8a16 --description "publish this post"
gh label create "dir:验证" --repo <OWNER>/<CONTENT> --color 1d76db   # 可选: 目录标签
# 正文先写到一个临时 md 文件(避免 shell 引号转义), 再用 --body-file 引用:
Set-Content -Path "$env:TEMP\post.md" -Value "# 标题`n`n正文 Markdown……"
gh issue create --repo <OWNER>/<CONTENT> --title "Issues 模式验证文章" --body-file "$env:TEMP\post.md" --label published --label "dir:验证"

# 关于页: 用 page 标签(config/build.json 的 pageLabel)标记为独立页, 不进时间线, URL 由正文头部 meta 块决定.
# 坑: 独立页正文必须以 <!-- meta\nurl: <slug>\n--> 开头, 否则 issueToPage 返回 null 直接跳过, pages.json 会是空数组.
# slug 不能是 index; URL 最终为 <slug>.html.
gh label create page --repo <OWNER>/<CONTENT> --color 5319e7 --description "standalone page"
Set-Content -Path "$env:TEMP\about.md" -Value "<!-- meta`nurl: about`n-->`n`n# 关于`n`n这是关于页。"
gh issue create --repo <OWNER>/<CONTENT> --title "关于" --body-file "$env:TEMP\about.md" --label published --label page
```

### 7. 本地 md 文章（触发 incrementalLocal）

```bash
# 新增 content/posts/<年>/xxx.md(带 Front Matter: title/date/tags/categories), 然后:
git add content/posts/<年>/verify-local-md.md
git commit -m "post: add local md verify"
git push origin main
```

## 验证：怎样算部署成功

不必拘泥固定命令（按当前环境自行拼 `gh` / HTTP 请求即可），满足以下即视为成功：

1. **构建成功**：内容仓最近一次相关 Actions run 结论为 `success`。
   - 注：建/改 issue 会同时触发 opened+labeled 多个事件，并发组会取消排队中的旧运行，`cancelled` 属正常，以最后一次 `success` 为准。
   - 三种策略应分别出现：首次配置 push → `full`，建 issue → `incremental`，push 本地 md → `incrementalLocal`（构建日志里有「自动策略 = …」）。
2. **产物到位**：站点仓 `main` 根目录出现构建产物（`index.html`、`post/`、`data/` 等）。
3. **Pages 上线**：站点仓 pages build 状态为 `built`（首次有 30~60s 延迟），访问 `https://<OWNER>.github.io/<SITE>/` 返回 200。
4. **内容正确**：站点是客户端渲染，`index.html` 不含文章标题，文章数据在 `data/*.json`（如 `data/years.json`、`data/year/<年>.json`）。确认你发的 issue 文章与本地 md 文章标题出现在这些 JSON 里即为正确。（`gh api` 取中文路径如 `data/dir/<中文>.json` 会因二次编码 404，走 Pages 的 HTTP 直取更稳。）
5. **交付**：成功后把站点地址打印给用户，并在浏览器打开（`Start-Process <url>`；macOS `open`，Linux `xdg-open`）。

## （可选）配置 giscus 评论

**在上面全部完成、用户确认站点没问题后再进行，且先问用户是否需要评论**——不需要就保持默认（`comments.enabled=false`）。

评论存 GitHub Discussions，giscus 要求承载仓库**公开**，用**站点仓**承载即可（私有内容仓不能用）。`repoId`/`categoryId` 是 giscus.app 给的公开值，不是密钥，直接写进 `config/comments.json`，无需 Secret。

1. 开启站点仓的 Discussions：
   ```bash
   gh api -X PATCH repos/<OWNER>/<SITE> -F has_discussions=true
   ```
2. **用户授权（浏览器，AI 代不了）**：
   - 给站点仓安装 giscus App：https://github.com/apps/giscus
   - 打开 https://giscus.app ，填入 `<OWNER>/<SITE>`、选 Discussion 分类（如 Announcements）、mapping 选 `pathname`；页面会给出 `repo`、`repoId`、`category`、`categoryId` 四个值，交给 AI。
3. AI 把这些值写进内容仓 `config/comments.json`（`enabled` 设为 `true`，`mapping` 用 `pathname`），提交推送触发重建：
   ```bash
   git add config/comments.json
   git commit -m "chore: enable giscus comments"
   git push origin main
   ```
4. 判定成功：重建完成后打开任意文章页，底部出现 giscus 评论框（挂载点 `#giscus-mount`，接近视口时懒加载 client.js）。首页/归档等列表页不显示评论，只有文章页有。

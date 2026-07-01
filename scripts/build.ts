// CLI 唯一装配点 (无 --mode): 自动选策略 (full/incremental/reassemble) 并装配底层实现.
// 同次构建先编译 CSS (buildCssEntry -> tailwind) 再写/重盖 HTML. --full 强制全量; --fixture 本地无网预览.
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import katex from "katex";
import type {
  EventSource,
  GitHubApi,
  ImageDownloader,
  Markdown,
  RawIssue,
} from "../src/domain/types.ts";
import { createMarkdown } from "../src/infra/markdown.ts";
import { protectMath, restoreMath } from "../src/domain/math.ts";
import { createFileStore } from "../src/infra/fileStore.ts";
import { createEventSource } from "../src/infra/eventPayload.ts";
import { createGitHubApi } from "../src/infra/githubApi.ts";
import { createImageDownloader, createLocalImageReader } from "../src/infra/imageDownloader.ts";
import { listLocalPosts, listChangedLocalPosts } from "../src/infra/localMarkdownSource.ts";
import { createTemplateProvider } from "../src/infra/templateProvider.ts";
import { createFeedRenderer } from "../src/infra/feedRenderer.ts";
import { createHighlighter } from "../src/domain/highlight.ts";
import { loadConfig, toSiteConfig } from "../src/domain/config.ts";
import {
  resolveThemePaths,
  loadThemeManifest,
  deriveChromeVars,
  toChromeData,
  buildCssEntry,
} from "../src/domain/themeService.ts";
import { writeListPages, copyThemeAssets, writeChromeJson, writeErrorPages, themeScriptAssets } from "../src/domain/siteService.ts";
import type { Config, FileStore, LocalPost } from "../src/domain/types.ts";
import { runIncremental } from "../src/app/runIncremental.ts";
import { runFull } from "../src/app/runFull.ts";
import { run, decideStrategy } from "../src/app/run.ts";
import type { StrategyEnv } from "../src/app/run.ts";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error("缺少环境变量: " + key);
  return v;
}

// 数学装饰器: 包裹 Markdown 端口. render 前用 protectMath 抽出 $…$/$$…$$ 换占位 (排除代码),
// 底层渲染后用 restoreMath + katex.renderToString 回填. 无公式时走原始 render 不改动.
// 装配于此单一装配点 (postService 不感知); 仅 cfg.content.math.enabled 时启用.
function withMath(base: Markdown): Markdown {
  return {
    render(md: string): string {
      const { md: stripped, tokens } = protectMath(md);
      if (tokens.length === 0) return base.render(md);
      const html = base.render(stripped);
      return restoreMath(html, tokens, (tex, display) =>
        katex.renderToString(tex, { displayMode: display, throwOnError: false }),
      );
    },
  };
}

// 事件文件是否含 issue 载荷 (区分 issues 事件与 push 事件; 解析失败按无载荷处理).
function eventHasIssue(eventPath: string): boolean {
  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf8"));
    return Boolean(payload && payload.issue);
  } catch {
    return false;
  }
}

// 本次 push 改动的一条文件记录: status (A/M/D 等单字母) + 仓库相对路径.
interface ChangedFile {
  status: string;
  path: string;
}

// 用 git diff 算本次 push 改动 (DIFF_BASE..DIFF_HEAD), 带增删改状态供本地 md 增量.
// 数组参数调用避免 shell 注入; 缺 ref/失败则置空. 重命名 (R) 拆为 "删旧 + 增新"; 复制 (C) 仅记新增.
function computeChangedPaths(): ChangedFile[] {
  const base = process.env.DIFF_BASE;
  const head = process.env.DIFF_HEAD;
  if (!base || !head) return [];
  const proc = Bun.spawnSync(["git", "diff", "--name-status", base, head]);
  if (proc.exitCode !== 0) {
    console.log("[build] git diff 非零退出, changedPaths 置空");
    return [];
  }
  const out: ChangedFile[] = [];
  for (const line of new TextDecoder().decode(proc.stdout).split("\n")) {
    const t = line.replace(/\r$/, "");
    if (!t.trim()) continue;
    const cols = t.split("\t");
    const status = cols[0]!;
    if (/^R/i.test(status) && cols.length >= 3) {
      // 重命名: 删旧 + 增新 (与 md5=路径身份一致, 见设计 §3.7).
      out.push({ status: "D", path: cols[1]! });
      out.push({ status: "A", path: cols[2]! });
    } else if (/^C/i.test(status) && cols.length >= 3) {
      // 复制: 源未删, 仅记新增.
      out.push({ status: "A", path: cols[2]! });
    } else if (cols.length >= 2) {
      out.push({ status: status[0]!, path: cols[1]! });
    }
  }
  return out;
}

// 编译 CSS: buildCssEntry 写 .build/app.entry.css (相对 @source) -> tailwindcss 产出 <siteDir>/app.css.
async function compileCss(
  rootFs: FileStore,
  cfg: Config,
  siteDir: string,
): Promise<void> {
  const entry = buildCssEntry(cfg, rootFs);
  const entryPath = ".build/app.entry.css";
  await Bun.write(entryPath, entry);
  const proc = Bun.spawn(
    ["bunx", "tailwindcss", "-i", entryPath, "-o", siteDir + "/app.css", "--minify"],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error("tailwindcss 编译失败, exit=" + code);
  console.log("[build] CSS 编译完成 -> " + siteDir + "/app.css");
}

// 资产生产化: 把主题 .js/.css 资产用 Bun 打包器 minify 到 outDir, 其它(svg/图片等)原样拷贝.
// 放在装配层(非 domain): 下游 copyThemeAssets 从 outDir 拷贝, 即得压缩版, 无需改 domain 签名.
// .js 必须用 format:"iife" 封装作用域: 各脚本是经典脚本(共享全局), minify 会把不同文件的顶层函数
// 都重命名成 a/w 等短名, 经典脚本顶层声明进全局 -> 后加载的脚本(如 app.js 的 render=w)会覆盖
// 先加载的(browse.js 的 isSamePageNav=w), 导致 SPA 拦截误用 render 当判定. IIFE 封装杜绝此全局冲突,
// window.gblog 等显式全局不受影响.
// 源解析: 主题 assets 内有同名文件优先 (允许主题覆写 runtime); 否则 fallback 到 runtime/.
// runtime/ 集中放跨主题共用的 browse/chrome/widgets/app/archive/tag/dir/tags.js, 主题不复制.
async function prepareThemeAssets(
  srcAbs: string,
  runtimeAbs: string,
  outAbs: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    const themeSrc = join(srcAbs, name);
    const src = existsSync(themeSrc) ? themeSrc : join(runtimeAbs, name);
    const out = join(outAbs, name);
    const isJs = name.endsWith(".js");
    if (isJs || name.endsWith(".css")) {
      const res = await Bun.build({
        entrypoints: [src],
        minify: true,
        target: "browser",
        ...(isJs ? { format: "iife" as const } : {}),
      });
      if (!res.success)
        throw new Error("资产 minify 失败: " + name + " " + res.logs.map(String).join("; "));
      await Bun.write(out, await res.outputs[0]!.text());
    } else {
      await Bun.write(out, Bun.file(src)); // 原样拷贝 (favicon.svg / 图片等)
    }
  }
  console.log("[build] 资产压缩完成 -> " + outAbs + " (" + names.length + " 项)");
}

// 模板生产化: 把主题模板树递归拷到 outAbs, 其中 head.html 的内联 <script> 经 Bun minify 后回填.
// 占位符 {{giscusThemeLight/Dark}} 位于字符串字面量内, 标准 minify 保留; {{headExtra}} 在 script 块外, 不受影响.
// 放装配层 (非 domain): 下游 templateProvider 从 outAbs 读, 即得压缩版 head, 无需改 domain.
async function prepareTemplates(srcAbs: string, outAbs: string): Promise<void> {
  const glob = new Bun.Glob("**/*");
  let count = 0;
  for (const rel of glob.scanSync({ cwd: srcAbs, onlyFiles: true })) {
    const src = join(srcAbs, rel);
    const out = join(outAbs, rel);
    const base = rel.split(/[\\/]/).pop();
    if (base === "head.html") {
      await Bun.write(out, await minifyHeadInlineScript(await Bun.file(src).text()));
    } else {
      await Bun.write(out, Bun.file(src)); // 原样拷贝 (baseof/header/footer/main-* 等)
    }
    count++;
  }
  console.log("[build] 模板装配完成 -> " + outAbs + " (" + count + " 项)");
}

// 压缩 head.html 唯一的内联 <script> 块 (含 chrome.json kickoff + 主题脚本): 抽出 JS 写临时文件 ->
// Bun.build minify -> 回填. Bun 无独立 string-minify API, 故借 Bun.build (与 prepareThemeAssets 同源).
async function minifyHeadInlineScript(html: string): Promise<string> {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) return html; // 无内联脚本: 原样返回
  const tmp = join(".build", "_head-inline.js");
  await Bun.write(tmp, m[1]!);
  const res = await Bun.build({ entrypoints: [tmp], minify: true, target: "browser" });
  if (!res.success)
    throw new Error("head 内联脚本 minify 失败: " + res.logs.map(String).join("; "));
  const minified = (await res.outputs[0]!.text()).trim();
  // 用替换函数 (而非字符串) 回填: 规避 minify 产物中潜在 $ 序列被 String.replace 特殊解释.
  return html.replace(m[0], () => "<script>" + minified + "</script>");
}

// fixture 内置假事件源 (本地验证, 不触网). 正文覆盖多种 markdown 格式以验证渲染.
function fixtureEventSource(): EventSource {
  const body = [
    "<!-- meta",
    "date: 2026-06-01",
    "-->",
    "# 标题一 H1",
    "",
    "段落含 **加粗**、*斜体*、`行内代码` 与 [链接](https://example.com)。",
    "",
    "## 标题二 H2",
    "",
    "- 无序项一",
    "- 无序项二",
    "  - 嵌套项",
    "",
    "1. 有序项一",
    "2. 有序项二",
    "",
    "- [x] 已完成任务",
    "- [ ] 未完成任务",
    "",
    "> 这是一段引用 blockquote。",
    "",
    "| 列 A | 列 B |",
    "| ---- | ---- |",
    "| 单元 1 | 单元 2 |",
    "| 单元 3 | 单元 4 |",
    "",
    "### 代码块 (含特殊字符)",
    "",
    "```ts",
    "const cmp = (a: number, b: number) => a < b && b > 0;",
    'const s = "x & y";',
    "```",
    "",
    "```",
    "无语言代码块: plain text",
    "```",
    "",
    "---",
    "",
    "![示例图片](https://example.com/img.png)",
    "",
    "结尾段落。",
  ].join("\n");
  const issue: RawIssue = {
    node_id: "I_fixture001",
    number: 1,
    title: "Fixture 示例文章 (多格式验证)",
    body,
    state: "open",
    labels: [
      { name: "published" },
      { name: "bun" },
      { name: "教程" },
      { name: "enhancement" },
    ],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };
  return { readIssue: () => issue, readAction: () => null };
}

async function main(argv: string[]): Promise<void> {
  const forceFull = argv.includes("--full");
  const isFixture = argv.includes("--fixture");
  const isLocalPreview = argv.includes("--local-preview");

  const rootBase = process.env.CONFIG_DIR ?? ".";
  const rootFs = createFileStore(rootBase);
  const cfg = loadConfig(rootFs, process.env.CONFIG_FILES_DIR ?? "config");
  // 解析所选主题: 模板/资产目录 + 清单 + 构建期外壳片段 (logo/nav/footer/rss).
  const themePaths = resolveThemePaths(cfg, rootFs);
  const themeManifest = loadThemeManifest(rootFs, themePaths.themeDir);
  const chrome = deriveChromeVars(cfg, themeManifest);
  // 模板生产化: 递归拷模板树到 .build/templates, head 内联脚本 minify; provider 指向产物目录.
  // fixture 与正式构建共用此 templates, 故在分支前先装配.
  const builtTemplatesDir = join(".build", "templates");
  await prepareTemplates(join(rootBase, themePaths.templatesDir), builtTemplatesDir);
  const templates = createTemplateProvider(builtTemplatesDir);
  // 资产生产化: 先把主题 .js/.css 压缩到 .build/theme-assets, 后续 copyThemeAssets 从此拷贝.
  const srcAssetsDir = join(rootBase, themePaths.assetsDir);
  const runtimeAssetsDir = join(rootBase, "src", "runtime");
  const assetsDir = join(".build", "theme-assets");
  await prepareThemeAssets(srcAssetsDir, runtimeAssetsDir, assetsDir, themeScriptAssets(themeManifest));
  const feedRenderer = createFeedRenderer();
  // 数学公式启用时, 用装饰器包裹 Markdown 端口 (protectMath/restoreMath + katex); 否则原始端口.
  const md = cfg.content.math.enabled ? withMath(createMarkdown()) : createMarkdown();
  const highlighter = createHighlighter();

  // 本地预览: 假事件 -> 写 _preview + 编译 CSS (不触网, 无图片下载).
  if (isFixture) {
    const siteDir = "_preview";
    const fs = createFileStore(siteDir);
    await compileCss(rootFs, cfg, siteDir);
    await runIncremental({
      events: fixtureEventSource(),
      fs,
      md,
      cfg,
      templates,
      manifest: themeManifest,
      chrome,
      feedRenderer,
      highlighter,
    });
    // 补齐列表外壳 + 主题脚本资产, 使 _preview 为完整可预览站点 (首页/归档/目录 + 文章).
    writeListPages(fs, templates, themeManifest, toSiteConfig(cfg), chrome, cfg);
    writeErrorPages(fs, templates, themeManifest, chrome, cfg);
    copyThemeAssets(fs, assetsDir, themeManifest);
    // 增量不写 chrome.json, fixture 需补齐使本地预览有完整外壳 (chrome.js 已在资产清单内).
    writeChromeJson(fs, toChromeData(chrome, cfg.site.title));
    console.log("[build] fixture 完成 -> _preview");
    return;
  }

  // 本地内容离线预览: 读 content/ md 直调 runFull (不构造 api/repo, issues=[]), 仅由本地 md 建站.
  // 绕过 run()/decideStrategy (类比 --fixture 直调 runIncremental); 本地图走 createLocalImageReader.
  if (isLocalPreview) {
    const siteDir = "_preview";
    const fs = createFileStore(siteDir);
    await runFull({
      fs,
      md,
      cfg,
      templates,
      manifest: themeManifest,
      chrome,
      assetsDir,
      feedRenderer,
      highlighter,
      // 远程图: 联网时尝试下载 (无 token 走匿名), 失败保留原链接.
      images: createImageDownloader(process.env.GITHUB_TOKEN, undefined, cfg.content.webp),
      localPosts: listLocalPosts(cfg, rootBase),
      localImageReader: (dir) => createLocalImageReader(dir, cfg.content.webp),
    });
    // CSS 在产物写出后编译 (runFull 的 cleanSiteRoot 会清站点根, app.css 须在之后产出).
    await compileCss(rootFs, cfg, siteDir);
    console.log("[build] local-preview 完成 -> _preview (本地 md 双源离线预览)");
    return;
  }

  const siteDir = requireEnv("SITE_DIR");
  const fs = createFileStore(siteDir);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const changedFiles = computeChangedPaths();
  const env: StrategyEnv = {
    hasIssuePayload: eventPath ? eventHasIssue(eventPath) : false,
    hasManifest: fs.exists("data/years.json"),
    changedPaths: changedFiles.map((f) => f.path),
    forceFull,
    contentDir: cfg.build.contentDir,
  };
  const strategy = decideStrategy(env);
  console.log(
    "[build] env=" +
      JSON.stringify({ ...env, changedPaths: env.changedPaths.length }) +
      " -> 策略 " +
      strategy,
  );

  // 按策略惰性构造外部资源: reassemble 无需 token/事件.
  let api: GitHubApi | undefined;
  let repo: string | undefined;
  let events: EventSource | undefined;
  let images: ImageDownloader | undefined;
  let localPosts: LocalPost[] | undefined;
  let localChanges: { upserts: LocalPost[]; removes: string[] } | undefined;
  // 本地相对图 reader 工厂 (full 与 incrementalLocal 共用; 端口-适配器: app 不直接 new infra).
  const localImageReader = (dir: string) => createLocalImageReader(dir, cfg.content.webp);
  if (strategy === "full") {
    api = createGitHubApi(requireEnv("GITHUB_TOKEN"));
    repo = requireEnv("CONTENT_REPO");
    images = createImageDownloader(
      process.env.CONTENT_PAT || requireEnv("GITHUB_TOKEN"),
      undefined,
      cfg.content.webp,
    );
    localPosts = listLocalPosts(cfg, rootBase); // 双源: 本地 md 合并入全量
  } else if (strategy === "incremental") {
    events = createEventSource(requireEnv("GITHUB_EVENT_PATH"));
    images = createImageDownloader(
      process.env.CONTENT_PAT || process.env.GITHUB_TOKEN,
      undefined,
      cfg.content.webp,
    );
  } else if (strategy === "incrementalLocal") {
    // 本地 md 增量: 预算改动篇目; 远程图仍可能出现 (匿名/带 token 尝试).
    images = createImageDownloader(
      process.env.CONTENT_PAT || process.env.GITHUB_TOKEN,
      undefined,
      cfg.content.webp,
    );
    localChanges = listChangedLocalPosts(changedFiles, cfg, rootBase);
  }

  await run({
    env,
    fs,
    md,
    cfg,
    templates,
    manifest: themeManifest,
    chrome,
    assetsDir,
    feedRenderer,
    highlighter,
    api,
    repo,
    events,
    images,
    localPosts,
    localChanges,
    localImageReader,
  });
  // CSS 在产物写出后编译: full 策略会先清空站点根 (cleanSiteRoot), 故 app.css 必须在 run 之后产出, 避免被清理删除.
  await compileCss(rootFs, cfg, siteDir);
  console.log("[build] 完成 -> " + siteDir);
}

main(process.argv.slice(2)).catch((e) => {
  console.error("[build] 失败:", e);
  process.exit(1);
});

// 全量构建: 清站点根 -> 拉全部已发布 (Issues) + 合并本地 md -> 渲染文章与独立页 ->
// 重建 data/ 分片(years/year/tag/dir) + pages/site/chrome + feed + 列表外壳 + 主题资产.
// 双源: Issues 与本地 md 经同一套 processOne 分流处理 (node_id 命名空间天然不冲突).
// api/repo 可选: 离线本地预览 (--local-preview) 不构造 GitHub, issues 视为 [], 仅由 localPosts 建站.
import type {
  ChromeVars,
  Config,
  FeedRenderer,
  FileStore,
  GitHubApi,
  Highlighter,
  LocalPost,
  Manifest,
  PageManifest,
  ImageDownloader,
  Markdown,
  RawIssue,
  TemplateProvider,
  ThemeManifest,
  ImageSource,
} from "../domain/types.ts";
import { toSiteConfig, postDirDepth, rootPrefixFor } from "../domain/config.ts";
import { listPublishedIssues } from "../domain/issueService.ts";
import { issueToPage, issueToPost, isPageIssue, postImgDir } from "../domain/postService.ts";
import {
  savePages,
  upsertEntry,
  upsertPage,
} from "../domain/manifestService.ts";
import { renderPageHtml, renderStandalonePageHtml } from "../domain/template.ts";
import { rebuildAllShards } from "../domain/shardService.ts";
import { toChromeData } from "../domain/themeService.ts";
import { generateFeeds } from "../domain/feedService.ts";
import { finalizeContent, enrichPostContent } from "../domain/finalize.ts";
import {
  cleanSiteRootKeepImages,
  copyThemeAssets,
  pruneOrphanImages,
  writeChromeJson,
  writeErrorPages,
  writeListPages,
  writePostPage,
  writeSiteJson,
} from "../domain/siteService.ts";

export interface FullDeps {
  api?: GitHubApi; // 可选: 离线本地预览不构造
  fs: FileStore;
  md: Markdown;
  cfg: Config;
  repo?: string; // 可选: 同 api
  templates: TemplateProvider; // 指向所选主题 templates 目录
  manifest: ThemeManifest; // 主题清单
  chrome: ChromeVars; // 构建期派生的外壳片段
  assetsDir: string; // 主题 assets 目录 (拷贝客户端脚本)
  feedRenderer: FeedRenderer;
  images?: ImageDownloader; // 远程图下载器
  highlighter?: Highlighter;
  // 本地 md 双源 (装配层注入): localPosts 为合成 RawIssue 列表;
  // localImageReader 为按 md 文件目录构造本地相对图 reader 的工厂 (端口-适配器: app 不直接 new infra).
  localPosts?: LocalPost[];
  localImageReader?: (baseDir: string) => ImageDownloader;
}

export async function runFull(deps: FullDeps): Promise<void> {
  const {
    api,
    fs,
    md,
    cfg,
    repo,
    templates,
    manifest,
    chrome,
    assetsDir,
    feedRenderer,
    images,
    highlighter,
    localPosts,
    localImageReader,
  } = deps;
  if ((api && !repo) || (!api && repo))
    throw new Error("full 策略 api/repo 必须同时提供");
  // api/repo 缺省时 (离线本地预览) issues 视为空, 仅由 localPosts 建站.
  const issues = api && repo ? await listPublishedIssues(api, repo, cfg.build.publishedLabel) : [];
  console.log(
    "[全量] 拉取已发布 " + issues.length + " 项, 本地 md " + (localPosts?.length ?? 0) + " 篇",
  );
  // full 为站点产物唯一权威来源: 清站点根但保留正文图片 (转码代价高, 靠判存复用避免重下), 杜绝旧版布局孤儿.
  // existingImages = 保留下来的图片集; 构建末尾据"本次在用集"回收孤儿 (删文章/换图残留的旧图).
  const existingImages = cleanSiteRootKeepImages(fs);
  const site = toSiteConfig(cfg);
  const postDir = cfg.build.postDir;
  const postPrefix = rootPrefixFor(postDirDepth(postDir));
  let manifestData: Manifest = [];
  let pages: PageManifest = [];
  // 本次构建实际引用的图片路径集 (含判存命中复用的图); 末尾据此回收未被引用的孤儿图.
  const usedImages = new Set<string>();

  // 单篇处理 (Issues 与本地 md 共用): 独立页 -> issueToPage; 文章 -> issueToPost.
  // localImages 仅本地 md 传入 (处理正文相对图); issue 文章不传 -> finalize 本地图段 no-op.
  const processOne = async (
    issue: RawIssue,
    localImages?: ImageDownloader,
    imageSource?: ImageSource,
  ): Promise<void> => {
    if (isPageIssue(issue, cfg.build.pageLabel)) {
      const page = issueToPage(issue, cfg, md);
      if (!page) {
        console.log("[全量] 独立页 url 非法, 跳过 node_id=" + issue.node_id);
        return;
      }
      if (pages.some((p) => p.url === page.url && p.nodeId !== page.nodeId)) {
        console.log("[全量] 独立页 url 冲突, 跳过: " + page.url);
        return;
      }
      const { html, assets } = await finalizeContent(page.contentHtml, {
        highlighter,
        images,
        localImages,
        fs,
        imgDir: page.nodeId,
        relPrefix: page.nodeId + "/",
        imageSource,
        webp: cfg.content.webp,
      });
      for (const a of assets) usedImages.add(a);
      fs.write(
        page.url,
        renderStandalonePageHtml(
          { ...page, contentHtml: html },
          site,
          templates,
          manifest,
          chrome,
          cfg,
        ),
      );
      pages = upsertPage(pages, { nodeId: page.nodeId, url: page.url, title: page.title });
      return;
    }

    const post = issueToPost(issue, cfg, md);
    const base = await finalizeContent(post.contentHtml, {
      highlighter,
      images,
      localImages,
      fs,
      imgDir: postImgDir(post.nodeId, postDir),
      relPrefix: post.nodeId + "/",
      imageSource,
      webp: cfg.content.webp,
    });
    for (const a of base.assets) usedImages.add(a);
    // 富化层 (文章专属): 锚点 + 派生卡片元数据 (摘要/首图/阅读时长/字数).
    const enriched = enrichPostContent(base.html, cfg.content, postDir + "/");
    post.contentHtml = enriched.html;
    post.summary = enriched.meta.summary;
    post.cover = enriched.meta.cover;
    post.readingTime = enriched.meta.readingTime;
    post.words = enriched.meta.words;
    writePostPage(
      fs,
      post.nodeId,
      postDir,
      renderPageHtml(post, site, templates, manifest, chrome, cfg, postPrefix),
    );
    manifestData = upsertEntry(manifestData, {
      url: post.url,
      title: post.title,
      date: post.date,
      tags: post.tags,
      dirs: post.dirs,
      // 派生字段随分片落库 (year/tag/dir 各分片), 供列表卡片消费; reassemble 读出透传.
      summary: post.summary,
      cover: post.cover,
      readingTime: post.readingTime,
      words: post.words,
    });
  };

  if (repo) {
    for (const issue of issues)
      await processOne(issue, undefined, { kind: "github-issue", repo, issueNumber: issue.number });
  }
  // 本地 md: 文章与独立页均传本地图 reader (按其 md 文件目录解析相对图).
  for (const lp of localPosts ?? []) {
    const localImages = localImageReader ? localImageReader(lp.fileDir) : undefined;
    await processOne(lp.issue, localImages, { kind: "local-markdown" });
  }

  rebuildAllShards(fs, manifestData);
  savePages(fs, pages);
  writeSiteJson(fs, site);
  writeChromeJson(fs, toChromeData(chrome, cfg.site.title));
  if (cfg.rss.enabled) generateFeeds({ manifest: manifestData, fs, cfg, feedRenderer });
  writeListPages(fs, templates, manifest, site, chrome, cfg);
  writeErrorPages(fs, templates, manifest, chrome, cfg);
  copyThemeAssets(fs, assetsDir, manifest);
  // 孤儿图片回收: 构建前保留的图中本次未被任何文章/独立页引用的删除 (删文章/正文换图残留).
  pruneOrphanImages(fs, existingImages, usedImages);
  console.log(
    "[全量] 完成, 文章 " + manifestData.length + " 篇, 独立页 " + pages.length + " 个",
  );
}

// 增量单篇核心 (Issues 增量与本地 md 增量共用, 消除重复, 变更限于 app 层):
//   applyIncrementalIssue  处理单个 issue (删除/关闭 -> 移除; 否则文章/独立页分流, 含跨类型迁移).
//   applyIncrementalRemove 按 node_id 移除 (本地 md 删除文件; 无 issue 实体, 仅凭 node_id 清理两侧).
// 与 runIncremental 同款积木 (locateEntry/decideAction/decidePageAction/applyUpsert/applyRemove);
// 本地 md 通过 localImages (createLocalImageReader 工厂产物) 处理正文相对图, issue 不传 -> no-op.
import type {
  ChromeVars,
  Config,
  FileStore,
  Highlighter,
  ImageDownloader,
  ImageSource,
  Markdown,
  PageDoc,
  PageManifest,
  RawIssue,
  TemplateProvider,
  ThemeManifest,
} from "../domain/types.ts";
import { toSiteConfig } from "../domain/config.ts";
import { removePageByNodeId, upsertPage } from "../domain/manifestService.ts";
import { applyRemove, applyUpsert, locateEntry } from "../domain/shardService.ts";
import { decideAction, decidePageAction } from "../domain/publishPolicy.ts";
import { isPageIssue, nodeIdFromUrl, postImgDir } from "../domain/postService.ts";
import { renderPageHtml, renderStandalonePageHtml } from "../domain/template.ts";
import { finalizeContent, enrichPostContent } from "../domain/finalize.ts";
import { deletePostPage, writePostPage } from "../domain/siteService.ts";

interface IncrementalCoreBaseDeps {
  fs: FileStore;
  md: Markdown;
  cfg: Config;
  templates: TemplateProvider;
  manifest: ThemeManifest;
  chrome: ChromeVars;
  highlighter?: Highlighter;
  images?: ImageDownloader; // 远程图下载器
  postDir: string;
  postPrefix: string;
}

// 增量单篇所需上下文 (postDir/postPrefix 由调用方预算, 避免每篇重复).
// 来源语义显式建模: GitHub issue 必须有 repo, 本地 md 不能静默降级为 remote.
export type IncrementalCoreDeps =
  | (IncrementalCoreBaseDeps & { sourceKind: "github-issue"; repo: string })
  | (IncrementalCoreBaseDeps & { sourceKind: "local-markdown" });

/**
 * 处理单个 issue 的增量: 删除/关闭 -> 移除; 否则按 pageLabel 分流文章/独立页 (含跨类型迁移).
 * @param issue       目标 issue (本地 md 为合成 RawIssue)
 * @param action      webhook 顶层 action (deleted 等); 本地 md 传 null
 * @param pages       当前独立页清单 (函数式更新, 通过返回值传回)
 * @param deps        增量上下文
 * @param localImages 本地相对图 reader (本地 md 传入; issue 不传 -> finalize 本地图段 no-op)
 * @returns 更新后的 pages 与是否有改动
 */
export async function applyIncrementalIssue(
  issue: RawIssue,
  action: string | null,
  pages: PageManifest,
  deps: IncrementalCoreDeps,
  localImages?: ImageDownloader,
): Promise<{ pages: PageManifest; changed: boolean }> {
  const { fs, md, cfg, templates, manifest, chrome, highlighter, images, postDir, postPrefix } =
    deps;
  const imageSource: ImageSource =
    deps.sourceKind === "local-markdown"
      ? { kind: "local-markdown" }
      : { kind: "github-issue", repo: deps.repo, issueNumber: issue.number };
  let changed = false;
  // 旧文章状态: 按 nodeId 在年份分片定位.
  const oldEntry = locateEntry(fs, issue.node_id, postDir)?.entry ?? null;

  // 独立页内容收尾 (基础层); 独立页不富化 (无目录/卡片派生).
  const writePage = async (page: PageDoc): Promise<void> => {
    const { html } = await finalizeContent(page.contentHtml, {
      highlighter,
      images,
      localImages,
      fs,
      imgDir: page.nodeId,
      relPrefix: page.nodeId + "/",
      imageSource,
      webp: cfg.content.webp,
    });
    fs.write(
      page.url,
      renderStandalonePageHtml(
        { ...page, contentHtml: html },
        toSiteConfig(cfg),
        templates,
        manifest,
        chrome,
        cfg,
      ),
    );
  };

  // 1. 删除或关闭 -> 一律移除.
  if (action === "deleted" || issue.state === "closed") {
    if (oldEntry) {
      deletePostPage(fs, issue.node_id, postDir);
      applyRemove(fs, oldEntry, postDir);
      changed = true;
    }
    const pg = pages.find((p) => p.nodeId === issue.node_id);
    if (pg) {
      fs.remove(pg.url);
      pages = removePageByNodeId(pages, issue.node_id);
      changed = true;
    }
    if (changed) console.log("[增量] 移除 (删除/关闭) node_id=" + issue.node_id);
    return { pages, changed };
  }

  // 2. 独立页 / 文章分流 (含跨类型迁移).
  if (isPageIssue(issue, cfg.build.pageLabel)) {
    // 曾是文章, 现转独立页: 清理 posts 侧.
    let removedPost = false;
    if (oldEntry) {
      deletePostPage(fs, issue.node_id, postDir);
      applyRemove(fs, oldEntry, postDir);
      changed = true;
      removedPost = true;
    }
    const a = decidePageAction(issue, pages, cfg, md);
    switch (a.type) {
      case "publish":
      case "update": {
        const page = a.page!;
        if (a.staleUrl && a.staleUrl !== page.url) fs.remove(a.staleUrl);
        console.log("[增量] 独立页 " + a.type + " " + page.url + " (" + page.title + ")");
        await writePage(page);
        pages = upsertPage(pages, { nodeId: page.nodeId, url: page.url, title: page.title });
        changed = true;
        break;
      }
      case "unpublish": {
        console.log("[增量] 独立页下线 " + a.url);
        fs.remove(a.url!);
        pages = removePageByNodeId(pages, issue.node_id);
        changed = true;
        break;
      }
      case "ignore":
        if (removedPost)
          console.log(
            "[增量] 原文章已下线, 但独立页因 url 非法/冲突未生成 node_id=" + issue.node_id,
          );
        break;
    }
    return { pages, changed };
  }

  // 文章: 曾是独立页, 现转文章: 清理 pages 侧.
  const pg = pages.find((p) => p.nodeId === issue.node_id);
  if (pg) {
    fs.remove(pg.url);
    pages = removePageByNodeId(pages, issue.node_id);
    changed = true;
  }
  const action2 = decideAction(issue, oldEntry ? [oldEntry] : [], cfg, md);
  switch (action2.type) {
    case "publish":
    case "update": {
      const post = action2.post!;
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
      const enriched = enrichPostContent(base.html, cfg.content, postDir + "/");
      post.contentHtml = enriched.html;
      post.summary = enriched.meta.summary;
      post.cover = enriched.meta.cover;
      post.readingTime = enriched.meta.readingTime;
      post.words = enriched.meta.words;
      console.log("[增量] " + action2.type + " 文章 " + post.url + " (" + post.title + ")");
      writePostPage(
        fs,
        post.nodeId,
        postDir,
        renderPageHtml(post, toSiteConfig(cfg), templates, manifest, chrome, cfg, postPrefix),
      );
      applyUpsert(
        fs,
        oldEntry,
        {
          url: post.url,
          title: post.title,
          date: post.date,
          tags: post.tags,
          dirs: post.dirs,
          summary: post.summary,
          cover: post.cover,
          readingTime: post.readingTime,
          words: post.words,
        },
        postDir,
      );
      changed = true;
      break;
    }
    case "unpublish": {
      console.log("[增量] 下线文章 " + action2.url);
      deletePostPage(fs, nodeIdFromUrl(action2.url!, postDir), postDir);
      if (oldEntry) applyRemove(fs, oldEntry, postDir);
      changed = true;
      break;
    }
    case "ignore":
      break;
  }
  return { pages, changed };
}

/**
 * 按 node_id 移除 (本地 md 删除文件: 文件已不在, 无 issue 实体, 仅凭 node_id 清理).
 * 文章侧: locateEntry 命中则删页 + 分片移除; 独立页侧: 命中则删文件 + pages 移除.
 * @returns 更新后的 pages 与是否有改动
 */
export function applyIncrementalRemove(
  nodeId: string,
  pages: PageManifest,
  deps: IncrementalCoreDeps,
): { pages: PageManifest; changed: boolean } {
  const { fs, postDir } = deps;
  let changed = false;
  const oldEntry = locateEntry(fs, nodeId, postDir)?.entry ?? null;
  if (oldEntry) {
    deletePostPage(fs, nodeId, postDir);
    applyRemove(fs, oldEntry, postDir);
    changed = true;
  }
  const pg = pages.find((p) => p.nodeId === nodeId);
  if (pg) {
    fs.remove(pg.url);
    pages = removePageByNodeId(pages, nodeId);
    changed = true;
  }
  if (changed) console.log("[本地增量] 删除文件移除 node_id=" + nodeId);
  return { pages, changed };
}

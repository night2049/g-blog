// 本地 md 增量构建: 处理本次 push 改动的 md (镜像 issue 增量, 最大化减少重建).
// 输入 localChanges 由装配层 (build.ts) 经 listChangedLocalPosts 预算 (app 不下沉磁盘 IO);
// upserts 每篇经 applyIncrementalIssue (action=null, 传本地图 reader), removes 经 applyIncrementalRemove.
// 收尾与 runIncremental 一致: 有改动则 savePages + feed (rss.enabled) 从最新年份分片重生成.
import type {
  ChromeVars,
  Config,
  FeedRenderer,
  FileStore,
  Highlighter,
  ImageDownloader,
  LocalPost,
  Markdown,
  TemplateProvider,
  ThemeManifest,
} from "../domain/types.ts";
import { postDirDepth, rootPrefixFor } from "../domain/config.ts";
import { loadPages, savePages } from "../domain/manifestService.ts";
import { loadLatestEntries } from "../domain/shardService.ts";
import { generateFeeds } from "../domain/feedService.ts";
import {
  applyIncrementalIssue,
  applyIncrementalRemove,
  type IncrementalCoreDeps,
} from "./incrementalCore.ts";

export interface IncrementalLocalDeps {
  // 装配层预算的本地改动 (listChangedLocalPosts 产出): A/M -> upserts, D -> removes(node_id).
  localChanges: { upserts: LocalPost[]; removes: string[] };
  fs: FileStore;
  md: Markdown;
  cfg: Config;
  templates: TemplateProvider;
  manifest: ThemeManifest;
  chrome: ChromeVars;
  feedRenderer: FeedRenderer;
  images?: ImageDownloader; // 远程图 (本地 md 正文偶含远程图)
  highlighter?: Highlighter;
  // 本地相对图 reader 工厂 (端口-适配器: app 不直接 new infra).
  localImageReader?: (baseDir: string) => ImageDownloader;
}

export async function runIncrementalLocal(deps: IncrementalLocalDeps): Promise<void> {
  const {
    localChanges,
    fs,
    md,
    cfg,
    templates,
    manifest,
    chrome,
    feedRenderer,
    images,
    highlighter,
    localImageReader,
  } = deps;
  const postDir = cfg.build.postDir;
  const core: IncrementalCoreDeps = {
    fs,
    md,
    cfg,
    templates,
    manifest,
    chrome,
    highlighter,
    images,
    postDir,
    postPrefix: rootPrefixFor(postDirDepth(postDir)),
  };
  let pages = loadPages(fs);
  let changed = false;

  console.log(
    "[本地增量] 改动 md: 增改 " +
      localChanges.upserts.length +
      " 篇, 删除 " +
      localChanges.removes.length +
      " 篇",
  );
  // 增改: 每篇 action=null (本地 md 无 webhook 删除语义, state 恒 open), 传本地图 reader.
  for (const lp of localChanges.upserts) {
    const localImages = localImageReader ? localImageReader(lp.fileDir) : undefined;
    const res = await applyIncrementalIssue(lp.issue, null, pages, core, localImages);
    pages = res.pages;
    changed = changed || res.changed;
  }
  // 删除文件: 凭 node_id 清理文章/独立页两侧.
  for (const nodeId of localChanges.removes) {
    const res = applyIncrementalRemove(nodeId, pages, core);
    pages = res.pages;
    changed = changed || res.changed;
  }

  if (!changed) {
    console.log("[本地增量] 无改动");
    return;
  }
  savePages(fs, pages);
  if (cfg.rss.enabled)
    generateFeeds({ manifest: loadLatestEntries(fs, cfg.rss.count), fs, cfg, feedRenderer });
}

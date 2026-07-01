// 增量构建 (Issues 事件): 读事件 issue -> 经 applyIncrementalIssue 处理单篇 (删除/关闭移除 或
// 文章/独立页分流, 含跨类型迁移) -> 改动则 savePages + feed (rss.enabled) 从最新年份分片取最新 N 重生成.
// 单篇核心逻辑抽到 incrementalCore.ts, 与本地 md 增量 (runIncrementalLocal) 共用.
import type {
  ChromeVars,
  Config,
  EventSource,
  FeedRenderer,
  FileStore,
  Highlighter,
  ImageDownloader,
  Markdown,
  TemplateProvider,
  ThemeManifest,
} from "../domain/types.ts";
import { postDirDepth, rootPrefixFor } from "../domain/config.ts";
import { getEventIssue } from "../domain/issueService.ts";
import { loadPages, savePages } from "../domain/manifestService.ts";
import { loadLatestEntries } from "../domain/shardService.ts";
import { generateFeeds } from "../domain/feedService.ts";
import { applyIncrementalIssue, type IncrementalCoreDeps } from "./incrementalCore.ts";

export interface IncrementalDeps {
  events: EventSource;
  fs: FileStore;
  md: Markdown;
  cfg: Config;
  templates: TemplateProvider; // 指向所选主题 templates 目录
  manifest: ThemeManifest; // 主题清单
  chrome: ChromeVars; // 构建期派生的外壳片段
  feedRenderer: FeedRenderer;
  images?: ImageDownloader;
  highlighter?: Highlighter;
}

export async function runIncremental(deps: IncrementalDeps): Promise<void> {
  const { events, fs, md, cfg, templates, manifest, chrome, feedRenderer, images, highlighter } =
    deps;
  const issue = getEventIssue(events);
  const action = events.readAction();
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
  const res = await applyIncrementalIssue(issue, action, loadPages(fs), core);
  if (!res.changed) {
    console.log("[增量] 无改动 node_id=" + issue.node_id);
    return;
  }
  savePages(fs, res.pages);
  if (cfg.rss.enabled)
    generateFeeds({ manifest: loadLatestEntries(fs, cfg.rss.count), fs, cfg, feedRenderer });
}

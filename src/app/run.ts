// 单一编排入口: decideStrategy 自动选策略 (纯函数), run 装配后分派到 full/incremental/incrementalLocal/reassemble.
import type {
  ChromeVars,
  Config,
  EventSource,
  FeedRenderer,
  FileStore,
  GitHubApi,
  Highlighter,
  ImageDownloader,
  LocalPost,
  Markdown,
  TemplateProvider,
  ThemeManifest,
} from "../domain/types.ts";
import { runFull } from "./runFull.ts";
import { runIncremental } from "./runIncremental.ts";
import { runIncrementalLocal } from "./runIncrementalLocal.ts";
import { runReassemble } from "./runReassemble.ts";

export type Strategy = "full" | "incremental" | "incrementalLocal" | "reassemble";

// decideStrategy 的纯输入 (由装配层预算: changedPaths 用 git diff before..after 算出).
export interface StrategyEnv {
  hasIssuePayload: boolean; // 是否有 issue 事件载荷
  eventPayloadOk: boolean; // 事件载荷是否可解析; false 时 fail closed
  hasManifest: boolean; // 站点是否已构建 (哨兵: data/years.json 存在)
  changedPaths: string[]; // 本次 push 改动路径 (仓库相对)
  changedPathsOk: boolean; // git diff 是否可靠; false 时 fail closed
  changedPathsError?: string; // diff 失败原因, 仅用于日志/诊断
  forceFull: boolean; // 显式 --full
  contentDir?: string; // 本地内容根目录 (装配层从 cfg 注入; 缺省 "content"), 用于识别本地 md 改动
}

// 路径是否在某目录下 (dir 形如 "src"): 命中 "src/x" 或恰为 "src".
function isUnder(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir + "/");
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function configPathEffect(p: string): "full" | "reassemble" | null {
  if (!isUnder(p, "config")) return null;
  if (p === "config/appearance.json" || p === "config/comments.json") return "reassemble";
  if (
    p === "config/build.json" ||
    p === "config/site.json" ||
    p === "config/feed.json" ||
    p === "config/content.json"
  )
    return "full";
  return "full";
}

/**
 * 自动选构建策略 (纯函数).
 * 优先级:
 *   1. forceFull | 无 manifest                                    -> full
 *   2. 有 issue 载荷                                               -> incremental
 *   3. 事件载荷或 diff 失败且无 issue payload                       -> full
 *   4. changedPaths 含 src/scripts/关键配置/内容非 md              -> full
 *   5. changedPaths 含 <contentDir>/ 且同时含 themes/config       -> full (保险, 两者都要)
 *   6. changedPaths 含 <contentDir>/ 下 .md (已排除 full 条件)     -> incrementalLocal
 *   7. changedPaths 仅含 themes/appearance/comments                -> reassemble
 *   7. 兜底 (含 manifest)                                         -> reassemble
 * issue 事件 (webhook) 与本地 md 改动 (push) 由触发源天然互斥, 故 2 与 5 不冲突.
 */
export function decideStrategy(env: StrategyEnv): Strategy {
  if (env.forceFull || !env.hasManifest) return "full";
  if (env.hasIssuePayload) return "incremental";
  if (!env.eventPayloadOk) return "full";
  if (env.changedPathsOk === false) return "full";
  const paths = (env.changedPaths ?? []).map(normPath);
  const contentDir = env.contentDir ?? "content";
  if (paths.some((p) => isUnder(p, "src") || isUnder(p, "scripts"))) return "full";
  if (paths.some((p) => configPathEffect(p) === "full")) return "full";
  const hasContentDir = paths.some((p) => isUnder(p, contentDir));
  const hasThemesOrConfig = paths.some((p) => isUnder(p, "themes") || configPathEffect(p) !== null);
  // 4. 内容与渲染外壳同改 -> full (保险).
  if (hasContentDir && hasThemesOrConfig) return "full";
  if (paths.some((p) => isUnder(p, contentDir) && !/\.md$/i.test(p))) return "full";
  // 5. 仅内容目录下 .md 改动 (至此已排除 src/scripts/themes/config) -> 本地增量.
  if (paths.some((p) => isUnder(p, contentDir) && /\.md$/i.test(p))) return "incrementalLocal";
  // 6. 仅 themes/appearance/comments -> reassemble.
  if (
    paths.length > 0 &&
    paths.every((p) => isUnder(p, "themes") || configPathEffect(p) === "reassemble")
  )
    return "reassemble";
  return "reassemble";
}

export interface RunDeps {
  env: StrategyEnv;
  fs: FileStore;
  md: Markdown;
  cfg: Config;
  templates: TemplateProvider;
  manifest: ThemeManifest;
  chrome: ChromeVars;
  assetsDir: string;
  feedRenderer: FeedRenderer;
  highlighter?: Highlighter;
  images?: ImageDownloader;
  // full 专属 (装配层按策略惰性构造, reassemble 无需 token)
  api?: GitHubApi;
  repo?: string;
  // incremental 专属
  events?: EventSource;
  // 本地 md 双源 (装配层注入): full 用 localPosts; incrementalLocal 用 localChanges; 二者共用 localImageReader.
  localPosts?: LocalPost[];
  localChanges?: { upserts: LocalPost[]; removes: string[] };
  localImageReader?: (baseDir: string) => ImageDownloader;
}

// 编排: 自动选策略并分派. 返回所选策略 (便于装配层日志/CSS 步骤).
export async function run(deps: RunDeps): Promise<Strategy> {
  const strategy = decideStrategy(deps.env);
  console.log("[build] 自动策略 = " + strategy);
  if (strategy === "full") {
    if (!deps.api || !deps.repo) throw new Error("full 策略缺少 api/repo 装配");
    await runFull({
      api: deps.api,
      fs: deps.fs,
      md: deps.md,
      cfg: deps.cfg,
      repo: deps.repo,
      templates: deps.templates,
      manifest: deps.manifest,
      chrome: deps.chrome,
      assetsDir: deps.assetsDir,
      feedRenderer: deps.feedRenderer,
      images: deps.images,
      highlighter: deps.highlighter,
      localPosts: deps.localPosts,
      localImageReader: deps.localImageReader,
    });
  } else if (strategy === "incremental") {
    if (!deps.events) throw new Error("incremental 策略缺少 events 装配");
    if (!deps.repo) throw new Error("incremental 策略缺少 repo 装配");
    await runIncremental({
      events: deps.events,
      fs: deps.fs,
      md: deps.md,
      cfg: deps.cfg,
      repo: deps.repo,
      templates: deps.templates,
      manifest: deps.manifest,
      chrome: deps.chrome,
      feedRenderer: deps.feedRenderer,
      images: deps.images,
      highlighter: deps.highlighter,
    });
  } else if (strategy === "incrementalLocal") {
    if (!deps.localChanges) throw new Error("incrementalLocal 策略缺少 localChanges 装配");
    await runIncrementalLocal({
      localChanges: deps.localChanges,
      fs: deps.fs,
      md: deps.md,
      cfg: deps.cfg,
      templates: deps.templates,
      manifest: deps.manifest,
      chrome: deps.chrome,
      feedRenderer: deps.feedRenderer,
      images: deps.images,
      highlighter: deps.highlighter,
      localImageReader: deps.localImageReader,
    });
  } else {
    await runReassemble({
      fs: deps.fs,
      cfg: deps.cfg,
      templates: deps.templates,
      manifest: deps.manifest,
      chrome: deps.chrome,
      assetsDir: deps.assetsDir,
    });
  }
  return strategy;
}

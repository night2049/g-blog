// 发布状态机: 按 issue 目标态与 manifest 现状 diff, 幂等, 与事件类型无关.
import type {
  Action,
  Config,
  Manifest,
  Markdown,
  PageAction,
  PageManifest,
  RawIssue,
} from "./types.ts";
import { isPublished, issueToPage, issueToPost, postUrl } from "./postService.ts";

export function decideAction(
  issue: RawIssue,
  manifest: Manifest,
  cfg: Config,
  md: Markdown,
): Action {
  const url = postUrl(issue.node_id, cfg.build.postDir);
  const desired = isPublished(issue, cfg.build.publishedLabel);
  const current = manifest.some((e) => e.url === url);

  if (desired) {
    // 上线或更新: 都需渲染, current 仅决定语义标签
    return {
      type: current ? "update" : "publish",
      post: issueToPost(issue, cfg, md),
    };
  }
  if (current) {
    return { type: "unpublish", url };
  }
  return { type: "ignore" };
}

// 独立页状态机: 与文章并行, 以 nodeId 为主键; url 由 meta.url 解析.
export function decidePageAction(
  issue: RawIssue,
  pages: PageManifest,
  cfg: Config,
  md: Markdown,
): PageAction {
  const published = isPublished(issue, cfg.build.publishedLabel);
  const doc = issueToPage(issue, cfg, md);
  const existing = pages.find((p) => p.nodeId === issue.node_id);

  if (published && doc) {
    // url 唯一性: 被其它 nodeId 占用则冲突, 不覆盖.
    const taken = pages.some(
      (p) => p.url === doc.url && p.nodeId !== issue.node_id,
    );
    if (taken) {
      console.log(
        "[独立页] url 冲突, 已被其它页占用, 忽略: " + doc.url,
      );
      return { type: "ignore" };
    }
    return {
      type: existing ? "update" : "publish",
      page: doc,
      staleUrl: existing && existing.url !== doc.url ? existing.url : undefined,
    };
  }

  if (published && !doc) {
    // url 非法/保留名: 有旧页则下线, 否则忽略.
    console.log("[独立页] meta.url 非法或为保留名, node_id=" + issue.node_id);
    if (existing) return { type: "unpublish", url: existing.url };
    return { type: "ignore" };
  }

  if (existing) return { type: "unpublish", url: existing.url };
  return { type: "ignore" };
}

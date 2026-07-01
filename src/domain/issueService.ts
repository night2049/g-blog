// Issue 查询层: 组合底层接口为领域查询.
import type { EventSource, GitHubApi, RawIssue } from "./types.ts";

// 增量: 从事件源取单篇.
export function getEventIssue(events: EventSource): RawIssue {
  return events.readIssue();
}

// 全量: 取全部 open + publishedLabel 文章.
export function listPublishedIssues(
  api: GitHubApi,
  repo: string,
  publishedLabel: string,
): Promise<RawIssue[]> {
  return api.listIssues(repo, { state: "open", labels: publishedLabel });
}

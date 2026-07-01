// GitHub REST 适配器: fetch + Bearer + 分页, 过滤 pull_request. 无业务判断.
import type { GitHubApi, RawIssue } from "../domain/types.ts";
import { mapIssue } from "./eventPayload.ts";

export function createGitHubApi(
  token: string,
  fetchImpl: typeof fetch = fetch,
): GitHubApi {
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gblog-builder",
  };
  return {
    async listIssues(repo, opts): Promise<RawIssue[]> {
      const out: RawIssue[] = [];
      let page = 1;
      for (;;) {
        const url =
          "https://api.github.com/repos/" +
          repo +
          "/issues?state=" +
          opts.state +
          "&labels=" +
          encodeURIComponent(opts.labels) +
          "&per_page=100&page=" +
          page;
        const res = await fetchImpl(url, { headers });
        if (!res.ok)
          throw new Error("GitHub 列表请求失败 " + res.status + ": " + url);
        const items: any[] = await res.json();
        if (items.length === 0) break;
        for (const it of items) {
          if (it.pull_request) continue;
          out.push(mapIssue(it));
        }
        if (items.length < 100) break;
        page += 1;
      }
      return out;
    },
    async getIssueByNumber(repo, num): Promise<RawIssue> {
      const url = "https://api.github.com/repos/" + repo + "/issues/" + num;
      const res = await fetchImpl(url, { headers });
      if (!res.ok)
        throw new Error("GitHub 单项请求失败 " + res.status + ": " + url);
      return mapIssue(await res.json());
    },
  };
}

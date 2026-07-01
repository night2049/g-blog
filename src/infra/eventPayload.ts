// 读取 GitHub Actions 事件文件 (GITHUB_EVENT_PATH), 取出 issue 并映射为 RawIssue.
import { readFileSync } from "node:fs";
import type { EventSource, RawIssue } from "../domain/types.ts";

export function createEventSource(eventPath: string): EventSource {
  const payload = JSON.parse(readFileSync(eventPath, "utf8"));
  return {
    readIssue(): RawIssue {
      if (!payload.issue)
        throw new Error("事件 payload 缺少 issue 字段: " + eventPath);
      return mapIssue(payload.issue);
    },
    readAction(): string | null {
      return typeof payload.action === "string" ? payload.action : null;
    },
  };
}

// 把 GitHub 原始 issue JSON 映射为 RawIssue (只取所需字段). githubApi 复用.
export function mapIssue(issue: any): RawIssue {
  return {
    node_id: issue.node_id,
    number: issue.number,
    title: issue.title ?? "",
    body: issue.body ?? null,
    state: issue.state === "closed" ? "closed" : "open",
    labels: Array.isArray(issue.labels)
      ? issue.labels.map((l: any) => ({
          name: typeof l === "string" ? l : l.name,
        }))
      : [],
    created_at: issue.created_at,
    updated_at: issue.updated_at,
  };
}

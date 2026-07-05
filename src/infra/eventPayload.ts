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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(label + " 必须为对象");
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") throw new Error("GitHub issue 字段 " + key + " 必须为字符串");
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number") throw new Error("GitHub issue 字段 " + key + " 必须为数字");
  return value;
}

function mapLabels(labels: unknown): { name: string }[] {
  if (!Array.isArray(labels)) return [];
  const out: { name: string }[] = [];
  for (const label of labels) {
    if (typeof label === "string") {
      out.push({ name: label });
      continue;
    }
    if (label && typeof label === "object" && !Array.isArray(label)) {
      const name = (label as Record<string, unknown>).name;
      if (typeof name === "string") out.push({ name });
    }
  }
  return out;
}

// 把 GitHub 原始 issue JSON 映射为 RawIssue (只取所需字段). githubApi 复用.
export function mapIssue(issue: unknown): RawIssue {
  const raw = asRecord(issue, "GitHub issue");
  const body = raw.body;
  return {
    node_id: requireString(raw, "node_id"),
    number: requireNumber(raw, "number"),
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof body === "string" || body === null ? body : null,
    state: raw.state === "closed" ? "closed" : "open",
    labels: mapLabels(raw.labels),
    created_at: requireString(raw, "created_at"),
    updated_at: requireString(raw, "updated_at"),
  };
}

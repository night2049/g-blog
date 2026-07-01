import { test, expect } from "bun:test";
import {
  getEventIssue,
  listPublishedIssues,
} from "../src/domain/issueService.ts";
import { fakeEventSource, fakeGitHubApi, makeIssue } from "./fakes.ts";

test("getEventIssue 返回事件 issue", () => {
  expect(
    getEventIssue(fakeEventSource(makeIssue({ node_id: "I_evt" }))).node_id,
  ).toBe("I_evt");
});

test("listPublishedIssues 透传 api 结果", async () => {
  const issues = [
    makeIssue({ number: 1 }),
    makeIssue({ number: 2, node_id: "I_test002" }),
  ];
  const r = await listPublishedIssues(
    fakeGitHubApi(issues),
    "owner/repo",
    "published",
  );
  expect(r.length).toBe(2);
});

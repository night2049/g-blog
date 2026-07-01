import { test, expect } from "bun:test";
import { createGitHubApi } from "../../src/infra/githubApi.ts";

function jsonRes(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

test("listIssues 过滤 pull_request 并映射", async () => {
  const fakeFetch = (async () =>
    jsonRes([
      {
        node_id: "I_1",
        number: 1,
        title: "a",
        body: "",
        state: "open",
        labels: [],
        created_at: "c",
        updated_at: "u",
      },
      {
        node_id: "PR_1",
        number: 2,
        title: "pr",
        state: "open",
        labels: [],
        created_at: "c",
        updated_at: "u",
        pull_request: {},
      },
    ])) as unknown as typeof fetch;
  const r = await createGitHubApi("token", fakeFetch).listIssues("owner/repo", {
    state: "open",
    labels: "published",
  });
  expect(r.length).toBe(1);
  expect(r[0].node_id).toBe("I_1");
});

test("listIssues 分页合并两页", async () => {
  const page1 = Array.from({ length: 100 }, (_v, i) => ({
    node_id: "I_" + i,
    number: i,
    title: "t",
    body: "",
    state: "open",
    labels: [],
    created_at: "c",
    updated_at: "u",
  }));
  const page2 = [
    {
      node_id: "I_x",
      number: 999,
      title: "t",
      body: "",
      state: "open",
      labels: [],
      created_at: "c",
      updated_at: "u",
    },
  ];
  let call = 0;
  const fakeFetch = (async () =>
    jsonRes(call++ === 0 ? page1 : page2)) as unknown as typeof fetch;
  const r = await createGitHubApi("token", fakeFetch).listIssues("owner/repo", {
    state: "open",
    labels: "published",
  });
  expect(r.length).toBe(101);
});

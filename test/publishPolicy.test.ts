import { test, expect, describe } from "bun:test";
import { decideAction, decidePageAction } from "../src/domain/publishPolicy.ts";
import { fakeMarkdown, fixtureConfig, makeIssue } from "./fakes.ts";
import type { Manifest } from "../src/domain/types.ts";

const cfg = fixtureConfig();
const md = fakeMarkdown();
const url = "post/I_test001.html";
const present: Manifest = [{ url, title: "t", date: "2026-01-01" }];
const absent: Manifest = [];

describe("decideAction 状态机", () => {
  test("open+published, 不在 manifest -> publish", () => {
    const a = decideAction(
      makeIssue({ state: "open", labels: [{ name: "published" }] }),
      absent,
      cfg,
      md,
    );
    expect(a.type).toBe("publish");
    expect(a.post?.url).toBe(url);
  });
  test("open+published, 在 manifest -> update", () => {
    expect(
      decideAction(
        makeIssue({ state: "open", labels: [{ name: "published" }] }),
        present,
        cfg,
        md,
      ).type,
    ).toBe("update");
  });
  test("open 无 label, 在 manifest -> unpublish", () => {
    const a = decideAction(
      makeIssue({ state: "open", labels: [] }),
      present,
      cfg,
      md,
    );
    expect(a.type).toBe("unpublish");
    expect(a.url).toBe(url);
  });
  test("closed, 在 manifest -> unpublish", () => {
    expect(
      decideAction(
        makeIssue({ state: "closed", labels: [{ name: "published" }] }),
        present,
        cfg,
        md,
      ).type,
    ).toBe("unpublish");
  });
  test("open 无 label, 不在 manifest -> ignore", () => {
    expect(
      decideAction(makeIssue({ state: "open", labels: [] }), absent, cfg, md)
        .type,
    ).toBe("ignore");
  });
  test("closed, 不在 manifest -> ignore", () => {
    expect(
      decideAction(makeIssue({ state: "closed", labels: [] }), absent, cfg, md)
        .type,
    ).toBe("ignore");
  });
});

describe("幂等", () => {
  test("publish 后用新 manifest 再 decide -> update", () => {
    const issue = makeIssue({ state: "open", labels: [{ name: "published" }] });
    const a1 = decideAction(issue, absent, cfg, md);
    const m2: Manifest = [
      { url: a1.post!.url, title: a1.post!.title, date: a1.post!.date },
    ];
    expect(decideAction(issue, m2, cfg, md).type).toBe("update");
  });
  test("unpublish 后再 decide -> ignore", () => {
    expect(
      decideAction(makeIssue({ state: "closed", labels: [] }), absent, cfg, md)
        .type,
    ).toBe("ignore");
  });
});

describe("decidePageAction", () => {
  const pubPage = (over = {}) =>
    makeIssue({
      node_id: "I_p",
      state: "open",
      labels: [{ name: "published" }, { name: "page" }],
      body: "<!-- meta\nurl: about\n-->\n正文",
      ...over,
    });
  const existingAbout = [{ nodeId: "I_p", url: "about.html", title: "旧" }];

  test("published + 合法 url + 无 existing -> publish", () => {
    const a = decidePageAction(pubPage(), [], cfg, md);
    expect(a.type).toBe("publish");
    expect(a.page?.url).toBe("about.html");
  });
  test("url 被其它 nodeId 占用 -> ignore", () => {
    const a = decidePageAction(pubPage(), [{ nodeId: "I_other", url: "about.html", title: "x" }], cfg, md);
    expect(a.type).toBe("ignore");
  });
  test("有 existing 同 url -> update, 无 staleUrl", () => {
    const a = decidePageAction(pubPage(), existingAbout, cfg, md);
    expect(a.type).toBe("update");
    expect(a.staleUrl).toBeUndefined();
  });
  test("url 变更 -> update + staleUrl=旧 url", () => {
    const a = decidePageAction(
      pubPage({ body: "<!-- meta\nurl: me\n-->\nx" }),
      existingAbout,
      cfg,
      md,
    );
    expect(a.type).toBe("update");
    expect(a.page?.url).toBe("me.html");
    expect(a.staleUrl).toBe("about.html");
  });
  test("url 非法 + 有 existing -> unpublish", () => {
    const a = decidePageAction(pubPage({ body: "无 meta" }), existingAbout, cfg, md);
    expect(a.type).toBe("unpublish");
    expect(a.url).toBe("about.html");
  });
  test("url 非法 + 无 existing -> ignore", () => {
    expect(decidePageAction(pubPage({ body: "无 meta" }), [], cfg, md).type).toBe("ignore");
  });
  test("未 published + 有 existing -> unpublish", () => {
    const a = decidePageAction(pubPage({ state: "closed" }), existingAbout, cfg, md);
    expect(a.type).toBe("unpublish");
    expect(a.url).toBe("about.html");
  });
  test("未 published + 无 existing -> ignore", () => {
    expect(decidePageAction(pubPage({ state: "closed" }), [], cfg, md).type).toBe("ignore");
  });
});

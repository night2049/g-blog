import { test, expect, describe } from "bun:test";
import { runIncremental } from "../src/app/runIncremental.ts";
import {
  memFileStore,
  fakeEventSource,
  fakeMarkdown,
  fakeImageDownloader,
  fakeFeedRenderer,
  fakeThemeProvider,
  fakeThemeManifest,
  fakeChrome,
  fixtureConfig,
  makeIssue,
} from "./fakes.ts";
import type { FileStore, RawIssue } from "../src/domain/types.ts";

const templates = fakeThemeProvider();
const manifest = fakeThemeManifest();
const chrome = fakeChrome();
const md = fakeMarkdown();
const cfg = fixtureConfig();

const run = (issue: RawIssue, fs: FileStore, action: string | null = null) =>
  runIncremental({
    events: fakeEventSource(issue, action),
    fs,
    md,
    cfg,
    templates,
    manifest,
    chrome,
    feedRenderer: fakeFeedRenderer(),
  });

// 预置一篇已存在文章到时间线分片 (替代旧 posts.json 种子).
function seedArticle(
  fs: FileStore,
  nodeId: string,
  over: { title?: string; date?: string; tags?: string[]; dirs?: string[] } = {},
): void {
  const entry = {
    url: "post/" + nodeId + ".html",
    title: over.title ?? "甲",
    date: over.date ?? "2026-01-01T00:00:00.000Z",
    tags: over.tags ?? [],
    dirs: over.dirs ?? [],
  };
  const year = entry.date.slice(0, 4);
  fs.write("post/" + nodeId + ".html", "old");
  fs.write("data/years.json", JSON.stringify([{ year, count: 1 }]));
  fs.write("data/year/" + year + ".json", JSON.stringify([entry]));
}

describe("文章流程(回归)", () => {
  test("新发布: 生成页 + 年份分片/索引 + feed", async () => {
    const fs = memFileStore();
    await run(makeIssue({ node_id: "I_a", title: "甲", body: "正文" }), fs);
    const d = fs.dump();
    expect(d["post/I_a.html"]).toContain("甲");
    expect(JSON.parse(d["data/years.json"]!)[0].count).toBe(1);
    expect(JSON.parse(d["data/year/2026.json"]!).length).toBe(1);
    expect("feed.xml" in d).toBe(true);
    // 不再产出聚合 posts.json
    expect("posts.json" in d).toBe(false);
  });
  test("更新: 页内容与年份分片条目更新", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_a", { title: "旧" });
    await run(makeIssue({ node_id: "I_a", title: "新标题", body: "x" }), fs);
    const shard = JSON.parse(fs.dump()["data/year/2026.json"]!);
    expect(shard.length).toBe(1);
    expect(shard[0].title).toBe("新标题");
  });
  test("草稿: 不产页, 不写分片", async () => {
    const fs = memFileStore();
    await run(makeIssue({ node_id: "I_a", state: "open", labels: [] }), fs);
    expect("post/I_a.html" in fs.dump()).toBe(false);
    expect("data/years.json" in fs.dump()).toBe(false);
  });
  test("下线(移除标签): 删页 + 移出分片 (空分片删除, 索引清零)", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_a");
    await run(makeIssue({ node_id: "I_a", state: "open", labels: [] }), fs);
    const d = fs.dump();
    expect("post/I_a.html" in d).toBe(false);
    expect("data/year/2026.json" in d).toBe(false); // 空分片删除
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
  });
});

describe("移除(删除或关闭)", () => {
  test("关闭: 删文章页 + 移出分片", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_a");
    await run(makeIssue({ node_id: "I_a", state: "closed", labels: [{ name: "published" }] }), fs);
    const d = fs.dump();
    expect("post/I_a.html" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
  });
  test("删除事件: state 仍 open 也移除文章", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_a");
    await run(
      makeIssue({ node_id: "I_a", state: "open", labels: [{ name: "published" }] }),
      fs,
      "deleted",
    );
    const d = fs.dump();
    expect("post/I_a.html" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
  });
  test("删除事件: 移除独立页", async () => {
    const fs = memFileStore({
      "about.html": "old",
      "pages.json": JSON.stringify([{ nodeId: "I_p", url: "about.html", title: "关于" }]),
    });
    await run(
      makeIssue({ node_id: "I_p", state: "open", labels: [{ name: "published" }, { name: "page" }], body: "<!-- meta\nurl: about\n-->\nx" }),
      fs,
      "deleted",
    );
    expect("about.html" in fs.dump()).toBe(false);
    expect(JSON.parse(fs.dump()["pages.json"]!).length).toBe(0);
  });
});

describe("重新打开", () => {
  test("reopened + published -> 重新发布", async () => {
    const fs = memFileStore();
    await run(
      makeIssue({ node_id: "I_a", title: "回归", body: "x", state: "open", labels: [{ name: "published" }] }),
      fs,
      "reopened",
    );
    expect(fs.dump()["post/I_a.html"]).toContain("回归");
    expect(JSON.parse(fs.dump()["data/years.json"]!)[0].count).toBe(1);
  });
});

describe("增量分片维护", () => {
  test("改标签: 只写涉及的标签分片, 索引更新", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_a", { tags: ["旧标签"] });
    // 旧标签分片预置.
    fs.write(
      "data/tag/" + encodeURIComponent("旧标签") + ".json",
      JSON.stringify([{ url: "post/I_a.html", title: "甲", date: "2026-01-01T00:00:00.000Z" }]),
    );
    fs.write("data/tags.json", JSON.stringify([{ name: "旧标签", slug: encodeURIComponent("旧标签"), count: 1 }]));
    await run(
      makeIssue({ node_id: "I_a", title: "甲", labels: [{ name: "published" }, { name: "新标签" }], body: "x" }),
      fs,
    );
    const d = fs.dump();
    // 旧标签分片清空删除, 新标签分片生成.
    expect("data/tag/" + encodeURIComponent("旧标签") + ".json" in d).toBe(false);
    expect("data/tag/" + encodeURIComponent("新标签") + ".json" in d).toBe(true);
    const tagsIdx = JSON.parse(d["data/tags.json"]!);
    expect(tagsIdx.map((t: any) => t.name)).toEqual(["新标签"]);
  });

  test("跨年改动: 旧年份分片移除, 新年份分片插入", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_a", { date: "2024-03-03T00:00:00.000Z" }); // 旧年 2024
    // 新 date 2026 (meta).
    await run(
      makeIssue({
        node_id: "I_a",
        title: "甲",
        labels: [{ name: "published" }],
        body: "<!-- meta\ndate: 2026-07-07\n-->\nx",
      }),
      fs,
    );
    const d = fs.dump();
    expect("data/year/2024.json" in d).toBe(false); // 旧年空 -> 删除
    expect(JSON.parse(d["data/year/2026.json"]!)[0].url).toBe("post/I_a.html");
    const years = JSON.parse(d["data/years.json"]!);
    expect(years).toEqual([{ year: "2026", count: 1 }]);
  });
});

describe("独立页流程", () => {
  const pageIssue = (over = {}) =>
    makeIssue({
      node_id: "I_p",
      title: "关于",
      labels: [{ name: "published" }, { name: "page" }],
      body: "<!-- meta\nurl: about\n-->\n正文",
      ...over,
    });

  test("首次发布: 写 route 文件 + pages.json 新增, 不进时间线分片", async () => {
    const fs = memFileStore();
    await run(pageIssue(), fs);
    const d = fs.dump();
    expect(d["about.html"]).toContain("关于");
    expect(JSON.parse(d["pages.json"]!)).toEqual([{ nodeId: "I_p", url: "about.html", title: "关于" }]);
    expect("data/years.json" in d).toBe(false);
  });
  test("更新 url(路由变更): 写新文件 + 删旧文件", async () => {
    const fs = memFileStore({
      "about.html": "old",
      "pages.json": JSON.stringify([{ nodeId: "I_p", url: "about.html", title: "关于" }]),
    });
    await run(pageIssue({ body: "<!-- meta\nurl: me\n-->\n新正文" }), fs);
    const d = fs.dump();
    expect("about.html" in d).toBe(false);
    expect(d["me.html"]).toContain("关于");
    expect(JSON.parse(d["pages.json"]!)[0].url).toBe("me.html");
  });
  test("取消 published: 删文件 + pages.json 移除", async () => {
    const fs = memFileStore({
      "about.html": "old",
      "pages.json": JSON.stringify([{ nodeId: "I_p", url: "about.html", title: "关于" }]),
    });
    await run(pageIssue({ labels: [{ name: "page" }] }), fs);
    expect("about.html" in fs.dump()).toBe(false);
    expect(JSON.parse(fs.dump()["pages.json"]!).length).toBe(0);
  });
});

describe("跨类型迁移", () => {
  test("文章加 page label: 移出分片 + 删 <postDir>/node.html, 转入 pages", async () => {
    const fs = memFileStore();
    seedArticle(fs, "I_x", { title: "原文章" });
    await run(
      makeIssue({ node_id: "I_x", title: "转页", labels: [{ name: "published" }, { name: "page" }], body: "<!-- meta\nurl: x\n-->\nx" }),
      fs,
    );
    const d = fs.dump();
    expect("post/I_x.html" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0); // 移出时间线
    expect(d["x.html"]).toContain("转页");
    expect(JSON.parse(d["pages.json"]!)[0].nodeId).toBe("I_x");
  });
  test("独立页去掉 page label: 反向迁移到文章", async () => {
    const fs = memFileStore({
      "about.html": "old page",
      "pages.json": JSON.stringify([{ nodeId: "I_p", url: "about.html", title: "关于" }]),
    });
    await run(
      makeIssue({ node_id: "I_p", title: "变文章", labels: [{ name: "published" }], body: "正文" }),
      fs,
    );
    const d = fs.dump();
    expect("about.html" in d).toBe(false);
    expect(JSON.parse(d["pages.json"]!).length).toBe(0);
    expect(d["post/I_p.html"]).toContain("变文章");
    expect(JSON.parse(d["data/year/2026.json"]!)[0].url).toBe("post/I_p.html");
  });
});

describe("feed 开关", () => {
  test("rss.enabled=false: 任何改动都不生成 feed (仍写分片)", async () => {
    const cfg2 = fixtureConfig();
    cfg2.rss.enabled = false;
    const fs = memFileStore();
    await runIncremental({
      events: fakeEventSource(makeIssue({ node_id: "I_a", body: "x" }), null),
      fs,
      md,
      cfg: cfg2,
      templates,
      manifest,
      chrome,
      feedRenderer: fakeFeedRenderer(),
    });
    expect("feed.xml" in fs.dump()).toBe(false);
    expect("data/years.json" in fs.dump()).toBe(true);
  });
});

test("发布含远程图: 下载改写为本地路径并写入字节", async () => {
  const fs = memFileStore();
  const u = "https://x/p.png";
  await runIncremental({
    events: fakeEventSource(makeIssue({ node_id: "I_img", body: `<img src="${u}">` }), null),
    fs,
    md,
    cfg,
    templates,
    manifest,
    chrome,
    feedRenderer: fakeFeedRenderer(),
    images: fakeImageDownloader({ [u]: { bytes: new Uint8Array([7, 7, 7]), ext: "png" } }),
  });
  const d = fs.dump();
  expect(d["post/I_img.html"]).not.toContain(u);
  // 图片落各自 nodeId 文件夹, src 相对文章页为 <nodeId>/<hash>.<ext>
  expect(d["post/I_img.html"]).toContain("I_img/");
  expect(d["post/I_img.html"]).not.toContain("assets/img/");
  const byteKeys = Object.keys(fs.dumpBytes());
  expect(byteKeys.length).toBe(1);
  expect(byteKeys[0].startsWith("post/I_img/")).toBe(true);
});

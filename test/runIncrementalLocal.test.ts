import { test, expect, describe } from "bun:test";
import { runIncrementalLocal } from "../src/app/runIncrementalLocal.ts";
import { hashLocalImage } from "../src/domain/imageService.ts";
import {
  memFileStore,
  fakeMarkdown,
  fakeFeedRenderer,
  fakeThemeProvider,
  fakeThemeManifest,
  fakeChrome,
  fixtureConfig,
  makeIssue,
} from "./fakes.ts";
import type { FileStore, ImageDownloader, LocalPost, RawIssue } from "../src/domain/types.ts";

const templates = fakeThemeProvider();
const manifest = fakeThemeManifest();
const chrome = fakeChrome();
const md = fakeMarkdown();
const cfg = fixtureConfig();

// 构造 LocalPost (合成 RawIssue + fileDir).
function lp(issue: RawIssue, fileDir = "/fake/content/posts"): LocalPost {
  return { issue, fileDir };
}

function run(
  fs: FileStore,
  localChanges: { upserts: LocalPost[]; removes: string[] },
  localImageReader?: (baseDir: string) => ImageDownloader,
) {
  return runIncrementalLocal({
    localChanges,
    fs,
    md,
    cfg,
    templates,
    manifest,
    chrome,
    feedRenderer: fakeFeedRenderer(),
    localImageReader,
  });
}

// 预置一篇已存在文章到时间线分片.
function seedArticle(fs: FileStore, nodeId: string, over: { title?: string; date?: string } = {}): void {
  const entry = {
    url: "post/" + nodeId + ".html",
    title: over.title ?? "旧",
    date: over.date ?? "2026-01-01T00:00:00.000Z",
    tags: [],
    dirs: [],
  };
  const year = entry.date.slice(0, 4);
  fs.write("post/" + nodeId + ".html", "old");
  fs.write("data/years.json", JSON.stringify([{ year, count: 1 }]));
  fs.write("data/year/" + year + ".json", JSON.stringify([entry]));
}

describe("runIncrementalLocal 文章", () => {
  test("新发布: 生成页 + 年份分片 + feed", async () => {
    const fs = memFileStore();
    const issue = makeIssue({ node_id: "abc", title: "本地甲", labels: [{ name: "published" }], body: "正文" });
    await run(fs, { upserts: [lp(issue)], removes: [] });
    const d = fs.dump();
    expect(d["post/abc.html"]).toContain("本地甲");
    expect(JSON.parse(d["data/years.json"]!)[0].count).toBe(1);
    expect("feed.xml" in d).toBe(true);
  });

  test("更新: 已有文章内容/分片更新", async () => {
    const fs = memFileStore();
    seedArticle(fs, "abc", { title: "旧" });
    const issue = makeIssue({ node_id: "abc", title: "新标题", labels: [{ name: "published" }], body: "x" });
    await run(fs, { upserts: [lp(issue)], removes: [] });
    const shard = JSON.parse(fs.dump()["data/year/2026.json"]!);
    expect(shard[0].title).toBe("新标题");
  });

  test("草稿下线 (无 publishedLabel): 删页 + 移出分片", async () => {
    const fs = memFileStore();
    seedArticle(fs, "abc");
    // 草稿: mapToRawIssue 会不加 publishedLabel; 这里直接构造 labels 为空模拟.
    const issue = makeIssue({ node_id: "abc", labels: [], state: "open" });
    await run(fs, { upserts: [lp(issue)], removes: [] });
    const d = fs.dump();
    expect("post/abc.html" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
  });

  test("删除文件 (removes): 凭 node_id 删页 + 移出分片", async () => {
    const fs = memFileStore();
    seedArticle(fs, "abc");
    await run(fs, { upserts: [], removes: ["abc"] });
    const d = fs.dump();
    expect("post/abc.html" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
  });

  test("无改动 (草稿且未发布过): 不写 pages/feed", async () => {
    const fs = memFileStore();
    const issue = makeIssue({ node_id: "abc", labels: [], state: "open" });
    await run(fs, { upserts: [lp(issue)], removes: [] });
    expect("feed.xml" in fs.dump()).toBe(false);
    expect("pages.json" in fs.dump()).toBe(false);
  });
});

describe("runIncrementalLocal 独立页", () => {
  test("首次发布: 写 route + pages.json", async () => {
    const fs = memFileStore();
    const issue = makeIssue({
      node_id: "def",
      title: "本地关于",
      labels: [{ name: "published" }, { name: "page" }],
      body: "<!-- meta\nurl: localabout\n-->\n正文",
    });
    await run(fs, { upserts: [lp(issue, "/fake/content/pages")], removes: [] });
    const d = fs.dump();
    expect(d["localabout.html"]).toContain("本地关于");
    expect(JSON.parse(d["pages.json"]!)[0].url).toBe("localabout.html");
  });

  test("删除文件: 移除独立页", async () => {
    const fs = memFileStore({
      "localabout.html": "old",
      "pages.json": JSON.stringify([{ nodeId: "def", url: "localabout.html", title: "关于" }]),
    });
    await run(fs, { upserts: [], removes: ["def"] });
    expect("localabout.html" in fs.dump()).toBe(false);
    expect(JSON.parse(fs.dump()["pages.json"]!).length).toBe(0);
  });
});

describe("runIncrementalLocal 跨类型迁移", () => {
  test("文章 -> 独立页 (加 page label): 移出分片 + 转入 pages", async () => {
    const fs = memFileStore();
    seedArticle(fs, "x1", { title: "原文章" });
    const issue = makeIssue({
      node_id: "x1",
      title: "转页",
      labels: [{ name: "published" }, { name: "page" }],
      body: "<!-- meta\nurl: turned\n-->\nx",
    });
    await run(fs, { upserts: [lp(issue, "/fake/content/pages")], removes: [] });
    const d = fs.dump();
    expect("post/x1.html" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
    expect(d["turned.html"]).toContain("转页");
    expect(JSON.parse(d["pages.json"]!)[0].nodeId).toBe("x1");
  });
});

describe("runIncrementalLocal 本地图", () => {
  test("正文相对图经 reader 落盘并改写", async () => {
    const fs = memFileStore();
    const picBytes = new Uint8Array([5, 5]);
    const reader = (_dir: string): ImageDownloader => ({
      download: async (s) =>
        s === "a.png"
          ? { bytes: picBytes, ext: "png", sourceBytes: picBytes, sourceExt: "png" }
          : null,
    });
    const issue = makeIssue({
      node_id: "img1",
      title: "带图",
      labels: [{ name: "published" }],
      body: '<img src="a.png">正文',
    });
    await run(fs, { upserts: [lp(issue)], removes: [] }, reader);
    const d = fs.dump();
    const name = `${hashLocalImage(picBytes, "png", cfg.content.webp)}.png`;
    expect(d["post/img1.html"]).toContain(`img1/${name}`);
    expect(fs.dumpBytes()[`post/img1/${name}`]).toEqual(picBytes);
  });

  test("md 重建且本地图源字节变化时引用新文件名", async () => {
    const fs = memFileStore();
    const oldBytes = new Uint8Array([1, 1]);
    const newBytes = new Uint8Array([2, 2]);
    const oldName = `${hashLocalImage(oldBytes, "png", cfg.content.webp)}.png`;
    seedArticle(fs, "img2");
    fs.writeBytes(`post/img2/${oldName}`, oldBytes);
    const reader = (_dir: string): ImageDownloader => ({
      download: async (s) =>
        s === "a.png"
          ? { bytes: newBytes, ext: "png", sourceBytes: newBytes, sourceExt: "png" }
          : null,
    });
    const issue = makeIssue({
      node_id: "img2",
      title: "换图",
      labels: [{ name: "published" }],
      body: '<img src="a.png">正文',
    });
    await run(fs, { upserts: [lp(issue)], removes: [] }, reader);
    const newName = `${hashLocalImage(newBytes, "png", cfg.content.webp)}.png`;
    expect(fs.dump()["post/img2.html"]).toContain(`img2/${newName}`);
    expect(fs.dump()["post/img2.html"]).not.toContain(`img2/${oldName}`);
    expect(fs.dumpBytes()[`post/img2/${newName}`]).toEqual(newBytes);
  });
});

describe("runIncrementalLocal 批量 + feed", () => {
  test("多篇增改 + 删除混合, 一次性处理", async () => {
    const fs = memFileStore();
    seedArticle(fs, "del1");
    const a = makeIssue({ node_id: "a1", title: "甲", labels: [{ name: "published" }], body: "<!-- meta\ndate: 2026-02-01\n-->\nx" });
    const b = makeIssue({ node_id: "b1", title: "乙", labels: [{ name: "published" }], body: "<!-- meta\ndate: 2026-03-01\n-->\ny" });
    await run(fs, { upserts: [lp(a), lp(b)], removes: ["del1"] });
    const d = fs.dump();
    expect(d["post/a1.html"]).toContain("甲");
    expect(d["post/b1.html"]).toContain("乙");
    expect("post/del1.html" in d).toBe(false);
    const y = JSON.parse(d["data/year/2026.json"]!);
    expect(y.map((x: any) => x.url).sort()).toEqual(["post/a1.html", "post/b1.html"]);
    expect("feed.xml" in d).toBe(true);
  });

  test("rss.enabled=false: 不生成 feed (仍写分片)", async () => {
    const cfg2 = fixtureConfig();
    cfg2.rss.enabled = false;
    const fs = memFileStore();
    const issue = makeIssue({ node_id: "n1", labels: [{ name: "published" }], body: "x" });
    await runIncrementalLocal({
      localChanges: { upserts: [lp(issue)], removes: [] },
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

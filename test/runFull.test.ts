import { test, expect } from "bun:test";
import { runFull } from "../src/app/runFull.ts";
import {
  memFileStore,
  fakeGitHubApi,
  fakeMarkdown,
  fakeFeedRenderer,
  fakeThemeProvider,
  fakeThemeManifest,
  fakeChrome,
  fixtureConfig,
  makeIssue,
} from "./fakes.ts";

const templates = fakeThemeProvider();
const manifest = fakeThemeManifest();
const chrome = fakeChrome();

test("全量: 文章 + 独立页分流, 分片(years/year/dirs/dir)/pages/site/chrome/feed/列表外壳/主题资产", async () => {
  const issues = [
    makeIssue({
      node_id: "I_1",
      number: 1,
      title: "一",
      labels: [{ name: "published" }, { name: "dir:往事" }],
      body: "<!-- meta\ndate: 2026-01-01\n-->\na",
    }),
    makeIssue({
      node_id: "I_2",
      number: 2,
      title: "二",
      labels: [{ name: "published" }],
      body: "<!-- meta\ndate: 2026-05-01\n-->\nb",
    }),
    makeIssue({
      node_id: "I_p",
      number: 3,
      title: "关于",
      labels: [{ name: "published" }, { name: "page" }],
      body: "<!-- meta\nurl: about\n-->\n关于正文",
    }),
  ];
  const fs = memFileStore();
  const feedRenderer = fakeFeedRenderer();
  await runFull({
    api: fakeGitHubApi(issues),
    fs,
    md: fakeMarkdown(),
    cfg: fixtureConfig(),
    repo: "owner/repo",
    templates,
    manifest,
    chrome,
    assetsDir: "assets",
    feedRenderer,
  });
  const d = fs.dump();
  // 文章页 (组装, 标题在 h1, 进入 <postDir>/)
  expect(d["post/I_1.html"]).toContain("一");
  expect(d["post/I_2.html"]).toContain("二");
  // 独立页写到 meta.url 路由 (根级), 不进时间线分片
  expect(d["about.html"]).toContain("关于");
  // 不产出聚合 posts.json
  expect("posts.json" in d).toBe(false);
  // 时间线分片: years.json (年降序) + year/2026.json (date 倒序)
  expect(JSON.parse(d["data/years.json"]!)).toEqual([{ year: "2026", count: 2 }]);
  const y2026 = JSON.parse(d["data/year/2026.json"]!);
  expect(y2026.map((x: any) => x.url)).toEqual(["post/I_2.html", "post/I_1.html"]);
  expect(y2026.find((x: any) => x.url === "post/I_1.html").dirs).toEqual(["往事"]);
  // pages.json 含独立页
  expect(JSON.parse(d["pages.json"]!)).toEqual([
    { nodeId: "I_p", url: "about.html", title: "关于" },
  ]);
  // site.json 新形状
  expect(JSON.parse(d["site.json"]!)).toEqual({
    title: "测试站点",
    pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
  });
  // 目录分片索引 + 分片 (slug = encodeURIComponent(name))
  const dirsIdx = JSON.parse(d["data/dirs.json"]!);
  expect(dirsIdx[0].name).toBe("往事");
  expect(dirsIdx[0].count).toBe(1);
  const dirShard = JSON.parse(d["data/dir/" + encodeURIComponent("往事") + ".json"]!);
  expect(dirShard[0].url).toBe("post/I_1.html");
  // chrome.json (运行时外壳片段)
  const chromeData = JSON.parse(d["chrome.json"]!);
  expect(chromeData.siteTitle).toBe("测试站点");
  expect(typeof chromeData.nav).toBe("string");
  // feed 被渲染, items 为文章 (不含独立页)
  expect(feedRenderer.calls.length).toBe(1);
  expect(feedRenderer.calls[0].items.map((i) => i.title)).toEqual(["二", "一"]);
  // 列表页外壳: 组装写出 (非拷贝), 含挂载点
  expect(d["index.html"]).toContain('id="posts"');
  expect(d["archive.html"]).toContain('id="years"');
  expect(d["dir.html"]).toContain('id="map"');
  // 主题脚本资产: 拷贝写出
  expect(d["browse.js"]).toBe("COPIED");
  expect(d["app.js"]).toBe("COPIED");
  expect(d["archive.js"]).toBe("COPIED");
  expect(d["widgets.js"]).toBe("COPIED");
});

test("rss.enabled=false 不生成 feed", async () => {
  const cfg = fixtureConfig();
  cfg.rss.enabled = false;
  const fs = memFileStore();
  const feedRenderer = fakeFeedRenderer();
  await runFull({
    api: fakeGitHubApi([makeIssue({ node_id: "I_1", body: "a" })]),
    fs,
    md: fakeMarkdown(),
    cfg,
    repo: "owner/repo",
    templates,
    manifest,
    chrome,
    assetsDir: "assets",
    feedRenderer,
  });
  expect(feedRenderer.calls.length).toBe(0);
  expect("feed.xml" in fs.dump()).toBe(false);
});

test("全量前清空站点: 清除旧版孤儿产物, 保留白名单", async () => {
  const fs = memFileStore({
    ".git/config": "x",
    "CNAME": "blog.example.com",
    "I_old.html": "旧版根级文章",
    "posts.json": "[]",
    "dirs.json": "[]",
    "assets/img/old.png": "旧图",
  });
  await runFull({
    api: fakeGitHubApi([makeIssue({ node_id: "I_1", body: "a" })]),
    fs,
    md: fakeMarkdown(),
    cfg: fixtureConfig(),
    repo: "owner/repo",
    templates,
    manifest,
    chrome,
    assetsDir: "assets",
    feedRenderer: fakeFeedRenderer(),
  });
  const d = fs.dump();
  // 旧版布局孤儿产物被清除
  expect("I_old.html" in d).toBe(false);
  expect("posts.json" in d).toBe(false);
  expect("dirs.json" in d).toBe(false);
  expect("assets/img/old.png" in d).toBe(false);
  // 白名单保留
  expect(".git/config" in d).toBe(true);
  expect("CNAME" in d).toBe(true);
  // 新产物已写
  expect("data/years.json" in d).toBe(true);
  expect(d["post/I_1.html"]).toBeTruthy();
});

import type { ImageDownloader, LocalPost } from "../src/domain/types.ts";
import { hashUrl } from "../src/domain/imageService.ts";

test("双源合并: Issues + 本地 md (文章/独立页/本地相对图)", async () => {
  const issues = [
    makeIssue({
      node_id: "I_iss",
      number: 1,
      title: "Issue 文章",
      labels: [{ name: "published" }],
      body: "<!-- meta\ndate: 2026-03-01\n-->\nissue 正文",
    }),
  ];
  const localArticle: LocalPost = {
    issue: makeIssue({
      node_id: "abc",
      number: 0,
      title: "本地文章",
      labels: [{ name: "published" }, { name: "dir:随笔" }],
      body: '<!-- meta\ndate: 2026-04-01\n-->\n<img src="pic.png">本地正文',
    }),
    fileDir: "/fake/content/posts",
  };
  const localPage: LocalPost = {
    issue: makeIssue({
      node_id: "def",
      number: 0,
      title: "本地页",
      labels: [{ name: "published" }, { name: "page" }],
      body: "<!-- meta\nurl: localabout\n-->\n本地页正文",
    }),
    fileDir: "/fake/content/pages",
  };
  const picBytes = new Uint8Array([7, 7, 7]);
  // 本地图 reader 工厂: 仅识别 pic.png; 与真实 createLocalImageReader 同形 (装配层注入).
  const localImageReader = (_baseDir: string): ImageDownloader => ({
    download: async (relSrc) =>
      relSrc === "pic.png" ? { bytes: picBytes, ext: "png" } : null,
  });

  const fs = memFileStore();
  const feedRenderer = fakeFeedRenderer();
  await runFull({
    api: fakeGitHubApi(issues),
    fs,
    md: fakeMarkdown(),
    cfg: fixtureConfig(),
    repo: "owner/repo",
    templates,
    manifest,
    chrome,
    assetsDir: "assets",
    feedRenderer,
    localPosts: [localArticle, localPage],
    localImageReader,
  });
  const d = fs.dump();
  // Issue 文章与本地文章都成页
  expect(d["post/I_iss.html"]).toContain("Issue 文章");
  expect(d["post/abc.html"]).toContain("本地文章");
  // 本地独立页
  expect(d["localabout.html"]).toContain("本地页");
  expect(JSON.parse(d["pages.json"]!).some((p: any) => p.url === "localabout.html")).toBe(true);
  // 两篇文章都进时间线分片 (Issue 2026-03 / 本地 2026-04)
  const y = JSON.parse(d["data/year/2026.json"]!);
  const urls = y.map((x: any) => x.url);
  expect(urls).toContain("post/I_iss.html");
  expect(urls).toContain("post/abc.html");
  // 本地相对图落盘到 post/abc/<hash>.png, 正文改写为相对引用
  const picName = `${hashUrl("pic.png")}.png`;
  expect(fs.dumpBytes()[`post/abc/${picName}`]).toEqual(picBytes);
  expect(d["post/abc.html"]).toContain(`abc/${picName}`);
});

test("离线本地预览: 无 api/repo, 仅由 localPosts 建站", async () => {
  const localArticle: LocalPost = {
    issue: makeIssue({
      node_id: "loc1",
      number: 0,
      title: "离线文章",
      labels: [{ name: "published" }],
      body: "<!-- meta\ndate: 2026-02-02\n-->\n离线正文",
    }),
    fileDir: "/fake/content/posts",
  };
  const fs = memFileStore();
  await runFull({
    fs,
    md: fakeMarkdown(),
    cfg: fixtureConfig(),
    templates,
    manifest,
    chrome,
    assetsDir: "assets",
    feedRenderer: fakeFeedRenderer(),
    localPosts: [localArticle],
  });
  const d = fs.dump();
  expect(d["post/loc1.html"]).toContain("离线文章");
  expect("data/years.json" in d).toBe(true);
});

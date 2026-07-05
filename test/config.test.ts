import { test, expect, describe } from "bun:test";
import {
  loadConfig,
  toSiteConfig,
  normalizePostDir,
  postDirDepth,
  rootPrefixFor,
} from "../src/domain/config.ts";
import { memFileStore, fixtureConfig } from "./fakes.ts";

// 构造 config/ 多文件 (基础 + 扩展), 允许覆盖/删除单个文件.
function baseFiles(): Record<string, string> {
  return {
    "config/site.json": JSON.stringify({
      title: "测试站点",
      description: "desc",
      author: "tester",
      url: "https://blog.example.com",
      language: "zh-CN",
    }),
    "config/build.json": JSON.stringify({
      build: {
        publishedLabel: "published",
        metaMarker: "meta",
        pageLabel: "page",
        dirPrefix: "dir",
        postDir: "post",
        excludedLabels: [],
      },
      pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
    }),
    "config/feed.json": JSON.stringify({
      enabled: true,
      formats: ["rss", "atom", "json"],
      count: 10,
      summaryLength: 255,
    }),
    "config/comments.json": JSON.stringify({
      enabled: true,
      repo: "o/r",
      repoId: "R_x",
      category: "Announcements",
      categoryId: "DIC_x",
      mapping: "pathname",
    }),
    "config/appearance.json": JSON.stringify({
      theme: { name: "default", skin: "indigo" },
      logo: { type: "text", value: "LG" },
      links: [{ label: "GH", href: "https://github.com/x" }],
      footer: { copyright: "c", icp: "i", police: "p", policeCode: "pc" },
    }),
  };
}
// 覆盖/删除若干文件后加载.
function load(over: Record<string, string | null> = {}) {
  const files = baseFiles();
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete files[k];
    else files[k] = v;
  }
  return loadConfig(memFileStore(files));
}

describe("loadConfig 基础文件", () => {
  test("缺 site.json 抛错", () => {
    expect(() => load({ "config/site.json": null })).toThrow();
  });
  test("缺 build.json 抛错", () => {
    expect(() => load({ "config/build.json": null })).toThrow();
  });
  test("缺 site.title 抛错", () => {
    expect(() =>
      load({ "config/site.json": JSON.stringify({ url: "https://x.com" }) }),
    ).toThrow();
  });
  test("基础字符串字段必须为字符串", () => {
    expect(() =>
      load({ "config/site.json": JSON.stringify({ title: 123, url: "https://x.com" }) }),
    ).toThrow();
    const badBuild = JSON.stringify({
      build: { publishedLabel: 123, metaMarker: "meta", pageLabel: "page", dirPrefix: "dir" },
      pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
    });
    expect(() => load({ "config/build.json": badBuild })).toThrow();
  });
  test("合法多文件合并", () => {
    const c = load();
    expect(c.build.publishedLabel).toBe("published");
    expect(c.build.postDir).toBe("post");
    expect(c.pagination.archive).toBe(100);
    expect(c.rss.enabled).toBe(true);
    expect(c.comments.repoId).toBe("R_x");
    expect(c.theme).toEqual({ name: "default", skin: "indigo" });
  });
  test("pagination 任一非正数抛错", () => {
    const bad = JSON.stringify({
      build: {
        publishedLabel: "published",
        metaMarker: "meta",
        pageLabel: "page",
        dirPrefix: "dir",
      },
      pagination: { home: 2, archive: 0, directory: 10, tag: 10 },
    });
    expect(() => load({ "config/build.json": bad })).toThrow();
    const stringPage = JSON.stringify({
      build: { publishedLabel: "p", metaMarker: "meta", pageLabel: "page", dirPrefix: "dir" },
      pagination: { home: "2", archive: 100, directory: 10, tag: 10 },
    });
    expect(() => load({ "config/build.json": stringPage })).toThrow();
  });
  test("缺 build.pageLabel / dirPrefix 抛错", () => {
    const noPage = JSON.stringify({
      build: { publishedLabel: "p", metaMarker: "meta", pageLabel: "", dirPrefix: "dir" },
      pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
    });
    expect(() => load({ "config/build.json": noPage })).toThrow();
  });
  test("site.language 缺省兜底 zh-CN", () => {
    const noLang = JSON.stringify({ title: "T", url: "https://x.com" });
    expect(load({ "config/site.json": noLang }).site.language).toBe("zh-CN");
  });
  test("site.url 非空时必须为 http(s) URL", () => {
    expect(load({ "config/site.json": JSON.stringify({ title: "T", url: "http://x.com" }) }).site.url).toBe(
      "http://x.com",
    );
    expect(load({ "config/site.json": JSON.stringify({ title: "T", url: "https://x.com" }) }).site.url).toBe(
      "https://x.com",
    );
    expect(() =>
      load({
        "config/site.json": JSON.stringify({ title: "T", url: "javascript:alert(1)" }),
        "config/feed.json": JSON.stringify({ enabled: false }),
      }),
    ).toThrow();
    expect(() =>
      load({
        "config/site.json": JSON.stringify({ title: "T", url: "not a url" }),
        "config/feed.json": JSON.stringify({ enabled: false }),
      }),
    ).toThrow();
  });
  test("site.language 必须为安全 BCP47 形态", () => {
    expect(
      load({ "config/site.json": JSON.stringify({ title: "T", url: "https://x.com", language: "en-US" }) }).site
        .language,
    ).toBe("en-US");
    expect(() =>
      load({
        "config/site.json": JSON.stringify({ title: "T", language: 'zh-CN" onclick="x' }),
        "config/feed.json": JSON.stringify({ enabled: false }),
      }),
    ).toThrow();
  });
  test("excludedLabels 缺省兜底 [], 非数组抛错", () => {
    const noExcl = JSON.stringify({
      build: { publishedLabel: "p", metaMarker: "meta", pageLabel: "page", dirPrefix: "dir" },
      pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
    });
    expect(load({ "config/build.json": noExcl }).build.excludedLabels).toEqual([]);
    const badExcl = JSON.stringify({
      build: {
        publishedLabel: "p",
        metaMarker: "meta",
        pageLabel: "page",
        dirPrefix: "dir",
        excludedLabels: "draft",
      },
      pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
    });
    expect(() => load({ "config/build.json": badExcl })).toThrow();
  });
});

describe("loadConfig feed (扩展, 缺省关闭)", () => {
  test("feed.json 缺省 -> rss 关闭", () => {
    expect(load({ "config/feed.json": null }).rss.enabled).toBe(false);
  });
  test("enabled 非布尔抛错", () => {
    expect(() =>
      load({ "config/feed.json": JSON.stringify({ enabled: "yes" }) }),
    ).toThrow();
  });
  test("enabled 时 formats 空/非法抛错", () => {
    expect(() =>
      load({ "config/feed.json": JSON.stringify({ enabled: true, formats: [], count: 1, summaryLength: 0 }) }),
    ).toThrow();
    expect(() =>
      load({ "config/feed.json": JSON.stringify({ enabled: true, formats: ["xml"], count: 1, summaryLength: 0 }) }),
    ).toThrow();
  });
  test("enabled 时 count<=0 抛错", () => {
    expect(() =>
      load({ "config/feed.json": JSON.stringify({ enabled: true, formats: ["rss"], count: 0, summaryLength: 0 }) }),
    ).toThrow();
  });
  test("summaryLength=0 合法", () => {
    expect(
      load({ "config/feed.json": JSON.stringify({ enabled: true, formats: ["rss"], count: 1, summaryLength: 0 }) }).rss
        .summaryLength,
    ).toBe(0);
  });
  test("enabled=true 缺 site.url 抛错", () => {
    expect(() => load({ "config/site.json": JSON.stringify({ title: "T" }) })).toThrow();
  });
  test("enabled=false 无 site.url 合法", () => {
    const c = load({
      "config/site.json": JSON.stringify({ title: "T" }),
      "config/feed.json": JSON.stringify({ enabled: false }),
    });
    expect(c.rss.enabled).toBe(false);
  });
});

describe("loadConfig comments (扩展, 缺省关闭)", () => {
  test("comments.json 缺省 -> 关闭", () => {
    expect(load({ "config/comments.json": null }).comments.enabled).toBe(false);
  });
  test("enabled 必须为布尔", () => {
    expect(() =>
      load({ "config/comments.json": JSON.stringify({ enabled: "yes" }) }),
    ).toThrow();
  });
  test("enabled 时 repo 与必填字段校验", () => {
    expect(() =>
      load({
        "config/comments.json": JSON.stringify({
          enabled: true,
          repo: "bad repo",
          repoId: "R",
          category: "Announcements",
          categoryId: "C",
          mapping: "pathname",
        }),
      }),
    ).toThrow();
    expect(() =>
      load({
        "config/comments.json": JSON.stringify({
          enabled: true,
          repo: "owner/repo",
          repoId: "",
          category: "Announcements",
          categoryId: "C",
          mapping: "pathname",
        }),
      }),
    ).toThrow();
  });
  test("mapping 必须为 giscus 白名单", () => {
    for (const mapping of ["pathname", "url", "title", "og:title", "specific", "number"]) {
      expect(
        load({
          "config/comments.json": JSON.stringify({
            enabled: true,
            repo: "owner/repo",
            repoId: "R",
            category: "Announcements",
            categoryId: "C",
            mapping,
          }),
        }).comments.mapping,
      ).toBe(mapping);
    }
    expect(() =>
      load({
        "config/comments.json": JSON.stringify({
          enabled: true,
          repo: "owner/repo",
          repoId: "R",
          category: "Announcements",
          categoryId: "C",
          mapping: "javascript",
        }),
      }),
    ).toThrow();
  });
});

describe("loadConfig appearance (扩展, 缺省默认)", () => {
  test("appearance.json 缺省 -> 默认主题 + 文本 logo=site.title + 空外链/页脚", () => {
    const c = load({ "config/appearance.json": null });
    expect(c.theme).toEqual({ name: "default", skin: "" });
    expect(c.appearance.logo).toEqual({ type: "text", value: "测试站点" });
    expect(c.appearance.links).toEqual([]);
    expect(c.appearance.footer).toEqual({ copyright: "", icp: "", police: "", policeCode: "" });
  });
  test("theme.skin 可空", () => {
    const c = load({
      "config/appearance.json": JSON.stringify({ theme: { name: "default" } }),
    });
    expect(c.theme.skin).toBe("");
  });
  test("links 非 http(s) 外链抛错", () => {
    expect(() =>
      load({
        "config/appearance.json": JSON.stringify({
          theme: { name: "default", skin: "indigo" },
          links: [{ label: "本地", href: "/local.html" }],
        }),
      }),
    ).toThrow();
  });
  test("logo.type 非法抛错", () => {
    expect(() =>
      load({
        "config/appearance.json": JSON.stringify({
          theme: { name: "default", skin: "indigo" },
          logo: { type: "svg", value: "x" },
        }),
      }),
    ).toThrow();
  });
  test("logo.value 为空抛错", () => {
    expect(() =>
      load({
        "config/appearance.json": JSON.stringify({
          theme: { name: "default", skin: "indigo" },
          logo: { type: "text", value: "" },
        }),
      }),
    ).toThrow();
  });
});

describe("loadConfig content (功能增强, 缺省安全默认)", () => {
  test("content.json 缺省 -> 全默认", () => {
    const c = load({ "config/content.json": null }).content;
    expect(c.toc).toEqual({ enabled: true, minHeadings: 2, pcCollapseBelow: 5 });
    expect(c.readingTime).toEqual({ enabled: true, cpm: 400, wpm: 250 });
    expect(c.summary).toEqual({ enabled: true, length: 120 });
    expect(c.webp).toEqual({ enabled: true, quality: 80 });
    expect(c.share.networks).toEqual(["copy", "x", "telegram", "weibo"]);
    expect(c.errorPages.codes).toEqual([404, 403, 500]);
  });
  test("各开关独立解析 (toc 关其余默认)", () => {
    const c = load({
      "config/content.json": JSON.stringify({ toc: { enabled: false } }),
    }).content;
    expect(c.toc.enabled).toBe(false);
    expect(c.toc.minHeadings).toBe(2); // 同段缺省字段仍默认
    expect(c.math.enabled).toBe(true); // 其它段默认开
  });
  test("非法 share.networks 抛错", () => {
    expect(() =>
      load({
        "config/content.json": JSON.stringify({ share: { networks: ["myspace"] } }),
      }),
    ).toThrow();
  });
  test("非法 errorPages.codes 抛错", () => {
    expect(() =>
      load({
        "config/content.json": JSON.stringify({ errorPages: { codes: [99, 700] } }),
      }),
    ).toThrow();
  });
  test("非法数值 (summary.length=0 / webp.quality=0) 抛错", () => {
    expect(() =>
      load({ "config/content.json": JSON.stringify({ summary: { length: 0 } }) }),
    ).toThrow();
    expect(() =>
      load({ "config/content.json": JSON.stringify({ webp: { quality: 0 } }) }),
    ).toThrow();
  });
  test("canonical/jsonLd 缺省 -> 开启", () => {
    const c = load({ "config/content.json": null }).content;
    expect(c.canonical).toEqual({ enabled: true });
    expect(c.jsonLd).toEqual({ enabled: true });
  });
  test("canonical/jsonLd 显式关闭被尊重", () => {
    const c = load({
      "config/content.json": JSON.stringify({
        canonical: { enabled: false },
        jsonLd: { enabled: false },
      }),
    }).content;
    expect(c.canonical.enabled).toBe(false);
    expect(c.jsonLd.enabled).toBe(false);
  });
  test("canonical.enabled / jsonLd.enabled 非布尔抛错", () => {
    expect(() =>
      load({ "config/content.json": JSON.stringify({ canonical: { enabled: "yes" } }) }),
    ).toThrow();
    expect(() =>
      load({ "config/content.json": JSON.stringify({ jsonLd: { enabled: 1 } }) }),
    ).toThrow();
  });
  test("toc.pcCollapseBelow 缺省 5; 自定义生效; 非正整数抛错", () => {
    expect(load({ "config/content.json": null }).content.toc.pcCollapseBelow).toBe(5);
    expect(
      load({ "config/content.json": JSON.stringify({ toc: { pcCollapseBelow: 8 } }) })
        .content.toc.pcCollapseBelow,
    ).toBe(8);
    expect(() =>
      load({ "config/content.json": JSON.stringify({ toc: { pcCollapseBelow: 0 } }) }),
    ).toThrow();
  });
});

test("toSiteConfig 取公开子集", () => {
  expect(toSiteConfig(fixtureConfig())).toEqual({
    title: "测试站点",
    pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
  });
});

describe("build.postDir 归一化与 rootPrefix", () => {
  // 经 loadConfig 验证 postDir 归一化与缺省/非法分支.
  function loadWithPostDir(v: unknown) {
    const build: any = {
      publishedLabel: "p",
      metaMarker: "meta",
      pageLabel: "page",
      dirPrefix: "dir",
    };
    if (v !== undefined) build.postDir = v;
    return load({
      "config/build.json": JSON.stringify({
        build,
        pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
      }),
    });
  }

  test("缺省 -> post", () => {
    expect(loadWithPostDir(undefined).build.postDir).toBe("post");
  });
  test("去首尾斜杠/空白", () => {
    expect(loadWithPostDir("/post/").build.postDir).toBe("post");
    expect(loadWithPostDir("  blog  ").build.postDir).toBe("blog");
    expect(loadWithPostDir("").build.postDir).toBe("post");
  });
  test("多段合法", () => {
    expect(loadWithPostDir("a/b").build.postDir).toBe("a/b");
  });
  test("含 .. / 反斜杠抛错", () => {
    expect(() => loadWithPostDir("../x")).toThrow();
    expect(() => loadWithPostDir("a\\b")).toThrow();
  });

  test("normalizePostDir 纯函数", () => {
    expect(normalizePostDir(undefined)).toBe("post");
    expect(normalizePostDir("/post/")).toBe("post");
    expect(normalizePostDir("a/b")).toBe("a/b");
    expect(() => normalizePostDir("a/../b")).toThrow();
  });
  test("postDirDepth", () => {
    expect(postDirDepth("post")).toBe(1);
    expect(postDirDepth("a/b")).toBe(2);
    expect(postDirDepth("")).toBe(0);
  });
  test("rootPrefixFor", () => {
    expect(rootPrefixFor(0)).toBe("./");
    expect(rootPrefixFor(1)).toBe("../");
    expect(rootPrefixFor(2)).toBe("../../");
  });
});

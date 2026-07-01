import { test, expect, describe } from "bun:test";
import {
  htmlToText,
  joinUrl,
  absolutizeUrls,
  buildItemBody,
  buildChannel,
  buildFeedItems,
} from "../src/domain/feedService.ts";
import { extractContentHtml } from "../src/domain/contentMarkers.ts";
import { memFileStore, fixtureConfig } from "./fakes.ts";
import type { Manifest } from "../src/domain/types.ts";

describe("extractContentHtml", () => {
  test("有标记 -> 返回标记间内容 (含嵌套标签)", () => {
    const html = `<div><!--content:start--><p>a<span>b</span></p><!--content:end--></div>`;
    expect(extractContentHtml(html)).toBe("<p>a<span>b</span></p>");
  });
  test("无标记 -> null", () => {
    expect(extractContentHtml("<p>x</p>")).toBeNull();
  });
});

describe("htmlToText", () => {
  test("去标签 + 解码实体 + 折叠空白", () => {
    expect(htmlToText("<p>a &amp; b</p>")).toBe("a & b");
    expect(htmlToText("x&nbsp;y")).toBe("x y");
    expect(htmlToText("&#65;&#x42;")).toBe("AB");
  });
});

describe("joinUrl", () => {
  test("处理尾/首斜杠", () => {
    expect(joinUrl("https://x.com/", "/a.html")).toBe("https://x.com/a.html");
    expect(joinUrl("https://x.com", "a.html")).toBe("https://x.com/a.html");
  });
});

describe("absolutizeUrls", () => {
  const base = "https://x.com";
  test("相对 src/href -> 绝对", () => {
    expect(absolutizeUrls('<img src="assets/img/a.png">', base)).toContain('src="https://x.com/assets/img/a.png"');
    expect(absolutizeUrls('<a href="b.html">', base)).toContain('href="https://x.com/b.html"');
  });
  test("绝对/协议相对/#/mailto/data 不变", () => {
    expect(absolutizeUrls('<a href="https://y.com/z">', base)).toContain('href="https://y.com/z"');
    expect(absolutizeUrls('<img src="//cdn/a.png">', base)).toContain('src="//cdn/a.png"');
    expect(absolutizeUrls('<a href="#sec">', base)).toContain('href="#sec"');
    expect(absolutizeUrls('<a href="mailto:a@b.c">', base)).toContain('href="mailto:a@b.c"');
    expect(absolutizeUrls('<img src="data:image/png;base64,xx">', base)).toContain('src="data:image/png;base64,xx"');
  });
});

describe("buildItemBody", () => {
  test("summaryLength>0 -> 仅 description (纯文本截断)", () => {
    const b = buildItemBody("<p>abcdef</p>", 3, "https://x.com");
    expect(b.description).toBe("abc…");
    expect(b.content).toBeUndefined();
  });
  test("summaryLength=0 -> 仅 content (绝对化)", () => {
    const b = buildItemBody('<img src="a.png">', 0, "https://x.com");
    expect(b.content).toContain('src="https://x.com/a.png"');
    expect(b.description).toBeUndefined();
  });
});

describe("buildChannel", () => {
  test("映射 site 字段; updated 取最新文章日期", () => {
    const m: Manifest = [
      { url: "b.html", title: "b", date: "2026-03-01" },
      { url: "a.html", title: "a", date: "2026-01-01" },
    ];
    const ch = buildChannel(m, fixtureConfig(), "2099-01-01T00:00:00Z");
    expect(ch.title).toBe("测试站点");
    expect(ch.id).toBe("https://blog.example.com");
    expect(ch.language).toBe("zh-CN");
    expect(ch.author).toBe("tester");
    expect(ch.updated).toBe("2026-03-01");
  });
  test("空 manifest -> updated 取构建时刻", () => {
    expect(buildChannel([], fixtureConfig(), "2099-01-01T00:00:00Z").updated).toBe("2099-01-01T00:00:00Z");
  });
});

describe("buildFeedItems", () => {
  const cfg = fixtureConfig();
  cfg.rss.count = 2;
  cfg.rss.summaryLength = 255;
  const body = (s: string) => `<div><!--content:start-->${s}<!--content:end--></div>`;
  test("取最新 N, 顺序正确, link=id 绝对, 跳过无 HTML/无标记", () => {
    const fs = memFileStore({
      "c.html": body("<p>cc</p>"),
      "b.html": "无标记",
      // a.html 不存在
    });
    const m: Manifest = [
      { url: "c.html", title: "c", date: "2026-03-01" },
      { url: "b.html", title: "b", date: "2026-02-01" },
      { url: "a.html", title: "a", date: "2026-01-01" },
    ];
    const items = buildFeedItems({ manifest: m, fs, cfg });
    // count=2 -> 取 c,b; b 无标记跳过; a 超出 count
    expect(items.map((i) => i.title)).toEqual(["c"]);
    expect(items[0].link).toBe("https://blog.example.com/c.html");
    expect(items[0].id).toBe(items[0].link);
    expect(items[0].description).toBe("cc");
  });
});

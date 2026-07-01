import { test, expect } from "bun:test";
import { createFeedRenderer } from "../../src/infra/feedRenderer.ts";
import type { FeedChannel, FeedItem } from "../../src/domain/types.ts";

const channel: FeedChannel = {
  title: "站点",
  description: "desc",
  id: "https://x.com",
  link: "https://x.com",
  language: "zh-CN",
  author: "me",
  updated: "2026-03-01T00:00:00.000Z",
};
const items: FeedItem[] = [
  {
    id: "https://x.com/a.html",
    title: "文章A",
    link: "https://x.com/a.html",
    date: "2026-03-01T00:00:00.000Z",
    description: "摘要A",
  },
];

test("render 产出三格式, 含标题与绝对链接", () => {
  const out = createFeedRenderer().render(channel, items);
  expect(out.rss).toContain("<rss");
  expect(out.rss).toContain("文章A");
  expect(out.rss).toContain("https://x.com/a.html");
  expect(out.atom).toContain("<feed");
  expect(out.atom).toContain("文章A");
  const json = JSON.parse(out.json);
  expect(json.items.length).toBe(1);
  expect(json.items[0].url).toBe("https://x.com/a.html");
});

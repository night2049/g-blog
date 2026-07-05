// RSS/Atom/JSON feed 领域逻辑: 正文提取/摘要/绝对化/模型组装/编排. 与具体 feed 库无关.
// 真正的格式渲染委托给注入的 FeedRenderer 端口 (见 infra/feedRenderer.ts).
import type {
  Config,
  FeedChannel,
  FeedItem,
  FeedRenderer,
  FileStore,
  Manifest,
} from "./types.ts";
import * as parse5 from "parse5";
import { takeLatest } from "./manifestService.ts";
import { extractContentHtml } from "./contentMarkers.ts";
import { htmlToText, truncate } from "./text.ts";

// htmlToText 已抽到 domain/text.ts (RSS 与卡片/SEO 摘要共用同一 strip/截断实现, 见设计 §5.2);
// 此处再导出, 保持既有引用方 (test/调用方) 不变.
export { htmlToText } from "./text.ts";

// 拼接绝对 URL: 处理 base 尾斜杠与 rel 首斜杠, 避免 // 或缺斜杠.
export function joinUrl(baseUrl: string, rel: string): string {
  return baseUrl.replace(/\/+$/, "") + "/" + rel.replace(/^\/+/, "");
}

function shouldKeepUrl(url: string): boolean {
  const v = url.trim();
  return (
    v === "" ||
    /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(v)
  );
}

function absolutizeOne(url: string, baseUrl: string): string {
  if (shouldKeepUrl(url)) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function absolutizeSrcset(srcset: string, baseUrl: string): string {
  return srcset
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const pieces = trimmed.split(/\s+/);
      const url = pieces.shift()!;
      return [absolutizeOne(url, baseUrl), ...pieces].join(" ");
    })
    .join(", ");
}

function setAttr(node: any, name: string, value: string): void {
  const attr = node.attrs?.find((a: any) => a.name === name);
  if (attr) attr.value = value;
}

function getAttr(node: any, name: string): string | null {
  return node.attrs?.find((a: any) => a.name === name)?.value ?? null;
}

function absolutizeNodeAttrs(node: any, baseUrl: string): void {
  const tag = node.tagName;
  if (!tag || !node.attrs) return;

  const resourceAttrs: Record<string, string[]> = {
    img: ["src"],
    source: ["src"],
    video: ["src", "poster"],
    audio: ["src"],
    track: ["src"],
  };
  for (const attr of resourceAttrs[tag] ?? []) {
    const value = getAttr(node, attr);
    if (value !== null) setAttr(node, attr, absolutizeOne(value, baseUrl));
  }
  if (tag === "source") {
    const srcset = getAttr(node, "srcset");
    if (srcset !== null) setAttr(node, "srcset", absolutizeSrcset(srcset, baseUrl));
  }
  if (tag === "a") {
    const href = getAttr(node, "href");
    if (href !== null) setAttr(node, "href", absolutizeOne(href, baseUrl));
  }
}

function walk(node: any, fn: (node: any) => void): void {
  fn(node);
  for (const child of node.childNodes ?? []) walk(child, fn);
}

// 正文内相对资源 URL 改为绝对; 绝对/协议相对/#/mailto/tel/data 保持不变.
export function absolutizeUrls(html: string, baseUrl: string): string {
  const fragment = parse5.parseFragment(html);
  walk(fragment, (node) => absolutizeNodeAttrs(node, baseUrl));
  return parse5.serialize(fragment);
}

// 摘要/全文二选一: summaryLength>0 取纯文本摘要; =0 取绝对化全文.
export function buildItemBody(
  contentHtml: string,
  summaryLength: number,
  baseUrl: string,
): { description?: string; content?: string } {
  if (summaryLength > 0) {
    return { description: truncate(htmlToText(contentHtml), summaryLength) };
  }
  return { content: absolutizeUrls(contentHtml, baseUrl) };
}

// 组装 feed channel 模型. now 可注入便于测试 (无文章时 updated 取 now).
export function buildChannel(
  manifest: Manifest,
  cfg: Config,
  now: string = new Date().toISOString(),
): FeedChannel {
  const latest = takeLatest(manifest, 1)[0];
  return {
    title: cfg.site.title,
    description: cfg.site.description,
    id: cfg.site.url,
    link: cfg.site.url,
    language: cfg.site.language,
    author: cfg.site.author,
    updated: latest ? latest.date : now,
  };
}

// 取最新 N 条, 读其 HTML 提取正文, 组装与库无关的 FeedItem[]. 读不到/无标记则跳过.
export function buildFeedItems(deps: {
  manifest: Manifest;
  fs: FileStore;
  cfg: Config;
}): FeedItem[] {
  const { manifest, fs, cfg } = deps;
  const items: FeedItem[] = [];
  for (const e of takeLatest(manifest, cfg.rss.count)) {
    const html = fs.read(e.url);
    if (html === null) {
      console.log("[RSS] 读不到文章 HTML, 跳过: " + e.url);
      continue;
    }
    const content = extractContentHtml(html);
    if (content === null) {
      console.log("[RSS] 文章缺正文标记, 跳过: " + e.url);
      continue;
    }
    const link = joinUrl(cfg.site.url, e.url);
    const contentBase = new URL(".", link).toString();
    items.push({
      id: link,
      title: e.title,
      link,
      date: e.date,
      ...buildItemBody(content, cfg.rss.summaryLength, contentBase),
    });
  }
  return items;
}

// 按 formats 仅写出对应文件.
export function writeFeeds(
  fs: FileStore,
  feeds: { rss: string; atom: string; json: string },
  formats: Config["rss"]["formats"],
): void {
  removeFeeds(fs);
  if (formats.includes("rss")) fs.write("feed.xml", feeds.rss);
  if (formats.includes("atom")) fs.write("atom.xml", feeds.atom);
  if (formats.includes("json")) fs.write("feed.json", feeds.json);
}

export function removeFeeds(fs: FileStore): void {
  fs.remove("feed.xml");
  fs.remove("atom.xml");
  fs.remove("feed.json");
}

// 编排: 组装 items + channel -> 交 FeedRenderer 渲染 -> 写文件. rss.enabled 由调用方判断.
export function generateFeeds(deps: {
  manifest: Manifest;
  fs: FileStore;
  cfg: Config;
  feedRenderer: FeedRenderer;
}): void {
  const { manifest, fs, cfg, feedRenderer } = deps;
  const items = buildFeedItems({ manifest, fs, cfg });
  const feeds = feedRenderer.render(buildChannel(manifest, cfg), items);
  writeFeeds(fs, feeds, cfg.rss.formats);
}

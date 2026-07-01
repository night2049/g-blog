// Post 领域服务: 发布判定, URL, 标签/目录提取, 独立页路由, Issue -> Post/Page 渲染.
import type { Config, Markdown, PageDoc, Post, RawIssue } from "./types.ts";
import { parseMeta, resolveDate } from "./meta.ts";

// GitHub 新仓库自带的默认 label (lowercase). 作为标签排除白名单, 仅保留作者自定义标签.
// 取舍: 作者若想用这些默认词当内容标签会被一并排除, 换取"无需前缀、直接打标签"的体验.
export const DEFAULT_GITHUB_LABELS: ReadonlySet<string> = new Set([
  "bug",
  "documentation",
  "duplicate",
  "enhancement",
  "good first issue",
  "help wanted",
  "invalid",
  "question",
  "wontfix",
]);

// 站点保留文件名 (不含/含 .html), 独立页 url 不得占用, 防止覆盖核心页/数据/feed.
export const RESERVED_PAGE_NAMES: ReadonlySet<string> = new Set([
  "index",
  "archive",
  "tag",
  "dir",
  "posts",
  "site",
  "feed",
  "atom",
]);

// open 且含 publishedLabel 才上线.
export function isPublished(issue: RawIssue, publishedLabel: string): boolean {
  return (
    issue.state === "open" &&
    issue.labels.some((l) => l.name === publishedLabel)
  );
}

// 是否目录 label: 去空白后以 prefix 开头 (大小写不敏感) 且紧跟半角 : 或全角 ：.
export function isDirLabel(name: string, prefix: string): boolean {
  const t = name.trim();
  const p = prefix.toLowerCase();
  if (t.length <= p.length) return false;
  if (t.slice(0, p.length).toLowerCase() !== p) return false;
  const sep = t[p.length];
  return sep === ":" || sep === "：";
}

// 目录取值: 冒号后内容 (首尾去空); 非目录或值为空 -> null.
export function dirValue(name: string, prefix: string): string | null {
  if (!isDirLabel(name, prefix)) return null;
  const t = name.trim();
  const v = t.slice(prefix.length + 1).trim();
  return v === "" ? null : v;
}

// 提取目录: 映射 dirValue, 去 null, 按出现顺序去重.
export function extractDirs(
  labels: { name: string }[],
  prefix: string,
): string[] {
  const out: string[] = [];
  for (const l of labels) {
    const v = dirValue(l.name, prefix);
    if (v !== null && !out.includes(v)) out.push(v);
  }
  return out;
}

export interface TagOpts {
  publishedLabel: string;
  pageLabel: string;
  dirPrefix: string;
  excludedLabels?: string[];
}

// 内容标签 = labels 去掉 publishedLabel/pageLabel/(内置默认 ∪ 配置 excludedLabels)/目录 label.
export function extractTags(labels: { name: string }[], opts: TagOpts): string[] {
  const excluded = new Set<string>(DEFAULT_GITHUB_LABELS);
  for (const e of opts.excludedLabels ?? []) excluded.add(e.toLowerCase());
  return labels
    .map((l) => l.name)
    .filter(
      (name) =>
        name !== opts.publishedLabel &&
        name !== opts.pageLabel &&
        !excluded.has(name.toLowerCase()) &&
        !isDirLabel(name, opts.dirPrefix),
    );
}

// 是否独立页: labels 含 pageLabel (精确匹配, 不限 state).
export function isPageIssue(issue: RawIssue, pageLabel: string): boolean {
  return issue.labels.some((l) => l.name === pageLabel);
}

// 文章 URL / 文件名 = <postDir>/<node_id>.html.
export function postUrl(nodeId: string, postDir: string): string {
  return postDir + "/" + nodeId + ".html";
}

// 从文章 url 还原 node_id: 去 <postDir>/ 前缀与 .html 后缀.
export function nodeIdFromUrl(url: string, postDir: string): string {
  const prefix = postDir + "/";
  const noPrefix = url.startsWith(prefix) ? url.slice(prefix.length) : url;
  return noPrefix.replace(/\.html$/, "");
}

// 文章图片文件夹 = <postDir>/<node_id> (图片落于文章页同名子文件夹).
export function postImgDir(nodeId: string, postDir: string): string {
  return postDir + "/" + nodeId;
}

// 解析独立页路由: 仅根级、安全、非保留名. 非法返回 null.
export function resolvePageUrl(rawUrl: string | undefined | null): string | null {
  const raw = (rawUrl ?? "").trim();
  if (!raw) return null;
  if (raw.includes("..") || raw.includes("\\") || raw.includes("/")) return null;
  if (raw.startsWith(".")) return null;
  const base = raw.toLowerCase().endsWith(".html") ? raw.slice(0, -5) : raw;
  if (!base || base.includes(".")) return null;
  if (RESERVED_PAGE_NAMES.has(base.toLowerCase())) return null;
  return base + ".html";
}

// Issue -> Post: 解析 meta -> 解析日期 -> 渲染正文 -> 提取标签/目录.
export function issueToPost(issue: RawIssue, cfg: Config, md: Markdown): Post {
  const { meta, content } = parseMeta(issue.body, cfg.build.metaMarker);
  return {
    nodeId: issue.node_id,
    url: postUrl(issue.node_id, cfg.build.postDir),
    title: issue.title,
    date: resolveDate(meta, issue.created_at),
    contentHtml: md.render(content),
    tags: extractTags(issue.labels, {
      publishedLabel: cfg.build.publishedLabel,
      pageLabel: cfg.build.pageLabel,
      dirPrefix: cfg.build.dirPrefix,
      excludedLabels: cfg.build.excludedLabels,
    }),
    dirs: extractDirs(issue.labels, cfg.build.dirPrefix),
  };
}

// Issue -> PageDoc: 解析 meta.url 为路由; 路由非法返回 null (无法发布).
export function issueToPage(
  issue: RawIssue,
  cfg: Config,
  md: Markdown,
): PageDoc | null {
  const { meta, content } = parseMeta(issue.body, cfg.build.metaMarker);
  const url = resolvePageUrl(meta.url);
  if (!url) return null;
  return {
    nodeId: issue.node_id,
    url,
    title: issue.title,
    contentHtml: md.render(content),
  };
}

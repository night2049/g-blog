import type {
  ChromeVars,
  Config,
  EventSource,
  FeedChannel,
  FeedItem,
  FeedRenderer,
  FileStore,
  GitHubApi,
  ImageDownloader,
  Markdown,
  RawIssue,
  TemplateProvider,
  ThemeManifest,
} from "../src/domain/types.ts";

// 内存 FileStore: 断言写入内容, 无磁盘 IO.
export function memFileStore(initial: Record<string, string> = {}): FileStore & { dump(): Record<string, string>; dumpBytes(): Record<string, Uint8Array> } {
const store: Record<string, string> = { ...initial };
const bytes: Record<string, Uint8Array> = {};
return {
read: (rel) => (rel in store ? store[rel]! : null),
write: (rel, content) => { store[rel] = content; },
writeBytes: (rel, b) => { bytes[rel] = b; },
remove: (rel) => { delete store[rel]; delete bytes[rel]; },
exists: (rel) => rel in store,
copyInto: (_srcAbs, rel) => { store[rel] = "COPIED"; },
list: (dir) => {
  const prefix = dir.replace(/\/+$/, "") + "/";
  const names = new Set<string>();
  for (const key of [...Object.keys(store), ...Object.keys(bytes)]) {
    if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
  }
  return [...names];
},
listAll: (dir) => {
  const prefix = dir === "" ? "" : dir.replace(/\/+$/, "") + "/";
  const out: string[] = [];
  for (const key of [...Object.keys(store), ...Object.keys(bytes)]) {
    if (prefix === "" || key.startsWith(prefix)) out.push(key);
  }
  return out;
},
clearExcept: (keep) => {
  const keepSet = new Set(keep);
  // 清除顶层段不在白名单内的所有键 (模拟清空根目录).
  for (const map of [store, bytes] as Record<string, unknown>[]) {
    for (const key of Object.keys(map)) {
      if (!keepSet.has(key.split("/")[0]!)) delete map[key];
    }
  }
},
dump: () => ({ ...store }),
dumpBytes: () => ({ ...bytes }),
};
}

export function fakeMarkdown(): Markdown {
return { render: (md) => "<md>" + md + "</md>" };
}

export function fakeEventSource(issue: RawIssue, action: string | null = null): EventSource {
return { readIssue: () => issue, readAction: () => action };
}

export function fakeGitHubApi(issues: RawIssue[]): GitHubApi {
return { listIssues: async () => issues, getIssueByNumber: async (_repo, num) => issues.find((i) => i.number === num)! };
}

// 假图片下载器: 按 url -> {bytes, ext} 映射返回; 未命中返回 null.
export function fakeImageDownloader(map: Record<string, { bytes: Uint8Array; ext: string }>): ImageDownloader {
return { download: async (url) => map[url] ?? null };
}

// 假模板提供者: 按名返回模板字符串; 未命中返回空串.
export function fakeTemplateProvider(map: Record<string, string> = {}): TemplateProvider {
return { read: (name) => map[name] ?? "" };
}

// 假 feed 渲染器: 记录被调用的 channel/items, 不依赖真实 feed 库.
export function fakeFeedRenderer(): FeedRenderer & { calls: { channel: FeedChannel; items: FeedItem[] }[] } {
const calls: { channel: FeedChannel; items: FeedItem[] }[] = [];
return {
calls,
render: (channel, items) => {
calls.push({ channel, items });
return { rss: "<rss/>", atom: "<feed/>", json: "{}" };
},
};
}

export function fixtureConfig(): Config {
return {
site: { title: "测试站点", description: "desc", author: "tester", url: "https://blog.example.com", language: "zh-CN" },
pagination: { home: 2, archive: 100, directory: 10, tag: 10 },
rss: { enabled: true, formats: ["rss", "atom", "json"], count: 10, summaryLength: 255 },
build: { publishedLabel: "published", metaMarker: "meta", pageLabel: "page", dirPrefix: "dir", postDir: "post", contentDir: "content", excludedLabels: [] },
comments: { enabled: false, repo: "owner/repo", repoId: "", category: "Announcements", categoryId: "", mapping: "pathname" },
theme: { name: "default", skin: "indigo" },
appearance: {
theme: { name: "default", skin: "indigo" },
logo: { type: "text", value: "测试站点" },
links: [],
footer: { copyright: "", icp: "", police: "", policeCode: "" },
},
content: {
toc: { enabled: true, minHeadings: 2, pcCollapseBelow: 5 },
readingTime: { enabled: true, cpm: 400, wpm: 250 },
summary: { enabled: true, length: 120 },
cover: { enabled: true },
math: { enabled: true },
codeCopy: { enabled: true },
imageZoom: { enabled: true },
share: { enabled: true, networks: ["copy", "x", "telegram", "weibo"] },
widgets: { enabled: true },
og: { enabled: true },
canonical: { enabled: true },
jsonLd: { enabled: true },
webp: { enabled: true, quality: 80 },
errorPages: { codes: [404, 403, 500] },
},
};
}

export function makeIssue(over: Partial<RawIssue> = {}): RawIssue {
return {
node_id: "I_test001", number: 1, title: "标题", body: "正文内容",
state: "open", labels: [{ name: "published" }],
created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
...over,
};
}

// 假主题清单: 与 themes/default/theme.json 同形状, 供 assemblePage/run* 测试.
export function fakeThemeManifest(over: Partial<ThemeManifest> = {}): ThemeManifest {
return {
defaultSkin: "indigo",
mains: { post: "main-post.html", page: "main-page.html", home: "main-list.html", archive: "main-list.html", tag: "main-list.html", dir: "main-list.html" },
scripts: { home: ["browse.js", "app.js"], archive: ["browse.js", "archive.js"], tag: ["browse.js", "tag.js"], dir: ["browse.js", "dir.js"] },
nav: [ { label: "首页", page: "home" }, { label: "归档", page: "archive" }, { label: "目录", page: "dir" } ],
widgets: { post: ["reading-progress", "back-to-top", "back-to-home"], default: ["back-to-top", "back-to-home"], home: ["back-to-top"] },
assets: [],
...over,
};
}

// 假主题模板提供者: baseof + partials, 占位与真实主题一致, 供组装测试.
export function fakeThemeProvider(over: Record<string, string> = {}): TemplateProvider {
const files: Record<string, string> = {
"baseof.html": '<!doctype html><html lang="{{lang}}" data-root="{{rootPrefix}}"><head>{{> head}}</head><body><main class="page">{{> header}}{{> main}}{{> footer}}</main><script src="{{rootPrefix}}chrome.js" defer></script>{{widgets}}{{scripts}}</body></html>',
"partials/head.html": '<title>{{pageTitle}}</title>{{metaDescription}}{{ogTags}}{{canonical}}{{jsonLd}}{{katexCss}}<link rel="stylesheet" href="{{rootPrefix}}app.css" />{{headExtra}}{{contentFlags}}',
"partials/header.html": '<header><div class="site-logo" id="site-logo"></div><nav class="site-nav" id="site-nav"></nav></header>',
"partials/footer.html": '<footer class="site-footer"><div class="footer-line" id="site-footer"></div></footer>',
"partials/main-post.html": '<article class="post-article"><h1 class="post-title">{{title}}</h1><div class="post-meta-row"><span class="post-card-date">{{dateDisplay}}</span>{{readingMeta}}{{tags}}</div><post-toc></post-toc><div class="prose"><!--content:start-->{{content}}<!--content:end--></div></article>{{comments}}',
"partials/main-page.html": '<article class="post-article"><h1 class="post-title">{{title}}</h1><div class="prose"><!--content:start-->{{content}}<!--content:end--></div></article>',
"partials/main-list.html": '<h1 id="page-title" class="post-title"></h1><nav id="years" class="year-nav"></nav><div id="map" class="dir-map"></div><ul id="posts" class="post-list"></ul><nav id="pager" class="pager"></nav>',
...over,
};
return { read: (name) => files[name] ?? "" };
}

// 假外壳片段: 供 run* 测试注入 (内容简短便于断言).
export function fakeChrome(over: Partial<ChromeVars> = {}): ChromeVars {
return {
logo: '<a class="site-logo-link" href="./index.html">LG</a>',
nav: '<a href="./index.html">首页</a><a href="./archive.html">归档</a><a href="./dir.html">目录</a>',
footerCopyright: "© 2026 t",
footerIcp: "",
footerPolice: "",
rssLinks: "",
giscusThemeLight: "https://blog.example.com/giscus-light.css",
giscusThemeDark: "https://blog.example.com/giscus-dark.css",
giscusThemeLightJs: '"https://blog.example.com/giscus-light.css"',
giscusThemeDarkJs: '"https://blog.example.com/giscus-dark.css"',
lang: "zh-CN",
...over,
};
}

// 页面组装与渲染: 占位替换 + partial 内联 + 部件/脚本注入 + HTML 转义. 纯函数 (模板来源经 provider 注入).
import type {
  ChromeVars,
  Config,
  PageDoc,
  Post,
  SiteConfig,
  TemplateProvider,
  ThemeManifest,
} from "./types.ts";
import { joinUrl } from "./feedService.ts";

// 转义 HTML 文本中的特殊字符 (用于标题等用户输入).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 替换模板中的 {{key}} 占位; 未提供的 key 替换为空串. 不处理 {{> partial}} (含 > 不匹配 \w+).
export function applyTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}

// 部件占位默认 data-* 选项: 本轮部件 (reading-progress/back-to-top/back-to-home) 无需默认属性;
// post-toc 已移入 main-post 模板 (作为 tocbot 挂载容器, 不再由 widgets 注入, data-depth 弃用).
const WIDGET_DEFAULTS: Record<string, Record<string, string>> = {};

// 部件占位标签: <name data-*></name>; 无声明返回空串.
function renderWidgets(names?: string[]): string {
  if (!names || names.length === 0) return "";
  return names
    .map((n) => {
      const attrs = WIDGET_DEFAULTS[n] ?? {};
      const a = Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("");
      return `<${n}${a}></${n}>`;
    })
    .join("\n    ");
}

// 客户端脚本: 页类型脚本列表 + (有部件时) 稳定的 widgets.js 引用. 均 defer 保序.
// rootPrefix 使脚本引用在不同目录深度的页面 (如文章页 <postDir>/) 仍正确解析.
function renderScripts(
  scripts: string[] | undefined,
  widgets: string[] | undefined,
  rootPrefix: string,
): string {
  const tags = (scripts ?? []).map(
    (s) => `<script src="${rootPrefix}${s}" defer></script>`,
  );
  if (widgets && widgets.length > 0)
    tags.push(`<script src="${rootPrefix}widgets.js" defer></script>`);
  return tags.join("\n    ");
}

// 解析 {{> name}} partial 包含: head/header/footer -> partials/<name>.html; main -> 所选 main 片段.
// 循环解析以支持嵌套 (max 6 层), 未知 partial 由 provider 返回空串.
function resolveIncludes(
  baseof: string,
  provider: TemplateProvider,
  mainPartial: string | undefined,
): string {
  let html = baseof;
  for (let depth = 0; depth < 6; depth++) {
    if (!/\{\{>\s*[\w-]+\s*\}\}/.test(html)) break;
    html = html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_m, name) => {
      if (name === "main")
        return mainPartial ? provider.read("partials/" + mainPartial) : "";
      return provider.read("partials/" + name + ".html");
    });
  }
  return html;
}

/**
 * 组装整页: 读 baseof -> 内联 partial (head/header/footer + 按 pageType 选 main) ->
 * 注入 widgets 占位与 scripts -> applyTemplate 替换 {{key}}. 纯函数.
 * @param provider  指向所选主题 templates 目录的模板提供者
 * @param manifest  主题清单 (mains/scripts/widgets 映射)
 * @param pageType  页类型 (post/page/home/archive/tag/dir)
 * @param vars      占位取值 (已转义/已渲染的安全 HTML 片段)
 */
export function assemblePage(
  provider: TemplateProvider,
  manifest: ThemeManifest,
  pageType: string,
  vars: Record<string, string>,
): string {
  const baseof = provider.read("baseof.html");
  const assembled = resolveIncludes(baseof, provider, manifest.mains[pageType]);
  const rootPrefix = vars.rootPrefix || "./";
  const merged: Record<string, string> = {
    ...vars,
    rootPrefix,
    widgets: renderWidgets(manifest.widgets[pageType]),
    scripts: renderScripts(
      manifest.scripts[pageType],
      manifest.widgets[pageType],
      rootPrefix,
    ),
  };
  return applyTemplate(assembled, merged);
}

// KaTeX 样式表 (jsDelivr); 仅正文含 .katex 标记时条件注入 head, 不进 app.css.
// 版本须与 package.json 的 katex (构建期 renderToString 所用) 一致, 否则字体/布局细节可能不匹配.
const KATEX_CSS_LINK =
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css" crossorigin="anonymous" />';
function katexCssFor(contentHtml: string | undefined): string {
  return contentHtml && /class="katex/.test(contentHtml) ? KATEX_CSS_LINK : "";
}

// 相对资源绝对化 (og:image/og:url): 绝对/协议相对原样; 无 site.url 退回原值; 否则复用 feedService.joinUrl.
function toAbsolute(siteUrl: string, path: string): string {
  if (!path) return "";
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(path)) return path;
  return siteUrl ? joinUrl(siteUrl, path) : path;
}

// 文章 meta 行的"约 N 分钟 · M 字"片段 (次要文字); 无派生字段则空.
function buildReadingMeta(post: Post): string {
  const parts: string[] = [];
  if (post.readingTime) parts.push("约 " + post.readingTime + " 分钟");
  if (post.words)
    parts.push(String(post.words).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " 字");
  return parts.length ? `<span class="post-reading">${parts.join(" · ")}</span>` : "";
}

/**
 * 构建 head 的 meta description + OG/twitter 标签 + 条件 KaTeX CSS (页类型相关).
 * og:image 仅在有 image (本篇首图) 时输出, 无则省略 (不生成默认图); og:url/og:image 经 site.url 绝对化.
 * twitter:card 有图 summary_large_image, 无图 summary. og.enabled=false 时仅出 description + KaTeX CSS.
 */
function buildHeadSeo(
  cfg: Config,
  args: {
    title: string;
    description: string;
    ogType: string;
    url: string;
    image?: string;
    contentHtml?: string;
  },
): { metaDescription: string; ogTags: string; katexCss: string } {
  const { title, description, ogType, url, image, contentHtml } = args;
  const metaDescription = description
    ? `<meta name="description" content="${escapeHtml(description)}" />`
    : "";
  const katexCss = katexCssFor(contentHtml);
  if (!cfg.content.og.enabled) return { metaDescription, ogTags: "", katexCss };
  const absUrl = toAbsolute(cfg.site.url, url);
  const absImage = image ? toAbsolute(cfg.site.url, image) : "";
  const tags: string[] = [
    `<meta property="og:type" content="${escapeHtml(ogType)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(cfg.site.title)}" />`,
  ];
  if (description)
    tags.push(`<meta property="og:description" content="${escapeHtml(description)}" />`);
  if (absUrl) tags.push(`<meta property="og:url" content="${escapeHtml(absUrl)}" />`);
  if (absImage) tags.push(`<meta property="og:image" content="${escapeHtml(absImage)}" />`);
  tags.push(
    `<meta name="twitter:card" content="${absImage ? "summary_large_image" : "summary"}" />`,
  );
  tags.push(`<meta name="twitter:title" content="${escapeHtml(title)}" />`);
  if (description)
    tags.push(`<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  return { metaDescription, ogTags: tags.join("\n    "), katexCss };
}

// canonical 规范链接 (仅文章页/单页, 由各 render 函数调用; 列表页/错误页不调用即不输出).
// 复用 toAbsolute, 与 og:url 同源; site.url 为空则不输出 (相对 canonical 有害), href 经 escapeHtml.
export function buildCanonical(cfg: Config, url: string): string {
  // site.url 为空 -> 不输出 (toAbsolute 在无 site.url 时退回相对路径, 相对 canonical 有害).
  if (!cfg.content.canonical.enabled || !cfg.site.url) return "";
  const abs = toAbsolute(cfg.site.url, url);
  return abs ? `<link rel="canonical" href="${escapeHtml(abs)}" />` : "";
}

// JSON-LD 注入 <script> 块: JSON.stringify 后把 < 转义为 \u003c, 防正文中的 </script> 截断脚本.
// 禁用 escapeHtml: script 内为原始文本, HTML 实体不解码, &lt; 会破坏 JSON.parse.
function jsonLdScript(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// publisher = Organization(site.title); 仅 appearance.logo 为 image 且可绝对化时附 logo.
function buildPublisher(cfg: Config): Record<string, unknown> {
  const pub: Record<string, unknown> = { "@type": "Organization", name: cfg.site.title };
  const logo = cfg.appearance.logo;
  // logo 需绝对化: 仅 site.url 非空且 logo 为 image 时附带 (与其它 URL 字段降级策略一致).
  if (cfg.site.url && logo.type === "image" && logo.value) {
    pub.logo = { "@type": "ImageObject", url: toAbsolute(cfg.site.url, logo.value) };
  }
  return pub;
}

/**
 * 文章页 JSON-LD (BlogPosting). 字段"有则出无则省": 仅 datePublished (无 dateModified, 见方案 §1.5);
 * url/@id/image 需 site.url 绝对化, 空则省略 (优雅降级, 与 og:url 一致). 关闭开关 -> 空串.
 */
export function buildArticleJsonLd(cfg: Config, post: Post): string {
  if (!cfg.content.jsonLd.enabled) return "";
  const siteUrl = cfg.site.url;
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    datePublished: post.date,
  };
  const description = post.summary || cfg.site.description;
  if (description) obj.description = description;
  // url/@id/image 需 site.url 绝对化, 空则省略 (toAbsolute 无 site.url 会退回相对路径).
  if (siteUrl && post.cover) obj.image = toAbsolute(siteUrl, post.cover);
  if (post.words) obj.wordCount = post.words;
  if (siteUrl) {
    const abs = toAbsolute(siteUrl, post.url);
    obj.url = abs;
    obj.mainEntityOfPage = { "@type": "WebPage", "@id": abs };
  }
  if (cfg.site.author) obj.author = { "@type": "Person", name: cfg.site.author };
  obj.publisher = buildPublisher(cfg);
  if (cfg.site.language) obj.inLanguage = cfg.site.language;
  return jsonLdScript(obj);
}

// 单页 JSON-LD (WebPage): name + 可选 description/url/inLanguage/isPartOf(站点). 关闭开关 -> 空串.
export function buildPageJsonLd(cfg: Config, page: PageDoc): string {
  if (!cfg.content.jsonLd.enabled) return "";
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
  };
  if (cfg.site.description) obj.description = cfg.site.description;
  // url/isPartOf 需 site.url 绝对化, 空则省略.
  if (cfg.site.url) obj.url = toAbsolute(cfg.site.url, page.url);
  if (cfg.site.language) obj.inLanguage = cfg.site.language;
  if (cfg.site.url)
    obj.isPartOf = { "@type": "WebSite", name: cfg.site.title, url: cfg.site.url };
  return jsonLdScript(obj);
}

// 注入客户端功能开关 (widgets.js 消费 window.__content 决定启用哪些部件); 各页统一注入, 早于 widgets.js.
function contentFlagsScript(cfg: Config): string {
  const c = cfg.content;
  const flags = {
    toc: c.toc.enabled,
    tocMinHeadings: c.toc.minHeadings,
    tocCollapseBelow: c.toc.pcCollapseBelow,
    codeCopy: c.codeCopy.enabled,
    imageZoom: c.imageZoom.enabled,
    share: { enabled: c.share.enabled, networks: c.share.networks },
    widgets: c.widgets.enabled,
  };
  return "<script>window.__content=" + JSON.stringify(flags) + "</script>";
}

// 列表页类型 -> 输出文件 (供 og:url; home 为根). 与 siteService.LIST_PAGES 一致但内联避免循环依赖.
const LIST_FILE: Record<string, string> = {
  home: "",
  archive: "archive.html",
  tag: "tag.html",
  dir: "dir.html",
  tags: "tags.html",
};

// 文章页: 组装 post 类型. content 为已渲染 HTML (不转义), 标记由 main-post partial 内置.
// rootPrefix: 文章页相对站点根的前缀 (默认 postDir 单段 -> "../"), 用于共享资源与标签链接.
export function renderPageHtml(
  post: Post,
  site: SiteConfig,
  provider: TemplateProvider,
  manifest: ThemeManifest,
  chrome: ChromeVars,
  cfg: Config,
  rootPrefix: string,
): string {
  // description: 文章用摘要 (派生), 无摘要回退站点描述.
  const description = post.summary || cfg.site.description || "";
  const seo = buildHeadSeo(cfg, {
    title: post.title,
    description,
    ogType: "article",
    url: post.url,
    image: post.cover,
    contentHtml: post.contentHtml,
  });
  const vars: Record<string, string> = {
    rootPrefix,
    pageTitle: escapeHtml(post.title) + " - " + escapeHtml(site.title),
    title: escapeHtml(post.title),
    siteTitle: escapeHtml(site.title),
    date: post.date,
    dateDisplay: post.date.slice(0, 10),
    content: post.contentHtml,
    readingMeta: buildReadingMeta(post),
    tags: renderTags(post.tags, rootPrefix),
    url: post.url,
    comments: cfg.comments ? renderComments(cfg.comments, chrome.giscusThemeLight) : "",
    headExtra: "", // 文章页无列表数据 kickoff
    contentFlags: contentFlagsScript(cfg),
    metaDescription: seo.metaDescription,
    ogTags: seo.ogTags,
    canonical: buildCanonical(cfg, post.url),
    jsonLd: buildArticleJsonLd(cfg, post),
    katexCss: seo.katexCss,
    ...chrome,
  };
  return assemblePage(provider, manifest, "post", vars);
}

// 独立页: 组装 page 类型 (根级, rootPrefix="./"). 不含 date/tags/comments; 标记由 main-page partial 内置.
export function renderStandalonePageHtml(
  page: PageDoc,
  site: SiteConfig,
  provider: TemplateProvider,
  manifest: ThemeManifest,
  chrome: ChromeVars,
  cfg: Config,
): string {
  // 无正文派生摘要, description 用站点描述.
  const description = cfg.site.description || "";
  const seo = buildHeadSeo(cfg, {
    title: page.title,
    description,
    ogType: "website",
    url: page.url,
    contentHtml: page.contentHtml,
  });
  const vars: Record<string, string> = {
    rootPrefix: "./",
    pageTitle: escapeHtml(page.title) + " - " + escapeHtml(site.title),
    title: escapeHtml(page.title),
    siteTitle: escapeHtml(site.title),
    content: page.contentHtml,
    headExtra: "", // 独立页无列表数据 kickoff
    contentFlags: contentFlagsScript(cfg),
    metaDescription: seo.metaDescription,
    ogTags: seo.ogTags,
    canonical: buildCanonical(cfg, page.url),
    jsonLd: buildPageJsonLd(cfg, page),
    katexCss: seo.katexCss,
    ...chrome,
  };
  return assemblePage(provider, manifest, "page", vars);
}

// 列表数据尽早取数 kickoff (仅列表页, 经 headExtra 注入 head): 首屏必取 JSON 在 head 解析时即发起.
// home/archive 取 site + years; tag/dir 仅 site (分片路径依赖查询串, 动态无法提前). 列表页根级 -> 前缀 "./".
// 失败兜底 (site->{} / years->[]) + 消费端 (browse.js) "有则用无则自取", 故无需额外 catch 防护以外的处理.
function listDataKickoff(pageType: string): string {
  const site =
    'site:fetch("./site.json").then(function(r){return r.json()}).catch(function(){return{}})';
  const years =
    'years:fetch("./data/years.json").then(function(r){return r.json()}).catch(function(){return[]})';
  const tags =
    'tags:fetch("./data/tags.json").then(function(r){return r.json()}).catch(function(){return[]})';
  let fields = site;
  if (pageType === "home" || pageType === "archive") fields = site + "," + years;
  else if (pageType === "tags") fields = site + "," + tags; // 标签云页预取标签分片索引
  return "<script>window.__data={" + fields + "}</script>";
}

// 列表页 (home/archive/tag/dir, 根级 rootPrefix="./"): 仅外壳 + 列表骨架, 正文与标题由客户端脚本运行时填充.
export function renderListPage(
  provider: TemplateProvider,
  manifest: ThemeManifest,
  pageType: string,
  site: SiteConfig,
  chrome: ChromeVars,
  cfg: Config,
): string {
  // 列表页无正文 -> description 用站点描述; 客户端渲染无 .katex -> 无 KaTeX CSS.
  const seo = buildHeadSeo(cfg, {
    title: site.title,
    description: cfg.site.description || "",
    ogType: "website",
    url: LIST_FILE[pageType] ?? "",
  });
  const vars: Record<string, string> = {
    rootPrefix: "./",
    pageTitle: escapeHtml(site.title),
    siteTitle: escapeHtml(site.title),
    headExtra: listDataKickoff(pageType),
    contentFlags: contentFlagsScript(cfg),
    metaDescription: seo.metaDescription,
    ogTags: seo.ogTags,
    katexCss: seo.katexCss,
    ...chrome,
  };
  return assemblePage(provider, manifest, pageType, vars);
}

// 标签渲染为可点击 chip (语义类 .tag .tag-link), 指向标签页; 文本转义, href 用 encodeURIComponent.
// rootPrefix 使文章页 (子目录) 的标签链接仍指向根级 tag.html. 无标签返回空串.
export function renderTags(tags: string[], rootPrefix: string): string {
  return tags
    .map(
      (t) =>
        `<a class="tag tag-link" href="${rootPrefix}tag.html?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`,
    )
    .join("");
}

// giscus 评论挂载点 (#giscus-mount + data-*). 不直接输出脚本: 由 widgets.js 经
// IntersectionObserver 接近视口时按 data-* 懒加载 giscus client.js (仅一次).
// themeUrl: 初始主题, 自定义主题 CSS 的绝对 URL (或内置 "light"); 缺省回退 "light".
// 明暗切换由 head 主题脚本通过 postMessage(setConfig.theme) 处理.
export function renderComments(c: Config["comments"], themeUrl?: string): string {
  if (!c.enabled) return "";
  const attrs = [
    `data-repo="${c.repo}"`,
    `data-repo-id="${c.repoId}"`,
    `data-category="${c.category}"`,
    `data-category-id="${c.categoryId}"`,
    `data-mapping="${c.mapping}"`,
    `data-strict="1"`,
    `data-reactions-enabled="1"`,
    `data-input-position="bottom"`,
    `data-theme="${themeUrl || "light"}"`,
    `data-lang="zh-CN"`,
  ].join(" ");
  return `<div id="giscus-mount" ${attrs}></div>`;
}

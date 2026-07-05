// 共享契约: 领域类型 + 底层接口. 所有层依赖此文件, 反向不依赖.

export interface RawIssue {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
}

// 本地 md 一篇: 把 Front Matter + 正文映射成的合成 RawIssue, 外加源文件所在目录.
// fileDir 供 createLocalImageReader(baseDir) 解析正文里的相对图片 (以 md 文件所在目录为基准).
export interface LocalPost {
  issue: RawIssue;
  fileDir: string; // md 文件所在目录 (绝对或相对仓根); 相对图片解析基准
}

export interface Post {
  nodeId: string;
  url: string;
  title: string;
  date: string;
  contentHtml: string;
  tags: string[];
  dirs: string[]; // 目录归属, 可多个, 可空数组
  // 构建期派生 (full/incremental 由 deriveCardMeta 算出; reassemble 从分片读出透传).
  // 供文章页 meta 行 (阅读时长/字数) 与 head 的 description/OG; 缺失时模板回退站点描述/省略.
  summary?: string;
  cover?: string; // 首图根相对路径 (无首图则空/缺省)
  readingTime?: number; // 预计阅读分钟
  words?: number; // 字数 (CJK 字符 + 拉丁词)
}

export interface ManifestEntry {
  url: string;
  title: string;
  date: string;
  // 旧 posts.json 可能无 tags/dirs, 设为可选以兼容历史数据; 新构建始终写入.
  tags?: string[];
  dirs?: string[];
  // 派生卡片字段 (deriveCardMeta 写入, 随分片去规范化同时落 year/tag/dir 各分片).
  // 客户端 browse.js 渲染卡片时消费; 缺失回退紧凑形态. reassemble 读出透传给 Post.
  summary?: string;
  cover?: string;
  readingTime?: number;
  words?: number;
}
export type Manifest = ManifestEntry[];

// 分片索引项: years.json [{year,count}] (降序); tags.json/dirs.json [{name,slug,count}].
export interface YearIndexEntry {
  year: string;
  count: number;
}
export interface TaxonomyIndexEntry {
  name: string; // 显示名
  slug: string; // 文件名 (= encodeURIComponent(name))
  count: number;
}

// 独立页文档 (渲染用) 与清单条目 (状态机用).
export interface PageDoc {
  nodeId: string;
  url: string; // 路由, 由 meta.url 解析而来 (如 about.html)
  title: string;
  contentHtml: string;
}
export interface PageEntry {
  nodeId: string; // 以 nodeId 为稳定主键, 支持 url 变更/跨类型重定位
  url: string;
  title: string;
}
export type PageManifest = PageEntry[];

export type PageActionType = "publish" | "update" | "unpublish" | "ignore";
export interface PageAction {
  type: PageActionType;
  page?: PageDoc;
  url?: string; // unpublish 时的目标文件
  staleUrl?: string; // url 变更时需删除的旧文件
}

export type FeedFormat = "rss" | "atom" | "json";

export interface Config {
  site: {
    title: string;
    description: string;
    author: string;
    url: string;
    language: string;
  };
  pagination: {
    home: number;
    archive: number;
    directory: number;
    tag: number;
  };
  rss: {
    enabled: boolean;
    formats: FeedFormat[];
    count: number;
    summaryLength: number;
  };
  build: {
    publishedLabel: string;
    metaMarker: string;
    pageLabel: string;
    dirPrefix: string;
    postDir: string; // 文章页输出目录 (默认 post); 归一化后段数决定文章页 rootPrefix 深度
    contentDir: string; // 本地 md 内容根目录 (默认 content); 下设 posts/ 与 pages/ 子目录
    excludedLabels?: string[];
  };
  comments: {
    enabled: boolean;
    repo: string;
    repoId: string;
    category: string;
    categoryId: string;
    mapping: string;
  };
  // 外观/展示 (扩展信息): 主题选择 + logo + 外链 + 页脚. 由 appearance.json 合并, 缺省有默认.
  theme: ThemeSelection;
  appearance: AppearanceConfig;
  // 功能增强 (阅读体验/SEO/媒体/错误页) 集中开关与参数; 由 content.json 合并, 缺省有安全默认.
  content: ContentConfig;
}

// ---- 功能增强配置 (config/content.json) ----
// 各项可独立开关; 数值给安全默认. 锚点随 TOC 常开 (TOC 跳转前提, 不单设开关).
export interface ContentConfig {
  toc: { enabled: boolean; minHeadings: number; pcCollapseBelow: number }; // 目录: minHeadings 少于此数不渲染; pcCollapseBelow 条目少于此数 PC 端折叠为开关
  readingTime: { enabled: boolean; cpm: number; wpm: number }; // 阅读时长: 中文字/分, 英文词/分
  summary: { enabled: boolean; length: number }; // 卡片/SEO 摘要 (与 feed.summaryLength 数值独立)
  cover: { enabled: boolean }; // 列表卡片首图缩略
  math: { enabled: boolean }; // KaTeX 数学公式
  codeCopy: { enabled: boolean }; // 代码复制按钮
  imageZoom: { enabled: boolean }; // 图片灯箱
  share: { enabled: boolean; networks: string[] }; // 分享: networks 属白名单
  widgets: { enabled: boolean }; // 总控回顶部/回首页/阅读进度
  og: { enabled: boolean }; // OG/社交卡片 meta
  canonical: { enabled: boolean }; // canonical 规范链接 (仅文章页/单页)
  jsonLd: { enabled: boolean }; // JSON-LD 结构化数据 (文章 BlogPosting/单页 WebPage)
  webp: { enabled: boolean; quality: number }; // 图片转 WebP (质量 1-100)
  errorPages: { codes: number[] }; // 生成的错误页 HTTP 码表
}

// ---- 主题/外观配置 (config/appearance.json) ----
export interface ThemeSelection {
  name: string; // 主题文件夹名 (themes/<name>)
  skin: string; // 皮肤令牌文件名 (不含 .css); 空串表示用主题 theme.json.defaultSkin
}
export interface LinkItem {
  label: string;
  href: string; // 仅外链 (http/https); 内置导航由主题 theme.json.nav 自动生成
}
export interface LogoConfig {
  type: "text" | "image";
  value: string; // text: 文本; image: 图片 URL
}
export interface FooterConfig {
  copyright: string;
  icp: string; // 工信部 ICP 备案号 (可空)
  police: string; // 公安备案文案 (可空)
  policeCode: string; // 公安备案号码 (用于拼官方链接, 可空)
}
export interface AppearanceConfig {
  theme: ThemeSelection;
  logo: LogoConfig;
  links: LinkItem[];
  footer: FooterConfig;
}

// ---- 主题清单 (themes/<name>/theme.json) ----
export interface ThemeManifest {
  defaultSkin: string;
  mains: Record<string, string>; // 页类型 -> main 片段文件名 (列表页共用 main-list)
  scripts: Record<string, string[]>; // 页类型 -> 客户端脚本列表
  nav: { label: string; page: string }[]; // 内置导航 (指向既有页面)
  widgets: Record<string, string[]>; // 各页类型部件占位声明
  assets: string[]; // 需原样拷贝到站点根的静态资产 (如 giscus 主题 CSS)
}

// 构建期派生、填入外壳 partial 的 HTML 片段 (均为已转义/编码的安全 HTML).
export interface ChromeVars {
  logo: string;
  nav: string;
  footerCopyright: string;
  footerIcp: string;
  footerPolice: string;
  rssLinks: string;
  giscusThemeLight: string; // giscus 浅色主题值 (自定义 CSS 的绝对 URL, 或内置 "light")
  giscusThemeDark: string; // giscus 深色主题值 (绝对 URL 或内置 "dark")
  giscusThemeLightJs: string; // 上述值的 JS 字符串字面量, 供内联主题脚本使用
  giscusThemeDarkJs: string; // 上述值的 JS 字符串字面量, 供内联主题脚本使用
  lang: string; // <html lang> 值 (源自 cfg.site.language, 缺省 zh-CN); 经各 render 的 ...chrome 注入 {{lang}}, 不写入 chrome.json
}

// chrome.json 模型 (运行时由 chrome.js 注入挂载点的外壳 HTML 片段).
// 内部跨页链接含 %ROOT% 占位, 由 chrome.js 按页面 data-root 替换. 不含 giscus 主题 (见 themeService).
export interface ChromeData {
  siteTitle: string; // 纯文本原文 (chrome.js 经 textContent 注入, 不预转义), 供 #site-title
  logo: string; // HTML 片段
  nav: string; // HTML 片段
  footer: string; // HTML 片段 (版权 + ICP + 公安备案)
  rssLinks: string; // HTML 片段
}

export interface SiteConfig {
  title: string;
  pagination: { home: number; archive: number; directory: number; tag: number };
}

// 目录/标签 map 输出结构 (名称 -> 该名下文章列表).
export interface TaxonomyGroup {
  name: string;
  posts: ManifestEntry[];
}

export type ActionType = "publish" | "update" | "unpublish" | "ignore";
export interface Action {
  type: ActionType;
  post?: Post;
  url?: string;
}

export type BuildMode = "incremental" | "full" | "fixture";

// 底层接口 (infra 实现, domain 依赖抽象, 便于测试注入 mock)
export interface GitHubApi {
  listIssues(
    repo: string,
    opts: { state: "open"; labels: string },
  ): Promise<RawIssue[]>;
  getIssueByNumber(repo: string, num: number): Promise<RawIssue>;
}
export interface EventSource {
  readIssue(): RawIssue;
  // webhook 顶层 action (opened/edited/deleted/closed/reopened...). 本地 fixture 可返回 null.
  readAction(): string | null;
}
export interface Markdown {
  render(md: string): string;
}
// 构建期代码高亮: 输入渲染后 HTML, 返回高亮后的 HTML (纯函数实现, 见 domain/highlight.ts).
export interface Highlighter {
  highlight(html: string): string;
}
export interface FileStore {
  read(rel: string): string | null;
  write(rel: string, content: string): void;
  remove(rel: string): void;
  exists(rel: string): boolean;
  copyInto(srcAbs: string, rel: string): void;
writeBytes(rel: string, bytes: Uint8Array): void;
  // 列出 dir 下直接子项名 (文件/子目录名); 目录不存在返回 []. 供图片判存.
  list(dir: string): string[];
  // 递归列出 dir 下所有文件的相对路径 (相对 baseDir, 不含目录项本身); 目录不存在返回 [].
  // dir="" 表示站点根. 供 full 保图片清理与孤儿回收 (需穿透 post/<id>/ 等子目录, list 仅列一层不够).
  listAll(dir: string): string[];
  // 清空根目录下除顶层白名单 (keep) 外的全部文件/目录. 供 full 清旧产物.
  clearExcept(keep: string[]): void;
}

export interface DownloadedImage {
  bytes: Uint8Array;
  ext: string;
  width?: number;
  height?: number;
  sourceBytes?: Uint8Array;
  sourceExt?: string;
}

export type ImageSource =
  | { kind: "github-issue"; repo: string; issueNumber: number }
  | { kind: "local-markdown" };

export interface VerifiedAttachmentRule {
  host: string;
  pathPattern: RegExp;
  sourceRepo: string;
  authMode: "bearer" | "none";
  evidence: {
    issueNumber: number;
    capturedAt: string;
    urlShape: string;
    anonymousStatus: number;
    bearerStatus?: number;
    sessionCookieStatus?: number;
    authenticatedOk: boolean;
  };
}

export interface GitHubAttachmentResolutionRule {
  sourceRepo: string;
  canonicalHost: string;
  canonicalPathPattern: RegExp;
  signedHost: string;
  signedPathPattern: RegExp;
  signedQueryParam: string;
  evidence: {
    verificationRepo: string;
    issueNumber: number;
    capturedAt: string;
    canonicalUrlShape: string;
    signedUrlShape: string;
    signedUrlSamples: readonly {
      source: string;
      capturedAt: string;
      host: string;
      path: string;
      queryParam: string;
      contentTypeHint?: string;
      jwtIssuer?: string;
      jwtAudience?: string;
      jwtNotBeforeUtc?: string;
      jwtExpiresUtc?: string;
    }[];
    markdownApiStatus: number;
    signedAnonymousStatus: number;
  };
}

export interface ImageAuthPolicy {
  token?: string;
  contentRepo?: string;
  verifiedAttachmentRules?: readonly VerifiedAttachmentRule[];
  githubAttachmentResolutionRules?: readonly GitHubAttachmentResolutionRule[];
}

export interface ImageDownloader {
download(url: string, source?: ImageSource): Promise<DownloadedImage | null>;
}

// 端口: 模板提供者. 按名取模板字符串, 解耦模板来源 (文件系统/内存/远程), 便于替换模板.
export interface TemplateProvider {
  read(name: string): string; // 如 read("post.html") / read("page.html")
}

// 与具体库无关的 feed 模型, 由 domain 组装, 交 FeedRenderer 渲染.
export interface FeedChannel {
  title: string;
  description: string;
  id: string; // 通常为 site.url
  link: string;
  language: string;
  author: string;
  updated: string; // feed 级更新时间, 取最新文章日期 (无文章时取构建时刻)
}
export interface FeedItem {
  id: string; // 稳定 guid, 取绝对 permalink (link)
  title: string;
  link: string; // 绝对 URL
  date: string;
  description?: string; // 摘要模式
  content?: string; // 全文模式 (已绝对化)
}

// 端口: feed 渲染. 同一模型产出三格式. 默认实现基于 npm `feed`, 可替换.
export interface FeedRenderer {
  render(
    channel: FeedChannel,
    items: FeedItem[],
  ): { rss: string; atom: string; json: string };
}

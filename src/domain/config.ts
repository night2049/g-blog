// 加载并合并 config/ 多文件配置 (fail-fast 校验), 提取前端公开子集.
// 基础信息 (site/build) 缺失即抛错; 扩展信息 (feed/comments/appearance) 缺省有默认.
import type {
  AppearanceConfig,
  Config,
  ContentConfig,
  FeedFormat,
  FileStore,
  LinkItem,
  LogoConfig,
  SiteConfig,
  ThemeSelection,
} from "./types.ts";

const FEED_FORMATS: ReadonlySet<string> = new Set(["rss", "atom", "json"]);
const COMMENT_MAPPINGS: ReadonlySet<string> = new Set([
  "pathname",
  "url",
  "title",
  "og:title",
  "specific",
  "number",
]);
const SITE_LANGUAGE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const GISCUS_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// 分享渠道白名单 (content.json share.networks 校验; "x" 在 widgets.js 映射为 twitter).
const SHARE_NETWORKS: ReadonlySet<string> = new Set([
  "copy",
  "x",
  "twitter",
  "telegram",
  "weibo",
  "facebook",
  "linkedin",
  "reddit",
  "whatsapp",
  "email",
]);

type JsonRecord = Record<string, unknown>;

// 正整数校验.
function isPositiveInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function assertRecord(v: unknown, label: string): JsonRecord {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error(label + " 必须为对象");
  return v as JsonRecord;
}

function optionalRecord(v: unknown, label: string): JsonRecord | undefined {
  if (v === undefined || v === null) return undefined;
  return assertRecord(v, label);
}

function assertString(v: unknown, label: string): string {
  if (typeof v !== "string") throw new Error(label + " 必须为字符串");
  return v;
}

function assertNonEmptyString(v: unknown, label: string): string {
  const s = assertString(v, label);
  if (!s) throw new Error(label + " 缺失");
  return s;
}

function stringOr(v: unknown, def: string, label: string): string {
  if (v === undefined || v === null) return def;
  return assertString(v, label);
}

function validateSiteUrl(url: string): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("config/site.json: site.url 必须为合法 http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("config/site.json: site.url 必须为 http(s) URL");
}

function validateLanguage(language: string): void {
  if (!SITE_LANGUAGE_RE.test(language))
    throw new Error("config/site.json: site.language 必须为合法 BCP47 语言标签");
}

function validateGiscusComments(c: Config["comments"]): void {
  if (!COMMENT_MAPPINGS.has(c.mapping))
    throw new Error("config/comments.json: mapping 必须为 giscus 白名单值");
  if (!c.enabled) return;
  if (!GISCUS_REPO_RE.test(c.repo))
    throw new Error("config/comments.json: repo 必须形如 owner/repo");
  for (const key of ["repoId", "category", "categoryId"] as const) {
    if (!c[key]) throw new Error("config/comments.json: " + key + " 启用时必填");
  }
}

/**
 * 归一化并校验 build.postDir (文章页输出目录).
 * 规则: 去首尾空白与斜杠; 缺省 "post"; 禁含 ".." 与反斜杠; 允许多段 (a/b).
 * @returns 归一化后的相对目录 (无首尾斜杠)
 * @throws  含 .. / 反斜杠 / 归一化后为空时抛中文错误
 */
export function normalizePostDir(raw: unknown): string {
  if (raw === undefined || raw === null) return "post";
  if (typeof raw !== "string")
    throw new Error("config/build.json: build.postDir 必须为字符串");
  const v = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (v === "") return "post";
  if (v.includes("..")) throw new Error("config/build.json: build.postDir 不得含 ..");
  if (v.includes("\\"))
    throw new Error("config/build.json: build.postDir 不得含反斜杠");
  return v;
}

// postDir 归一化后的路径段数 (决定文章页相对根的深度).
export function postDirDepth(postDir: string): number {
  const v = postDir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return v === "" ? 0 : v.split("/").length;
}

/**
 * 归一化并校验 build.contentDir (本地 md 内容根目录).
 * 规则同 normalizePostDir: 去首尾空白与斜杠; 缺省 "content"; 禁含 ".." 与反斜杠; 允许多段.
 * @returns 归一化后的相对目录 (无首尾斜杠)
 * @throws  含 .. / 反斜杠 / 非字符串时抛中文错误
 */
export function normalizeContentDir(raw: unknown): string {
  if (raw === undefined || raw === null) return "content";
  if (typeof raw !== "string")
    throw new Error("config/build.json: build.contentDir 必须为字符串");
  const v = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (v === "") return "content";
  if (v.includes(".."))
    throw new Error("config/build.json: build.contentDir 不得含 ..");
  if (v.includes("\\"))
    throw new Error("config/build.json: build.contentDir 不得含反斜杠");
  return v;
}

// 由目录深度生成相对根前缀: depth<=0 -> "./"; 否则 "../" 重复 depth 次.
export function rootPrefixFor(depth: number): string {
  return depth <= 0 ? "./" : "../".repeat(depth);
}

// 读单个配置文件; 不存在返回 null, 解析失败抛中文错误.
function readJson(fs: FileStore, path: string): unknown | null {
  const text = fs.read(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("配置文件 JSON 解析失败: " + path);
  }
}

/**
 * 读取 config/ 目录多文件并合并校验为内存 Config.
 * @param fs   以内容仓根为基准的 FileStore
 * @param dir  配置目录, 默认 "config"
 * @returns    合并后的内存 Config (site/build/pagination/rss/comments/theme/appearance)
 * @throws     基础文件缺失/字段非法时抛中文错误
 */
export function loadConfig(fs: FileStore, dir: string = "config"): Config {
  const p = (name: string) => dir.replace(/\/+$/, "") + "/" + name;

  // ---- 基础: site.json (必需) ----
  const siteRaw = readJson(fs, p("site.json"));
  if (siteRaw === null) throw new Error("找不到基础配置文件: " + p("site.json"));
  const siteObj = assertRecord(siteRaw, "config/site.json");
  const site: Config["site"] = {
    title: assertNonEmptyString(siteObj.title, "config/site.json: site.title"),
    description: stringOr(siteObj.description, "", "config/site.json: site.description"),
    author: stringOr(siteObj.author, "", "config/site.json: site.author"),
    url: stringOr(siteObj.url, "", "config/site.json: site.url"),
    language: stringOr(siteObj.language, "zh-CN", "config/site.json: site.language"),
  };
  validateSiteUrl(site.url);
  validateLanguage(site.language);

  // ---- 基础: build.json (必需, 含 build + pagination) ----
  const buildFileRaw = readJson(fs, p("build.json"));
  if (buildFileRaw === null) throw new Error("找不到基础配置文件: " + p("build.json"));
  const buildFile = assertRecord(buildFileRaw, "config/build.json");
  const buildRaw = assertRecord(buildFile.build, "config/build.json: build");
  const paginationRaw = assertRecord(buildFile.pagination, "config/build.json: pagination");
  const build: Config["build"] = {
    publishedLabel: assertNonEmptyString(
      buildRaw.publishedLabel,
      "config/build.json: build.publishedLabel",
    ),
    metaMarker: assertNonEmptyString(buildRaw.metaMarker, "config/build.json: build.metaMarker"),
    pageLabel: assertNonEmptyString(buildRaw.pageLabel, "config/build.json: build.pageLabel"),
    dirPrefix: assertNonEmptyString(buildRaw.dirPrefix, "config/build.json: build.dirPrefix"),
    postDir: normalizePostDir(buildRaw.postDir),
    contentDir: normalizeContentDir(buildRaw.contentDir),
    excludedLabels: [],
  };
  if (buildRaw.excludedLabels !== undefined) {
    if (
      !Array.isArray(buildRaw.excludedLabels) ||
      !buildRaw.excludedLabels.every((s: unknown) => typeof s === "string")
    )
      throw new Error("config/build.json: build.excludedLabels 必须为字符串数组");
    build.excludedLabels = buildRaw.excludedLabels as string[];
  }
  for (const k of ["home", "archive", "directory", "tag"] as const) {
    if (!isPositiveInt(paginationRaw[k]))
      throw new Error("config/build.json: pagination." + k + " 必须为正整数");
  }
  const pagination: Config["pagination"] = {
    home: paginationRaw.home as number,
    archive: paginationRaw.archive as number,
    directory: paginationRaw.directory as number,
    tag: paginationRaw.tag as number,
  };

  // ---- 扩展: feed.json (可选, 缺省关闭) ----
  const feedFileRaw = readJson(fs, p("feed.json"));
  let rss: Config["rss"];
  if (feedFileRaw === null) {
    rss = { enabled: false, formats: [], count: 10, summaryLength: 0 };
  } else {
    const feedFile = assertRecord(feedFileRaw, "config/feed.json");
    if (typeof feedFile.enabled !== "boolean")
      throw new Error("config/feed.json: enabled 必须为布尔");
    if (feedFile.enabled) {
      if (
        !Array.isArray(feedFile.formats) ||
        feedFile.formats.length === 0 ||
        !feedFile.formats.every((f) => typeof f === "string" && FEED_FORMATS.has(f))
      )
        throw new Error("config/feed.json: formats 必须为 rss/atom/json 的非空子集");
      if (!isPositiveInt(feedFile.count))
        throw new Error("config/feed.json: count 必须为正整数");
      if (
        typeof feedFile.summaryLength !== "number" ||
        !Number.isInteger(feedFile.summaryLength) ||
        feedFile.summaryLength < 0
      )
        throw new Error("config/feed.json: summaryLength 必须为 >=0 整数");
    }
    rss = {
      enabled: feedFile.enabled,
      formats: (feedFile.formats ?? []) as FeedFormat[],
      count: typeof feedFile.count === "number" ? feedFile.count : 10,
      summaryLength: typeof feedFile.summaryLength === "number" ? feedFile.summaryLength : 0,
    };
  }
  // rss 启用时才强制 site.url (RSS 需绝对链接).
  if (rss.enabled && !site.url)
    throw new Error("config/site.json: url 在 feed.enabled 时必填");

  // ---- 扩展: comments.json (可选, 缺省关闭) ----
  const commentsFile = readJson(fs, p("comments.json"));
  const comments: Config["comments"] = commentsFile
    ? loadCommentsConfig(commentsFile)
    : {
        enabled: false,
        repo: "",
        repoId: "",
        category: "",
        categoryId: "",
        mapping: "pathname",
      };

  // ---- 扩展: appearance.json (可选, 缺省默认主题 + 文本 logo=site.title + 空外链/页脚) ----
  const appearance = loadAppearance(readJson(fs, p("appearance.json")), site.title);

  // ---- 扩展: content.json (功能增强开关与参数, 可选, 缺省安全默认) ----
  const content = loadContentConfig(readJson(fs, p("content.json")));

  return {
    site,
    pagination,
    rss,
    build,
    comments,
    theme: appearance.theme,
    appearance,
    content,
  };
}

function loadCommentsConfig(raw: unknown): Config["comments"] {
  const obj = assertRecord(raw, "config/comments.json");
  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean")
    throw new Error("config/comments.json: enabled 必须为布尔");
  const comments: Config["comments"] = {
    enabled: obj.enabled === true,
    repo: obj.repo === undefined ? "" : assertString(obj.repo, "config/comments.json: repo"),
    repoId:
      obj.repoId === undefined ? "" : assertString(obj.repoId, "config/comments.json: repoId"),
    category:
      obj.category === undefined
        ? ""
        : assertString(obj.category, "config/comments.json: category"),
    categoryId:
      obj.categoryId === undefined
        ? ""
        : assertString(obj.categoryId, "config/comments.json: categoryId"),
    mapping:
      obj.mapping === undefined
        ? "pathname"
        : assertString(obj.mapping, "config/comments.json: mapping"),
  };
  validateGiscusComments(comments);
  return comments;
}

// 解析 appearance.json (含默认兜底与外链/ logo 校验). raw 为 null 时返回全默认.
function loadAppearance(raw: unknown | null, siteTitle: string): AppearanceConfig {
  const obj = raw === null ? undefined : assertRecord(raw, "config/appearance.json");
  const themeObj = optionalRecord(obj?.theme, "config/appearance.json: theme");
  const logoObj = optionalRecord(obj?.logo, "config/appearance.json: logo");
  const footerObj = optionalRecord(obj?.footer, "config/appearance.json: footer");
  const theme: ThemeSelection = {
    name: stringOr(themeObj?.name, "default", "config/appearance.json: theme.name"),
    skin: stringOr(themeObj?.skin, "", "config/appearance.json: theme.skin"),
  };
  if (!theme.name) throw new Error("config/appearance.json: theme.name 不能为空");

  let logo: LogoConfig;
  if (logoObj) {
    if (logoObj.type !== "text" && logoObj.type !== "image")
      throw new Error("config/appearance.json: logo.type 必须为 text 或 image");
    if (typeof logoObj.value !== "string" || logoObj.value.trim() === "")
      throw new Error("config/appearance.json: logo.value 必须为非空字符串");
    logo = { type: logoObj.type, value: logoObj.value };
  } else {
    logo = { type: "text", value: siteTitle };
  }

  const links: LinkItem[] = [];
  if (obj?.links !== undefined) {
    if (!Array.isArray(obj.links))
      throw new Error("config/appearance.json: links 必须为数组");
    for (const item of obj.links) {
      const it = assertRecord(item, "config/appearance.json: links[]");
      if (!it || typeof it.label !== "string" || typeof it.href !== "string")
        throw new Error("config/appearance.json: links[] 需含 label/href 字符串");
      if (!/^https?:\/\//i.test(it.href))
        throw new Error(
          "config/appearance.json: links[].href 必须为 http(s):// 外链: " + it.href,
        );
      links.push({ label: it.label, href: it.href });
    }
  }

  const footer = {
    copyright: stringOr(footerObj?.copyright, "", "config/appearance.json: footer.copyright"),
    icp: stringOr(footerObj?.icp, "", "config/appearance.json: footer.icp"),
    police: stringOr(footerObj?.police, "", "config/appearance.json: footer.police"),
    policeCode: stringOr(footerObj?.policeCode, "", "config/appearance.json: footer.policeCode"),
  };

  return { theme, logo, links, footer };
}

// 校验整数区间 (含端点); 失败抛中文错误.
function intInRangeOr(v: unknown, def: number, min: number, max: number, label: string): number {
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new Error(
      "config/content.json: " + label + " 必须为 " + min + "-" + max + " 整数",
    );
  return v;
}
function posIntOr(v: unknown, def: number, label: string): number {
  if (v === undefined) return def;
  if (!isPositiveInt(v))
    throw new Error("config/content.json: " + label + " 必须为正整数");
  return v as number;
}
function boolOr(v: unknown, def: boolean, label: string): boolean {
  if (v === undefined) return def;
  if (typeof v !== "boolean")
    throw new Error("config/content.json: " + label + " 必须为布尔");
  return v;
}

/**
 * 解析 content.json (功能增强开关与参数). raw 为 null 时全默认.
 * 各项独立开关; 数值正整数/区间、share.networks 白名单、errorPages.codes 有效 HTTP 码均 fail-fast 中文错误.
 */
function loadContentConfig(raw: unknown | null): ContentConfig {
  const r = raw === null ? {} : assertRecord(raw, "config/content.json");
  const toc = optionalRecord(r.toc, "config/content.json: toc");
  const readingTime = optionalRecord(r.readingTime, "config/content.json: readingTime");
  const summary = optionalRecord(r.summary, "config/content.json: summary");
  const cover = optionalRecord(r.cover, "config/content.json: cover");
  const math = optionalRecord(r.math, "config/content.json: math");
  const codeCopy = optionalRecord(r.codeCopy, "config/content.json: codeCopy");
  const imageZoom = optionalRecord(r.imageZoom, "config/content.json: imageZoom");
  const share = optionalRecord(r.share, "config/content.json: share");
  const widgets = optionalRecord(r.widgets, "config/content.json: widgets");
  const og = optionalRecord(r.og, "config/content.json: og");
  const canonical = optionalRecord(r.canonical, "config/content.json: canonical");
  const jsonLd = optionalRecord(r.jsonLd, "config/content.json: jsonLd");
  const webp = optionalRecord(r.webp, "config/content.json: webp");
  const errorPages = optionalRecord(r.errorPages, "config/content.json: errorPages");

  // share.networks: 缺省四项; 提供则须为白名单字符串数组.
  let networks: string[] = ["copy", "x", "telegram", "weibo"];
  if (share?.networks !== undefined) {
    if (
      !Array.isArray(share.networks) ||
      !share.networks.every(
        (s: unknown) => typeof s === "string" && SHARE_NETWORKS.has(s),
      )
    )
      throw new Error(
        "config/content.json: share.networks 必须为白名单字符串数组 (copy/x/twitter/telegram/weibo/facebook/linkedin/reddit/whatsapp/email)",
      );
    networks = share.networks as string[];
  }

  // errorPages.codes: 缺省 404/403/500; 提供则须为有效 HTTP 码 (100-599) 数组 (允许空 = 不生成).
  let codes: number[] = [404, 403, 500];
  if (errorPages?.codes !== undefined) {
    if (
      !Array.isArray(errorPages.codes) ||
      !errorPages.codes.every(
        (c: unknown) =>
          typeof c === "number" && Number.isInteger(c) && c >= 100 && c <= 599,
      )
    )
      throw new Error(
        "config/content.json: errorPages.codes 必须为有效 HTTP 码 (100-599) 数组",
      );
    codes = errorPages.codes as number[];
  }

  return {
    toc: {
      enabled: boolOr(toc?.enabled, true, "toc.enabled"),
      minHeadings: posIntOr(toc?.minHeadings, 2, "toc.minHeadings"),
      pcCollapseBelow: posIntOr(toc?.pcCollapseBelow, 5, "toc.pcCollapseBelow"),
    },
    readingTime: {
      enabled: boolOr(readingTime?.enabled, true, "readingTime.enabled"),
      cpm: posIntOr(readingTime?.cpm, 400, "readingTime.cpm"),
      wpm: posIntOr(readingTime?.wpm, 250, "readingTime.wpm"),
    },
    summary: {
      enabled: boolOr(summary?.enabled, true, "summary.enabled"),
      length: posIntOr(summary?.length, 120, "summary.length"),
    },
    cover: { enabled: boolOr(cover?.enabled, true, "cover.enabled") },
    math: { enabled: boolOr(math?.enabled, true, "math.enabled") },
    codeCopy: { enabled: boolOr(codeCopy?.enabled, true, "codeCopy.enabled") },
    imageZoom: { enabled: boolOr(imageZoom?.enabled, true, "imageZoom.enabled") },
    share: { enabled: boolOr(share?.enabled, true, "share.enabled"), networks },
    widgets: { enabled: boolOr(widgets?.enabled, true, "widgets.enabled") },
    og: { enabled: boolOr(og?.enabled, true, "og.enabled") },
    canonical: { enabled: boolOr(canonical?.enabled, true, "canonical.enabled") },
    jsonLd: { enabled: boolOr(jsonLd?.enabled, true, "jsonLd.enabled") },
    webp: {
      enabled: boolOr(webp?.enabled, true, "webp.enabled"),
      quality: intInRangeOr(webp?.quality, 80, 1, 100, "webp.quality"),
    },
    errorPages: { codes },
  };
}

export function toSiteConfig(cfg: Config): SiteConfig {
  return {
    title: cfg.site.title,
    pagination: {
      home: cfg.pagination.home,
      archive: cfg.pagination.archive,
      directory: cfg.pagination.directory,
      tag: cfg.pagination.tag,
    },
  };
}

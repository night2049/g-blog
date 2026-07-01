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

// 正整数校验.
function isPositiveInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
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
function readJson(fs: FileStore, path: string): any | null {
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
  const site = readJson(fs, p("site.json"));
  if (!site) throw new Error("找不到基础配置文件: " + p("site.json"));
  if (!site.title) throw new Error("config/site.json: site.title 缺失");
  site.description = site.description ?? "";
  site.author = site.author ?? "";
  site.url = site.url ?? "";
  if (!site.language) site.language = "zh-CN";

  // ---- 基础: build.json (必需, 含 build + pagination) ----
  const buildFile = readJson(fs, p("build.json"));
  if (!buildFile) throw new Error("找不到基础配置文件: " + p("build.json"));
  const build = buildFile.build;
  const pagination = buildFile.pagination;
  if (!build?.publishedLabel)
    throw new Error("config/build.json: build.publishedLabel 缺失");
  if (!build.metaMarker) throw new Error("config/build.json: build.metaMarker 缺失");
  if (!build.pageLabel) throw new Error("config/build.json: build.pageLabel 缺失");
  if (!build.dirPrefix) throw new Error("config/build.json: build.dirPrefix 缺失");
  build.postDir = normalizePostDir(build.postDir);
  build.contentDir = normalizeContentDir(build.contentDir);
  if (build.excludedLabels !== undefined) {
    if (
      !Array.isArray(build.excludedLabels) ||
      !build.excludedLabels.every((s: unknown) => typeof s === "string")
    )
      throw new Error("config/build.json: build.excludedLabels 必须为字符串数组");
  } else {
    build.excludedLabels = [];
  }
  for (const k of ["home", "archive", "directory", "tag"] as const) {
    if (!isPositiveInt(pagination?.[k]))
      throw new Error("config/build.json: pagination." + k + " 必须为正整数");
  }

  // ---- 扩展: feed.json (可选, 缺省关闭) ----
  const feedFile = readJson(fs, p("feed.json"));
  let rss: Config["rss"];
  if (!feedFile) {
    rss = { enabled: false, formats: [], count: 10, summaryLength: 0 };
  } else {
    if (typeof feedFile.enabled !== "boolean")
      throw new Error("config/feed.json: enabled 必须为布尔");
    if (feedFile.enabled) {
      if (
        !Array.isArray(feedFile.formats) ||
        feedFile.formats.length === 0 ||
        !feedFile.formats.every((f: string) => FEED_FORMATS.has(f))
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
      count: feedFile.count ?? 10,
      summaryLength: feedFile.summaryLength ?? 0,
    };
  }
  // rss 启用时才强制 site.url (RSS 需绝对链接).
  if (rss.enabled && !site.url)
    throw new Error("config/site.json: url 在 feed.enabled 时必填");

  // ---- 扩展: comments.json (可选, 缺省关闭) ----
  const commentsFile = readJson(fs, p("comments.json"));
  const comments: Config["comments"] = commentsFile
    ? {
        enabled: commentsFile.enabled === true,
        repo: commentsFile.repo ?? "",
        repoId: commentsFile.repoId ?? "",
        category: commentsFile.category ?? "",
        categoryId: commentsFile.categoryId ?? "",
        mapping: commentsFile.mapping ?? "pathname",
      }
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
  } as Config;
}

// 解析 appearance.json (含默认兜底与外链/ logo 校验). raw 为 null 时返回全默认.
function loadAppearance(raw: any | null, siteTitle: string): AppearanceConfig {
  const theme: ThemeSelection = {
    name: (raw?.theme?.name && String(raw.theme.name)) || "default",
    skin: raw?.theme?.skin ? String(raw.theme.skin) : "",
  };
  if (!theme.name) throw new Error("config/appearance.json: theme.name 不能为空");

  let logo: LogoConfig;
  if (raw?.logo) {
    if (raw.logo.type !== "text" && raw.logo.type !== "image")
      throw new Error("config/appearance.json: logo.type 必须为 text 或 image");
    if (typeof raw.logo.value !== "string" || raw.logo.value.trim() === "")
      throw new Error("config/appearance.json: logo.value 必须为非空字符串");
    logo = { type: raw.logo.type, value: raw.logo.value };
  } else {
    logo = { type: "text", value: siteTitle };
  }

  const links: LinkItem[] = [];
  if (raw?.links !== undefined) {
    if (!Array.isArray(raw.links))
      throw new Error("config/appearance.json: links 必须为数组");
    for (const it of raw.links) {
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
    copyright: raw?.footer?.copyright ?? "",
    icp: raw?.footer?.icp ?? "",
    police: raw?.footer?.police ?? "",
    policeCode: raw?.footer?.policeCode ?? "",
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
function loadContentConfig(raw: any | null): ContentConfig {
  const r = raw ?? {};

  // share.networks: 缺省四项; 提供则须为白名单字符串数组.
  let networks: string[] = ["copy", "x", "telegram", "weibo"];
  if (r.share?.networks !== undefined) {
    if (
      !Array.isArray(r.share.networks) ||
      !r.share.networks.every(
        (s: unknown) => typeof s === "string" && SHARE_NETWORKS.has(s),
      )
    )
      throw new Error(
        "config/content.json: share.networks 必须为白名单字符串数组 (copy/x/twitter/telegram/weibo/facebook/linkedin/reddit/whatsapp/email)",
      );
    networks = r.share.networks as string[];
  }

  // errorPages.codes: 缺省 404/403/500; 提供则须为有效 HTTP 码 (100-599) 数组 (允许空 = 不生成).
  let codes: number[] = [404, 403, 500];
  if (r.errorPages?.codes !== undefined) {
    if (
      !Array.isArray(r.errorPages.codes) ||
      !r.errorPages.codes.every(
        (c: unknown) =>
          typeof c === "number" && Number.isInteger(c) && c >= 100 && c <= 599,
      )
    )
      throw new Error(
        "config/content.json: errorPages.codes 必须为有效 HTTP 码 (100-599) 数组",
      );
    codes = r.errorPages.codes as number[];
  }

  return {
    toc: {
      enabled: boolOr(r.toc?.enabled, true, "toc.enabled"),
      minHeadings: posIntOr(r.toc?.minHeadings, 2, "toc.minHeadings"),
      pcCollapseBelow: posIntOr(r.toc?.pcCollapseBelow, 5, "toc.pcCollapseBelow"),
    },
    readingTime: {
      enabled: boolOr(r.readingTime?.enabled, true, "readingTime.enabled"),
      cpm: posIntOr(r.readingTime?.cpm, 400, "readingTime.cpm"),
      wpm: posIntOr(r.readingTime?.wpm, 250, "readingTime.wpm"),
    },
    summary: {
      enabled: boolOr(r.summary?.enabled, true, "summary.enabled"),
      length: posIntOr(r.summary?.length, 120, "summary.length"),
    },
    cover: { enabled: boolOr(r.cover?.enabled, true, "cover.enabled") },
    math: { enabled: boolOr(r.math?.enabled, true, "math.enabled") },
    codeCopy: { enabled: boolOr(r.codeCopy?.enabled, true, "codeCopy.enabled") },
    imageZoom: { enabled: boolOr(r.imageZoom?.enabled, true, "imageZoom.enabled") },
    share: { enabled: boolOr(r.share?.enabled, true, "share.enabled"), networks },
    widgets: { enabled: boolOr(r.widgets?.enabled, true, "widgets.enabled") },
    og: { enabled: boolOr(r.og?.enabled, true, "og.enabled") },
    canonical: { enabled: boolOr(r.canonical?.enabled, true, "canonical.enabled") },
    jsonLd: { enabled: boolOr(r.jsonLd?.enabled, true, "jsonLd.enabled") },
    webp: {
      enabled: boolOr(r.webp?.enabled, true, "webp.enabled"),
      quality: intInRangeOr(r.webp?.quality, 80, 1, 100, "webp.quality"),
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

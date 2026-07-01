// 本地 Markdown 数据源适配器: 扫描 content/{posts,pages}/**.md -> 解析 Front Matter ->
// 映射为合成 RawIssue, 使下游 (issueToPost/issueToPage/decideAction/shardService 等) 零改动复用.
// 磁盘 IO (Bun.Glob 扫描 + 读盘 + mtime) 放在 infra; 纯映射函数可单测.
//
// 身份契约 (设计 §0/§3.3):
//   node_id = md5(规范化相对路径), 32 位十六进制; 路径是稳定身份, 改正文不变 URL.
//   listLocalPosts (glob 相对子目录) 与 listChangedLocalPosts (git 仓库相对剥 contentDir 前缀)
//   必须经 canonicalRelPath 产出逐字节相同的 relPath, 否则 node_id 分叉, locateEntry/applyRemove 静默失效.
import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Config, LocalPost, RawIssue } from "../domain/types.ts";

// content 下硬编码子目录 -> 领域 kind (本轮不做可配).
const KIND_DIRS: { dir: "posts" | "pages"; kind: LocalKind }[] = [
  { dir: "posts", kind: "post" },
  { dir: "pages", kind: "page" },
];

export type LocalKind = "post" | "page";

// mapToRawIssue 所需的 cfg.build 切片 (标签/目录前缀/meta 标记).
export interface BuildSlice {
  publishedLabel: string;
  pageLabel: string;
  dirPrefix: string;
  metaMarker: string;
}

function sliceBuild(b: Config["build"]): BuildSlice {
  return {
    publishedLabel: b.publishedLabel,
    pageLabel: b.pageLabel,
    dirPrefix: b.dirPrefix,
    metaMarker: b.metaMarker,
  };
}

// md5 十六进制 (32 位); 不裁剪. 本地 md 身份哈希.
export function md5Hex(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

/**
 * 规范化身份相对路径 = 子目录名 (posts/pages) + "/" + 子路径, 统一正斜杠.
 * 两个枚举入口 (glob 相对子目录 / git 仓库相对剥前缀) 都经此函数, 保证 node_id 不分叉.
 * @param subdir "posts" 或 "pages"
 * @param sub    子目录下相对路径 (可含 Windows 反斜杠)
 */
export function canonicalRelPath(subdir: string, sub: string): string {
  const cleanSub = sub.replace(/\\/g, "/").replace(/^\/+/, "");
  return subdir + "/" + cleanSub;
}

/**
 * 切分开头的 YAML Front Matter 围栏 (--- ... ---) 与正文 (纯函数).
 * - 仅匹配字符串开头 (允许前置 BOM) 的围栏; 正文中间出现的 --- 不误切.
 * - 中段交 Bun.YAML.parse, 空围栏返回 null -> 兜底 {}; 非对象 (标量/数组) 同样兜底 {}.
 * - YAML 解析失败抛中文错误 (fail-fast).
 * @returns { data: 解析后的对象; body: 围栏之后的正文 }
 */
export function splitFrontMatter(text: string): {
  data: Record<string, unknown>;
  body: string;
} {
  // ^BOM? --- 换行 (可选: 捕获 yaml 行 + 换行) --- (独占一行, 行尾或文末). 非贪婪取首个闭合围栏.
  // 内容+换行整体可选, 以支持空围栏 (---\n---); 闭合 --- 前必须有换行, 避免 "foo---" 被误判为闭合.
  const re = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
  const m = text.match(re);
  if (!m) return { data: {}, body: text };
  let parsed: unknown;
  try {
    // @ts-ignore - Bun.YAML 内置, @types/bun 可能未覆盖. 空围栏 m[1] 为 undefined -> parse("") -> null.
    parsed = Bun.YAML.parse(m[1] ?? "");
  } catch (e) {
    throw new Error("本地 md Front Matter YAML 解析失败: " + String(e));
  }
  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, body: text.slice(m[0].length) };
}

// 归一化 Front Matter 的 date (恒为字符串, YAML 1.2 core schema 无 timestamp 类型).
// date-only (2025-06-01) 按 UTC 午夜, 与 domain/meta.ts resolveDate 语义一致; 非法返回 null.
function normalizeDate(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const t = Date.parse(dateOnly ? s + "T00:00:00.000Z" : s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

// 取字符串数组: 数组取其中非空字符串项; 单字符串包成单元素数组; 其它 -> [].
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v))
    return v
      .filter((x): x is string => typeof x === "string" && x.trim() !== "")
      .map((x) => x.trim());
  if (typeof v === "string" && v.trim() !== "") return [v.trim()];
  return [];
}

/**
 * 把一篇本地 md 映射为合成 RawIssue (纯函数).
 * 功能: 由 Front Matter + 正文 + mtime 合成下游可消费的 RawIssue.
 * @param relPath 规范化相对路径 (canonicalRelPath 产出); 用于 md5 身份与文件名兜底
 * @param data    Front Matter 解析结果
 * @param body    围栏之后的正文
 * @param mtime   文件修改时间 (date 缺省回退)
 * @param build   cfg.build 切片 (标签/目录前缀/meta 标记)
 * @param kind    "post" | "page"
 * @returns 合成 RawIssue (node_id=md5(relPath), number=0, state=open)
 */
export function mapToRawIssue(
  relPath: string,
  data: Record<string, unknown>,
  body: string,
  mtime: Date,
  build: BuildSlice,
  kind: LocalKind,
): RawIssue {
  const nodeId = md5Hex(relPath);
  const fileBase = relPath
    .split("/")
    .pop()!
    .replace(/\.md$/i, "");
  const title =
    typeof data.title === "string" && data.title.trim() !== ""
      ? data.title.trim()
      : fileBase;
  const date = normalizeDate(data.date) ?? mtime.toISOString();

  // 合成 labels: 草稿不靠 state, 靠是否加 publishedLabel.
  const labels: { name: string }[] = [];
  if (data.draft !== true) labels.push({ name: build.publishedLabel });
  for (const t of toStringArray(data.tags)) labels.push({ name: t });
  for (const c of toStringArray(data.categories))
    labels.push({ name: build.dirPrefix + ":" + c });
  if (kind === "page") labels.push({ name: build.pageLabel });

  // 独立页: 于正文最前注入 <!-- <metaMarker> url: <slug|文件名> --> 块, 使 issueToPage 零改动解析.
  // post 类型不注入 (不污染正文).
  let bodyOut = body;
  if (kind === "page") {
    const slug =
      typeof data.slug === "string" && data.slug.trim() !== ""
        ? data.slug.trim()
        : fileBase;
    bodyOut = "<!-- " + build.metaMarker + "\nurl: " + slug + "\n-->\n" + body;
  }

  return {
    node_id: nodeId,
    number: 0,
    title,
    body: bodyOut,
    state: "open",
    labels,
    created_at: date,
    updated_at: date,
  };
}

/**
 * 扫描 <contentDir>/{posts,pages}/**.md 并映射为 LocalPost[].
 * 功能: 全量枚举本地 md (供 full 双源合并); md5 做一次 Set 校验 (理论碰撞 fail-fast).
 * @param cfg     站点配置 (取 build.contentDir 与 build 切片)
 * @param baseDir contentDir 解析基准 (默认 ".", = 仓库根)
 * @returns 每篇 { issue: 合成 RawIssue, fileDir: md 文件所在目录 }
 * @throws  md5 (node_id) 冲突时抛中文错误
 */
export function listLocalPosts(cfg: Config, baseDir: string = "."): LocalPost[] {
  const contentDir = cfg.build.contentDir;
  const build = sliceBuild(cfg.build);
  const out: LocalPost[] = [];
  const seen = new Set<string>();
  for (const { dir, kind } of KIND_DIRS) {
    const absDir = join(baseDir, contentDir, dir);
    if (!existsSync(absDir)) continue;
    const glob = new Bun.Glob("**/*.md");
    for (const rel of glob.scanSync({ cwd: absDir })) {
      const relPath = canonicalRelPath(dir, rel);
      const absFile = join(absDir, rel);
      const text = readFileSync(absFile, "utf8").replace(/^\uFEFF/, "");
      const { data, body } = splitFrontMatter(text);
      const mtime = statSync(absFile).mtime;
      const issue = mapToRawIssue(relPath, data, body, mtime, build, kind);
      if (seen.has(issue.node_id))
        throw new Error("本地 md node_id (md5) 冲突: " + relPath);
      seen.add(issue.node_id);
      out.push({ issue, fileDir: dirname(absFile) });
    }
  }
  return out;
}

/**
 * 由本次 push 的 git 改动筛出本地 md 的增改/删除 (供 incrementalLocal).
 * 功能: 仅处理 <contentDir>/{posts,pages}/ 下 .md; A/M -> 读盘构造 LocalPost; D -> 算 node_id 入 removes.
 *       重命名 (R) 已在 computeChangedPaths 拆为 "D 旧 + A 新", 此处不再处理 R.
 * @param changed git diff --name-status 解析结果 [{status,path}]
 * @param cfg     站点配置
 * @param baseDir contentDir 解析基准 (默认 ".")
 * @returns { upserts: 增改篇目, removes: 被删除文件的 node_id 列表 }
 */
export function listChangedLocalPosts(
  changed: { status: string; path: string }[],
  cfg: Config,
  baseDir: string = ".",
): { upserts: LocalPost[]; removes: string[] } {
  const contentDir = cfg.build.contentDir.replace(/\/+$/, "");
  const build = sliceBuild(cfg.build);
  const upserts: LocalPost[] = [];
  const removes: string[] = [];
  const prefix = contentDir + "/";
  for (const { status, path } of changed) {
    const norm = path.replace(/\\/g, "/");
    if (!norm.startsWith(prefix)) continue;
    if (!/\.md$/i.test(norm)) continue;
    const rest = norm.slice(prefix.length); // posts/... 或 pages/...
    const seg = rest.split("/")[0] ?? "";
    const map = KIND_DIRS.find((k) => k.dir === seg);
    if (!map) continue; // 非 posts/pages 子目录, 忽略
    const relPath = canonicalRelPath(seg, rest.slice(seg.length + 1));
    const st = status.trim().toUpperCase();
    if (st.startsWith("D")) {
      // 文件已不在, 只需 node_id 走 applyRemove / removePageByNodeId.
      removes.push(md5Hex(relPath));
      continue;
    }
    // A / M: 读盘构造 LocalPost.
    const absFile = join(baseDir, contentDir, relPath);
    if (!existsSync(absFile)) {
      console.log("[本地增量] 改动文件已不存在, 跳过: " + relPath);
      continue;
    }
    const text = readFileSync(absFile, "utf8").replace(/^\uFEFF/, "");
    const { data, body } = splitFrontMatter(text);
    const mtime = statSync(absFile).mtime;
    const issue = mapToRawIssue(relPath, data, body, mtime, build, map.kind);
    upserts.push({ issue, fileDir: dirname(absFile) });
  }
  return { upserts, removes };
}

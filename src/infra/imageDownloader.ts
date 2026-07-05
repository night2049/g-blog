// 远程图片下载适配器: fetch (可带 token), 从 content-type 或 URL 推断扩展名.
// WebP 转码 (可选): JPEG/PNG/BMP 单次解码 -> 同时编码 WebP + 拿输出尺寸; GIF/SVG 跳过原样保留.
// 尺寸: 不转码时用 Bun.Image.metadata() 只读头取宽高 (消 CLS).
import type {
  DownloadedImage,
  GitHubAttachmentResolutionRule,
  ImageAuthPolicy,
  ImageDownloader,
  ImageSource,
  VerifiedAttachmentRule,
} from "../domain/types.ts";
import * as parse5 from "parse5";
import { safeResolve } from "./fileStore.ts";

const TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

// 可转 WebP 的源格式 (静态光栅图); GIF (可能动图, metadata 不暴露帧信息) 与 SVG (矢量) 不转.
const TRANSCODABLE: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "bmp"]);

function extFromUrl(url: string): string | null {
  const m = (url.split("?")[0] ?? "").match(/\.([a-z0-9]{2,5})$/i);
  const ext = m?.[1];
  return ext ? ext.toLowerCase() : null;
}

export interface WebpOption {
  enabled: boolean;
  quality: number; // 1-100
}

interface ResolvedImageAuthPolicy {
  token: string;
  contentRepo: string;
  verifiedAttachmentRules: readonly VerifiedAttachmentRule[];
  githubAttachmentResolutionRules: readonly GitHubAttachmentResolutionRule[];
}

export function createImageDownloader(
  token?: string,
  fetchImpl: typeof fetch = fetch,
  webp?: WebpOption,
  authPolicy?: ImageAuthPolicy,
): ImageDownloader {
  const policy = normalizeAuthPolicy(token, authPolicy);
  const resolvedAttachmentCache = new Map<string, string | null>();
  return {
    async download(url, source) {
      try {
        const res = await fetchAnonymousThenMaybeAuth(
          url,
          source,
          fetchImpl,
          policy,
          resolvedAttachmentCache,
        );
        if (!res) return null;
        return await responseToDownloadedImage(res, url, webp);
      } catch {
        return null;
      }
    },
  };
}

function normalizeAuthPolicy(token?: string, policy?: ImageAuthPolicy): ResolvedImageAuthPolicy {
  return {
    token: policy?.token ?? token ?? "",
    contentRepo: policy?.contentRepo ?? "",
    verifiedAttachmentRules: policy?.verifiedAttachmentRules ?? [],
    githubAttachmentResolutionRules: policy?.githubAttachmentResolutionRules ?? [],
  };
}

function shouldRetryWithAuth(
  url: URL,
  source: ImageSource | undefined,
  status: number,
  policy: ResolvedImageAuthPolicy,
): boolean {
  if (!policy.token) return false;
  if (url.protocol !== "https:") return false;
  if (source?.kind !== "github-issue") return false;
  if (!policy.contentRepo || source.repo !== policy.contentRepo) return false;
  const rules = policy.verifiedAttachmentRules ?? [];
  return rules.some((rule) => ruleAllowsBearerRetry(rule, url, source.repo!, status));
}

function ruleAllowsBearerRetry(
  rule: VerifiedAttachmentRule,
  url: URL,
  repo: string,
  status: number,
): boolean {
  if (rule.authMode !== "bearer") return false;
  if (rule.host !== url.host) return false;
  if (rule.sourceRepo !== repo) return false;
  if (status !== rule.evidence.anonymousStatus) return false;
  if (!rule.evidence.authenticatedOk) return false;
  if (
    typeof rule.evidence.bearerStatus !== "number" ||
    rule.evidence.bearerStatus < 200 ||
    rule.evidence.bearerStatus >= 300
  )
    return false;
  rule.pathPattern.lastIndex = 0;
  return rule.pathPattern.test(url.pathname);
}

async function fetchAnonymousThenMaybeAuth(
  rawUrl: string,
  source: ImageSource | undefined,
  fetchImpl: typeof fetch,
  policy: ResolvedImageAuthPolicy,
  resolvedAttachmentCache: Map<string, string | null>,
): Promise<Response | null> {
  const attachmentResolution = await resolveGitHubIssueAttachmentUrl(
    rawUrl,
    source,
    fetchImpl,
    policy,
    resolvedAttachmentCache,
  );
  if (attachmentResolution.matched) {
    if (!attachmentResolution.resolvedUrl) return null;
    rawUrl = attachmentResolution.resolvedUrl;
  }
  const resolvedUrl = rawUrl;
  let current = new URL(resolvedUrl);
  const seen = new Set<string>();
  const authed = new Set<string>();
  for (let hop = 0; hop <= 5; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") return null;
    const key = current.toString();
    if (seen.has(key)) return null;
    seen.add(key);

    const anonymous = await fetchWithHeaders(fetchImpl, key);
    if (anonymous.status >= 200 && anonymous.status < 300) return anonymous;

    const anonymousRedirect = redirectTarget(anonymous, current);
    if (anonymousRedirect) {
      current = anonymousRedirect;
      continue;
    }

    if (
      policy.token &&
      !authed.has(key) &&
      shouldRetryWithAuth(current, source, anonymous.status, policy)
    ) {
      authed.add(key);
      const authenticated = await fetchWithHeaders(fetchImpl, key, policy.token);
      if (authenticated.status >= 200 && authenticated.status < 300) return authenticated;
      const authenticatedRedirect = redirectTarget(authenticated, current);
      if (authenticatedRedirect) {
        current = authenticatedRedirect;
        continue;
      }
    }

    console.log("[图片] 下载 HTTP " + anonymous.status + ": " + key);
    return null;
  }
  return null;
}

async function resolveGitHubIssueAttachmentUrl(
  rawUrl: string,
  source: ImageSource | undefined,
  fetchImpl: typeof fetch,
  policy: ResolvedImageAuthPolicy,
  cache: Map<string, string | null>,
): Promise<{ matched: false } | { matched: true; resolvedUrl: string | null }> {
  const match = matchingGitHubAttachmentResolutionRule(rawUrl, source, policy);
  if (!match || source?.kind !== "github-issue") return { matched: false };
  const cacheKey = source.repo + "\n" + rawUrl;
  if (cache.has(cacheKey)) return { matched: true, resolvedUrl: cache.get(cacheKey) ?? null };
  const resolved = await resolveViaGitHubMarkdownApi(rawUrl, source.repo, match, fetchImpl, policy);
  cache.set(cacheKey, resolved);
  return { matched: true, resolvedUrl: resolved };
}

function matchingGitHubAttachmentResolutionRule(
  rawUrl: string,
  source: ImageSource | undefined,
  policy: ResolvedImageAuthPolicy,
): GitHubAttachmentResolutionRule | null {
  if (!policy.token) return null;
  if (source?.kind !== "github-issue") return null;
  if (!policy.contentRepo || source.repo !== policy.contentRepo) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.search || url.hash) return null;
  for (const rule of policy.githubAttachmentResolutionRules) {
    if (rule.sourceRepo !== source.repo) continue;
    if (rule.canonicalHost !== url.host) continue;
    rule.canonicalPathPattern.lastIndex = 0;
    if (rule.canonicalPathPattern.test(url.pathname)) return rule;
  }
  return null;
}

async function resolveViaGitHubMarkdownApi(
  rawUrl: string,
  repo: string,
  rule: GitHubAttachmentResolutionRule,
  fetchImpl: typeof fetch,
  policy: ResolvedImageAuthPolicy,
): Promise<string | null> {
  const res = await fetchImpl("https://api.github.com/markdown", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + policy.token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gblog-builder",
    },
    body: JSON.stringify({
      text: "![gblog-attachment](<" + rawUrl + ">)",
      mode: "gfm",
      context: repo,
    }),
  });
  if (!res.ok) return null;
  return firstVerifiedSignedAttachmentUrl(await res.text(), rule);
}

function firstVerifiedSignedAttachmentUrl(
  html: string,
  rule: GitHubAttachmentResolutionRule,
): string | null {
  const fragment = parse5.parseFragment(html) as any;
  for (const value of collectHtmlAttrValues(fragment, ["src", "href"])) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    if (url.host !== rule.signedHost) continue;
    if (!url.searchParams.has(rule.signedQueryParam)) continue;
    rule.signedPathPattern.lastIndex = 0;
    if (rule.signedPathPattern.test(url.pathname)) return url.toString();
  }
  return null;
}

function collectHtmlAttrValues(node: any, names: readonly string[]): string[] {
  const out: string[] = [];
  const wanted = new Set(names);
  const visit = (n: any) => {
    if (Array.isArray(n?.attrs)) {
      for (const attr of n.attrs) {
        if (wanted.has(attr.name) && typeof attr.value === "string") out.push(attr.value);
      }
    }
    for (const child of n?.childNodes ?? []) visit(child);
  };
  visit(node);
  return out;
}

async function fetchWithHeaders(
  fetchImpl: typeof fetch,
  url: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "User-Agent": "gblog-builder" };
  if (token) headers.Authorization = "Bearer " + token;
  return await fetchImpl(url, { headers, redirect: "manual" });
}

function redirectTarget(res: Response, current: URL): URL | null {
  if (res.status < 300 || res.status >= 400) return null;
  const location = res.headers.get("location");
  if (!location) return null;
  try {
    const next = new URL(location, current);
    if (next.protocol !== "http:" && next.protocol !== "https:") return null;
    return next;
  } catch {
    return null;
  }
}

async function responseToDownloadedImage(
  res: Response,
  url: string,
  webp?: WebpOption,
): Promise<DownloadedImage> {
  const ct = (res.headers.get("content-type") || "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  const ext = TYPE_EXT[ct] || extFromUrl(url) || "bin";
  const bytes = new Uint8Array(await res.arrayBuffer());

  // WebP 转码: 仅启用 + 可转码格式; 单次解码出 webp 字节 + 输出尺寸. 失败回退原图.
  if (webp?.enabled && TRANSCODABLE.has(ext)) {
    const t = await transcodeWebp(bytes, webp.quality);
    if (t) return { bytes: t.bytes, ext: "webp", width: t.width, height: t.height };
    console.log("[图片] WebP 转码失败, 保留原格式: " + url);
  }
  // 未转码 (跳过/失败/禁用): 读尺寸 (消 CLS), 保留原字节与扩展名.
  const size = await readImageSize(bytes);
  return { bytes, ext, ...size };
}

/**
 * 本地相对图片读取适配器: 以 baseDir 为基准解析正文里的相对图片路径, 用 Bun.file 读字节.
 * 复用本文件私有 transcodeWebp/readImageSize, 与远程图同构 (实现 ImageDownloader 端口, 无需新端口).
 * 缺文件: 先 exists() 判存, 为假返回 null (Bun.file().bytes() 对缺文件抛 ENOENT, 不可依赖其返回空).
 * @param baseDir 相对图片解析基准 (= 该篇 md 文件所在目录)
 * @param webp    WebP 转码选项 (与远程图同款); 不传/禁用则保留原格式
 */
export function createLocalImageReader(
  baseDir: string,
  webp?: WebpOption,
): ImageDownloader {
  return {
    async download(relSrc) {
      try {
        const abs = safeResolve(baseDir, relSrc);
        // 先判存: Bun.file().bytes() 对缺文件抛 ENOENT, 故不可依赖其返回空.
        if (!(await Bun.file(abs).exists())) {
          console.log("[本地图] 文件不存在, 保留原链接: " + relSrc);
          return null;
        }
        const bytes = await Bun.file(abs).bytes();
        const ext = extFromUrl(relSrc) || "bin";

        // WebP 转码: 仅启用 + 可转码格式; 失败回退原图.
        if (webp?.enabled && TRANSCODABLE.has(ext)) {
          const t = await transcodeWebp(bytes, webp.quality);
          if (t)
            return {
              bytes: t.bytes,
              ext: "webp",
              width: t.width,
              height: t.height,
              sourceBytes: bytes,
              sourceExt: ext,
            };
          console.log("[本地图] WebP 转码失败, 保留原格式: " + relSrc);
        }
        const size = await readImageSize(bytes);
        return { bytes, ext, ...size, sourceBytes: bytes, sourceExt: ext };
      } catch {
        return null; // 读盘/解码异常: 保留原链接.
      }
    },
  };
}

// 单次解码: 编码 WebP 终结后, img.width/height 反映输出尺寸 (= 输入尺寸, 未缩放). 见 Bun.Image 文档.
// 守卫: 旧 Bun/不可用/坏图/不支持格式 (HEIC/AVIF on Linux 等) 返回 null, 调用方回退原图.
async function transcodeWebp(
  bytes: Uint8Array,
  quality: number,
): Promise<{ bytes: Uint8Array; width?: number; height?: number } | null> {
  // @ts-ignore - Bun.Image 于 v1.3.14 引入, @types/bun 可能尚未覆盖.
  if (typeof Bun === "undefined" || typeof Bun.Image !== "function") return null;
  try {
    // @ts-ignore - 见上.
    const img = new Bun.Image(bytes);
    const out = await img.webp({ quality }).bytes();
    const width = typeof img.width === "number" && img.width > 0 ? img.width : undefined;
    const height = typeof img.height === "number" && img.height > 0 ? img.height : undefined;
    return { bytes: out as Uint8Array, width, height };
  } catch {
    return null; // 坏图/不支持: 回退原图.
  }
}

// 只读图片头取宽高 (消 CLS 用). 用 Bun 内置 Bun.Image.metadata() (v1.3.14+), 传字节不传路径.
// 守卫: 旧 Bun/坏图/不支持格式仅返回空对象, 绝不抛错中断下载.
async function readImageSize(
  bytes: Uint8Array,
): Promise<{ width?: number; height?: number }> {
  // @ts-ignore - Bun.Image 于 v1.3.14 引入, @types/bun 可能尚未覆盖.
  if (typeof Bun === "undefined" || typeof Bun.Image !== "function") return {};
  try {
    // @ts-ignore - 见上.
    const meta = await new Bun.Image(bytes).metadata();
    if (typeof meta?.width === "number" && typeof meta?.height === "number")
      return { width: meta.width, height: meta.height };
    return {};
  } catch {
    return {}; // 坏图/不支持格式: 跳过尺寸, 不影响图片本体落盘.
  }
}

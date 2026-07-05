// 图片管线: 提取正文图片, 下载/读取到文章/页同名子文件夹, 把 img src 改写为相对路径.
// 判存跳过: 目标文件夹已存在同 hash 文件则不重复写入. 失败保留原链接.
import { createHash } from "node:crypto";
import { parseFragment, serialize } from "parse5";
import type { FileStore, ImageDownloader, ImageSource } from "./types.ts";

// 基于 URL 的稳定哈希: 同一 URL 跨构建得到同名文件, 天然去重.
export function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

export interface WebpHashConfig {
  enabled: boolean;
  quality: number;
}

// 本地图缓存键: 源字节 + 源扩展名 + 输出参数. 路径变化不影响缓存.
export function hashLocalImage(
  sourceBytes: Uint8Array,
  sourceExt: string,
  webp: WebpHashConfig = { enabled: false, quality: 0 },
): string {
  const hash = createHash("sha1");
  const enc = new TextEncoder();
  hash.update(sourceBytes);
  hash.update(enc.encode("\0" + normalizeExt(sourceExt)));
  hash.update(enc.encode("\0" + String(webp.enabled)));
  hash.update(enc.encode("\0" + String(webp.quality)));
  return hash.digest("hex").slice(0, 16);
}

function normalizeExt(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\./, "");
}

type HtmlNode = {
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
};

function walkHtml(node: HtmlNode, visit: (node: HtmlNode) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) walkHtml(child, visit);
}

function getAttr(node: HtmlNode, name: string): string | null {
  const attr = node.attrs?.find((a) => a.name.toLowerCase() === name);
  return attr ? attr.value : null;
}

function collectImgSrcs(html: string, predicate: (src: string) => boolean): string[] {
  const urls = new Set<string>();
  const frag = parseFragment(html) as HtmlNode;
  walkHtml(frag, (node) => {
    if (node.tagName?.toLowerCase() !== "img") return;
    const src = getAttr(node, "src");
    if (src !== null && predicate(src)) urls.add(src);
  });
  return [...urls];
}

function rewriteImgSrcs(html: string, rewrite: Map<string, string>): string {
  if (rewrite.size === 0) return html;
  const frag = parseFragment(html) as HtmlNode;
  walkHtml(frag, (node) => {
    if (node.tagName?.toLowerCase() !== "img") return;
    const src = node.attrs?.find((a) => a.name.toLowerCase() === "src");
    if (!src) return;
    const next = rewrite.get(src.value);
    if (next) src.value = next;
  });
  return serialize(frag as any);
}

function isRemoteImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function isLocalImageSrc(src: string): boolean {
  if (isRemoteImageSrc(src)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(src)) return false;
  if (src.startsWith("//")) return false;
  if (src.startsWith("/")) return false;
  return true;
}

// 提取 HTML 中的远程 (http/https) 图片 URL, 去重.
export function extractImageUrls(html: string): string[] {
  return collectImgSrcs(html, isRemoteImageSrc);
}

// 提取 HTML 中的本地相对图片路径 (排除 http(s)/协议相对 //、根 /、data:), 去重.
// 与 extractImageUrls 互补: 远程图走 processImages, 相对图走 processLocalImages.
export function extractLocalImagePaths(html: string): string[] {
  return collectImgSrcs(html, isLocalImageSrc);
}

/**
 * 下载远程图片到 imgDir 并把 HTML 中的真实 <img src> 改写为相对 (relPrefix + 文件名).
 * 判存跳过: imgDir 下已有 `<hash>.*` 文件则跳过下载, 用列到的真实文件名改写.
 */
export async function processImages(
  html: string,
  deps: {
    downloader: ImageDownloader;
    fs: FileStore;
    imgDir: string;
    relPrefix: string;
    imageSource?: ImageSource;
  },
): Promise<{ html: string; assets: string[]; dims: Record<string, ImageDim> }> {
  const { downloader, fs, imgDir, relPrefix } = deps;
  const urls = extractImageUrls(html);
  const assets: string[] = [];
  const dims: Record<string, ImageDim> = {};
  const existing = fs.list(imgDir);
  const rewrite = new Map<string, string>();

  for (const url of urls) {
    const hash = hashUrl(url);
    const hit = existing.find((name) => name.startsWith(hash + "."));
    if (hit) {
      console.log("[图片] 已存在, 跳过下载: " + url);
      rewrite.set(url, relPrefix + hit);
      assets.push(imgDir + "/" + hit);
      continue;
    }

    const res = await downloader.download(url, deps.imageSource);
    if (!res) {
      console.log("[图片] 下载失败, 保留原链接: " + url);
      continue;
    }
    const name = hash + "." + res.ext;
    fs.writeBytes(imgDir + "/" + name, res.bytes);
    const relSrc = relPrefix + name;
    rewrite.set(url, relSrc);
    assets.push(imgDir + "/" + name);
    if (typeof res.width === "number" && typeof res.height === "number")
      dims[relSrc] = { width: res.width, height: res.height };
  }

  return { html: rewriteImgSrcs(html, rewrite), assets, dims };
}

// 正文 <img> 尺寸 (像素), 供 enhanceImages 补 width/height 消 CLS.
export interface ImageDim {
  width: number;
  height: number;
}

/**
 * 处理正文里的本地相对图片: reader 读盘 -> 按源字节和输出参数 hash -> 落 imgDir ->
 * 定向改写真实 <img src> 为相对路径. reader 缺 sourceBytes/sourceExt 时 fail closed.
 */
export async function processLocalImages(
  html: string,
  deps: {
    reader: ImageDownloader;
    fs: FileStore;
    imgDir: string;
    relPrefix: string;
    webp?: WebpHashConfig;
  },
): Promise<{ html: string; assets: string[]; dims: Record<string, ImageDim> }> {
  const { reader, fs, imgDir, relPrefix, webp } = deps;
  const rels = extractLocalImagePaths(html);
  const assets: string[] = [];
  const dims: Record<string, ImageDim> = {};
  const existing = fs.list(imgDir);
  const rewrite = new Map<string, string>();

  for (const relSrc of rels) {
    const res = await reader.download(relSrc);
    if (!res) continue;
    if (!res.sourceBytes || !res.sourceExt) {
      console.log("[本地图] 缺少源字节/扩展名, 保留原链接: " + relSrc);
      continue;
    }

    const hash = hashLocalImage(res.sourceBytes, res.sourceExt, webp);
    const name = hash + "." + res.ext;
    const hit = existing.includes(name);
    if (hit) {
      console.log("[本地图] 已存在, 跳过写入: " + relSrc);
      const existingSrc = relPrefix + name;
      rewrite.set(relSrc, existingSrc);
      assets.push(imgDir + "/" + name);
      if (typeof res.width === "number" && typeof res.height === "number")
        dims[existingSrc] = { width: res.width, height: res.height };
      continue;
    }

    fs.writeBytes(imgDir + "/" + name, res.bytes);
    existing.push(name);
    const newSrc = relPrefix + name;
    rewrite.set(relSrc, newSrc);
    assets.push(imgDir + "/" + name);
    if (typeof res.width === "number" && typeof res.height === "number")
      dims[newSrc] = { width: res.width, height: res.height };
  }

  return { html: rewriteImgSrcs(html, rewrite), assets, dims };
}

/**
 * 正文 <img> 增强 (纯函数, 幂等): 按出现顺序处理每个 <img>.
 * - 补 decoding="async" (已有则跳过).
 * - 非首图补 loading="lazy" (首图保 LCP 不加; 已有 loading 则跳过).
 * - dims[src] 命中且无同名属性时补 width/height (消 CLS).
 */
export function enhanceImages(
  html: string,
  dims?: Record<string, ImageDim>,
): string {
  let index = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const isFirst = index === 0;
    index++;
    const has = (attr: string): boolean =>
      new RegExp("\\s" + attr + "\\s*=", "i").test(tag);
    const adds: string[] = [];
    if (!has("decoding")) adds.push('decoding="async"');
    if (!isFirst && !has("loading")) adds.push('loading="lazy"');
    const srcMatch = tag.match(/\ssrc\s*=\s*"([^"]*)"/i);
    const dim = srcMatch && dims ? dims[srcMatch[1]!] : undefined;
    if (dim) {
      if (!has("width")) adds.push('width="' + dim.width + '"');
      if (!has("height")) adds.push('height="' + dim.height + '"');
    }
    if (adds.length === 0) return tag;
    return tag.replace(/^<img\b/i, "<img " + adds.join(" "));
  });
}

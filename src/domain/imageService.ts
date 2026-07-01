// 图片管线: 提取正文远程图片, 下载到文章/页同名子文件夹, 把 URL 改写为相对路径.
// 判存跳过: 目标文件夹已存在同 hash 文件则不重复下载. 下载失败保留原链接.
import { createHash } from "node:crypto";
import type { FileStore, ImageDownloader } from "./types.ts";

// 基于 URL 的稳定哈希: 同一 URL 跨构建得到同名文件, 天然去重.
export function hashUrl(url: string): string {
return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

// 提取 HTML 中的远程 (http/https) 图片 URL, 去重.
export function extractImageUrls(html: string): string[] {
const urls = new Set<string>();
const re = /<img\b[^>]*?\bsrc="([^"]+)"/gi;
let m: RegExpExecArray | null;
while ((m = re.exec(html)) !== null) {
if (/^https?:\/\//i.test(m[1])) urls.add(m[1]);
}
return [...urls];
}

// 提取 HTML 中的本地相对图片路径 (排除 http(s)/协议相对 //、根 /、data:), 去重.
// 与 extractImageUrls 互补: 远程图走 processImages, 相对图走 processLocalImages.
export function extractLocalImagePaths(html: string): string[] {
  const paths = new Set<string>();
  const re = /<img\b[^>]*?\bsrc="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1]!;
    if (/^https?:\/\//i.test(src)) continue; // 远程
    if (src.startsWith("//")) continue; // 协议相对
    if (src.startsWith("/")) continue; // 站点根绝对
    if (/^data:/i.test(src)) continue; // 内联 data URI
    paths.add(src);
  }
  return [...paths];
}

/**
 * 下载远程图片到 imgDir 并把 HTML 中的 URL 改写为相对 (relPrefix + 文件名).
 * 判存跳过: imgDir 下已有 `<hash>.*` 文件则跳过下载, 用列到的真实文件名改写.
 * @param deps.imgDir    图片落盘目录 (如 post/<nodeId>)
 * @param deps.relPrefix 相对页面引用前缀 (如 <nodeId>/), 拼文件名得 src
 * @returns 改写后 HTML、写入/命中的资源路径 (informational)、以及新下载图片的尺寸表
 *          (dims 键为改写后相对 src; 仅含本次成功下载且 downloader 带出 width/height 的图,
 *           判存命中与下载失败的图不入 dims, 见设计 §2.5.2)
 */
export async function processImages(
html: string,
deps: { downloader: ImageDownloader; fs: FileStore; imgDir: string; relPrefix: string },
): Promise<{ html: string; assets: string[]; dims: Record<string, ImageDim> }> {
const { downloader, fs, imgDir, relPrefix } = deps;
const urls = extractImageUrls(html);
let out = html;
const assets: string[] = [];
const dims: Record<string, ImageDim> = {};
const existing = fs.list(imgDir); // 该文章图片文件夹现有文件名 (判存用)
for (const url of urls) {
const hash = hashUrl(url);
const hit = existing.find((name) => name.startsWith(hash + "."));
if (hit) {
// 已存在: 跳过下载, 用真实文件名 (含扩展名) 改写 src. 无尺寸 (不读本地文件, 见 §2.5.2).
console.log("[图片] 已存在, 跳过下载: " + url);
out = out.split(url).join(relPrefix + hit);
assets.push(imgDir + "/" + hit);
continue;
}
const res = await downloader.download(url);
if (!res) {
console.log("[图片] 下载失败, 保留原链接: " + url);
continue;
}
const name = hash + "." + res.ext;
fs.writeBytes(imgDir + "/" + name, res.bytes);
const relSrc = relPrefix + name;
out = out.split(url).join(relSrc);
assets.push(imgDir + "/" + name);
// downloader 带出尺寸时收进 dims (infra 经 Bun.Image 读头; 缺失/不支持则无尺寸).
if (typeof res.width === "number" && typeof res.height === "number")
dims[relSrc] = { width: res.width, height: res.height };
}
return { html: out, assets, dims };
}

// 正文 <img> 尺寸 (像素), 供 enhanceImages 补 width/height 消 CLS.
export interface ImageDim {
width: number;
height: number;
}

/**
 * 处理正文里的本地相对图片: 经 reader 读盘 -> 落 imgDir -> 定向改写 <img src> 为相对路径.
 * 结构镜像 processImages (判存跳过 / 收集 dims), 但:
 *  - 来源为本地相对路径 (extractLocalImagePaths), 经 reader (createLocalImageReader) 读盘;
 *  - reader 返回 null (缺文件/坏图) 时保留原链接;
 *  - 改写用"定向 <img src> 替换"而非 split/join 全局替换 (相对路径短易撞正文子串, 降误命中).
 * @param deps.imgDir    图片落盘目录 (post/<nodeId> 或独立页 <nodeId>)
 * @param deps.relPrefix 相对页面引用前缀 (<nodeId>/)
 * @returns 改写后 HTML、命中/写入资源路径、新读取图片的尺寸表 (键为改写后相对 src)
 */
export async function processLocalImages(
  html: string,
  deps: { reader: ImageDownloader; fs: FileStore; imgDir: string; relPrefix: string },
): Promise<{ html: string; assets: string[]; dims: Record<string, ImageDim> }> {
  const { reader, fs, imgDir, relPrefix } = deps;
  const rels = extractLocalImagePaths(html);
  const assets: string[] = [];
  const dims: Record<string, ImageDim> = {};
  const existing = fs.list(imgDir); // 该文章图片文件夹现有文件名 (判存用)
  const rewrite: Record<string, string> = {}; // 原 relSrc -> 改写后相对 src
  for (const relSrc of rels) {
    const hash = hashUrl(relSrc);
    const hit = existing.find((name) => name.startsWith(hash + "."));
    if (hit) {
      console.log("[本地图] 已存在, 跳过读取: " + relSrc);
      rewrite[relSrc] = relPrefix + hit;
      assets.push(imgDir + "/" + hit);
      continue;
    }
    const res = await reader.download(relSrc);
    if (!res) continue; // reader 已打印原因 (缺文件/坏图); 保留原链接
    const name = hash + "." + res.ext;
    fs.writeBytes(imgDir + "/" + name, res.bytes);
    const newSrc = relPrefix + name;
    rewrite[relSrc] = newSrc;
    assets.push(imgDir + "/" + name);
    if (typeof res.width === "number" && typeof res.height === "number")
      dims[newSrc] = { width: res.width, height: res.height };
  }
  // 仅在 <img src="..."> 属性值精确命中 rewrite 表时替换; 不触正文其它子串.
  const out = html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi,
    (full, pre, src, post) => {
      const next = rewrite[src];
      return next ? pre + next + post : full;
    },
  );
  return { html: out, assets, dims };
}

/**
 * 正文 <img> 增强 (纯函数, 幂等): 按出现顺序处理每个 <img>.
 * - 补 decoding="async" (已有则跳过).
 * - 非首图补 loading="lazy" (首图保 LCP 不加; 已有 loading 则跳过).
 * - dims[src] 命中且无同名属性时补 width/height (消 CLS).
 * src 取标签内 src="..." 的值 (与 dims 键一致, 即改写后的相对路径).
 * 新增属性统一插在 `<img` 之后, 保留原属性与自闭合形式.
 * @param html 正文 HTML
 * @param dims 可选 src->尺寸映射 (键为改写后的相对 src); 缺省仅补 decoding/loading
 * @returns 增强后的 HTML (无 <img> 时原样返回)
 */
export function enhanceImages(
html: string,
dims?: Record<string, ImageDim>,
): string {
let index = 0;
return html.replace(/<img\b[^>]*>/gi, (tag) => {
const isFirst = index === 0;
index++;
// 属性判存: 属性名前必有空白 (<img 后或属性间), 避免 data-width 之类误命中 width.
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

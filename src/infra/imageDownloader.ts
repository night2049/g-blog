// 远程图片下载适配器: fetch (可带 token), 从 content-type 或 URL 推断扩展名.
// WebP 转码 (可选): JPEG/PNG/BMP 单次解码 -> 同时编码 WebP + 拿输出尺寸; GIF/SVG 跳过原样保留.
// 尺寸: 不转码时用 Bun.Image.metadata() 只读头取宽高 (消 CLS).
import { join } from "node:path";
import type { ImageDownloader } from "../domain/types.ts";

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
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : null;
}

export interface WebpOption {
  enabled: boolean;
  quality: number; // 1-100
}

export function createImageDownloader(
  token?: string,
  fetchImpl: typeof fetch = fetch,
  webp?: WebpOption,
): ImageDownloader {
  return {
    async download(url) {
      try {
        const headers: Record<string, string> = {
          "User-Agent": "gblog-builder",
        };
        if (token) headers.Authorization = "Bearer " + token;
        const res = await fetchImpl(url, { headers, redirect: "follow" });
        if (!res.ok) {
          console.log("[图片] 下载 HTTP " + res.status + ": " + url);
          return null;
        }
        const ct = (res.headers.get("content-type") || "")
          .split(";")[0]
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
      } catch {
        return null;
      }
    },
  };
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
        const abs = join(baseDir, relSrc);
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
          if (t) return { bytes: t.bytes, ext: "webp", width: t.width, height: t.height };
          console.log("[本地图] WebP 转码失败, 保留原格式: " + relSrc);
        }
        const size = await readImageSize(bytes);
        return { bytes, ext, ...size };
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

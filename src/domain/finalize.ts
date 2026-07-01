// 内容收尾 (两层, 消除 full/incremental 三处重复):
//   基础层 finalizeContent = highlight + 图片本地化 + enhanceImages, 文章与独立页共用;
//   富化层 enrichPostContent = 标题锚点 + deriveCardMeta, 文章专属 (独立页无目录/卡片, 不富化).
// TOC 改客户端 tocbot 从 DOM 构建, 不在此层生成.
import type { FileStore, Highlighter, ImageDownloader } from "./types.ts";
import { processImages, processLocalImages, enhanceImages, type ImageDim } from "./imageService.ts";
import {
  injectHeadingAnchors,
  deriveCardMeta,
  type CardMeta,
  type CardMetaOpts,
} from "./contentEnhance.ts";

export interface FinalizeDeps {
  highlighter?: Highlighter;
  images?: ImageDownloader; // 远程图下载器
  localImages?: ImageDownloader; // 本地相对图 reader (issue 文章不传 -> 该段 no-op)
  fs: FileStore;
  imgDir: string; // 图片落盘目录 (post/<nodeId> 或独立页 <nodeId>)
  relPrefix: string; // 正文图片引用前缀 (<nodeId>/)
}

/**
 * 基础层: highlight -> 本地相对图本地化 -> 远程图本地化 -> 正文图片增强 (lazy/decoding/尺寸). 文章与独立页共用.
 * 本地图先行: 在原始正文上只匹配真·相对路径; 若远程图先跑, 其改写产出的相对 src 会被本地通道误扫 (见设计 §3.4).
 * @returns { html, assets } 收尾后正文 HTML + 本次落盘/判存命中的图片相对路径 (站点根相对, 供 full 孤儿回收)
 */
export async function finalizeContent(
  html: string,
  deps: FinalizeDeps,
): Promise<{ html: string; assets: string[] }> {
  let out = html;
  if (deps.highlighter) out = deps.highlighter.highlight(out);
  let dims: Record<string, ImageDim> = {};
  const assets: string[] = []; // 本次引用的图片落盘路径 (含判存命中复用), 供孤儿回收求"在用集"
  // 本地相对图先行 (issue 文章不传 localImages -> 跳过).
  if (deps.localImages) {
    const r = await processLocalImages(out, {
      reader: deps.localImages,
      fs: deps.fs,
      imgDir: deps.imgDir,
      relPrefix: deps.relPrefix,
    });
    out = r.html;
    dims = { ...dims, ...r.dims };
    for (const a of r.assets) assets.push(a);
  }
  if (deps.images) {
    const r = await processImages(out, {
      downloader: deps.images,
      fs: deps.fs,
      imgDir: deps.imgDir,
      relPrefix: deps.relPrefix,
    });
    out = r.html;
    dims = { ...dims, ...r.dims };
    for (const a of r.assets) assets.push(a);
  }
  return { html: enhanceImages(out, dims), assets };
}

/**
 * 富化层 (文章专属): 在基础层结果上叠 标题锚点 + 派生卡片元数据.
 * 派生从锚点注入前的 HTML 取 (避免 # 锚链文本污染摘要); 页面渲染用锚点注入后的 HTML.
 * @param baseHtml    finalizeContent 的产物
 * @param opts        摘要/首图/阅读时长子配置 (取自 cfg.content)
 * @param coverPrefix 首图相对路径前缀 (= postDir + "/")
 */
export function enrichPostContent(
  baseHtml: string,
  opts: CardMetaOpts,
  coverPrefix: string,
): { html: string; meta: CardMeta } {
  const meta = deriveCardMeta(baseHtml, opts, coverPrefix);
  const { html } = injectHeadingAnchors(baseHtml);
  return { html, meta };
}

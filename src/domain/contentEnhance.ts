// 内容后处理 (构建期纯函数, 沿用 highlight.ts 模式): 标题锚点注入 + 卡片派生元数据.
// 在渲染后 HTML 上做; 与 highlight (只动代码块)、图片本地化互不干扰.
import GithubSlugger from "github-slugger";
import { htmlToText, truncate } from "./text.ts";

// CJK 区间 (中日韩统一表意 + 扩展A + 假名 + 谚文): 逐字符计数, 与拉丁词分别按 cpm/wpm 估时.
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/g;
// 拉丁词: 字母/数字串 (允许内部连字符/撇号), 按词计数.
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

/**
 * 扫描 h1–h6, 用 github-slugger 生成 id (unicode/CJK 友好、自动去重) 注入, 并补一个 hover 显现的 # 锚链.
 * 已带 id 的标题尊重原 id (幂等); 空标题不处理. 不依赖 TOC (TOC 由客户端 tocbot 从 DOM 构建).
 * @returns { html } 注入 id 与锚链后的 HTML
 */
export function injectHeadingAnchors(html: string): { html: string } {
  const slugger = new GithubSlugger();
  const out = html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (m, level: string, attrs: string, inner: string) => {
      const text = htmlToText(inner);
      if (!text) return m; // 空标题 (如仅含图片): 不注入
      const existingId = attrs.match(/\sid="([^"]*)"/i);
      const id = existingId ? existingId[1]! : slugger.slug(text);
      const attrsOut = existingId ? attrs : `${attrs} id="${id}"`;
      // 锚链留空 (# 由 CSS ::before 渲染), 使标题 textContent 不含 #, 避免污染 tocbot 目录文本与摘要.
      const anchor = `<a class="heading-anchor" href="#${id}" aria-hidden="true"></a>`;
      return `<h${level}${attrsOut}>${inner}${anchor}</h${level}>`;
    },
  );
  return { html: out };
}

// 派生卡片元数据结果.
export interface CardMeta {
  summary: string;
  cover: string; // 根相对路径或绝对 URL; 无首图为空串
  readingTime: number; // 分钟; 关闭或空正文为 0
  words: number; // CJK 字符 + 拉丁词
}

// deriveCardMeta 所需的最小配置子集 (取自 ContentConfig, 便于单测注入).
export interface CardMetaOpts {
  summary: { enabled: boolean; length: number };
  cover: { enabled: boolean };
  readingTime: { enabled: boolean; cpm: number; wpm: number };
}

// CJK 字符数 + 拉丁词数 (混排正文的"字数").
function countWords(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const latin = text.match(LATIN_WORD_RE)?.length ?? 0;
  return cjk + latin;
}

// 阅读时长 (分钟, 向上取整): CJK 按 cpm, 拉丁词按 wpm 混算; 空正文返回 0, 有内容至少 1 分钟.
function estimateReadingTime(text: string, cpm: number, wpm: number): number {
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const latin = text.match(LATIN_WORD_RE)?.length ?? 0;
  if (cjk === 0 && latin === 0) return 0;
  const minutes = cjk / Math.max(1, cpm) + latin / Math.max(1, wpm);
  return Math.max(1, Math.ceil(minutes));
}

// 首个 <img> 的任意 src (此步在 processImages 之后, src 多为相对路径; 不能用只认 http 的 extractImageUrls).
// 绝对/协议相对/根路径原样返回; 相对路径加 coverPrefix (= postDir + "/") 转根相对.
function firstImage(html: string, coverPrefix: string): string {
  const m = html.match(/<img\b[^>]*?\ssrc="([^"]*)"/i);
  const src = m?.[1];
  if (!src) return "";
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/)/.test(src)) return src; // 绝对/协议相对/根
  return coverPrefix + src;
}

/**
 * 派生卡片/SEO 元数据: 摘要 (去标签截断, 复用 text.ts)、首图 (首个 img 转根相对)、字数、阅读时长.
 * @param html       渲染后正文 HTML (建议传锚点注入前的版本, 避免 # 锚链文本污染摘要)
 * @param opts       summary/cover/readingTime 子配置 (取自 ContentConfig)
 * @param coverPrefix 首图相对路径前缀 (= postDir + "/"), 缺省空串
 */
export function deriveCardMeta(
  html: string,
  opts: CardMetaOpts,
  coverPrefix: string = "",
): CardMeta {
  const text = htmlToText(html);
  return {
    summary: opts.summary.enabled ? truncate(text, opts.summary.length) : "",
    cover: opts.cover.enabled ? firstImage(html, coverPrefix) : "",
    readingTime: opts.readingTime.enabled
      ? estimateReadingTime(text, opts.readingTime.cpm, opts.readingTime.wpm)
      : 0,
    words: countWords(text),
  };
}

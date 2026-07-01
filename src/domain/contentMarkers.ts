// 正文标记: 构建期把正文烘焙进页面 HTML 时, 用注释标记包裹正文 (GitHub 视图不可见),
// 供 RSS 取全文/摘要与本地重组 (reassemble) 抽正文复用. 标记写在 main-post/main-page partial 内.
export const CONTENT_START = "<!--content:start-->";
export const CONTENT_END = "<!--content:end-->";

// 从已生成的页面 HTML 中取正文 (标记之间); 缺标记或顺序错返回 null.
export function extractContentHtml(pageHtml: string): string | null {
  const i = pageHtml.indexOf(CONTENT_START);
  const j = pageHtml.indexOf(CONTENT_END);
  if (i === -1 || j === -1 || j < i) return null;
  return pageHtml.slice(i + CONTENT_START.length, j);
}

// 纯文本工具: 去标签取纯文本 + 截断. RSS 摘要 (feedService) 与卡片/SEO 摘要 (contentEnhance) 共用.
// 抽离自 feedService, 集中 strip/截断逻辑, 避免两处重复 (设计 §5.2: 数值各自独立但函数共享).

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// 去标签 + 解码常见实体 + 折叠空白. 供摘要/字数/阅读时长的纯文本来源.
export function htmlToText(html: string): string {
  const noTags = html.replace(/<[^>]*>/g, " ");
  const decoded = noTags.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X"
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ent] ?? m;
  });
  return decoded.replace(/\s+/g, " ").trim();
}

// 超长截断加省略号; length<=0 或不超长则原样返回. 与 RSS summaryLength 共用此实现.
export function truncate(text: string, length: number): string {
  if (length <= 0) return text;
  return text.length > length ? text.slice(0, length) + "…" : text;
}

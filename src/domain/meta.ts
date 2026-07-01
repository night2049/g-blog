// 解析正文开头的 meta 块 (HTML 注释) 与发布日期. 纯函数.
// meta 块形如:
// <!-- meta
// date: 2026-06-01
// -->

export function parseMeta(
  body: string | null,
  marker: string = "meta",
): { meta: Record<string, string>; content: string } {
  const text = body ?? "";
  // 仅匹配开头(允许前置空白)的 meta 注释块
  const re = new RegExp("^\\s*<!--\\s*" + marker + "\\b([\\s\\S]*?)-->\\s*");
  const m = text.match(re);
  if (!m) return { meta: {}, content: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, content: text.slice(m[0].length) };
}

// 解析发布日期: meta.date 合法则归一化 ISO, 否则回退 createdAt.
// date-only (2026-06-01) 归一化为当日 UTC 00:00:00.
export function resolveDate(
  meta: Record<string, string>,
  createdAt: string,
): string {
  const raw = meta.date?.trim();
  if (raw) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const t = Date.parse(dateOnly ? raw + "T00:00:00.000Z" : raw);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const ct = Date.parse(createdAt);
  return Number.isNaN(ct) ? createdAt : new Date(ct).toISOString();
}

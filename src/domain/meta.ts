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
  for (const line of (m[1] ?? "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, content: text.slice(m[0].length) };
}

export function parseDateOnlyStrict(raw: string): string | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    return null;
  return d.toISOString();
}

function parseTimezoneOffsetMinutes(raw: string): number | null {
  if (raw.endsWith("Z")) return 0;
  const m = raw.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function sameInputDateInOffset(t: number, year: number, month: number, day: number, offset: number): boolean {
  const d = new Date(t + offset * 60_000);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function parseDateStrict(raw: string): string | null {
  const s = raw.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (dateOnly) return parseDateOnlyStrict(s);

  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;

  if (isoDate) {
    const year = Number(isoDate[1] ?? "");
    const month = Number(isoDate[2] ?? "");
    const day = Number(isoDate[3] ?? "");
    const offset = parseTimezoneOffsetMinutes(s);
    if (offset !== null) {
      if (!sameInputDateInOffset(t, year, month, day, offset)) return null;
    } else {
      const d = new Date(t);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day)
        return null;
    }
  }

  return new Date(t).toISOString();
}

// 解析发布日期: meta.date 合法则归一化 ISO, 否则回退 createdAt.
// date-only (2026-06-01) 归一化为当日 UTC 00:00:00.
export function resolveDate(
  meta: Record<string, string>,
  createdAt: string,
): string {
  const raw = meta.date?.trim();
  if (raw) {
    const iso = parseDateStrict(raw);
    if (iso) return iso;
  }
  const ct = Date.parse(createdAt);
  return Number.isNaN(ct) ? createdAt : new Date(ct).toISOString();
}

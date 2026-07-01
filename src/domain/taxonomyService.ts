// 目录/标签映射: 把 manifest 按 dirs/tags 展开归组. 纯函数, 供 dirs.json 产出与未来复用.
import type { Manifest, ManifestEntry, TaxonomyGroup } from "./types.ts";

// 通用归组: select 取每条的归属名数组; 组内保持入参顺序 (入参已 date 倒序); 组按名升序.
function groupBy(
  m: Manifest,
  select: (e: ManifestEntry) => string[] | undefined,
): TaxonomyGroup[] {
  const map = new Map<string, ManifestEntry[]>();
  for (const e of m) {
    for (const name of select(e) ?? []) {
      const arr = map.get(name);
      if (arr) arr.push(e);
      else map.set(name, [e]);
    }
  }
  return [...map.entries()]
    .map(([name, posts]) => ({ name, posts }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 目录映射: 名称 -> 该目录下文章 (date 倒序). 一篇多目录则进入多组.
export function buildDirMap(m: Manifest): TaxonomyGroup[] {
  return groupBy(m, (e) => e.dirs);
}

// 标签映射: 名称 -> 该标签下文章. 本轮仅交付函数, 不接入页面.
export function buildTagMap(m: Manifest): TaxonomyGroup[] {
  return groupBy(m, (e) => e.tags);
}

// 年份映射: 年份 (date 前 4 位) -> 该年文章. 组内保持入参顺序 (入参已 date 倒序).
export function buildYearMap(m: Manifest): TaxonomyGroup[] {
  return groupBy(m, (e) => [e.date.slice(0, 4)]);
}

// 索引分片服务: 把时间线/标签/目录拆为小分片 + 索引, 支持单篇增删只动受影响分片.
// 数据布局 (固定 data/ 目录):
//   data/years.json            YearIndexEntry[] (年降序)
//   data/year/<YYYY>.json      该年 ManifestEntry[] (date 倒序)
//   data/tags.json             TaxonomyIndexEntry[]
//   data/tag/<slug>.json       该标签 ManifestEntry[]
//   data/dirs.json             TaxonomyIndexEntry[]
//   data/dir/<slug>.json       该目录 ManifestEntry[]
// slug = encodeURIComponent(name). 纯函数优先, IO 经 FileStore.
import type {
  FileStore,
  Manifest,
  ManifestEntry,
  TaxonomyIndexEntry,
  YearIndexEntry,
} from "./types.ts";
import { nodeIdFromUrl } from "./postService.ts";
import { sortManifest } from "./manifestService.ts";

const DATA = "data";
export type ShardKind = "year" | "tag" | "dir";
type TaxonomyKind = "tag" | "dir";

// date 前 4 位为年份.
export function yearOf(date: string): string {
  return date.slice(0, 4);
}

// 名称 -> 文件名安全 slug (跨平台/可逆).
export function slugOf(name: string): string {
  return encodeURIComponent(name);
}

function shardPath(kind: ShardKind, key: string): string {
  return DATA + "/" + kind + "/" + key + ".json";
}
function indexFile(kind: ShardKind): string {
  const name = kind === "year" ? "years" : kind === "tag" ? "tags" : "dirs";
  return DATA + "/" + name + ".json";
}
function parseArray<T>(text: string | null): T[] {
  if (!text) return [];
  try {
    const d = JSON.parse(text);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

// ---- 分片读写 ----

export function loadShard(fs: FileStore, kind: ShardKind, key: string): Manifest {
  return parseArray<ManifestEntry>(fs.read(shardPath(kind, key)));
}

// 空数组 -> 删文件 (分片消失); 否则 date 倒序写.
export function saveShard(
  fs: FileStore,
  kind: ShardKind,
  key: string,
  entries: Manifest,
): void {
  const p = shardPath(kind, key);
  if (entries.length === 0) {
    fs.remove(p);
    return;
  }
  fs.write(p, JSON.stringify(sortManifest(entries)));
}

// ---- 索引读写 ----

export function loadYearIndex(fs: FileStore): YearIndexEntry[] {
  return parseArray<YearIndexEntry>(fs.read(indexFile("year")));
}
export function saveYearIndex(fs: FileStore, idx: YearIndexEntry[]): void {
  const sorted = [...idx].sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0));
  fs.write(indexFile("year"), JSON.stringify(sorted));
}
export function loadTaxonomyIndex(
  fs: FileStore,
  kind: TaxonomyKind,
): TaxonomyIndexEntry[] {
  return parseArray<TaxonomyIndexEntry>(fs.read(indexFile(kind)));
}
export function saveTaxonomyIndex(
  fs: FileStore,
  kind: TaxonomyKind,
  idx: TaxonomyIndexEntry[],
): void {
  const sorted = [...idx].sort((a, b) => a.name.localeCompare(b.name));
  fs.write(indexFile(kind), JSON.stringify(sorted));
}

// ---- 定位 ----

// 遍历 years 索引在年份分片按 nodeId 搜索旧条目; 不存在返回 null.
export function locateEntry(
  fs: FileStore,
  nodeId: string,
  postDir: string,
): { year: string; entry: ManifestEntry } | null {
  for (const { year } of loadYearIndex(fs)) {
    const entry = loadShard(fs, "year", year).find(
      (e) => nodeIdFromUrl(e.url, postDir) === nodeId,
    );
    if (entry) return { year, entry };
  }
  return null;
}

// ---- 增量 upsert / remove ----

// 在一个分片中移除该 nodeId 旧条目, 可选插入新条目; 落盘并返回新条数.
function updateShard(
  fs: FileStore,
  kind: ShardKind,
  key: string,
  nodeId: string,
  postDir: string,
  add: ManifestEntry | null,
): number {
  const next = loadShard(fs, kind, key).filter(
    (e) => nodeIdFromUrl(e.url, postDir) !== nodeId,
  );
  if (add) next.push(add);
  saveShard(fs, kind, key, next);
  return next.length;
}

function setYearCount(idx: YearIndexEntry[], year: string, count: number): YearIndexEntry[] {
  const rest = idx.filter((e) => e.year !== year);
  if (count > 0) rest.push({ year, count });
  return rest;
}
function setTaxonomyCount(
  idx: TaxonomyIndexEntry[],
  slug: string,
  name: string,
  count: number,
): TaxonomyIndexEntry[] {
  const rest = idx.filter((e) => e.slug !== slug);
  if (count > 0) rest.push({ name, slug, count });
  return rest;
}

// 标签/目录维度的 upsert: 受影响 = 旧名 ∪ 新名 的 slug; 在新集合内则插入, 否则仅移除.
function applyTaxonomyUpsert(
  fs: FileStore,
  kind: TaxonomyKind,
  oldNames: string[],
  newNames: string[],
  newEntry: ManifestEntry,
  nodeId: string,
  postDir: string,
): void {
  const newSet = new Set(newNames);
  // slug -> 显示名 (新名优先, 兼顾仅在旧集合的名).
  const affected = new Map<string, string>();
  for (const n of newNames) affected.set(slugOf(n), n);
  for (const n of oldNames) if (!affected.has(slugOf(n))) affected.set(slugOf(n), n);
  let idx = loadTaxonomyIndex(fs, kind);
  for (const [slug, name] of affected) {
    const count = updateShard(fs, kind, slug, nodeId, postDir, newSet.has(name) ? newEntry : null);
    idx = setTaxonomyCount(idx, slug, name, count);
  }
  saveTaxonomyIndex(fs, kind, idx);
}

/**
 * 增量 upsert: 只动受影响的 年/标签/目录 分片 + 三索引 (§4.3.1).
 * @param oldEntry 旧条目 (locateEntry 得), 无则为 null (新增)
 * @param newEntry 新条目 (url 含 postDir 前缀)
 */
export function applyUpsert(
  fs: FileStore,
  oldEntry: ManifestEntry | null,
  newEntry: ManifestEntry,
  postDir: string,
): void {
  const nodeId = nodeIdFromUrl(newEntry.url, postDir);

  // 年份: {Y1, Y2} 各移除旧条, Y2 插入新条.
  const y2 = yearOf(newEntry.date);
  const years = new Set<string>([y2]);
  if (oldEntry) years.add(yearOf(oldEntry.date));
  let yIdx = loadYearIndex(fs);
  for (const y of years) {
    const count = updateShard(fs, "year", y, nodeId, postDir, y === y2 ? newEntry : null);
    yIdx = setYearCount(yIdx, y, count);
  }
  saveYearIndex(fs, yIdx);

  applyTaxonomyUpsert(fs, "tag", oldEntry?.tags ?? [], newEntry.tags ?? [], newEntry, nodeId, postDir);
  applyTaxonomyUpsert(fs, "dir", oldEntry?.dirs ?? [], newEntry.dirs ?? [], newEntry, nodeId, postDir);
}

// 增量删除: 从旧条目所属 年/标签/目录 分片移除, 更新索引, 删空分片 (§4.3.2).
export function applyRemove(
  fs: FileStore,
  oldEntry: ManifestEntry,
  postDir: string,
): void {
  const nodeId = nodeIdFromUrl(oldEntry.url, postDir);

  const y1 = yearOf(oldEntry.date);
  const yCount = updateShard(fs, "year", y1, nodeId, postDir, null);
  saveYearIndex(fs, setYearCount(loadYearIndex(fs), y1, yCount));

  applyTaxonomyRemove(fs, "tag", oldEntry.tags ?? [], nodeId, postDir);
  applyTaxonomyRemove(fs, "dir", oldEntry.dirs ?? [], nodeId, postDir);
}
function applyTaxonomyRemove(
  fs: FileStore,
  kind: TaxonomyKind,
  names: string[],
  nodeId: string,
  postDir: string,
): void {
  let idx = loadTaxonomyIndex(fs, kind);
  for (const n of names) {
    const slug = slugOf(n);
    const count = updateShard(fs, kind, slug, nodeId, postDir, null);
    idx = setTaxonomyCount(idx, slug, n, count);
  }
  saveTaxonomyIndex(fs, kind, idx);
}

// ---- 全量重建 ----

// 从内存 manifest 全量重建全部分片 + 三索引 (date 倒序, 计数正确).
export function rebuildAllShards(fs: FileStore, manifest: Manifest): void {
  const years = new Map<string, Manifest>();
  const tags = new Map<string, { name: string; entries: Manifest }>();
  const dirs = new Map<string, { name: string; entries: Manifest }>();
  const pushTax = (
    map: Map<string, { name: string; entries: Manifest }>,
    name: string,
    e: ManifestEntry,
  ) => {
    const slug = slugOf(name);
    const g = map.get(slug);
    if (g) g.entries.push(e);
    else map.set(slug, { name, entries: [e] });
  };

  for (const e of manifest) {
    const y = yearOf(e.date);
    (years.get(y) ?? years.set(y, []).get(y)!).push(e);
    for (const t of e.tags ?? []) pushTax(tags, t, e);
    for (const d of e.dirs ?? []) pushTax(dirs, d, e);
  }

  const yIdx: YearIndexEntry[] = [];
  for (const [year, entries] of years) {
    saveShard(fs, "year", year, entries);
    yIdx.push({ year, count: entries.length });
  }
  saveYearIndex(fs, yIdx);

  writeTaxonomy(fs, "tag", tags);
  writeTaxonomy(fs, "dir", dirs);
}
function writeTaxonomy(
  fs: FileStore,
  kind: TaxonomyKind,
  map: Map<string, { name: string; entries: Manifest }>,
): void {
  const idx: TaxonomyIndexEntry[] = [];
  for (const [slug, { name, entries }] of map) {
    saveShard(fs, kind, slug, entries);
    idx.push({ name, slug, count: entries.length });
  }
  saveTaxonomyIndex(fs, kind, idx);
}

// 取全站全部文章条目 (供 reassemble 枚举): 合并所有年份分片. 顺序不保证 (reassemble 不依赖).
export function loadAllEntries(fs: FileStore): Manifest {
  const out: Manifest = [];
  for (const { year } of loadYearIndex(fs)) {
    for (const e of loadShard(fs, "year", year)) out.push(e);
  }
  return out;
}

// 取全站最新 N 条 (供增量 feed): 年份降序遍历, 各年分片已 date 倒序, 拼接取前 N.
export function loadLatestEntries(fs: FileStore, count: number): Manifest {
  if (count <= 0) return [];
  const years = loadYearIndex(fs)
    .map((y) => y.year)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const out: Manifest = [];
  for (const year of years) {
    for (const e of loadShard(fs, "year", year)) {
      out.push(e);
      if (out.length >= count) return out;
    }
  }
  return out;
}

// ---- 首页全局分页 (纯函数, §4.3.3) ----

/**
 * 规划首页第 page 页 (每页 perPage) 需取的年份分片与切片区间.
 * 年份按降序累加 count 定位覆盖全局区间 [(page-1)*perPage, page*perPage) 的年份.
 * @returns years 降序年份键; start/end 为拼接后 (这些年份 date 倒序拼接) 的切片下标 [start, end)
 */
export function planTimelinePage(
  yearIndex: YearIndexEntry[],
  page: number,
  perPage: number,
): { years: string[]; start: number; end: number } {
  const sorted = [...yearIndex].sort((a, b) =>
    a.year < b.year ? 1 : a.year > b.year ? -1 : 0,
  );
  const total = sorted.reduce((s, y) => s + y.count, 0);
  const p = Math.max(1, page);
  const startGlobal = (p - 1) * perPage;
  if (startGlobal >= total) return { years: [], start: 0, end: 0 };
  const endGlobal = Math.min(startGlobal + perPage, total);

  const years: string[] = [];
  let acc = 0;
  let startInFirst = 0;
  for (const y of sorted) {
    const yStart = acc;
    const yEnd = acc + y.count;
    if (yEnd > startGlobal && yStart < endGlobal) {
      if (years.length === 0) startInFirst = startGlobal - yStart;
      years.push(y.year);
    }
    acc = yEnd;
    if (acc >= endGlobal) break;
  }
  return { years, start: startInFirst, end: startInFirst + (endGlobal - startGlobal) };
}

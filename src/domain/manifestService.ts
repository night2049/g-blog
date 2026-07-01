// 文章清单纯操作 (upsert/sort/takeLatest) + 独立页 pages.json IO.
// 注: 文章不再产出聚合 posts.json (改为 data/ 分片, 见 shardService); 这里仅保留仍在用的纯数组工具 + 独立页清单.
import type {
  FileStore,
  Manifest,
  ManifestEntry,
  PageEntry,
  PageManifest,
} from "./types.ts";

const PAGES_FILE = "pages.json";

// 按 url 覆盖或新增 (返回新数组, 不改入参).
export function upsertEntry(m: Manifest, e: ManifestEntry): Manifest {
  return [...m.filter((x) => x.url !== e.url), e];
}

// date 倒序; 同 date 用 url 倒序兜底, 保证确定性 (返回新数组).
export function sortManifest(m: Manifest): Manifest {
  return [...m].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.url < b.url ? 1 : -1;
  });
}

// 取最新 N 条 (先排序再切); n<=0 -> [].
export function takeLatest(m: Manifest, n: number): Manifest {
  return sortManifest(m).slice(0, Math.max(0, n));
}

// ---- 独立页清单 (pages.json): 以 nodeId 为主键, 无需排序 ----

export function parsePages(text: string | null): PageManifest {
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function loadPages(fs: FileStore): PageManifest {
  return parsePages(fs.read(PAGES_FILE));
}

export function savePages(fs: FileStore, p: PageManifest): void {
  fs.write(PAGES_FILE, JSON.stringify(p));
}

// 按 nodeId 覆盖或新增 (返回新数组, 不改入参).
export function upsertPage(p: PageManifest, e: PageEntry): PageManifest {
  return [...p.filter((x) => x.nodeId !== e.nodeId), e];
}

export function removePageByNodeId(p: PageManifest, nodeId: string): PageManifest {
  return p.filter((x) => x.nodeId !== nodeId);
}

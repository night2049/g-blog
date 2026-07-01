import { test, expect, describe } from "bun:test";
import {
  yearOf,
  slugOf,
  loadShard,
  saveShard,
  loadYearIndex,
  saveYearIndex,
  loadTaxonomyIndex,
  saveTaxonomyIndex,
  locateEntry,
  applyUpsert,
  applyRemove,
  rebuildAllShards,
  loadLatestEntries,
  loadAllEntries,
  planTimelinePage,
} from "../src/domain/shardService.ts";
import { memFileStore } from "./fakes.ts";
import type { ManifestEntry } from "../src/domain/types.ts";

const POST = "post";
function entry(
  nodeId: string,
  date: string,
  tags: string[] = [],
  dirs: string[] = [],
): ManifestEntry {
  return { url: "post/" + nodeId + ".html", title: nodeId, date, tags, dirs };
}

describe("yearOf / slugOf", () => {
  test("yearOf 取前 4 位", () => {
    expect(yearOf("2026-06-29T00:00:00.000Z")).toBe("2026");
  });
  test("slugOf 稳定编码", () => {
    expect(slugOf("往事/旧")).toBe(encodeURIComponent("往事/旧"));
    expect(slugOf("bun")).toBe("bun");
  });
});

describe("loadShard / saveShard", () => {
  test("缺失 -> []", () => {
    expect(loadShard(memFileStore(), "year", "2026")).toEqual([]);
  });
  test("空数组 -> 删文件", () => {
    const fs = memFileStore({ "data/year/2026.json": "[{}]" });
    saveShard(fs, "year", "2026", []);
    expect("data/year/2026.json" in fs.dump()).toBe(false);
  });
  test("非空 -> date 倒序写", () => {
    const fs = memFileStore();
    saveShard(fs, "year", "2026", [
      entry("I_a", "2026-01-01"),
      entry("I_b", "2026-05-01"),
    ]);
    const shard = JSON.parse(fs.dump()["data/year/2026.json"]!);
    expect(shard.map((e: any) => e.url)).toEqual(["post/I_b.html", "post/I_a.html"]);
  });
});

describe("索引读写 round-trip", () => {
  test("年份索引", () => {
    const fs = memFileStore();
    saveYearIndex(fs, [{ year: "2024", count: 2 }, { year: "2026", count: 5 }]);
    // 降序写入.
    expect(loadYearIndex(fs).map((y) => y.year)).toEqual(["2026", "2024"]);
  });
  test("分类索引 (名升序)", () => {
    const fs = memFileStore();
    saveTaxonomyIndex(fs, "tag", [
      { name: "rust", slug: "rust", count: 1 },
      { name: "bun", slug: "bun", count: 2 },
    ]);
    expect(loadTaxonomyIndex(fs, "tag").map((t) => t.name)).toEqual(["bun", "rust"]);
  });
});

describe("locateEntry", () => {
  test("多年份分片中按 nodeId 命中", () => {
    const fs = memFileStore();
    saveYearIndex(fs, [{ year: "2026", count: 1 }, { year: "2024", count: 1 }]);
    saveShard(fs, "year", "2026", [entry("I_a", "2026-01-01")]);
    saveShard(fs, "year", "2024", [entry("I_b", "2024-01-01")]);
    const found = locateEntry(fs, "I_b", POST);
    expect(found?.year).toBe("2024");
    expect(found?.entry.url).toBe("post/I_b.html");
  });
  test("不存在 -> null", () => {
    const fs = memFileStore();
    saveYearIndex(fs, [{ year: "2026", count: 1 }]);
    saveShard(fs, "year", "2026", [entry("I_a", "2026-01-01")]);
    expect(locateEntry(fs, "I_none", POST)).toBeNull();
  });
});

describe("applyUpsert", () => {
  test("新增 -> 只写其 年/标签/目录 分片 + 三索引, 其它分片未被写", () => {
    const fs = memFileStore();
    // 预置无关年份分片, 用于验证未被触碰.
    fs.write("data/year/2099.json", "PRESEED");
    applyUpsert(fs, null, entry("I_a", "2026-03-03", ["bun"], ["往事"]), POST);
    const d = fs.dump();
    expect(JSON.parse(d["data/year/2026.json"]!).length).toBe(1);
    expect(JSON.parse(d["data/years.json"]!)).toEqual([{ year: "2026", count: 1 }]);
    expect(JSON.parse(d["data/tag/bun.json"]!).length).toBe(1);
    expect(JSON.parse(d["data/tags.json"]!)[0].name).toBe("bun");
    expect(JSON.parse(d["data/dir/" + encodeURIComponent("往事") + ".json"]!).length).toBe(1);
    expect(JSON.parse(d["data/dirs.json"]!)[0].name).toBe("往事");
    expect(d["data/year/2099.json"]).toBe("PRESEED"); // 未被触碰
  });

  test("改标签(增/删): 只动涉及标签分片 + tags 索引", () => {
    const fs = memFileStore();
    const old = entry("I_a", "2026-03-03", ["a", "b"]);
    applyUpsert(fs, null, old, POST);
    // 预置无关标签分片.
    fs.write("data/tag/z.json", "PRESEED");
    applyUpsert(fs, old, entry("I_a", "2026-03-03", ["b", "c"]), POST);
    const d = fs.dump();
    expect("data/tag/a.json" in d).toBe(false); // a 清空删除
    expect(JSON.parse(d["data/tag/b.json"]!).length).toBe(1);
    expect(JSON.parse(d["data/tag/c.json"]!).length).toBe(1);
    expect(JSON.parse(d["data/tags.json"]!).map((t: any) => t.name).sort()).toEqual(["b", "c"]);
    expect(d["data/tag/z.json"]).toBe("PRESEED"); // 未被触碰
  });

  test("跨年改动: 旧年份分片删该条, 新年份分片插入", () => {
    const fs = memFileStore();
    const old = entry("I_a", "2024-03-03");
    applyUpsert(fs, null, old, POST);
    applyUpsert(fs, old, entry("I_a", "2026-07-07"), POST);
    const d = fs.dump();
    expect("data/year/2024.json" in d).toBe(false); // 旧年空删除
    expect(JSON.parse(d["data/year/2026.json"]!)[0].url).toBe("post/I_a.html");
    expect(JSON.parse(d["data/years.json"]!)).toEqual([{ year: "2026", count: 1 }]);
  });

  test("跨年改动只移除该条, 旧年其它条保留", () => {
    const fs = memFileStore();
    const a = entry("I_a", "2024-03-03");
    const b = entry("I_b", "2024-06-06");
    applyUpsert(fs, null, a, POST);
    applyUpsert(fs, null, b, POST);
    applyUpsert(fs, a, entry("I_a", "2026-01-01"), POST);
    const d = fs.dump();
    const y2024 = JSON.parse(d["data/year/2024.json"]!);
    expect(y2024.map((e: any) => e.url)).toEqual(["post/I_b.html"]); // 仅 I_a 迁走
    expect(JSON.parse(d["data/years.json"]!).find((y: any) => y.year === "2024").count).toBe(1);
  });
});

describe("applyRemove", () => {
  test("删条目 + 删空分片 + 更新索引", () => {
    const fs = memFileStore();
    const e = entry("I_a", "2026-03-03", ["bun"], ["往事"]);
    applyUpsert(fs, null, e, POST);
    applyRemove(fs, e, POST);
    const d = fs.dump();
    expect("data/year/2026.json" in d).toBe(false);
    expect("data/tag/bun.json" in d).toBe(false);
    expect("data/dir/" + encodeURIComponent("往事") + ".json" in d).toBe(false);
    expect(JSON.parse(d["data/years.json"]!).length).toBe(0);
    expect(JSON.parse(d["data/tags.json"]!).length).toBe(0);
    expect(JSON.parse(d["data/dirs.json"]!).length).toBe(0);
  });
});

describe("rebuildAllShards", () => {
  test("从内存 manifest 全量重建分片/索引, 计数正确, 组内 date 倒序", () => {
    const fs = memFileStore();
    const manifest = [
      entry("I_1", "2026-01-01", ["bun"], ["往事"]),
      entry("I_2", "2026-05-01", ["bun", "rust"], []),
      entry("I_3", "2024-09-09", ["rust"], ["往事"]),
    ];
    rebuildAllShards(fs, manifest);
    const d = fs.dump();
    // 年份索引 + 分片
    expect(JSON.parse(d["data/years.json"]!)).toEqual([
      { year: "2026", count: 2 },
      { year: "2024", count: 1 },
    ]);
    expect(JSON.parse(d["data/year/2026.json"]!).map((e: any) => e.url)).toEqual([
      "post/I_2.html",
      "post/I_1.html",
    ]);
    // 标签
    const tags = JSON.parse(d["data/tags.json"]!);
    expect(tags.find((t: any) => t.name === "bun").count).toBe(2);
    expect(tags.find((t: any) => t.name === "rust").count).toBe(2);
    // 目录
    expect(JSON.parse(d["data/dirs.json"]!)[0].name).toBe("往事");
    expect(JSON.parse(d["data/dir/" + encodeURIComponent("往事") + ".json"]!).length).toBe(2);
  });
});

describe("loadAllEntries / loadLatestEntries", () => {
  test("loadAllEntries 合并全部年份分片", () => {
    const fs = memFileStore();
    rebuildAllShards(fs, [entry("I_1", "2026-01-01"), entry("I_2", "2024-01-01")]);
    expect(loadAllEntries(fs).length).toBe(2);
  });
  test("loadLatestEntries 跨年取最新 N (全局 date 倒序)", () => {
    const fs = memFileStore();
    rebuildAllShards(fs, [
      entry("I_1", "2026-05-01"),
      entry("I_2", "2026-01-01"),
      entry("I_3", "2024-01-01"),
    ]);
    expect(loadLatestEntries(fs, 2).map((e) => e.url)).toEqual([
      "post/I_1.html",
      "post/I_2.html",
    ]);
    expect(loadLatestEntries(fs, 0)).toEqual([]);
  });
});

describe("planTimelinePage", () => {
  const idx = [
    { year: "2026", count: 5 },
    { year: "2025", count: 3 },
  ];
  test("单年覆盖整页", () => {
    expect(planTimelinePage(idx, 1, 4)).toEqual({ years: ["2026"], start: 0, end: 4 });
  });
  test("跨年边界返回两个年份 + 正确切片", () => {
    expect(planTimelinePage(idx, 2, 4)).toEqual({ years: ["2026", "2025"], start: 4, end: 8 });
  });
  test("末页不足", () => {
    // 总 8, 每页 3: 第 3 页全局 [6,8) -> 仅 2025 (yStart5,yEnd8), start=1,end=3
    expect(planTimelinePage(idx, 3, 3)).toEqual({ years: ["2025"], start: 1, end: 3 });
  });
  test("page 超界 -> 空", () => {
    expect(planTimelinePage(idx, 99, 4)).toEqual({ years: [], start: 0, end: 0 });
  });
  test("空 years -> 空", () => {
    expect(planTimelinePage([], 1, 4)).toEqual({ years: [], start: 0, end: 0 });
  });
});

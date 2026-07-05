import { test, expect, describe } from "bun:test";
import {
  upsertEntry,
  sortManifest,
  takeLatest,
  loadPages,
  savePages,
  upsertPage,
  removePageByNodeId,
} from "../src/domain/manifestService.ts";
import { memFileStore } from "./fakes.ts";

const E = (url: string, date: string, title = "t") => ({ url, title, date });

describe("纯操作", () => {
  test("upsert 新增", () => {
    expect(upsertEntry([], E("a.html", "1")).length).toBe(1);
  });
  test("upsert 覆盖同 url", () => {
    const m = upsertEntry([E("a.html", "1", "old")], E("a.html", "2", "new"));
    expect(m.length).toBe(1);
    expect(m[0]!.title).toBe("new");
  });
  test("sort date 倒序, 同 date url 倒序", () => {
    const sorted = sortManifest([
      E("a.html", "2026-01-01"),
      E("c.html", "2026-03-01"),
      E("b.html", "2026-03-01"),
    ]);
    expect(sorted.map((x) => x.url)).toEqual(["c.html", "b.html", "a.html"]);
  });
  test("不可变: 入参不被改", () => {
    const input = [E("a.html", "1")];
    upsertEntry(input, E("b.html", "2"));
    sortManifest(input);
    expect(input.length).toBe(1);
  });
});

describe("IO", () => {
  test("loadPages 无 -> []", () => {
    expect(loadPages(memFileStore())).toEqual([]);
  });
});

describe("takeLatest", () => {
  const m = [
    E("a.html", "2026-01-01"),
    E("c.html", "2026-03-01"),
    E("b.html", "2026-02-01"),
  ];
  test("先排序再取前 N", () => {
    expect(takeLatest(m, 2).map((x) => x.url)).toEqual(["c.html", "b.html"]);
  });
  test("N 超过总数 -> 全量(已排序)", () => {
    expect(takeLatest(m, 99).length).toBe(3);
  });
  test("N=0 / N<0 -> []", () => {
    expect(takeLatest(m, 0)).toEqual([]);
    expect(takeLatest(m, -1)).toEqual([]);
  });
});

describe("pages 清单", () => {
  const P = (nodeId: string, url: string, title = "t") => ({ nodeId, url, title });
  test("parse 空/坏 -> []", () => {
    expect(loadPages(memFileStore())).toEqual([]);
    expect(loadPages(memFileStore({ "pages.json": "oops" }))).toEqual([]);
  });
  test("save/load round-trip", () => {
    const fs = memFileStore();
    savePages(fs, [P("I_a", "about.html")]);
    expect(loadPages(fs)).toEqual([P("I_a", "about.html")]);
  });
  test("upsertPage 覆盖同 nodeId, 不改入参", () => {
    const input = [P("I_a", "about.html", "旧")];
    const out = upsertPage(input, P("I_a", "about.html", "新"));
    expect(out.length).toBe(1);
    expect(out[0]!.title).toBe("新");
    expect(input[0]!.title).toBe("旧");
  });
  test("removePageByNodeId 移除/不存在原样", () => {
    expect(removePageByNodeId([P("I_a", "about.html")], "I_a")).toEqual([]);
    expect(removePageByNodeId([P("I_a", "about.html")], "I_x").length).toBe(1);
  });
});

import { test, expect, describe } from "bun:test";
import { buildDirMap, buildTagMap, buildYearMap } from "../src/domain/taxonomyService.ts";
import type { Manifest } from "../src/domain/types.ts";

// 入参约定为已 date 倒序的 manifest.
const m: Manifest = [
  { url: "c.html", title: "c", date: "2026-03-01", tags: ["rust"], dirs: ["技术", "往事"] },
  { url: "b.html", title: "b", date: "2026-02-01", tags: ["rust", "css"], dirs: ["技术"] },
  { url: "a.html", title: "a", date: "2026-01-01", tags: ["css"], dirs: [] },
];

describe("buildDirMap", () => {
  test("一篇多目录进入多组", () => {
    const groups = buildDirMap(m);
    const names = groups.map((g) => g.name);
    expect(names).toContain("技术");
    expect(names).toContain("往事");
    const tech = groups.find((g) => g.name === "技术")!;
    expect(tech.posts.map((p) => p.url)).toEqual(["c.html", "b.html"]);
  });
  test("组按名升序", () => {
    const names = buildDirMap(m).map((g) => g.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  test("无 dirs 的文章不进入任何组", () => {
    const all = buildDirMap(m).flatMap((g) => g.posts.map((p) => p.url));
    expect(all).not.toContain("a.html");
  });
  test("空 manifest -> []", () => {
    expect(buildDirMap([])).toEqual([]);
  });
});

describe("buildTagMap", () => {
  test("按 tags 展开归组, 组内保序", () => {
    const groups = buildTagMap(m);
    const rust = groups.find((g) => g.name === "rust")!;
    expect(rust.posts.map((p) => p.url)).toEqual(["c.html", "b.html"]);
    const css = groups.find((g) => g.name === "css")!;
    expect(css.posts.map((p) => p.url)).toEqual(["b.html", "a.html"]);
  });
});

describe("buildYearMap", () => {
  test("按年份分组, 组内 date 倒序", () => {
    const m2: Manifest = [
      { url: "c.html", title: "c", date: "2026-03-01", tags: [], dirs: [] },
      { url: "b.html", title: "b", date: "2026-01-01", tags: [], dirs: [] },
      { url: "a.html", title: "a", date: "2024-09-09", tags: [], dirs: [] },
    ];
    const groups = buildYearMap(m2);
    expect(groups.map((g) => g.name)).toEqual(["2024", "2026"]); // 组按名升序
    expect(groups.find((g) => g.name === "2026")!.posts.map((p) => p.url)).toEqual([
      "c.html",
      "b.html",
    ]);
  });
  test("无文章 -> []", () => {
    expect(buildYearMap([])).toEqual([]);
  });
});

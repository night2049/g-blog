import { test, expect, describe } from "bun:test";
import { parseMeta, resolveDate } from "../src/domain/meta.ts";

describe("parseMeta", () => {
  test("无 meta 块原样返回", () => {
    const r = parseMeta("正文");
    expect(r.meta).toEqual({});
    expect(r.content).toBe("正文");
  });
  test("解析开头 meta 块并剥离", () => {
    const r = parseMeta("<!-- meta\ndate: 2026-06-01\n-->\n正文");
    expect(r.meta.date).toBe("2026-06-01");
    expect(r.content).toBe("正文");
  });
  test("多字段全部解析", () => {
    const r = parseMeta("<!-- meta\ndate: 2026-06-01\nfoo: bar\n-->\nx");
    expect(r.meta.date).toBe("2026-06-01");
    expect(r.meta.foo).toBe("bar");
  });
  test("meta 块不在开头则视为无", () => {
    const r = parseMeta("正文\n<!-- meta\ndate: 2026-06-01\n-->");
    expect(r.meta).toEqual({});
  });
  test("块前空白仍解析", () => {
    const r = parseMeta(" \n<!-- meta\ndate: 2026-06-01\n-->\nx");
    expect(r.meta.date).toBe("2026-06-01");
  });
  test("body 为 null", () => {
    const r = parseMeta(null);
    expect(r.meta).toEqual({});
    expect(r.content).toBe("");
  });
});

describe("resolveDate", () => {
  test("date-only 归一化为 UTC 当日", () => {
    expect(resolveDate({ date: "2026-06-01" }, "2026-05-01T00:00:00Z")).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });
  test("完整 ISO 归一化", () => {
    expect(
      resolveDate({ date: "2026-06-01T08:00:00Z" }, "2026-05-01T00:00:00Z"),
    ).toBe("2026-06-01T08:00:00.000Z");
  });
  test("非法 date 回退 createdAt", () => {
    expect(resolveDate({ date: "not-a-date" }, "2026-05-01T00:00:00Z")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
  test("无 date 回退 createdAt", () => {
    expect(resolveDate({}, "2026-05-01T00:00:00Z")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
});

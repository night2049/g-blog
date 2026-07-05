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
  test("带时区 ISO datetime 按输入日期严格校验", () => {
    expect(
      resolveDate({ date: "2026-06-01T08:00:00+08:00" }, "2026-05-01T00:00:00Z"),
    ).toBe("2026-06-01T00:00:00.000Z");
  });
  test("非法 date 回退 createdAt", () => {
    expect(resolveDate({ date: "not-a-date" }, "2026-05-01T00:00:00Z")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
  test("非法 date-only 不被 JS 自动滚动, 回退 createdAt", () => {
    expect(resolveDate({ date: "2026-02-31" }, "2026-05-01T00:00:00Z")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(resolveDate({ date: "2025-02-29" }, "2026-05-01T00:00:00Z")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
  test("非法 ISO datetime 不被 JS 自动滚动, 回退 createdAt", () => {
    expect(
      resolveDate({ date: "2026-02-31T00:00:00.000Z" }, "2026-05-01T00:00:00Z"),
    ).toBe("2026-05-01T00:00:00.000Z");
    expect(
      resolveDate({ date: "2025-02-29T08:00:00+08:00" }, "2026-05-01T00:00:00Z"),
    ).toBe("2026-05-01T00:00:00.000Z");
  });
  test("合法闰日 date-only 通过", () => {
    expect(resolveDate({ date: "2024-02-29" }, "2026-05-01T00:00:00Z")).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });
  test("无 date 回退 createdAt", () => {
    expect(resolveDate({}, "2026-05-01T00:00:00Z")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
});

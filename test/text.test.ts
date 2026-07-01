import { test, expect, describe } from "bun:test";
import { htmlToText, truncate } from "../src/domain/text.ts";

describe("htmlToText", () => {
  test("去标签 + 折叠空白", () => {
    expect(htmlToText("<p>Hello <b>World</b></p>\n<p>x</p>")).toBe("Hello World x");
  });
  test("解码命名实体与数字实体", () => {
    expect(htmlToText("a &amp; b &#65; &#x42;")).toBe("a & b A B");
  });
  test("空/纯标签 -> 空串", () => {
    expect(htmlToText("<img src='x'>")).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("truncate", () => {
  test("超长截断加省略号", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
  });
  test("不超长原样返回", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });
  test("length<=0 原样返回", () => {
    expect(truncate("abc", 0)).toBe("abc");
  });
});

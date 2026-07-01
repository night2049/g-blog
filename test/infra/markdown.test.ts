import { test, expect } from "bun:test";
import { createMarkdown } from "../../src/infra/markdown.ts";

const md = createMarkdown();
test("渲染标题", () => {
  expect(md.render("# hi")).toContain("<h1>");
});
test("渲染 GFM 表格", () => {
  expect(md.render("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<table");
});
test("渲染加粗", () => {
  expect(md.render("**x**")).toContain("<strong>");
});

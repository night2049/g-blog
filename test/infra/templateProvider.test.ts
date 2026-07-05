import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemplateProvider } from "../../src/infra/templateProvider.ts";

test("read 返回对应文件内容", () => {
  const d = mkdtempSync(join(tmpdir(), "gblog-tpl-"));
  writeFileSync(join(d, "post.html"), "<h1>{{title}}</h1>", "utf8");
  const tp = createTemplateProvider(d);
  expect(tp.read("post.html")).toBe("<h1>{{title}}</h1>");
});

test("缺失文件抛错", () => {
  const d = mkdtempSync(join(tmpdir(), "gblog-tpl-"));
  expect(() => createTemplateProvider(d).read("missing.html")).toThrow();
});

test("拒绝越界模板路径", () => {
  const d = mkdtempSync(join(tmpdir(), "gblog-tpl-"));
  expect(() => createTemplateProvider(d).read("../baseof.html")).toThrow();
  expect(() => createTemplateProvider(d).read("partials\\head.html")).toThrow();
  expect(() => createTemplateProvider(d).read(join(d, "post.html"))).toThrow();
});

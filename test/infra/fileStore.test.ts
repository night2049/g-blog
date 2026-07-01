import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../../src/infra/fileStore.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "gblog-"));
}

test("write+read round-trip", () => {
  const d = tmp();
  const fs = createFileStore(d);
  fs.write("a/b.txt", "hello");
  expect(fs.read("a/b.txt")).toBe("hello");
  rmSync(d, { recursive: true, force: true });
});

test("read 不存在返回 null", () => {
  expect(createFileStore(tmp()).read("none.txt")).toBeNull();
});

test("read 去除 BOM", () => {
  const d = tmp();
  writeFileSync(join(d, "x.json"), "\uFEFF{}", "utf8");
  expect(createFileStore(d).read("x.json")).toBe("{}");
  rmSync(d, { recursive: true, force: true });
});

test("exists 与 remove (不存在不抛错)", () => {
  const d = tmp();
  const fs = createFileStore(d);
  fs.write("f.txt", "1");
  expect(fs.exists("f.txt")).toBe(true);
  fs.remove("f.txt");
  expect(fs.exists("f.txt")).toBe(false);
  fs.remove("f.txt");
});

test("list 返回目录下文件名; 目录不存在返回 []", () => {
  const d = tmp();
  const fs = createFileStore(d);
  expect(fs.list("post/I_x")).toEqual([]);
  fs.writeBytes("post/I_x/a.png", new Uint8Array([1]));
  fs.writeBytes("post/I_x/b.jpg", new Uint8Array([2]));
  expect(fs.list("post/I_x").sort()).toEqual(["a.png", "b.jpg"]);
  rmSync(d, { recursive: true, force: true });
});

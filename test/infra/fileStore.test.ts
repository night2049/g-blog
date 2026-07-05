import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileStore, safeResolve } from "../../src/infra/fileStore.ts";

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

test("safeResolve 拒绝 NUL/绝对路径/反斜杠/越界", () => {
  const d = tmp();
  expect(() => safeResolve(d, "a\0b")).toThrow();
  expect(() => safeResolve(d, resolve(d, "x.txt"))).toThrow();
  expect(() => safeResolve(d, "a\\b.txt")).toThrow();
  expect(() => safeResolve(d, "../x.txt")).toThrow();
  expect(safeResolve(d, "a/../b.txt")).toBe(join(d, "b.txt"));
  rmSync(d, { recursive: true, force: true });
});

test("FileStore 所有相对路径受 safeResolve 边界保护", () => {
  const d = tmp();
  const fs = createFileStore(d);
  expect(() => fs.read("../x.txt")).toThrow();
  expect(() => fs.write("/abs.txt", "x")).toThrow();
  expect(() => fs.writeBytes("a\\b.bin", new Uint8Array([1]))).toThrow();
  expect(() => fs.listAll("../x")).toThrow();
  rmSync(d, { recursive: true, force: true });
});

test("已存在路径 realpath 越界时拒绝", () => {
  const base = tmp();
  const outside = tmp();
  try {
    mkdirSync(join(outside, "dir"));
    writeFileSync(join(outside, "dir", "secret.txt"), "secret", "utf8");
    let linked = false;
    try {
      symlinkSync(join(outside, "dir"), join(base, "link"), "junction");
      linked = true;
    } catch {
      // Windows 权限或文件系统不支持符号链接时, 保留其它路径边界测试.
    }
    if (linked) {
      expect(() => createFileStore(base).read("link/secret.txt")).toThrow();
      expect(() => createFileStore(base).write("link/new.txt", "x")).toThrow();
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("clearExcept 遇到 realpath 越界项时抛错且不删除根外文件", () => {
  const base = tmp();
  const outside = tmp();
  try {
    mkdirSync(join(outside, "dir"));
    writeFileSync(join(outside, "dir", "secret.txt"), "secret", "utf8");
    let linked = false;
    try {
      symlinkSync(join(outside, "dir"), join(base, "link"), "junction");
      linked = true;
    } catch {
      // Windows 权限或文件系统不支持符号链接时跳过该分支.
    }
    if (linked) {
      const fs = createFileStore(base);
      expect(() => fs.clearExcept([])).toThrow();
      expect(readFileSync(join(outside, "dir", "secret.txt"), "utf8")).toBe("secret");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolvePreviewPath } from "../scripts/serve.ts";

// resolvePreviewPath 返回站点根内的绝对路径 (用 node:path.resolve 归一化), 越界返回 null。
// 测试用同一 resolve(root, ...) 计算期望值, 保证跨平台 (Windows 反斜杠/POSIX 正斜杠) 断言一致。
const ROOT = "_preview";

describe("resolvePreviewPath", () => {
  test('根路径 "/" 映射到 index.html', () => {
    expect(resolvePreviewPath(ROOT, "/")).toBe(resolve(ROOT, "index.html"));
  });

  test('普通文件路径 "/about.html"', () => {
    expect(resolvePreviewPath(ROOT, "/about.html")).toBe(resolve(ROOT, "about.html"));
  });

  test('目录结尾 "/post/" 补 index.html', () => {
    expect(resolvePreviewPath(ROOT, "/post/")).toBe(resolve(ROOT, "post/index.html"));
  });

  test('数据 JSON "/data/years.json"', () => {
    expect(resolvePreviewPath(ROOT, "/data/years.json")).toBe(
      resolve(ROOT, "data/years.json"),
    );
  });

  test('编码斜杠 "/post%2Fa.html" 正确 decode', () => {
    expect(resolvePreviewPath(ROOT, "/post%2Fa.html")).toBe(resolve(ROOT, "post/a.html"));
  });

  test("子目录下文件不被越界拦截", () => {
    expect(resolvePreviewPath(ROOT, "/post/2025/x.html")).toBe(
      resolve(ROOT, "post/2025/x.html"),
    );
  });

  describe("越界拦截返回 null", () => {
    test('明文 "/../secret"', () => {
      expect(resolvePreviewPath(ROOT, "/../secret")).toBeNull();
    });

    test('编码斜杠 "/..%2f.."', () => {
      expect(resolvePreviewPath(ROOT, "/..%2f..")).toBeNull();
    });

    test('编码点 "/%2e%2e/etc"', () => {
      expect(resolvePreviewPath(ROOT, "/%2e%2e/etc")).toBeNull();
    });

    test("路径中段 .. 逃逸出 root", () => {
      expect(resolvePreviewPath(ROOT, "/a/../../etc")).toBeNull();
    });

    test("非法百分号编码返回 null", () => {
      expect(resolvePreviewPath(ROOT, "/%")).toBeNull();
    });

    test("空字节注入返回 null", () => {
      expect(resolvePreviewPath(ROOT, "/a%00b")).toBeNull();
    });
  });

  test("root 内合法的 .. 折叠仍在界内", () => {
    // "/a/../b" 折叠为 root/b, 未逃逸, 应返回 root/b。
    expect(resolvePreviewPath(ROOT, "/a/../b")).toBe(resolve(ROOT, "b"));
  });

  test("拒绝 realpath 越界的 symlink/junction 路径", () => {
    const base = mkdtempSync(join(tmpdir(), "gblog-serve-"));
    const outside = mkdtempSync(join(tmpdir(), "gblog-serve-out-"));
    try {
      mkdirSync(join(outside, "dir"));
      writeFileSync(join(outside, "dir", "secret.txt"), "secret", "utf8");
      let linked = false;
      try {
        symlinkSync(join(outside, "dir"), join(base, "link"), "junction");
        linked = true;
      } catch {
        // Windows 权限或文件系统不支持时跳过 realpath 分支, 保留其它路径测试.
      }
      if (linked) {
        expect(resolvePreviewPath(base, "/link/secret.txt")).toBeNull();
        expect(resolvePreviewPath(base, "/link/new.txt")).toBeNull();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

import { test, expect, describe } from "bun:test";
import { createImageDownloader } from "../../src/infra/imageDownloader.ts";

// 1x1 红点 PNG (合法图头, 用于验证 Bun.Image 读出 width/height=1).
const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

// 用合成 Response 充当 fetch, 避免触网.
function fetchReturning(body: Uint8Array, contentType = "image/png"): typeof fetch {
  return (async () =>
    new Response(body, { headers: { "content-type": contentType } })) as unknown as typeof fetch;
}

describe("createImageDownloader 尺寸 (Bun.Image)", () => {
  const bunImageAvailable =
    typeof (globalThis as any).Bun?.Image === "function";

  test("PNG 字节 -> 带出 ext 与 width/height", async () => {
    const dl = createImageDownloader(undefined, fetchReturning(PNG_1x1));
    const res = await dl.download("https://x/a.png");
    expect(res).not.toBeNull();
    expect(res!.ext).toBe("png");
    // 前置守卫: Bun.Image 不可用时跳过尺寸断言 (旧 Bun/非全功能平台), 不误红.
    if (bunImageAvailable) {
      expect(res!.width).toBe(1);
      expect(res!.height).toBe(1);
    }
  });

  test("非图字节 (content-type 仍声明 png) -> 无尺寸, 不抛错", async () => {
    const dl = createImageDownloader(
      undefined,
      fetchReturning(new Uint8Array([1, 2, 3, 4]), "image/png"),
    );
    const res = await dl.download("https://x/bad.png");
    expect(res).not.toBeNull();
    expect(res!.ext).toBe("png"); // 扩展名仍按 content-type 推断
    expect(res!.width).toBeUndefined();
    expect(res!.height).toBeUndefined();
  });

  test("HTTP 非 200 -> null", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch;
    const dl = createImageDownloader(undefined, fetchImpl);
    expect(await dl.download("https://x/missing.png")).toBeNull();
  });
});

describe("createImageDownloader WebP 转码", () => {
  const bunImage = typeof (globalThis as any).Bun?.Image === "function";

  test("PNG + webp 启用 -> 转 webp 且带宽高 (quality 透传)", async () => {
    const dl = createImageDownloader(undefined, fetchReturning(PNG_1x1, "image/png"), {
      enabled: true,
      quality: 80,
    });
    const res = await dl.download("https://x/a.png");
    expect(res).not.toBeNull();
    if (bunImage) {
      expect(res!.ext).toBe("webp");
      expect(res!.width).toBe(1);
      expect(res!.height).toBe(1);
    } else {
      expect(res!.ext).toBe("png"); // Bun.Image 不可用时回退原格式
    }
  });

  test("SVG 原样不转 (矢量不解码)", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const dl = createImageDownloader(undefined, fetchReturning(svg, "image/svg+xml"), {
      enabled: true,
      quality: 80,
    });
    expect((await dl.download("https://x/a.svg"))!.ext).toBe("svg");
  });

  test("GIF 原样不转 (可能动图)", async () => {
    const dl = createImageDownloader(
      undefined,
      fetchReturning(new Uint8Array([0x47, 0x49, 0x46]), "image/gif"),
      { enabled: true, quality: 80 },
    );
    expect((await dl.download("https://x/a.gif"))!.ext).toBe("gif");
  });

  test("损坏字节回退保留原格式, 不抛错", async () => {
    const dl = createImageDownloader(
      undefined,
      fetchReturning(new Uint8Array([1, 2, 3, 4]), "image/png"),
      { enabled: true, quality: 80 },
    );
    const res = await dl.download("https://x/bad.png");
    expect(res!.ext).toBe("png"); // 转码失败回退
    expect(res!.width).toBeUndefined();
  });

  test("webp 禁用 -> 不转码 (PNG 保持 png)", async () => {
    const dl = createImageDownloader(undefined, fetchReturning(PNG_1x1, "image/png"), {
      enabled: false,
      quality: 80,
    });
    expect((await dl.download("https://x/a.png"))!.ext).toBe("png");
  });
});

import { createLocalImageReader } from "../../src/infra/imageDownloader.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("createLocalImageReader (本地相对图读盘)", () => {
  const bunImage = typeof (globalThis as any).Bun?.Image === "function";

  function withTempDir(files: Record<string, Uint8Array>): string {
    const base = mkdtempSync(join(tmpdir(), "gblog-localimg-"));
    for (const [rel, bytes] of Object.entries(files)) {
      writeFileSync(join(base, rel), bytes);
    }
    return base;
  }

  test("读盘字节 + 由扩展名推断 ext", async () => {
    const base = withTempDir({ "a.png": PNG_1x1 });
    try {
      const reader = createLocalImageReader(base);
      const res = await reader.download("a.png");
      expect(res).not.toBeNull();
      expect(res!.ext).toBe("png");
      expect(res!.bytes.length).toBe(PNG_1x1.length);
      if (bunImage) {
        expect(res!.width).toBe(1);
        expect(res!.height).toBe(1);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("缺文件 -> null (不抛 ENOENT)", async () => {
    const base = withTempDir({});
    try {
      const reader = createLocalImageReader(base);
      expect(await reader.download("nope.png")).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("webp 启用 -> 转 webp 透传 (Bun.Image 可用时)", async () => {
    const base = withTempDir({ "a.png": PNG_1x1 });
    try {
      const reader = createLocalImageReader(base, { enabled: true, quality: 80 });
      const res = await reader.download("a.png");
      expect(res).not.toBeNull();
      if (bunImage) expect(res!.ext).toBe("webp");
      else expect(res!.ext).toBe("png");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("坏图字节回退原格式, 不抛错", async () => {
    const base = withTempDir({ "bad.png": new Uint8Array([1, 2, 3, 4]) });
    try {
      const reader = createLocalImageReader(base, { enabled: true, quality: 80 });
      const res = await reader.download("bad.png");
      expect(res).not.toBeNull();
      expect(res!.ext).toBe("png"); // 转码失败回退
      expect(res!.width).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

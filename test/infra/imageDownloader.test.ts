import { test, expect, describe } from "bun:test";
import { createImageDownloader } from "../../src/infra/imageDownloader.ts";
import { createGitHubIssueAttachmentResolutionRules } from "../../src/infra/githubAttachmentRules.ts";
import type { ImageSource, VerifiedAttachmentRule } from "../../src/domain/types.ts";

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
    new Response(body as BodyInit, { headers: { "content-type": contentType } })) as unknown as typeof fetch;
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

describe("createImageDownloader 认证策略", () => {
  const body = new Uint8Array([1, 2, 3]);
  const rule: VerifiedAttachmentRule = {
    host: "private.example.test",
    pathPattern: /^\/attachments\/[a-z0-9-]+\.png$/,
    sourceRepo: "owner/repo",
    authMode: "bearer",
    evidence: {
      issueNumber: 7,
      capturedAt: "2026-07-04",
      urlShape: "https://private.example.test/attachments/<id>.png",
      anonymousStatus: 404,
      bearerStatus: 200,
      authenticatedOk: true,
    },
  };
  const issueSource: ImageSource = {
    kind: "github-issue",
    repo: "owner/repo",
    issueNumber: 7,
  };

  function scriptedFetch(
    handler: (url: string, auth: string | undefined, redirect: RequestRedirect | undefined) => Response,
  ): typeof fetch & { calls: { url: string; auth?: string; redirect?: RequestRedirect }[] } {
    const calls: { url: string; auth?: string; redirect?: RequestRedirect }[] = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      const auth = headers?.Authorization;
      calls.push({ url, auth, redirect: init?.redirect });
      return handler(url, auth, init?.redirect);
    }) as typeof fetch & { calls: { url: string; auth?: string; redirect?: RequestRedirect }[] };
    fn.calls = calls;
    return fn;
  }

  test("传 token 但无 verifiedAttachmentRules 时仍默认匿名", async () => {
    const fetchImpl = scriptedFetch((_url, auth) => {
      expect(auth).toBeUndefined();
      return new Response(body, { headers: { "content-type": "image/png" } });
    });
    const dl = createImageDownloader("secret-token", fetchImpl);
    expect(await dl.download("https://raw.githubusercontent.com/o/r/main/a.png")).not.toBeNull();
    expect(fetchImpl.calls).toEqual([
      {
        url: "https://raw.githubusercontent.com/o/r/main/a.png",
        auth: undefined,
        redirect: "manual",
      },
    ]);
  });

  test("只有 github-issue 来源命中 repo/path/status/bearer 规则才认证重试", async () => {
    const fetchImpl = scriptedFetch((_url, auth) =>
      auth
        ? new Response(body, { status: 200, headers: { "content-type": "image/png" } })
        : new Response("", { status: 404 }),
    );
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      verifiedAttachmentRules: [rule],
    });
    const res = await dl.download("https://private.example.test/attachments/abc-123.png", issueSource);
    expect(res).not.toBeNull();
    expect(fetchImpl.calls.map((c) => c.auth)).toEqual([undefined, "Bearer secret-token"]);
  });

  test("自定义 shouldRetryWithAuth 不能绕过 verifiedAttachmentRules", async () => {
    const fetchImpl = scriptedFetch((_url, auth) => {
      expect(auth).toBeUndefined();
      return new Response("", { status: 404 });
    });
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      shouldRetryWithAuth: () => true,
    } as any);
    expect(
      await dl.download("https://private.example.test/attachments/abc-123.png", issueSource),
    ).toBeNull();
    expect(fetchImpl.calls.map((c) => c.auth)).toEqual([undefined]);
  });

  test("local-markdown 来源即使命中规则也不认证", async () => {
    const fetchImpl = scriptedFetch(() => new Response("", { status: 404 }));
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      verifiedAttachmentRules: [rule],
    });
    expect(
      await dl.download("https://private.example.test/attachments/abc-123.png", {
        kind: "local-markdown",
      }),
    ).toBeNull();
    expect(fetchImpl.calls.map((c) => c.auth)).toEqual([undefined]);
  });

  test("raw/gist 与 demo 中出现的 GitHub 图片代理域默认不带 token", async () => {
    for (const url of [
      "https://raw.githubusercontent.com/o/r/main/a.png",
      "https://gist.githubusercontent.com/u/g/raw/a.png",
      "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
      "https://camo.githubusercontent.com/617169e529ae1e4322baf6482579a23d41dc82661c1d47845c0e90bfe2085ed9/68747470733a2f2f6769746875622e6769746875626173736574732e636f6d2f696d616765732f6d6f64756c65732f6c6f676f735f706167652f4769744875622d4d61726b2e706e67",
    ]) {
      const fetchImpl = scriptedFetch(() => new Response("", { status: 404 }));
      const dl = createImageDownloader("secret-token", fetchImpl);
      expect(await dl.download(url, issueSource)).toBeNull();
      expect(fetchImpl.calls.map((c) => c.auth)).toEqual([undefined]);
    }
  });

  test("api.github.com 只有 Markdown 解析私有附件时才带 token", async () => {
    const fetchImpl = scriptedFetch(() => new Response("", { status: 404 }));
    const dl = createImageDownloader("secret-token", fetchImpl);
    expect(await dl.download("https://api.github.com/repos/o/r/contents/a.png", issueSource))
      .toBeNull();
    expect(fetchImpl.calls.map((c) => c.auth)).toEqual([undefined]);
  });

  test("redirect 每跳先匿名, Authorization 不跨跳", async () => {
    const fetchImpl = scriptedFetch((url, auth) => {
      if (url === "https://github.com/user-attachments/assets/abc") {
        expect(auth).toBeUndefined();
        return new Response("", {
          status: 302,
          headers: { location: "https://private.example.test/attachments/abc-123.png" },
        });
      }
      if (!auth) return new Response("", { status: 404 });
      return new Response(body, { status: 200, headers: { "content-type": "image/png" } });
    });
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      verifiedAttachmentRules: [rule],
    });
    expect(
      await dl.download("https://github.com/user-attachments/assets/abc", issueSource),
    ).not.toBeNull();
    expect(fetchImpl.calls).toEqual([
      {
        url: "https://github.com/user-attachments/assets/abc",
        auth: undefined,
        redirect: "manual",
      },
      {
        url: "https://private.example.test/attachments/abc-123.png",
        auth: undefined,
        redirect: "manual",
      },
      {
        url: "https://private.example.test/attachments/abc-123.png",
        auth: "Bearer secret-token",
        redirect: "manual",
      },
    ]);
  });

  test("GitHub issue canonical 附件先用 Markdown API 解析, 再匿名下载签名媒体 URL", async () => {
    const uuid = "d3455b90-f94f-4013-a00a-ebaff090635e";
    const canonical = "https://github.com/user-attachments/assets/" + uuid;
    const signed =
      "https://private-user-images.githubusercontent.com/120214987/614857368-" +
      uuid +
      ".png?jwt=abc";
    const calls: {
      url: string;
      auth?: string;
      method?: string;
      redirect?: RequestRedirect;
      body?: string;
    }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({
        url,
        auth: headers?.Authorization,
        method: init?.method,
        redirect: init?.redirect,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url === "https://api.github.com/markdown") {
        return new Response(
          '<p><a href="' +
            signed.replaceAll("&", "&amp;") +
            '"><img src="' +
            signed.replaceAll("&", "&amp;") +
            '" alt="x"></a></p>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      if (url === signed) {
        expect(headers?.Authorization).toBeUndefined();
        return new Response(body, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      verifiedAttachmentRules: [],
      githubAttachmentResolutionRules: createGitHubIssueAttachmentResolutionRules("owner/repo"),
    });

    expect(await dl.download(canonical, issueSource)).not.toBeNull();
    expect(calls.map((c) => ({ url: c.url, auth: c.auth, method: c.method, redirect: c.redirect })))
      .toEqual([
        {
          url: "https://api.github.com/markdown",
          auth: "Bearer secret-token",
          method: "POST",
          redirect: undefined,
        },
        {
          url: signed,
          auth: undefined,
          method: undefined,
          redirect: "manual",
        },
      ]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      text: "![gblog-attachment](<" + canonical + ">)",
      mode: "gfm",
      context: "owner/repo",
    });
  });

  test("GitHub canonical 附件带 query/hash 时不调用 Markdown API", async () => {
    const canonical =
      "https://github.com/user-attachments/assets/d3455b90-f94f-4013-a00a-ebaff090635e?x=1#frag";
    const calls: { url: string; auth?: string }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(input), auth: headers?.Authorization });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      githubAttachmentResolutionRules: createGitHubIssueAttachmentResolutionRules("owner/repo"),
    });

    expect(await dl.download(canonical, issueSource)).toBeNull();
    expect(calls).toEqual([{ url: canonical, auth: undefined }]);
  });

  test("GitHub Web UI 复制出的私有签名 JPEG 路径可作为 Markdown API 解析结果", async () => {
    const canonical =
      "https://github.com/user-attachments/assets/726e1b6d-46bb-4982-a863-840618e8ed10";
    const signed =
      "https://private-user-images.githubusercontent.com/69810127/614133415-726e1b6d-46bb-4982-a863-840618e8ed10.jpg?jwt=abc";
    const calls: { url: string; auth?: string; method?: string; redirect?: RequestRedirect }[] =
      [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({
        url,
        auth: headers?.Authorization,
        method: init?.method,
        redirect: init?.redirect,
      });
      if (url === "https://api.github.com/markdown") {
        return new Response('<p><img src="' + signed + '" alt="x"></p>', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url === signed) {
        return new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      githubAttachmentResolutionRules: createGitHubIssueAttachmentResolutionRules("owner/repo"),
    });

    const result = await dl.download(canonical, issueSource);
    expect(result).not.toBeNull();
    expect(result!.ext).toBe("jpg");
    expect(calls).toEqual([
      {
        url: "https://api.github.com/markdown",
        auth: "Bearer secret-token",
        method: "POST",
        redirect: undefined,
      },
      {
        url: signed,
        auth: undefined,
        method: undefined,
        redirect: "manual",
      },
    ]);
  });

  test("GitHub issue 附件解析结果未命中签名媒体规则时 fail closed", async () => {
    const canonical =
      "https://github.com/user-attachments/assets/d3455b90-f94f-4013-a00a-ebaff090635e";
    const calls: { url: string; auth?: string }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, auth: headers?.Authorization });
      if (url === "https://api.github.com/markdown") {
        return new Response('<img src="https://evil.example.test/a.png?jwt=abc">', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url === canonical) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      githubAttachmentResolutionRules: createGitHubIssueAttachmentResolutionRules("owner/repo"),
    });

    expect(await dl.download(canonical, issueSource)).toBeNull();
    expect(calls).toEqual([
      { url: "https://api.github.com/markdown", auth: "Bearer secret-token" },
    ]);
  });

  test("local-markdown 中的 GitHub canonical 附件不调用 Markdown API", async () => {
    const canonical =
      "https://github.com/user-attachments/assets/d3455b90-f94f-4013-a00a-ebaff090635e";
    const calls: { url: string; auth?: string }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(input), auth: headers?.Authorization });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const dl = createImageDownloader("secret-token", fetchImpl, undefined, {
      contentRepo: "owner/repo",
      githubAttachmentResolutionRules: createGitHubIssueAttachmentResolutionRules("owner/repo"),
    });

    expect(await dl.download(canonical, { kind: "local-markdown" })).toBeNull();
    expect(calls).toEqual([{ url: canonical, auth: undefined }]);
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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
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

  test("拒绝 NUL/绝对路径/反斜杠/越界本地图路径", async () => {
    const base = withTempDir({ "a.png": PNG_1x1 });
    try {
      const reader = createLocalImageReader(base);
      expect(await reader.download("a\0.png")).toBeNull();
      expect(await reader.download(resolve(base, "a.png"))).toBeNull();
      expect(await reader.download("a\\b.png")).toBeNull();
      expect(await reader.download("../a.png")).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("拒绝 realpath 越界的本地图路径", async () => {
    const base = withTempDir({});
    const outside = mkdtempSync(join(tmpdir(), "gblog-localimg-out-"));
    try {
      mkdirSync(join(outside, "dir"));
      writeFileSync(join(outside, "dir", "a.png"), PNG_1x1);
      let linked = false;
      try {
        symlinkSync(join(outside, "dir"), join(base, "link"), "junction");
        linked = true;
      } catch {}
      if (linked) {
        const reader = createLocalImageReader(base);
        expect(await reader.download("link/a.png")).toBeNull();
        expect(await reader.download("link/new.png")).toBeNull();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
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

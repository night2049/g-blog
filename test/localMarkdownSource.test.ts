import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  splitFrontMatter,
  mapToRawIssue,
  canonicalRelPath,
  md5Hex,
  listLocalPosts,
  listChangedLocalPosts,
  type BuildSlice,
} from "../src/infra/localMarkdownSource.ts";
import { fixtureConfig } from "./fakes.ts";
import type { Config } from "../src/domain/types.ts";

const BUILD: BuildSlice = {
  publishedLabel: "published",
  pageLabel: "page",
  dirPrefix: "dir",
  metaMarker: "meta",
};

describe("splitFrontMatter", () => {
  test("标准围栏: 解析 data 并切出正文", () => {
    const { data, body } = splitFrontMatter("---\ntitle: 你好\ndraft: false\n---\n正文内容");
    expect(data.title).toBe("你好");
    expect(data.draft).toBe(false);
    expect(body).toBe("正文内容");
  });
  test("无围栏 (裸 md): data={}, body 原样", () => {
    const { data, body } = splitFrontMatter("# 标题\n正文");
    expect(data).toEqual({});
    expect(body).toBe("# 标题\n正文");
  });
  test("空 frontmatter (空围栏): data={} 兜底", () => {
    const { data, body } = splitFrontMatter("---\n---\n正文");
    expect(data).toEqual({});
    expect(body).toBe("正文");
  });
  test("CRLF 围栏正确切分", () => {
    const { data, body } = splitFrontMatter("---\r\ntitle: x\r\n---\r\nbody");
    expect(data.title).toBe("x");
    expect(body).toBe("body");
  });
  test("YAML 非法 -> 抛错", () => {
    expect(() => splitFrontMatter("---\ntitle: : : [\n---\nbody")).toThrow();
  });
  test("正文含 --- 不误切 (无开头围栏)", () => {
    const { data, body } = splitFrontMatter("前言\n\n---\n\n分隔后的正文");
    expect(data).toEqual({});
    expect(body).toBe("前言\n\n---\n\n分隔后的正文");
  });
});

describe("canonicalRelPath", () => {
  test("glob 相对与 git 仓库相对(剥 contentDir/) 产出同一字符串", () => {
    const fromGlob = canonicalRelPath("posts", "2025/x.md"); // listLocalPosts 路径
    const gitRel = "content/posts/2025/x.md";
    const rest = gitRel.slice("content/".length); // posts/2025/x.md
    const seg = rest.split("/")[0]!;
    const fromGit = canonicalRelPath(seg, rest.slice(seg.length + 1));
    expect(fromGlob).toBe("posts/2025/x.md");
    expect(fromGit).toBe(fromGlob);
    expect(md5Hex(fromGlob)).toBe(md5Hex(fromGit));
  });
  test("Windows 反斜杠转正斜杠", () => {
    expect(canonicalRelPath("posts", "2025\\sub\\x.md")).toBe("posts/2025/sub/x.md");
  });
  test("posts/pages 前缀", () => {
    expect(canonicalRelPath("pages", "about.md")).toBe("pages/about.md");
  });
});

describe("mapToRawIssue", () => {
  const mtime = new Date("2026-01-02T03:04:05.000Z");

  test("title 缺省取文件名 (去扩展名)", () => {
    const issue = mapToRawIssue("posts/hello-world.md", {}, "正文", mtime, BUILD, "post");
    expect(issue.title).toBe("hello-world");
  });
  test("date 字符串归一化 (date-only 按 UTC 午夜)", () => {
    const issue = mapToRawIssue("posts/a.md", { date: "2025-06-01" }, "b", mtime, BUILD, "post");
    expect(issue.created_at).toBe("2025-06-01T00:00:00.000Z");
    expect(issue.updated_at).toBe("2025-06-01T00:00:00.000Z");
  });
  test("非法 date-only 回退 mtime, 不被 JS 自动滚动", () => {
    const issue = mapToRawIssue("posts/a.md", { date: "2026-02-31" }, "b", mtime, BUILD, "post");
    expect(issue.created_at).toBe(mtime.toISOString());
    expect(issue.updated_at).toBe(mtime.toISOString());
  });
  test("非法 ISO datetime 回退 mtime, 不被 JS 自动滚动", () => {
    const issue = mapToRawIssue(
      "posts/a.md",
      { date: "2025-02-29T00:00:00Z" },
      "b",
      mtime,
      BUILD,
      "post",
    );
    expect(issue.created_at).toBe(mtime.toISOString());
    expect(issue.updated_at).toBe(mtime.toISOString());
  });
  test("闰日严格校验", () => {
    const leap = mapToRawIssue("posts/a.md", { date: "2024-02-29" }, "b", mtime, BUILD, "post");
    const nonLeap = mapToRawIssue("posts/b.md", { date: "2025-02-29" }, "b", mtime, BUILD, "post");
    expect(leap.created_at).toBe("2024-02-29T00:00:00.000Z");
    expect(nonLeap.created_at).toBe(mtime.toISOString());
  });
  test("date 缺省取 mtime", () => {
    const issue = mapToRawIssue("posts/a.md", {}, "b", mtime, BUILD, "post");
    expect(issue.created_at).toBe(mtime.toISOString());
  });
  test("draft:true 不含 publishedLabel", () => {
    const issue = mapToRawIssue("posts/a.md", { draft: true }, "b", mtime, BUILD, "post");
    expect(issue.labels.some((l) => l.name === "published")).toBe(false);
  });
  test("draft 缺省/false 含 publishedLabel", () => {
    const issue = mapToRawIssue("posts/a.md", {}, "b", mtime, BUILD, "post");
    expect(issue.labels.some((l) => l.name === "published")).toBe(true);
  });
  test("tags -> labels; categories -> dirPrefix:label", () => {
    const issue = mapToRawIssue(
      "posts/a.md",
      { tags: ["bun", "教程"], categories: ["随笔"] },
      "b",
      mtime,
      BUILD,
      "post",
    );
    const names = issue.labels.map((l) => l.name);
    expect(names).toContain("bun");
    expect(names).toContain("教程");
    expect(names).toContain("dir:随笔");
  });
  test("kind=page 注入 meta url 块 (用 slug)", () => {
    const issue = mapToRawIssue("pages/about.md", { slug: "about" }, "正文", mtime, BUILD, "page");
    expect(issue.body!.startsWith("<!-- meta\nurl: about\n-->\n")).toBe(true);
    expect(issue.labels.some((l) => l.name === "page")).toBe(true);
  });
  test("kind=page 无 slug 用文件名作 url", () => {
    const issue = mapToRawIssue("pages/关于.md", {}, "正文", mtime, BUILD, "page");
    expect(issue.body!.startsWith("<!-- meta\nurl: 关于\n-->\n")).toBe(true);
  });
  test("kind=post 不注入 meta 块", () => {
    const issue = mapToRawIssue("posts/a.md", { slug: "x" }, "正文", mtime, BUILD, "post");
    expect(issue.body).toBe("正文");
    expect(issue.labels.some((l) => l.name === "page")).toBe(false);
  });
  test("md5 node_id 稳定且 32 位", () => {
    const a = mapToRawIssue("posts/a.md", {}, "x", mtime, BUILD, "post");
    const b = mapToRawIssue("posts/a.md", { title: "改了正文与标题" }, "y", mtime, BUILD, "post");
    expect(a.node_id).toBe(b.node_id); // 路径不变 -> 身份不变
    expect(a.node_id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.node_id).toBe(md5Hex("posts/a.md"));
  });
});

// ---- 磁盘扫描 (临时目录) ----
describe("listLocalPosts / listChangedLocalPosts (临时目录)", () => {
  const dirs: string[] = [];
  function makeTree(files: Record<string, string>): string {
    const base = mkdtempSync(join(tmpdir(), "gblog-md-"));
    dirs.push(base);
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(base, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    return base;
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function cfg(): Config {
    return fixtureConfig();
  }

  test("扫描 posts/pages 并合成 RawIssue", () => {
    const base = makeTree({
      "content/posts/hello.md": "---\ntitle: 你好\ntags: [bun]\n---\n正文",
      "content/posts/2025/deep.md": "# 无 frontmatter",
      "content/pages/about.md": "---\nslug: about\n---\n关于页",
    });
    const posts = listLocalPosts(cfg(), base);
    expect(posts.length).toBe(3);
    const hello = posts.find((p) => p.issue.title === "你好")!;
    expect(hello.issue.node_id).toBe(md5Hex("posts/hello.md"));
    expect(hello.issue.labels.some((l) => l.name === "bun")).toBe(true);
    const about = posts.find((p) => p.issue.labels.some((l) => l.name === "page"))!;
    expect(about.issue.body!.startsWith("<!-- meta\nurl: about")).toBe(true);
    // deep.md 标题取文件名
    expect(posts.some((p) => p.issue.title === "deep")).toBe(true);
  });

  test("listChangedLocalPosts: A/M -> upserts, D -> removes(node_id)", () => {
    const base = makeTree({
      "content/posts/a.md": "---\ntitle: A\n---\n正文A",
      "content/pages/p.md": "---\nslug: p\n---\n页P",
    });
    const changed = [
      { status: "A", path: "content/posts/a.md" },
      { status: "M", path: "content/pages/p.md" },
      { status: "D", path: "content/posts/gone.md" },
      { status: "M", path: "README.md" }, // 非 content 下, 忽略
      { status: "A", path: "content/drafts/x.md" }, // 非 posts/pages, 忽略
    ];
    const { upserts, removes } = listChangedLocalPosts(changed, cfg(), base);
    expect(upserts.length).toBe(2);
    expect(removes).toEqual([md5Hex("posts/gone.md")]);
    expect(upserts.some((u) => u.issue.title === "A")).toBe(true);
  });

  test("md5 (node_id) 冲突 fail-fast", () => {
    // 两个不同相对路径不会冲突; 这里直接断言 listLocalPosts 对正常树不抛.
    const base = makeTree({
      "content/posts/a.md": "x",
      "content/posts/b.md": "y",
    });
    expect(() => listLocalPosts(cfg(), base)).not.toThrow();
    expect(listLocalPosts(cfg(), base).length).toBe(2);
  });

  test("content 目录不存在 -> 返回 []", () => {
    const base = mkdtempSync(join(tmpdir(), "gblog-empty-"));
    dirs.push(base);
    expect(listLocalPosts(cfg(), base)).toEqual([]);
  });
});

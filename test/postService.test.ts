import { test, expect, describe } from "bun:test";
import {
  isPublished,
  postUrl,
  nodeIdFromUrl,
  postImgDir,
  issueToPost,
  issueToPage,
  extractTags,
  extractDirs,
  isDirLabel,
  dirValue,
  isPageIssue,
  resolvePageUrl,
} from "../src/domain/postService.ts";
import { fakeMarkdown, fixtureConfig, makeIssue } from "./fakes.ts";

const tagOpts = {
  publishedLabel: "published",
  pageLabel: "page",
  dirPrefix: "dir",
  excludedLabels: [] as string[],
};

describe("isPublished", () => {
  const label = "published";
  test("open + 含 label", () => {
    expect(isPublished(makeIssue({ state: "open", labels: [{ name: "published" }] }), label)).toBe(true);
  });
  test("open + 无 label", () => {
    expect(isPublished(makeIssue({ state: "open", labels: [] }), label)).toBe(false);
  });
  test("closed + 含 label", () => {
    expect(isPublished(makeIssue({ state: "closed", labels: [{ name: "published" }] }), label)).toBe(false);
  });
});

describe("postUrl / nodeIdFromUrl / postImgDir", () => {
  test("postUrl = <postDir>/<node_id>.html", () => {
    expect(postUrl("I_test001", "post")).toBe("post/I_test001.html");
  });
  test("nodeIdFromUrl 还原", () => {
    expect(nodeIdFromUrl("post/I_test001.html", "post")).toBe("I_test001");
  });
  test("postImgDir = <postDir>/<node_id>", () => {
    expect(postImgDir("I_test001", "post")).toBe("post/I_test001");
  });
  test("多段 postDir url 生成与还原一致", () => {
    const url = postUrl("I_x", "a/b");
    expect(url).toBe("a/b/I_x.html");
    expect(nodeIdFromUrl(url, "a/b")).toBe("I_x");
    expect(postImgDir("I_x", "a/b")).toBe("a/b/I_x");
  });
});

describe("isDirLabel", () => {
  test("半角/全角/大小写/空白", () => {
    expect(isDirLabel("dir:往事", "dir")).toBe(true);
    expect(isDirLabel("dir：往事", "dir")).toBe(true);
    expect(isDirLabel("DIR:x", "dir")).toBe(true);
    expect(isDirLabel("Dir：y", "dir")).toBe(true);
    expect(isDirLabel("  dir: z ", "dir")).toBe(true);
  });
  test("非目录", () => {
    expect(isDirLabel("director:x", "dir")).toBe(false);
    expect(isDirLabel("dir x", "dir")).toBe(false);
    expect(isDirLabel("dirs:x", "dir")).toBe(false);
  });
  test("自定义前缀来自配置", () => {
    expect(isDirLabel("cat:猫", "cat")).toBe(true);
    expect(isDirLabel("dir:x", "cat")).toBe(false);
  });
});

describe("dirValue", () => {
  test("取值与去空", () => {
    expect(dirValue("dir:往事", "dir")).toBe("往事");
    expect(dirValue("dir： 往事 ", "dir")).toBe("往事");
  });
  test("空值/非目录 -> null", () => {
    expect(dirValue("dir:", "dir")).toBeNull();
    expect(dirValue("dir：", "dir")).toBeNull();
    expect(dirValue("foo", "dir")).toBeNull();
  });
});

describe("extractDirs", () => {
  test("多目录去重保序", () => {
    expect(
      extractDirs([{ name: "dir:往事" }, { name: "dir:技术" }, { name: "dir:往事" }], "dir"),
    ).toEqual(["往事", "技术"]);
  });
  test("无目录 -> []", () => {
    expect(extractDirs([{ name: "published" }, { name: "bun" }], "dir")).toEqual([]);
  });
});

describe("extractTags", () => {
  test("去 publishedLabel/pageLabel, 保留自定义标签", () => {
    expect(
      extractTags([{ name: "published" }, { name: "page" }, { name: "bun" }, { name: "css" }], tagOpts),
    ).toEqual(["bun", "css"]);
  });
  test("去内置默认 label (大小写不敏感) 与目录 label", () => {
    expect(
      extractTags(
        [{ name: "bug" }, { name: "Enhancement" }, { name: "dir:往事" }, { name: "架构" }],
        tagOpts,
      ),
    ).toEqual(["架构"]);
  });
  test("配置 excludedLabels 与默认集取并集 (大小写不敏感)", () => {
    expect(
      extractTags(
        [{ name: "草稿" }, { name: "bug" }, { name: "rust" }],
        { ...tagOpts, excludedLabels: ["草稿"] },
      ),
    ).toEqual(["rust"]);
  });
});

describe("isPageIssue", () => {
  test("含/不含 pageLabel", () => {
    expect(isPageIssue(makeIssue({ labels: [{ name: "page" }] }), "page")).toBe(true);
    expect(isPageIssue(makeIssue({ labels: [{ name: "published" }] }), "page")).toBe(false);
  });
});

describe("resolvePageUrl", () => {
  test("合法根级", () => {
    expect(resolvePageUrl("about")).toBe("about.html");
    expect(resolvePageUrl("about.html")).toBe("about.html");
  });
  test("禁子目录 / 保留名 / 非法", () => {
    expect(resolvePageUrl("docs/intro")).toBeNull();
    expect(resolvePageUrl("index")).toBeNull();
    expect(resolvePageUrl("archive")).toBeNull();
    expect(resolvePageUrl("feed.html")).toBeNull();
    expect(resolvePageUrl(" /about ")).toBeNull();
    expect(resolvePageUrl("../x")).toBeNull();
    expect(resolvePageUrl("a\\b")).toBeNull();
    expect(resolvePageUrl(".foo")).toBeNull();
    expect(resolvePageUrl("")).toBeNull();
    expect(resolvePageUrl("   ")).toBeNull();
  });
});

describe("issueToPost", () => {
  const cfg = fixtureConfig();
  const md = fakeMarkdown();
  test("无 meta: date=created_at, 正文经 md.render", () => {
    const post = issueToPost(makeIssue({ body: "正文" }), cfg, md);
    expect(post.url).toBe("post/I_test001.html");
    expect(post.title).toBe("标题");
    expect(post.date).toBe("2026-05-01T00:00:00.000Z");
    expect(post.contentHtml).toBe("<md>正文</md>");
  });
  test("带 meta date: 正文不含 meta 块", () => {
    const post = issueToPost(makeIssue({ body: "<!-- meta\ndate: 2026-06-01\n-->\n正文体" }), cfg, md);
    expect(post.date).toBe("2026-06-01T00:00:00.000Z");
    expect(post.contentHtml).toBe("<md>正文体</md>");
  });
  test("产出 tags 与 dirs", () => {
    const post = issueToPost(
      makeIssue({ labels: [{ name: "published" }, { name: "bug" }, { name: "rust" }, { name: "dir:往事" }] }),
      cfg,
      md,
    );
    expect(post.tags).toEqual(["rust"]);
    expect(post.dirs).toEqual(["往事"]);
  });
});

describe("issueToPage", () => {
  const cfg = fixtureConfig();
  const md = fakeMarkdown();
  test("合法 url -> PageDoc", () => {
    const page = issueToPage(makeIssue({ title: "关于", body: "<!-- meta\nurl: about\n-->\n正文" }), cfg, md);
    expect(page).not.toBeNull();
    expect(page!.url).toBe("about.html");
    expect(page!.title).toBe("关于");
    expect(page!.contentHtml).toBe("<md>正文</md>");
  });
  test("url 非法/缺失 -> null", () => {
    expect(issueToPage(makeIssue({ body: "无 meta" }), cfg, md)).toBeNull();
    expect(issueToPage(makeIssue({ body: "<!-- meta\nurl: index\n-->\nx" }), cfg, md)).toBeNull();
  });
});

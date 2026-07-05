import { test, expect, describe } from "bun:test";
import { reassembleAll } from "../src/domain/reassembleService.ts";
import { renderPageHtml, renderStandalonePageHtml } from "../src/domain/template.ts";
import { extractContentHtml } from "../src/domain/contentMarkers.ts";
import { writeListPages } from "../src/domain/siteService.ts";
import { errorPagesToWrite, renderErrorPage } from "../src/domain/errorService.ts";
import { toSiteConfig } from "../src/domain/config.ts";
import {
  memFileStore,
  fakeThemeProvider,
  fakeThemeManifest,
  fakeChrome,
  fixtureConfig,
} from "./fakes.ts";
import type { Post } from "../src/domain/types.ts";

const provider = fakeThemeProvider();
const manifest = fakeThemeManifest();
const cfg = fixtureConfig();
const site = toSiteConfig(cfg);

const post: Post = {
  nodeId: "I_a",
  url: "post/I_a.html",
  title: "甲",
  date: "2026-01-01",
  contentHtml: "<p>正文 A</p>",
  tags: ["x"],
  dirs: [],
};

// 用给定 chrome 预渲一个完整站点 (文章页 + 列表外壳 + 年份分片/索引, 替代旧 posts.json).
function seedSite(chrome = fakeChrome()) {
  const fs = memFileStore();
  fs.write("post/I_a.html", renderPageHtml(post, site, provider, manifest, chrome, cfg, "../"));
  fs.write("data/years.json", JSON.stringify([{ year: "2026", count: 1 }]));
  fs.write(
    "data/year/2026.json",
    JSON.stringify([{ url: "post/I_a.html", title: "甲", date: "2026-01-01", tags: ["x"], dirs: [] }]),
  );
  writeListPages(fs, provider, manifest, site, chrome, cfg);
  // 错误页同样预渲 (与列表页同阶段), 使"输入不变"时全跳过.
  for (const { file, code } of errorPagesToWrite(cfg))
    fs.write(file, renderErrorPage(code, provider, manifest, chrome, cfg));
  return fs;
}

describe("reassembleAll", () => {
  test("输入不变 -> 全部跳过, 写出 chrome.json", () => {
    const fs = seedSite();
    const r = reassembleAll({ fs, cfg, templates: provider, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    expect(r.rewritten).toBe(0);
    expect(r.warned).toBe(0);
    expect(r.skipped).toBe(9); // 1 文章 + 5 列表页 + 3 错误页
    expect("chrome.json" in fs.dump()).toBe(true);
  });

  test("仅外壳变更(footer) -> 文章/列表 rewritten=0, chrome.json 重写", () => {
    const fs = seedSite();
    const before = extractContentHtml(fs.dump()["post/I_a.html"]!);
    const r = reassembleAll({
      fs,
      cfg,
      templates: provider,
      manifest,
      chrome: fakeChrome({ footerCopyright: "© 新版权" }),
      assetsDir: "assets",
    });
    // 外壳不在文章/列表/错误 HTML, 指纹不变 -> 全跳过.
    expect(r.rewritten).toBe(0);
    expect(r.skipped).toBe(9);
    expect(extractContentHtml(fs.dump()["post/I_a.html"]!)).toBe(before); // 正文不变
    // 外壳更新进 chrome.json.
    expect(JSON.parse(fs.dump()["chrome.json"]!).footer).toContain("© 新版权");
  });

  test("正文模板结构变更 -> 重写文章页", () => {
    const fs = seedSite();
    const provider2 = fakeThemeProvider({
      "partials/main-post.html":
        '<article class="post-article v2"><h1 class="post-title">{{title}}</h1><div class="prose"><!--content:start-->{{content}}<!--content:end--></div></article>{{comments}}',
    });
    const r = reassembleAll({ fs, cfg, templates: provider2, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    expect(r.rewritten).toBe(1); // 仅文章页结构变 (列表 main-list 未变 -> 跳过)
    expect(fs.dump()["post/I_a.html"]).toContain("post-article v2");
    expect(extractContentHtml(fs.dump()["post/I_a.html"]!)).toBe("<p>正文 A</p>");
  });

  test("从分片读派生字段透传到重组文章页 (description/阅读时长/字数)", () => {
    const fs = memFileStore();
    // 旧产物以无派生字段渲染; 分片含派生字段 -> reassemble 应读出透传 (不重算 Markdown).
    fs.write("post/I_a.html", renderPageHtml(post, site, provider, manifest, fakeChrome(), cfg, "../"));
    fs.write("data/years.json", JSON.stringify([{ year: "2026", count: 1 }]));
    fs.write(
      "data/year/2026.json",
      JSON.stringify([
        {
          url: "post/I_a.html",
          title: "甲",
          date: "2026-01-01",
          tags: ["x"],
          dirs: [],
          summary: "分片里的摘要",
          cover: "post/I_a/h.webp",
          readingTime: 7,
          words: 2345,
        },
      ]),
    );
    reassembleAll({ fs, cfg, templates: provider, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    const after = fs.dump()["post/I_a.html"]!;
    expect(after).toContain('content="分片里的摘要"'); // head description 用透传摘要
    expect(after).toContain("约 7 分钟"); // meta 行阅读时长
    expect(after).toContain("2,345 字"); // 字数 (千分位)
  });

  test("缺正文标记 -> 告警跳过, 不破坏原文件", () => {
    const fs = seedSite();
    fs.write("post/I_a.html", "<p>无标记</p>");
    const r = reassembleAll({ fs, cfg, templates: provider, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    expect(r.warned).toBe(1);
    expect(fs.dump()["post/I_a.html"]).toBe("<p>无标记</p>"); // 未被改写
  });

  test("rss.enabled=false -> 删除旧 feed 文件", () => {
    const fs = seedSite();
    fs.write("feed.xml", "<rss/>");
    fs.write("atom.xml", "<feed/>");
    fs.write("feed.json", "{}");
    const cfg2 = fixtureConfig();
    cfg2.rss.enabled = false;
    reassembleAll({ fs, cfg: cfg2, templates: provider, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    const d = fs.dump();
    expect("feed.xml" in d).toBe(false);
    expect("atom.xml" in d).toBe(false);
    expect("feed.json" in d).toBe(false);
  });

  test("切主题清理已知顶层主题资产并保留非 manifest 用户资源", () => {
    const fs = seedSite();
    fs.write("favicon.svg", "OLD");
    fs.write("old-logo.png", "OLD");
    fs.write("old-theme.js", "OLD");
    fs.write("giscus-dark.css", "OLD");
    const manifest2 = fakeThemeManifest({ assets: ["favicon.svg"] });
    reassembleAll({ fs, cfg, templates: provider, manifest: manifest2, chrome: fakeChrome(), assetsDir: "assets" });
    const d = fs.dump();
    expect(d["favicon.svg"]).toBe("COPIED");
    expect(d["old-logo.png"]).toBe("OLD");
    expect(d["old-theme.js"]).toBe("OLD");
    expect("giscus-dark.css" in d).toBe(false);
  });

  test("站点缺文件 -> 告警跳过", () => {
    const fs = seedSite();
    fs.remove("post/I_a.html");
    const r = reassembleAll({ fs, cfg, templates: provider, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    expect(r.warned).toBe(1);
  });

  test("独立页结构变更同样重组", () => {
    const fs = memFileStore();
    fs.write(
      "about.html",
      renderStandalonePageHtml(
        { nodeId: "I_p", url: "about.html", title: "关于", contentHtml: "<p>关于正文</p>" },
        site,
        provider,
        manifest,
        fakeChrome(),
        cfg,
      ),
    );
    fs.write("pages.json", JSON.stringify([{ nodeId: "I_p", url: "about.html", title: "关于" }]));
    const provider2 = fakeThemeProvider({
      "partials/main-page.html":
        '<article class="post-article v2"><h1 class="post-title">{{title}}</h1><div class="prose"><!--content:start-->{{content}}<!--content:end--></div></article>',
    });
    const r = reassembleAll({ fs, cfg, templates: provider2, manifest, chrome: fakeChrome(), assetsDir: "assets" });
    const after = fs.dump()["about.html"]!;
    expect(extractContentHtml(after)).toBe("<p>关于正文</p>");
    expect(after).toContain("post-article v2");
    // about 重写 + 5 列表页 + 3 错误页 (seed 未写, 新建) = 9
    expect(r.rewritten).toBe(9);
  });
});

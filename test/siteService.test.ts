import { test, expect } from "bun:test";
import {
  writePostPage,
  deletePostPage,
  writeSiteJson,
  writeChromeJson,
  cleanSiteRoot,
  isContentImage,
  cleanSiteRootKeepImages,
  pruneOrphanImages,
  cleanThemeAssets,
} from "../src/domain/siteService.ts";
import { fakeThemeManifest, memFileStore } from "./fakes.ts";

test("writePostPage 写 <postDir>/node_id.html", () => {
  const fs = memFileStore();
  writePostPage(fs, "I_a", "post", "<html>x</html>");
  expect(fs.dump()["post/I_a.html"]).toBe("<html>x</html>");
});

test("deletePostPage 删除存在的页", () => {
  const fs = memFileStore({ "post/I_a.html": "x" });
  deletePostPage(fs, "I_a", "post");
  expect(fs.exists("post/I_a.html")).toBe(false);
});

test("deletePostPage 同时删图片文件夹内文件", () => {
  const fs = memFileStore({ "post/I_a.html": "x" });
  fs.writeBytes("post/I_a/aa.png", new Uint8Array([1]));
  fs.writeBytes("post/I_a/bb.jpg", new Uint8Array([2]));
  deletePostPage(fs, "I_a", "post");
  expect(fs.exists("post/I_a.html")).toBe(false);
  expect(Object.keys(fs.dumpBytes()).length).toBe(0);
});

test("deletePostPage 不存在不抛错", () => {
  expect(() => deletePostPage(memFileStore(), "I_none", "post")).not.toThrow();
});

test("writeSiteJson 写 site.json (含 pagination 子集)", () => {
  const fs = memFileStore();
  const site = {
    title: "T",
    pagination: { home: 10, archive: 100, directory: 10, tag: 10 },
  };
  writeSiteJson(fs, site);
  expect(JSON.parse(fs.dump()["site.json"]!)).toEqual(site);
});

test("writeChromeJson 写根级 chrome.json", () => {
  const fs = memFileStore();
  const data = { siteTitle: "T", logo: "<a>L</a>", nav: "<a>n</a>", footer: "© x", rssLinks: "" };
  writeChromeJson(fs, data);
  expect(JSON.parse(fs.dump()["chrome.json"]!)).toEqual(data);
});

test("cleanSiteRoot 清非白名单, 保留 .git/.nojekyll/CNAME", () => {
  const fs = memFileStore({
    ".git/config": "x",
    ".nojekyll": "",
    "CNAME": "blog.example.com",
    "index.html": "old",
    "posts.json": "[]",
    "post/I_a.html": "old",
    "assets/img/x.png": "old",
  });
  cleanSiteRoot(fs);
  const d = fs.dump();
  expect(".git/config" in d).toBe(true);
  expect(".nojekyll" in d).toBe(true);
  expect("CNAME" in d).toBe(true);
  expect("index.html" in d).toBe(false);
  expect("posts.json" in d).toBe(false);
  expect("post/I_a.html" in d).toBe(false);
  expect("assets/img/x.png" in d).toBe(false);
});

test("isContentImage: 子目录图片为真; 顶层文件/非图片扩展名为假", () => {
  expect(isContentImage("post/I_a/x.webp")).toBe(true);
  expect(isContentImage("I_page/y.png")).toBe(true); // 独立页顶层 nodeId 目录下
  expect(isContentImage("favicon.svg")).toBe(false); // 顶层主题资产 (无子目录)
  expect(isContentImage("app.css")).toBe(false);
  expect(isContentImage("chrome.js")).toBe(false);
  expect(isContentImage("post/I_a.html")).toBe(false); // 文章页非图片
  expect(isContentImage("data/tags.json")).toBe(false); // 子目录但非图片扩展名
});

test("cleanSiteRootKeepImages: 保白名单+图片, 删其余, 返回图片集", () => {
  const fs = memFileStore({
    ".git/config": "x",
    ".nojekyll": "",
    CNAME: "blog.example.com",
    "index.html": "old",
    "app.css": "old",
    "chrome.js": "old",
    "comic-ink-icon.js": "old",
    "data/tags.json": "[]",
    "post/I_a.html": "old",
  });
  fs.writeBytes("post/I_a/p1.webp", new Uint8Array([1]));
  fs.writeBytes("I_page/p2.webp", new Uint8Array([2]));
  const images = cleanSiteRootKeepImages(fs);
  const d = fs.dump();
  // 白名单顶层整树保留
  expect(".git/config" in d).toBe(true);
  expect(".nojekyll" in d).toBe(true);
  expect("CNAME" in d).toBe(true);
  // 非图片产物全清 (HTML/css/js/json)
  expect("index.html" in d).toBe(false);
  expect("app.css" in d).toBe(false);
  expect("chrome.js" in d).toBe(false);
  expect("comic-ink-icon.js" in d).toBe(false);
  expect("data/tags.json" in d).toBe(false);
  expect("post/I_a.html" in d).toBe(false);
  // 正文图片保留 (转码复用)
  const b = fs.dumpBytes();
  expect("post/I_a/p1.webp" in b).toBe(true);
  expect("I_page/p2.webp" in b).toBe(true);
  // 返回保留的图片集 (供孤儿回收)
  expect(images.sort()).toEqual(["I_page/p2.webp", "post/I_a/p1.webp"]);
});

test("pruneOrphanImages: 删 existing 中不在 used 的孤儿 (删文章/换图)", () => {
  const fs = memFileStore();
  fs.writeBytes("post/I_a/keep.webp", new Uint8Array([1]));
  fs.writeBytes("post/I_a/orphan.webp", new Uint8Array([2]));
  fs.writeBytes("post/I_old/gone.webp", new Uint8Array([3]));
  const existing = ["post/I_a/keep.webp", "post/I_a/orphan.webp", "post/I_old/gone.webp"];
  const used = new Set(["post/I_a/keep.webp"]);
  pruneOrphanImages(fs, existing, used);
  const b = fs.dumpBytes();
  expect("post/I_a/keep.webp" in b).toBe(true);
  expect("post/I_a/orphan.webp" in b).toBe(false);
  expect("post/I_old/gone.webp" in b).toBe(false);
});

test("pruneOrphanImages: used 覆盖全部 existing 时不删 (无变更复用)", () => {
  const fs = memFileStore();
  fs.writeBytes("post/I_a/a.webp", new Uint8Array([1]));
  const existing = ["post/I_a/a.webp"];
  pruneOrphanImages(fs, existing, new Set(existing));
  expect("post/I_a/a.webp" in fs.dumpBytes()).toBe(true);
});

test("cleanThemeAssets: 删顶层主题脚本/样式/静态资产, 保 HTML/子目录 json/图片/白名单", () => {
  const fs = memFileStore({
    ".nojekyll": "",
    "CNAME": "blog.example.com",
    "app.css": "x",
    "chrome.js": "x",
    "comic-ink-icon.js": "x",
    "giscus-light.css": "x",
    "favicon.svg": "x",
    "logo.png": "x",
    "font.woff2": "x",
    "index.html": "x",
    "data/tags.json": "[]",
  });
  fs.writeBytes("post/I_a/p.webp", new Uint8Array([1]));
  cleanThemeAssets(fs, fakeThemeManifest({ assets: ["giscus-light.css", "favicon.svg"] }));
  const d = fs.dump();
  expect("app.css" in d).toBe(true); // app.css 由后续 CSS 编译覆盖, 不按扩展名误删
  expect("chrome.js" in d).toBe(false);
  expect("comic-ink-icon.js" in d).toBe(false);
  expect("giscus-light.css" in d).toBe(false);
  expect("favicon.svg" in d).toBe(false);
  expect("logo.png" in d).toBe(true);
  expect("font.woff2" in d).toBe(true);
  expect(".nojekyll" in d).toBe(true);
  expect("CNAME" in d).toBe(true);
  expect("index.html" in d).toBe(true); // HTML 保留 (reassemble 要读正文)
  expect("data/tags.json" in d).toBe(true); // 子目录 json 保留 (增量链)
  expect("post/I_a/p.webp" in fs.dumpBytes()).toBe(true); // 图片保留
});

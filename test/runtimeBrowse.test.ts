import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

function loadBrowse(root = "./"): Window {
  const window = new Window({ url: "https://blog.example.com/index.html" });
  window.document.documentElement.setAttribute("data-root", root);
  window.fetch = (async () => ({ ok: true, json: async () => ({}) })) as any;
  const code = readFileSync(join(process.cwd(), "src/runtime/browse.js"), "utf8");
  const run = new Function(
    "window",
    "document",
    "location",
    "history",
    "fetch",
    code + "\nwindow.postCard = postCard;",
  );
  run(window, window.document, window.location, window.history, window.fetch);
  return window;
}

describe("runtime browse postCard", () => {
  test("卡片主链接与标签链接不嵌套", () => {
    const window = loadBrowse("./");
    const li = (window as any).postCard({
      url: "post/I_x.html",
      title: "标题",
      date: "2026-06-01T00:00:00.000Z",
      cover: "post/I_x/hero.webp",
      summary: "摘要",
      readingTime: 3,
      words: 1234,
      tags: ["bun", "前端"],
    });
    window.document.body.appendChild(li);

    expect(window.document.querySelectorAll(".post-card a .tag-link").length).toBe(0);
    const main = window.document.querySelector(".post-card-main") as unknown as HTMLAnchorElement;
    expect(main).toBeTruthy();
    expect(main.getAttribute("href")).toBe("./post/I_x.html");
    expect(main.querySelector(".post-card-title")?.textContent).toBe("标题");
    expect(main.querySelector(".post-card-cover")?.getAttribute("src")).toBe("./post/I_x/hero.webp");

    const tags = window.document.querySelectorAll(".post-meta .tag-link");
    expect(tags.length).toBe(2);
    expect(tags[0]!.getAttribute("href")).toBe("./tag.html?tag=bun");
    expect(tags[1]!.getAttribute("href")).toBe("./tag.html?tag=%E5%89%8D%E7%AB%AF");
  });

  test("最小卡片结构稳定", () => {
    const window = loadBrowse("../");
    const li = (window as any).postCard({
      url: "post/I_min.html",
      title: "最小",
      date: "2026-06-02T00:00:00.000Z",
    });
    window.document.body.appendChild(li);

    expect(window.document.querySelector("li > article.post-card")).toBeTruthy();
    expect(window.document.querySelector(".post-card > .post-card-main")).toBeTruthy();
    expect(window.document.querySelector(".post-card > .post-meta")).toBeTruthy();
    expect(window.document.querySelector(".post-card-cover")).toBeNull();
    expect(window.document.querySelector(".post-card-summary")).toBeNull();
    expect(window.document.querySelector(".tag-link")).toBeNull();
    expect(window.document.querySelector(".post-card-main")?.getAttribute("href")).toBe(
      "../post/I_min.html",
    );
  });
});

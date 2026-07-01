import { test, expect, describe } from "bun:test";
import { decideStrategy, run } from "../src/app/run.ts";
import type { StrategyEnv } from "../src/app/run.ts";
import { extractContentHtml } from "../src/domain/contentMarkers.ts";
import {
  memFileStore,
  fakeGitHubApi,
  fakeMarkdown,
  fakeFeedRenderer,
  fakeThemeProvider,
  fakeThemeManifest,
  fakeChrome,
  fixtureConfig,
  makeIssue,
} from "./fakes.ts";

const env = (over: Partial<StrategyEnv>): StrategyEnv => ({
  hasIssuePayload: false,
  hasManifest: true,
  changedPaths: [],
  forceFull: false,
  ...over,
});

describe("decideStrategy", () => {
  test("forceFull -> full", () => {
    expect(decideStrategy(env({ forceFull: true }))).toBe("full");
  });
  test("无 manifest -> full", () => {
    expect(decideStrategy(env({ hasManifest: false }))).toBe("full");
  });
  test("有 issue 载荷 -> incremental", () => {
    expect(decideStrategy(env({ hasIssuePayload: true }))).toBe("incremental");
  });
  test("changedPaths 含 src/ -> full", () => {
    expect(decideStrategy(env({ changedPaths: ["src/domain/x.ts"] }))).toBe("full");
  });
  test("changedPaths 含 scripts/ -> full", () => {
    expect(decideStrategy(env({ changedPaths: ["scripts/build.ts"] }))).toBe("full");
  });
  test("仅 themes/config -> reassemble", () => {
    expect(
      decideStrategy(env({ changedPaths: ["themes/default/styles/skins/indigo.css", "config/appearance.json"] })),
    ).toBe("reassemble");
  });
  test("src 与 themes 混合 -> full (src 优先)", () => {
    expect(decideStrategy(env({ changedPaths: ["themes/default/x.css", "src/a.ts"] }))).toBe("full");
  });
  test("无法判定且有 manifest -> 兜底 reassemble", () => {
    expect(decideStrategy(env({ changedPaths: [] }))).toBe("reassemble");
  });
  test("仅 content 下 .md 改动 -> incrementalLocal", () => {
    expect(
      decideStrategy(env({ changedPaths: ["content/posts/hello.md", "content/pages/about.md"] })),
    ).toBe("incrementalLocal");
  });
  test("content md + themes 混改 -> full (保险)", () => {
    expect(
      decideStrategy(env({ changedPaths: ["content/posts/a.md", "themes/default/x.css"] })),
    ).toBe("full");
  });
  test("content md + src 混改 -> full (src 优先)", () => {
    expect(
      decideStrategy(env({ changedPaths: ["content/posts/a.md", "src/a.ts"] })),
    ).toBe("full");
  });
  test("有 issue 载荷优先 incremental (即便夹带 content md)", () => {
    expect(
      decideStrategy(env({ hasIssuePayload: true, changedPaths: ["content/posts/a.md"] })),
    ).toBe("incremental");
  });
  test("content 下非 md (仅图片) + 无其它 -> 兜底 reassemble", () => {
    expect(decideStrategy(env({ changedPaths: ["content/posts/img/a.png"] }))).toBe("reassemble");
  });
  test("自定义 contentDir 识别本地 md", () => {
    expect(
      decideStrategy(env({ contentDir: "site-content", changedPaths: ["site-content/posts/a.md"] })),
    ).toBe("incrementalLocal");
  });
});

describe("run 端到端: full -> reassemble", () => {
  const manifest = fakeThemeManifest();
  const issues = [
    makeIssue({ node_id: "I_a", number: 1, title: "甲", body: "<!-- meta\ndate: 2026-01-01\n-->\n正文甲" }),
  ];
  const common = (fs: ReturnType<typeof memFileStore>, chrome = fakeChrome()) => ({
    fs,
    md: fakeMarkdown(),
    cfg: fixtureConfig(),
    templates: fakeThemeProvider(),
    manifest,
    chrome,
    assetsDir: "assets",
    feedRenderer: fakeFeedRenderer(),
  });

  test("先 full 建站, 再 reassemble 套新外壳: 正文不变 + chrome.json 外壳更新", async () => {
    const fs = memFileStore();
    // 1) full (无 manifest -> full), 用 chrome A
    const s1 = await run({
      ...common(fs, fakeChrome({ footerCopyright: "© A" })),
      env: env({ hasManifest: false }),
      api: fakeGitHubApi(issues),
      repo: "owner/repo",
    });
    expect(s1).toBe("full");
    const contentAfterFull = extractContentHtml(fs.dump()["post/I_a.html"]!);
    // 外壳已移出文章 HTML, 落 chrome.json
    expect(JSON.parse(fs.dump()["chrome.json"]!).footer).toContain("© A");

    // 2) reassemble (仅 themes 改动), 用 chrome B (无 api/events)
    const s2 = await run({
      ...common(fs, fakeChrome({ footerCopyright: "© B" })),
      env: env({ changedPaths: ["themes/default/styles/skins/indigo.css"] }),
    });
    expect(s2).toBe("reassemble");
    const after = fs.dump()["post/I_a.html"]!;
    expect(extractContentHtml(after)).toBe(contentAfterFull); // 正文不变 (不渲 Markdown)
    expect(JSON.parse(fs.dump()["chrome.json"]!).footer).toContain("© B"); // 外壳更新
  });

  test("full 策略缺 api 抛错", async () => {
    const fs = memFileStore();
    await expect(
      run({ ...common(fs), env: env({ forceFull: true }) }),
    ).rejects.toThrow();
  });
});

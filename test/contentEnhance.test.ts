import { test, expect, describe } from "bun:test";
import {
  injectHeadingAnchors,
  deriveCardMeta,
  type CardMetaOpts,
} from "../src/domain/contentEnhance.ts";

describe("injectHeadingAnchors", () => {
  test("各级标题注入 id 与 # 锚链", () => {
    const { html } = injectHeadingAnchors("<h1>Hello World</h1><h3>Sub Title</h3>");
    expect(html).toContain('<h1 id="hello-world">');
    expect(html).toContain('<a class="heading-anchor" href="#hello-world" aria-hidden="true"></a>');
    expect(html).toContain('<h3 id="sub-title">');
  });

  test("CJK 标题保留中文 slug", () => {
    const { html } = injectHeadingAnchors("<h2>标题二 H2</h2>");
    expect(html).toContain('id="标题二-h2"');
  });

  test("重复标题去重 (slugger 负责)", () => {
    const { html } = injectHeadingAnchors("<h2>Intro</h2><h2>Intro</h2>");
    expect(html).toContain('<h2 id="intro">');
    expect(html).toContain('<h2 id="intro-1">');
  });

  test("含 HTML 实体的标题用纯文本生成 slug", () => {
    // &amp; 解码为 & 后被 slugger 去除, 两侧空格各转连字符 -> a--b
    // (若未解码会得到含 "amp" 的 slug, 以此验证实体解码生效).
    const { html } = injectHeadingAnchors("<h2>A &amp; B</h2>");
    expect(html).toContain('id="a--b"');
  });

  test("已有 id 的标题尊重原 id (不覆盖)", () => {
    const { html } = injectHeadingAnchors('<h1 id="custom">Title</h1>');
    expect(html).toContain('<h1 id="custom">');
    expect(html).not.toContain('id="title"');
    expect(html).toContain('href="#custom"');
  });

  test("无标题原样返回", () => {
    expect(injectHeadingAnchors("<p>正文段落</p>").html).toBe("<p>正文段落</p>");
  });

  test("空标题 (无文本) 不注入", () => {
    const src = '<h1><img src="x.png"></h1>';
    expect(injectHeadingAnchors(src).html).toBe(src);
  });
});

describe("deriveCardMeta", () => {
  const opts: CardMetaOpts = {
    summary: { enabled: true, length: 10 },
    cover: { enabled: true },
    readingTime: { enabled: true, cpm: 400, wpm: 250 },
  };

  test("摘要按 length 截断且去标签", () => {
    const r = deriveCardMeta("<p>Hello <b>World</b> long text here</p>", opts);
    expect(r.summary).toBe("Hello Worl…");
  });

  test("summary 关闭 -> 空摘要", () => {
    const r = deriveCardMeta("<p>Hello World</p>", {
      ...opts,
      summary: { enabled: false, length: 10 },
    });
    expect(r.summary).toBe("");
  });

  test("首图取首个 img 且加前缀转根相对", () => {
    const r = deriveCardMeta('<p>x</p><img src="I_x/a.webp"><img src="I_x/b.webp">', opts, "post/");
    expect(r.cover).toBe("post/I_x/a.webp");
  });

  test("首图为绝对 URL 时原样保留 (不加前缀)", () => {
    const r = deriveCardMeta('<img src="https://cdn/x.png">', opts, "post/");
    expect(r.cover).toBe("https://cdn/x.png");
  });

  test("无图 -> cover 空", () => {
    const r = deriveCardMeta("<p>无图正文</p>", opts, "post/");
    expect(r.cover).toBe("");
  });

  test("CJK + 拉丁混合字数", () => {
    const r = deriveCardMeta("<p>你好世界 hello world</p>", opts);
    expect(r.words).toBe(6); // 4 CJK + 2 拉丁词
  });

  test("阅读时长 cpm/wpm 向上取整, 有内容至少 1 分钟", () => {
    expect(deriveCardMeta("<p>你好</p>", opts).readingTime).toBe(1);
    // 401 CJK 字 / 400 cpm = 1.0025 -> ceil 2
    const longCjk = "字".repeat(401);
    expect(deriveCardMeta(`<p>${longCjk}</p>`, opts).readingTime).toBe(2);
  });

  test("空正文边界: 摘要空/cover 空/时长 0/字数 0", () => {
    const r = deriveCardMeta("", opts);
    expect(r).toEqual({ summary: "", cover: "", readingTime: 0, words: 0 });
  });
});

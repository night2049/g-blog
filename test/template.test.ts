import { test, expect, describe } from "bun:test";
import {
  applyTemplate,
  assemblePage,
  renderPageHtml,
  renderStandalonePageHtml,
  renderListPage,
  renderTags,
  escapeHtml,
  escapeHtmlAttr,
  jsStringLiteral,
  renderComments,
  buildCanonical,
  buildArticleJsonLd,
  buildPageJsonLd,
} from "../src/domain/template.ts";
import { Window } from "happy-dom";
import { extractContentHtml } from "../src/domain/contentMarkers.ts";
import { fakeThemeProvider, fakeThemeManifest, fakeChrome, fixtureConfig } from "./fakes.ts";
import type { Config, PageDoc, Post, SiteConfig } from "../src/domain/types.ts";

const site: SiteConfig = {
  title: "站点",
  pagination: { home: 10, archive: 100, directory: 10, tag: 10 },
};
// 渲染测试用 Config (含 site.url/description/content 默认); 评论默认关闭, 需要时局部覆盖.
const cfg: Config = fixtureConfig();

describe("applyTemplate", () => {
  test("替换占位", () => {
    expect(applyTemplate("{{a}}-{{b}}", { a: "1", b: "2" })).toBe("1-2");
  });
  test("缺失 key 替换为空串", () => {
    expect(applyTemplate("x{{missing}}y", {})).toBe("xy");
  });
  test("不误伤 {{> partial}} (含 > 不匹配)", () => {
    expect(applyTemplate("{{> head}}{{a}}", { a: "z" })).toBe("{{> head}}z");
  });
});

describe("escapeHtml", () => {
  test("转义特殊字符", () => {
    expect(escapeHtml('<a>&"')).toBe("&lt;a&gt;&amp;&quot;");
  });
  test("属性转义额外处理单引号", () => {
    expect(escapeHtmlAttr(`a"'<&>`)).toBe("a&quot;&#39;&lt;&amp;&gt;");
  });
  test("JS 字符串字面量使用 JSON.stringify 且转义 <", () => {
    expect(jsStringLiteral(`x</script>`)).toBe(`"x\\u003c/script>"`);
  });
});

describe("assemblePage", () => {
  const provider = fakeThemeProvider();
  const manifest = fakeThemeManifest();
  const baseVars = { ...fakeChrome(), pageTitle: "T", title: "标题", content: "<p>正文</p>" };

  test("header partial 改为挂载点 (#site-logo/#site-nav), 不内联 logo/nav 文本", () => {
    const html = assemblePage(provider, manifest, "post", baseVars);
    expect(html).toContain('id="site-logo"');
    expect(html).toContain('id="site-nav"');
    expect(html).not.toContain("site-logo-link");
    expect(html).not.toContain('<a href="./index.html">首页</a>');
  });
  test("footer partial 改为单挂载点 (#site-footer, 无 #rss-links)", () => {
    const html = assemblePage(provider, manifest, "post", baseVars);
    expect(html).toContain('id="site-footer"');
    expect(html).not.toContain('id="rss-links"');
  });
  test("baseof 注入 <html lang> (取 chrome.lang)", () => {
    const html = assemblePage(provider, manifest, "post", baseVars);
    expect(html).toContain('<html lang="zh-CN"');
  });
  test("baseof 注入 lang 时走属性转义", () => {
    const html = assemblePage(provider, manifest, "post", {
      ...baseVars,
      lang: 'zh-CN" data-x="1',
    });
    expect(html).toContain('lang="zh-CN&quot; data-x=&quot;1"');
    expect(html).not.toContain('data-x="1"');
  });
  test("home 选 main-list 并注入 browse.js+app.js", () => {
    const html = assemblePage(provider, manifest, "home", baseVars);
    expect(html).toContain('id="posts"');
    expect(html).toContain('<script src="./browse.js" defer></script>');
    expect(html).toContain('<script src="./app.js" defer></script>');
  });
  test("archive 注入 browse.js+archive.js", () => {
    const html = assemblePage(provider, manifest, "archive", baseVars);
    expect(html).toContain('<script src="./archive.js" defer></script>');
    expect(html).not.toContain("./app.js");
  });
  test("post 注入部件占位 (reading-progress/back-to-top/back-to-home) + widgets.js; post-toc 由 main-post 内置", () => {
    const html = assemblePage(provider, manifest, "post", baseVars);
    expect(html).toContain("<post-toc></post-toc>"); // 来自 main-post partial, 无 data-depth
    expect(html).toContain("<reading-progress></reading-progress>");
    expect(html).toContain("<back-to-top></back-to-top>");
    expect(html).toContain("<back-to-home></back-to-home>");
    expect(html).toContain('<script src="./widgets.js" defer></script>');
  });
  test("home 仅注入 back-to-top 占位", () => {
    const html = assemblePage(provider, manifest, "home", baseVars);
    expect(html).toContain("<back-to-top></back-to-top>");
    expect(html).not.toContain("<post-toc");
  });
  test("无 widgets 声明的页类型不注入 widgets.js", () => {
    const html = assemblePage(provider, manifest, "archive", baseVars);
    expect(html).not.toContain("widgets.js");
  });
  test("正文标记由 main-post partial 内置, content 不转义", () => {
    const html = assemblePage(provider, manifest, "post", baseVars);
    expect(extractContentHtml(html)).toBe("<p>正文</p>");
  });
});

describe("renderTags", () => {
  test("可点击 chip: .tag .tag-link, # 前缀, 文本转义, rootPrefix 前缀", () => {
    const h = renderTags(["bun", "a<b"], "./");
    expect(h).toBe(
      '<a class="tag tag-link" href="./tag.html?tag=bun">#bun</a>' +
        '<a class="tag tag-link" href="./tag.html?tag=a%3Cb">#a&lt;b</a>',
    );
  });
  test("子目录 rootPrefix 指回根级 tag.html", () => {
    expect(renderTags(["bun"], "../")).toBe(
      '<a class="tag tag-link" href="../tag.html?tag=bun">#bun</a>',
    );
  });
  test("空数组返回空串", () => {
    expect(renderTags([], "./")).toBe("");
  });
});

describe("renderPageHtml", () => {
  const post: Post = {
    nodeId: "I_x",
    url: "I_x.html",
    title: "标题<>",
    date: "2026-06-01T00:00:00.000Z",
    contentHtml: "<p>正文</p>",
    tags: ["css", "bun"],
    dirs: ["往事"],
  };
  test("组装 post: 转义标题, 正文原样(带标记), 日期截断, 标签链接, 含 giscus", () => {
    const cfgC: Config = {
      ...cfg,
      comments: { enabled: true, repo: "o/r", repoId: "R", category: "A", categoryId: "C", mapping: "pathname" },
    };
    const html = renderPageHtml(
      post,
      site,
      fakeThemeProvider(),
      fakeThemeManifest(),
      fakeChrome(),
      cfgC,
      "../",
    );
    expect(html).toContain("<title>标题&lt;&gt; - 站点</title>");
    expect(html).toContain('<h1 class="post-title">标题&lt;&gt;</h1>');
    expect(extractContentHtml(html)).toBe("<p>正文</p>");
    expect(html).toContain("2026-06-01");
    expect(html).toContain('<a class="tag tag-link" href="../tag.html?tag=css">#css</a>');
    expect(html).toContain('id="giscus-mount"');
    expect(html).not.toContain("giscus.app/client.js");
  });
  test("rootPrefix 注入 data-root 与共享资源引用", () => {
    const html = renderPageHtml(
      post,
      site,
      fakeThemeProvider(),
      fakeThemeManifest(),
      fakeChrome(),
      cfg,
      "../",
    );
    expect(html).toContain('data-root="../"');
    expect(html).toContain('href="../app.css"');
  });
  test("head 注入 description(摘要)/OG/阅读时长; 含 .katex 正文注入 KaTeX CSS", () => {
    const postWithMeta: Post = {
      ...post,
      summary: "这是文章摘要",
      cover: "post/I_x/hero.webp",
      readingTime: 5,
      words: 1234,
      contentHtml: '<p>正文</p><span class="katex">x</span>',
    };
    const html = renderPageHtml(postWithMeta, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg, "../");
    expect(html).toContain('<meta name="description" content="这是文章摘要" />');
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain(
      'property="og:image" content="https://blog.example.com/post/I_x/hero.webp"',
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain("约 5 分钟");
    expect(html).toContain("1,234 字");
    expect(html).toContain("katex.min.css");
  });
  test("无首图 -> 无 og:image 且 twitter:card=summary; 无 .katex -> 不注入 KaTeX CSS", () => {
    const html = renderPageHtml(post, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg, "../");
    expect(html).not.toContain("og:image");
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).not.toContain("katex.min.css");
  });
});

describe("renderStandalonePageHtml", () => {
  const page: PageDoc = {
    nodeId: "I_p",
    url: "about.html",
    title: "关于<>",
    contentHtml: "<p>关于正文</p>",
  };
  test("组装 page: 转义标题, 正文带标记, 无 tags/comments", () => {
    const html = renderStandalonePageHtml(page, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg);
    expect(html).toContain("<title>关于&lt;&gt; - 站点</title>");
    expect(extractContentHtml(html)).toBe("<p>关于正文</p>");
    expect(html).not.toContain("giscus");
    expect(html).not.toContain("tag-link");
  });
});

describe("renderListPage", () => {
  test("home 列表外壳: 含挂载点 + 脚本, 无正文标记", () => {
    const html = renderListPage(fakeThemeProvider(), fakeThemeManifest(), "home", site, fakeChrome(), cfg);
    expect(html).toContain('id="posts"');
    expect(html).toContain('<script src="./app.js" defer></script>');
    expect(extractContentHtml(html)).toBeNull();
  });
  test("home/archive 注入列表数据 kickoff (site + years)", () => {
    for (const pt of ["home", "archive"]) {
      const html = renderListPage(fakeThemeProvider(), fakeThemeManifest(), pt, site, fakeChrome(), cfg);
      expect(html).toContain("window.__data=");
      expect(html).toContain('fetch("./site.json")');
      expect(html).toContain('fetch("./data/years.json")');
    }
  });
  test("tag/dir 仅注入 site (不取 years)", () => {
    for (const pt of ["tag", "dir"]) {
      const html = renderListPage(fakeThemeProvider(), fakeThemeManifest(), pt, site, fakeChrome(), cfg);
      expect(html).toContain('fetch("./site.json")');
      expect(html).not.toContain("data/years.json");
    }
  });
});

describe("headExtra 作用域", () => {
  test("post/page 不含列表数据 kickoff", () => {
    const post: Post = {
      nodeId: "I_x",
      url: "I_x.html",
      title: "T",
      date: "2026-06-01T00:00:00.000Z",
      contentHtml: "<p>x</p>",
      tags: [],
      dirs: [],
    };
    const postHtml = renderPageHtml(post, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg, "../");
    expect(postHtml).not.toContain("window.__data");
    const pageHtml = renderStandalonePageHtml(
      { nodeId: "I_p", url: "about.html", title: "关于", contentHtml: "<p>x</p>" },
      site,
      fakeThemeProvider(),
      fakeThemeManifest(),
      fakeChrome(),
      cfg,
    );
    expect(pageHtml).not.toContain("window.__data");
  });
});

describe("renderComments", () => {
  const base = {
    enabled: true,
    repo: "o/r",
    repoId: "R_x",
    category: "Announcements",
    categoryId: "DIC_x",
    mapping: "pathname",
  };
  test("enabled 输出 #giscus-mount + data-*, 不含 client.js 脚本", () => {
    const h = renderComments(base, "https://blog.example.com/giscus-light.css");
    expect(h).toContain('id="giscus-mount"');
    expect(h).not.toContain("giscus.app/client.js");
    expect(h).toContain('data-repo="o/r"');
    expect(h).toContain('data-category-id="DIC_x"');
    expect(h).toContain('data-theme="https://blog.example.com/giscus-light.css"');
  });
  test("disabled 返回空串", () => {
    expect(renderComments({ ...base, enabled: false })).toBe("");
  });
  test("data-* 属性统一属性转义, DOM 解析后还原原始值", () => {
    const h = renderComments(
      {
        ...base,
        repoId: 'R"&<x>',
        category: `A'&<B>`,
        categoryId: 'C"x',
      },
      'https://blog.example.com/giscus-light.css?x="&y=<',
    );
    expect(h).not.toContain('data-evil="1"');
    expect(h).toContain("&quot;");
    expect(h).toContain("&#39;");
    const window = new Window();
    window.document.body.innerHTML = h;
    const el = window.document.getElementById("giscus-mount")!;
    expect(el.getAttribute("data-repo-id")).toBe('R"&<x>');
    expect(el.getAttribute("data-category")).toBe(`A'&<B>`);
    expect(el.getAttribute("data-theme")).toBe('https://blog.example.com/giscus-light.css?x="&y=<');
  });
  test("内联 JS 字符串占位不输出裸 </script>", () => {
    const provider = fakeThemeProvider({
      "partials/head.html":
        "<title>{{pageTitle}}</title><script>var dark={{giscusThemeDarkJs}},light={{giscusThemeLightJs}};</script>",
    });
    const html = assemblePage(provider, fakeThemeManifest({ scripts: {}, widgets: {} }), "post", {
      ...fakeChrome({
        giscusThemeDark: `x</script><script>alert(1)</script>`,
        giscusThemeLight: "light",
      }),
      pageTitle: "T",
      title: "T",
      content: "<p>x</p>",
    });
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("x</script>");
    expect(html).not.toContain("<script>alert(1)");
  });
});

// 抽出 <script type="application/ld+json"> 内的 JSON 文本并解析 (非贪婪到首个 </script>).
function parseJsonLd(html: string): any {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]!) : null;
}

describe("buildCanonical", () => {
  test("启用 + site.url: 相对 url 绝对化", () => {
    expect(buildCanonical(cfg, "post/I_x.html")).toBe(
      '<link rel="canonical" href="https://blog.example.com/post/I_x.html" />',
    );
  });
  test("url 已绝对则原样", () => {
    expect(buildCanonical(cfg, "https://other.com/a.html")).toBe(
      '<link rel="canonical" href="https://other.com/a.html" />',
    );
  });
  test("site.url 为空 -> 不输出 (优雅降级)", () => {
    const c: Config = { ...cfg, site: { ...cfg.site, url: "" } };
    expect(buildCanonical(c, "post/I_x.html")).toBe("");
  });
  test("canonical.enabled=false -> 空串", () => {
    const c: Config = { ...cfg, content: { ...cfg.content, canonical: { enabled: false } } };
    expect(buildCanonical(c, "post/I_x.html")).toBe("");
  });
});

describe("buildArticleJsonLd (BlogPosting)", () => {
  const post: Post = {
    nodeId: "I_x",
    url: "post/I_x.html",
    title: "标题",
    date: "2026-06-01T00:00:00.000Z",
    contentHtml: "<p>x</p>",
    tags: [],
    dirs: [],
    summary: "摘要",
    cover: "post/I_x/hero.webp",
    words: 1234,
    readingTime: 5,
  };
  test("核心字段 + 派生字段齐备", () => {
    const obj = parseJsonLd(buildArticleJsonLd(cfg, post));
    expect(obj["@context"]).toBe("https://schema.org");
    expect(obj["@type"]).toBe("BlogPosting");
    expect(obj.headline).toBe("标题");
    expect(obj.datePublished).toBe("2026-06-01T00:00:00.000Z");
    expect(obj.description).toBe("摘要");
    expect(obj.image).toBe("https://blog.example.com/post/I_x/hero.webp");
    expect(obj.wordCount).toBe(1234);
    expect(obj.url).toBe("https://blog.example.com/post/I_x.html");
    expect(obj.mainEntityOfPage).toEqual({
      "@type": "WebPage",
      "@id": "https://blog.example.com/post/I_x.html",
    });
    expect(obj.author).toEqual({ "@type": "Person", name: "tester" });
    expect(obj.publisher).toEqual({ "@type": "Organization", name: "测试站点" });
    expect(obj.inLanguage).toBe("zh-CN");
  });
  test("仅 datePublished, 无 dateModified", () => {
    const obj = parseJsonLd(buildArticleJsonLd(cfg, post));
    expect(obj.dateModified).toBeUndefined();
  });
  test("无首图/字数 -> 省略 image/wordCount; description 回退站点描述", () => {
    const bare: Post = { ...post, summary: undefined, cover: undefined, words: undefined };
    const obj = parseJsonLd(buildArticleJsonLd(cfg, bare));
    expect(obj.image).toBeUndefined();
    expect(obj.wordCount).toBeUndefined();
    expect(obj.description).toBe("desc");
  });
  test("site.url 为空 -> 省略 url/mainEntityOfPage/image, 仍出其余", () => {
    const c: Config = { ...cfg, site: { ...cfg.site, url: "" } };
    const obj = parseJsonLd(buildArticleJsonLd(c, post));
    expect(obj.url).toBeUndefined();
    expect(obj.mainEntityOfPage).toBeUndefined();
    expect(obj.image).toBeUndefined();
    expect(obj.headline).toBe("标题");
    expect(obj.datePublished).toBe("2026-06-01T00:00:00.000Z");
  });
  test("author 为空 -> 省略 author", () => {
    const c: Config = { ...cfg, site: { ...cfg.site, author: "" } };
    expect(parseJsonLd(buildArticleJsonLd(c, post)).author).toBeUndefined();
  });
  test("publisher.logo 仅 appearance.logo 为 image 时附带", () => {
    const c: Config = {
      ...cfg,
      appearance: { ...cfg.appearance, logo: { type: "image", value: "logo.png" } },
    };
    const obj = parseJsonLd(buildArticleJsonLd(c, post));
    expect(obj.publisher.logo).toEqual({
      "@type": "ImageObject",
      url: "https://blog.example.com/logo.png",
    });
  });
  test("jsonLd.enabled=false -> 空串", () => {
    const c: Config = { ...cfg, content: { ...cfg.content, jsonLd: { enabled: false } } };
    expect(buildArticleJsonLd(c, post)).toBe("");
  });
  test("转义: 标题含 </script> -> \\u003c, 无裸 </script>, JSON 可解析", () => {
    const evil: Post = { ...post, title: "X</script><script>alert(1)</script>" };
    const html = buildArticleJsonLd(cfg, evil);
    expect(html).toContain("\\u003c");
    expect(html.match(/<\/script>/g)!.length).toBe(1); // 仅脚本自身结尾标签
    expect(parseJsonLd(html).headline).toBe("X</script><script>alert(1)</script>");
  });
});

describe("buildPageJsonLd (WebPage)", () => {
  const page: PageDoc = { nodeId: "I_p", url: "about.html", title: "关于", contentHtml: "<p>x</p>" };
  test("含 @type=WebPage/name/url/inLanguage/isPartOf", () => {
    const obj = parseJsonLd(buildPageJsonLd(cfg, page));
    expect(obj["@type"]).toBe("WebPage");
    expect(obj.name).toBe("关于");
    expect(obj.url).toBe("https://blog.example.com/about.html");
    expect(obj.description).toBe("desc");
    expect(obj.inLanguage).toBe("zh-CN");
    expect(obj.isPartOf).toEqual({
      "@type": "WebSite",
      name: "测试站点",
      url: "https://blog.example.com",
    });
  });
  test("site.url 为空 -> 省略 url/isPartOf", () => {
    const c: Config = { ...cfg, site: { ...cfg.site, url: "" } };
    const obj = parseJsonLd(buildPageJsonLd(c, page));
    expect(obj.url).toBeUndefined();
    expect(obj.isPartOf).toBeUndefined();
    expect(obj.name).toBe("关于");
  });
  test("jsonLd.enabled=false -> 空串", () => {
    const c: Config = { ...cfg, content: { ...cfg.content, jsonLd: { enabled: false } } };
    expect(buildPageJsonLd(c, page)).toBe("");
  });
});

describe("canonical/JSON-LD 接入 (集成)", () => {
  const post: Post = {
    nodeId: "I_x",
    url: "post/I_x.html",
    title: "标题",
    date: "2026-06-01T00:00:00.000Z",
    contentHtml: "<p>正文</p>",
    tags: [],
    dirs: [],
    summary: "摘要",
    cover: "post/I_x/hero.webp",
    words: 100,
  };
  const page: PageDoc = { nodeId: "I_p", url: "about.html", title: "关于", contentHtml: "<p>x</p>" };
  test("文章页 head 含 canonical + BlogPosting JSON-LD", () => {
    const html = renderPageHtml(post, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg, "../");
    expect(html).toContain('<link rel="canonical" href="https://blog.example.com/post/I_x.html" />');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"BlogPosting"');
  });
  test("单页 head 含 canonical + WebPage JSON-LD", () => {
    const html = renderStandalonePageHtml(page, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg);
    expect(html).toContain('<link rel="canonical" href="https://blog.example.com/about.html" />');
    expect(html).toContain('"@type":"WebPage"');
  });
  test("列表页不含 canonical/JSON-LD (回归守卫)", () => {
    for (const pt of ["home", "archive", "tag", "dir"]) {
      const html = renderListPage(fakeThemeProvider(), fakeThemeManifest(), pt, site, fakeChrome(), cfg);
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain("application/ld+json");
    }
  });
});

describe("contentFlags 注入 (window.__content)", () => {
  test("文章页含 toc 折叠阈值与既有开关", () => {
    const post: Post = {
      nodeId: "I_x",
      url: "post/I_x.html",
      title: "T",
      date: "2026-06-01T00:00:00.000Z",
      contentHtml: "<p>x</p>",
      tags: [],
      dirs: [],
    };
    const html = renderPageHtml(post, site, fakeThemeProvider(), fakeThemeManifest(), fakeChrome(), cfg, "../");
    expect(html).toContain("window.__content=");
    expect(html).toContain('"tocMinHeadings":2');
    expect(html).toContain('"tocCollapseBelow":5');
  });
});

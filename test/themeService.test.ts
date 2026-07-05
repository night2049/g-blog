import { test, expect, describe } from "bun:test";
import {
  resolveThemePaths,
  loadThemeManifest,
  buildCssEntry,
  deriveChromeVars,
  toChromeData,
} from "../src/domain/themeService.ts";
import { memFileStore, fixtureConfig } from "./fakes.ts";
import type { Config, ThemeManifest } from "../src/domain/types.ts";

function themeFiles(over: Record<string, string> = {}): Record<string, string> {
  return {
    "themes/default/theme.json": JSON.stringify({
      defaultSkin: "indigo",
      mains: { post: "main-post.html", home: "main-list.html" },
      scripts: { home: ["browse.js", "app.js"] },
      nav: [
        { label: "首页", page: "home" },
        { label: "归档", page: "archive" },
      ],
      widgets: { post: ["post-toc"], home: ["back-to-top"] },
    }),
    "themes/default/styles/contract.css": ":root{--gb-x:1}/*CONTRACT*/",
    "themes/default/styles/fonts.css": "@font-face{font-family:X}/*FONTS*/",
    "themes/default/styles/layout.css": ".page{color:red}/*LAYOUT*/",
    "themes/default/styles/skins/indigo.css": ":root{--gb-primary:#4f46e5}/*INDIGO*/",
    "themes/default/styles/skins/emerald.css": ":root{--gb-primary:#059669}/*EMERALD*/",
    ...over,
  };
}

describe("loadThemeManifest", () => {
  test("正常解析", () => {
    const fs = memFileStore(themeFiles());
    const m = loadThemeManifest(fs, "themes/default");
    expect(m.defaultSkin).toBe("indigo");
    expect(m.nav[0]).toEqual({ label: "首页", page: "home" });
  });
  test("缺文件抛错", () => {
    expect(() => loadThemeManifest(memFileStore(), "themes/none")).toThrow();
  });
  test("缺关键字段抛错", () => {
    const fs = memFileStore({
      "themes/default/theme.json": JSON.stringify({ mains: {}, scripts: {}, nav: [], widgets: {} }),
    });
    expect(() => loadThemeManifest(fs, "themes/default")).toThrow();
  });
  test("manifest 路径字段拒绝穿越/绝对路径/反斜杠", () => {
    expect(() =>
      loadThemeManifest(
        memFileStore(themeFiles({ "themes/default/theme.json": JSON.stringify({
          defaultSkin: "../x",
          mains: {},
          scripts: {},
          nav: [],
          widgets: {},
        }) })),
        "themes/default",
      ),
    ).toThrow();
    expect(() =>
      loadThemeManifest(
        memFileStore(themeFiles({ "themes/default/theme.json": JSON.stringify({
          defaultSkin: "indigo",
          mains: { post: "../main-post.html" },
          scripts: {},
          nav: [],
          widgets: {},
        }) })),
        "themes/default",
      ),
    ).toThrow();
    expect(() =>
      loadThemeManifest(
        memFileStore(themeFiles({ "themes/default/theme.json": JSON.stringify({
          defaultSkin: "indigo",
          mains: {},
          scripts: { home: ["C:/evil.js"] },
          nav: [],
          widgets: {},
        }) })),
        "themes/default",
      ),
    ).toThrow();
    expect(() =>
      loadThemeManifest(
        memFileStore(themeFiles({ "themes/default/theme.json": JSON.stringify({
          defaultSkin: "indigo",
          mains: {},
          scripts: {},
          nav: [],
          widgets: {},
          assets: ["a\\b.css"],
        }) })),
        "themes/default",
      ),
    ).toThrow();
  });
});

describe("resolveThemePaths", () => {
  test("路径正确", () => {
    const fs = memFileStore(themeFiles());
    const p = resolveThemePaths(fixtureConfig(), fs);
    expect(p.themeDir).toBe("themes/default");
    expect(p.templatesDir).toBe("themes/default/templates");
    expect(p.assetsDir).toBe("themes/default/assets");
    expect(p.contractPath).toBe("themes/default/styles/contract.css");
    expect(p.fontsPath).toBe("themes/default/styles/fonts.css");
    expect(p.layoutCssPath).toBe("themes/default/styles/layout.css");
    expect(p.skinPath).toBe("themes/default/styles/skins/indigo.css");
  });
  test("skin 缺省取 defaultSkin", () => {
    const fs = memFileStore(themeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "default", skin: "" };
    expect(resolveThemePaths(cfg, fs).skinPath).toBe(
      "themes/default/styles/skins/indigo.css",
    );
  });
  test("显式 skin 生效", () => {
    const fs = memFileStore(themeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "default", skin: "emerald" };
    expect(resolveThemePaths(cfg, fs).skinPath).toBe(
      "themes/default/styles/skins/emerald.css",
    );
  });
  test("主题缺失抛错", () => {
    const fs = memFileStore(themeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "nope", skin: "indigo" };
    expect(() => resolveThemePaths(cfg, fs)).toThrow();
  });
  test("皮肤文件缺失抛错", () => {
    const fs = memFileStore(themeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "default", skin: "ghost" };
    expect(() => resolveThemePaths(cfg, fs)).toThrow();
  });
  test("配置中的 theme.name / skin 拒绝路径穿越", () => {
    const fs = memFileStore(themeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "../default", skin: "indigo" };
    expect(() => resolveThemePaths(cfg, fs)).toThrow();
    cfg.theme = { name: "default", skin: "../indigo" };
    expect(() => resolveThemePaths(cfg, fs)).toThrow();
  });
});

describe("buildCssEntry", () => {
  test("含 tailwind/typography/dark variant/@source, 内联三份 CSS, 无字体外链", () => {
    const fs = memFileStore(themeFiles());
    const css = buildCssEntry(fixtureConfig(), fs);
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain('@plugin "@tailwindcss/typography";');
    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *));");
    expect(css).toContain('@source "../themes/default/templates";');
    expect(css).toContain('@source "../themes/default/assets";');
    // 内联了三份内容
    expect(css).toContain("/*CONTRACT*/");
    expect(css).toContain("/*LAYOUT*/");
    expect(css).toContain("/*INDIGO*/");
    expect(css).toContain("/*FONTS*/");
    // 不含其它皮肤
    expect(css).not.toContain("/*EMERALD*/");
    // 不产字体外链 (字体在 head)
    expect(css).not.toContain("jsdelivr");
    expect(css).not.toContain("<link");
  });
  test("@source 为相对路径, 不含文件系统绝对路径/反斜杠", () => {
    const fs = memFileStore(themeFiles());
    const css = buildCssEntry(fixtureConfig(), fs);
    const sources = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(sources.length).toBe(2);
    for (const s of sources) {
      expect(s.startsWith("../")).toBe(true);
      expect(s.includes("\\")).toBe(false);
      expect(/^[a-zA-Z]:/.test(s)).toBe(false); // 非 Windows 盘符绝对路径
    }
  });
  test("切皮肤内联对应皮肤内容", () => {
    const fs = memFileStore(themeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "default", skin: "emerald" };
    const css = buildCssEntry(cfg, fs);
    expect(css).toContain("/*EMERALD*/");
    expect(css).not.toContain("/*INDIGO*/");
  });
});

describe("deriveChromeVars", () => {
  const manifest: ThemeManifest = {
    defaultSkin: "indigo",
    mains: {},
    scripts: {},
    nav: [
      { label: "首页", page: "home" },
      { label: "归档", page: "archive" },
      { label: "目录", page: "dir" },
    ],
    widgets: {},
    assets: [],
  };
  function cfgWith(over: (c: Config) => void): Config {
    const c = fixtureConfig();
    over(c);
    return c;
  }

  test("内置导航渲染为 <a>, 内链含 %ROOT% 占位", () => {
    const v = deriveChromeVars(fixtureConfig(), manifest);
    expect(v.nav).toContain('<a href="%ROOT%index.html">首页</a>');
    expect(v.nav).toContain('<a href="%ROOT%archive.html">归档</a>');
    expect(v.nav).toContain('<a href="%ROOT%dir.html">目录</a>');
  });
  test("外链追加在内置导航尾部", () => {
    const cfg = cfgWith((c) => {
      c.appearance.links = [{ label: "GitHub", href: "https://github.com/x" }];
    });
    const v = deriveChromeVars(cfg, manifest);
    expect(v.nav).toContain('class="nav-external" href="https://github.com/x"');
    expect(v.nav.indexOf("nav-external")).toBeGreaterThan(v.nav.indexOf("首页"));
  });
  test("外链为绝对 URL, 不含 %ROOT% 占位", () => {
    const cfg = cfgWith((c) => {
      c.appearance.links = [{ label: "GitHub", href: "https://github.com/x" }];
    });
    const v = deriveChromeVars(cfg, manifest);
    const external = v.nav.slice(v.nav.indexOf("nav-external"));
    expect(external).not.toContain("%ROOT%");
  });
  test("空外链合法", () => {
    const v = deriveChromeVars(fixtureConfig(), manifest);
    expect(v.nav).not.toContain("nav-external");
  });
  test("含特殊字符的 label 被转义", () => {
    const m: ThemeManifest = { ...manifest, nav: [{ label: 'a<b"', page: "home" }] };
    const v = deriveChromeVars(fixtureConfig(), m);
    expect(v.nav).toContain("a&lt;b&quot;");
  });
  test("logo text/image 两态", () => {
    const tv = deriveChromeVars(
      cfgWith((c) => (c.appearance.logo = { type: "text", value: "LG" })),
      manifest,
    );
    expect(tv.logo).toBe('<a class="site-logo-link" href="%ROOT%index.html">LG</a>');
    const iv = deriveChromeVars(
      cfgWith((c) => (c.appearance.logo = { type: "image", value: "https://x.com/l.png" })),
      manifest,
    );
    expect(iv.logo).toContain('<img class="site-logo-img" src="https://x.com/l.png"');
  });
  test("footer 含 ICP/公安号 + 官方链接", () => {
    const cfg = cfgWith((c) => {
      c.appearance.footer = {
        copyright: "© 2026 me",
        icp: "京ICP备2026000000号",
        police: "京公网安备 11010802000000号",
        policeCode: "11010802000000",
      };
    });
    const v = deriveChromeVars(cfg, manifest);
    expect(v.footerCopyright).toBe("© 2026 me");
    expect(v.footerIcp).toContain("beian.miit.gov.cn");
    expect(v.footerIcp).toContain("京ICP备2026000000号");
    expect(v.footerPolice).toContain("beian.mps.gov.cn");
    expect(v.footerPolice).toContain("11010802000000");
  });
  test("空 footer -> 空串", () => {
    const v = deriveChromeVars(fixtureConfig(), manifest);
    expect(v.footerCopyright).toBe("");
    expect(v.footerIcp).toBe("");
    expect(v.footerPolice).toBe("");
  });
  test("rssLinks 按 formats 生成", () => {
    const cfg = cfgWith((c) => {
      c.rss.enabled = true;
      c.rss.formats = ["rss", "atom"];
    });
    const v = deriveChromeVars(cfg, manifest);
    expect(v.rssLinks).toContain('href="%ROOT%feed.xml"');
    expect(v.rssLinks).toContain('href="%ROOT%atom.xml"');
    expect(v.rssLinks).not.toContain("feed.json");
  });
  test("rss 关闭 -> rssLinks 空", () => {
    const v = deriveChromeVars(
      cfgWith((c) => (c.rss.enabled = false)),
      manifest,
    );
    expect(v.rssLinks).toBe("");
  });
});

describe("toChromeData", () => {
  const manifest: ThemeManifest = {
    defaultSkin: "indigo",
    mains: {},
    scripts: {},
    nav: [{ label: "首页", page: "home" }],
    widgets: {},
    assets: [],
  };
  test("产出 ChromeData 五字段, footer 合并版权/ICP/公安, 不含 giscus 主题", () => {
    const cfg = fixtureConfig();
    cfg.appearance.footer = {
      copyright: "© 2026 me",
      icp: "京ICP备x号",
      police: "京公网安备 y号",
      policeCode: "y",
    };
    const data = toChromeData(deriveChromeVars(cfg, manifest), cfg.site.title);
    expect(Object.keys(data).sort()).toEqual(
      ["footer", "logo", "nav", "rssLinks", "siteTitle"],
    );
    expect(data.siteTitle).toBe("测试站点");
    expect(data.nav).toContain("%ROOT%index.html");
    expect(data.footer).toContain("© 2026 me");
    expect(data.footer).toContain("beian.miit.gov.cn");
    expect(data.footer).toContain("beian.mps.gov.cn");
    expect(JSON.stringify(data)).not.toContain("giscus");
  });
  test("siteTitle 原文不转义 (textContent 注入)", () => {
    const cfg = fixtureConfig();
    cfg.site.title = 'a<b"';
    const data = toChromeData(deriveChromeVars(cfg, manifest), cfg.site.title);
    expect(data.siteTitle).toBe('a<b"');
  });
});

describe("lang 注入 (方案B: 经 ChromeVars)", () => {
  const manifest: ThemeManifest = {
    defaultSkin: "indigo",
    mains: {},
    scripts: {},
    nav: [],
    widgets: {},
    assets: [],
  };
  test("deriveChromeVars.lang = cfg.site.language", () => {
    const c = fixtureConfig();
    expect(deriveChromeVars(c, manifest).lang).toBe(c.site.language);
    expect(deriveChromeVars(c, manifest).lang).toBe("zh-CN");
  });
  test("deriveChromeVars 生成 giscus 主题 JS 字符串字面量", () => {
    const c = fixtureConfig();
    c.site.url = "https://blog.example.com/x</script>";
    const v = deriveChromeVars(c, manifest);
    expect(v.giscusThemeDark).toBe("https://blog.example.com/x</script>/giscus-dark.css");
    expect(v.giscusThemeDarkJs).toContain("\\u003c/script>");
    expect(v.giscusThemeDarkJs).not.toContain("</script>");
  });
  test("toChromeData 不含 lang (不泄漏进 chrome.json)", () => {
    const c = fixtureConfig();
    const data = toChromeData(deriveChromeVars(c, manifest), c.site.title);
    expect("lang" in (data as unknown as Record<string, unknown>)).toBe(false);
  });
});

// comic 主题 (手绘漫画风, defaultSkin=ink): 验证"主题文件夹自包含 + 配置切换"扩展点.
// 用 memFileStore 注入虚拟 comic 主题文件 (不依赖真实磁盘), 断言路径解析与清单解析命中 comic/ink.
function comicThemeFiles(over: Record<string, string> = {}): Record<string, string> {
  return {
    "themes/comic/theme.json": JSON.stringify({
      defaultSkin: "ink",
      mains: { post: "main-post.html", home: "main-list.html" },
      scripts: { home: ["browse.js", "app.js"] },
      nav: [
        { label: "首页", page: "home" },
        { label: "归档", page: "archive" },
      ],
      widgets: { post: ["post-toc"], home: ["back-to-top"] },
    }),
    "themes/comic/styles/contract.css": ":root{--gb-x:1}/*COMIC-CONTRACT*/",
    "themes/comic/styles/fonts.css": "/*COMIC-FONTS*/",
    "themes/comic/styles/layout.css": ".page{}/*COMIC-LAYOUT*/",
    "themes/comic/styles/skins/ink.css": ":root{--gb-surface:#faf6ee}/*INK*/",
    ...over,
  };
}

describe("comic 主题解析 (扩展点验证)", () => {
  test("loadThemeManifest 解析 comic theme.json, defaultSkin=ink", () => {
    const fs = memFileStore(comicThemeFiles());
    const m = loadThemeManifest(fs, "themes/comic");
    expect(m.defaultSkin).toBe("ink");
    expect(m.nav[0]).toEqual({ label: "首页", page: "home" });
  });

  test("resolveThemePaths: themeDir=themes/comic, skin 缺省命中 ink", () => {
    const fs = memFileStore(comicThemeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "comic", skin: "" }; // skin 留空 -> 取 theme.json.defaultSkin=ink
    const p = resolveThemePaths(cfg, fs);
    expect(p.themeDir).toBe("themes/comic");
    expect(p.templatesDir).toBe("themes/comic/templates");
    expect(p.assetsDir).toBe("themes/comic/assets");
    expect(p.contractPath).toBe("themes/comic/styles/contract.css");
    expect(p.fontsPath).toBe("themes/comic/styles/fonts.css");
    expect(p.layoutCssPath).toBe("themes/comic/styles/layout.css");
    expect(p.skinPath).toBe("themes/comic/styles/skins/ink.css");
  });

  test("resolveThemePaths: 显式 skin=ink 同样命中", () => {
    const fs = memFileStore(comicThemeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "comic", skin: "ink" };
    expect(resolveThemePaths(cfg, fs).skinPath).toBe(
      "themes/comic/styles/skins/ink.css",
    );
  });

  test("buildCssEntry 内联 comic 三份 CSS + ink 皮肤, @source 指向 comic 目录", () => {
    const fs = memFileStore(comicThemeFiles());
    const cfg = fixtureConfig();
    cfg.theme = { name: "comic", skin: "ink" };
    const css = buildCssEntry(cfg, fs);
    expect(css).toContain('@source "../themes/comic/templates";');
    expect(css).toContain('@source "../themes/comic/assets";');
    expect(css).toContain("/*COMIC-CONTRACT*/");
    expect(css).toContain("/*COMIC-LAYOUT*/");
    expect(css).toContain("/*COMIC-FONTS*/");
    expect(css).toContain("/*INK*/");
  });
});

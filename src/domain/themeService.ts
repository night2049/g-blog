// 主题系统服务: 解析主题/皮肤路径、读主题清单、生成 Tailwind 入口、派生外壳 HTML 片段.
// 主题以文件夹为单位自包含 (templates + styles{contract,layout,skins} + assets + theme.json).
// 路径采用相对内容仓根 (与全局 FileStore 模型一致, 便于测试与 Windows/Linux 一致解析).
import type {
  ChromeData,
  ChromeVars,
  Config,
  FileStore,
  ThemeManifest,
} from "./types.ts";
import { escapeHtmlAttr, escapeHtmlText, jsStringLiteral } from "./template.ts";

export interface ThemePaths {
  themeDir: string;
  templatesDir: string;
  assetsDir: string;
  contractPath: string;
  fontsPath: string;
  layoutCssPath: string;
  skinPath: string;
}

// 内置导航页 -> 既有页面文件名映射 (内置导航指向站点既有页面).
// 链接含 %ROOT% 占位, 由 chrome.js 按页面 data-root 运行时替换 (外壳运行时注入).
const PAGE_HREF: Record<string, string> = {
  home: "%ROOT%index.html",
  archive: "%ROOT%archive.html",
  dir: "%ROOT%dir.html",
  tag: "%ROOT%tag.html",
};

function assertSafePathFragment(value: unknown, label: string, allowSlash = false): string {
  if (typeof value !== "string" || value === "")
    throw new Error(label + " 必须为非空字符串");
  if (value.includes("\0")) throw new Error(label + " 不得含 NUL 字符");
  if (value.includes("\\")) throw new Error(label + " 不得含反斜杠");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value))
    throw new Error(label + " 不得为绝对路径");
  const parts = value.split("/");
  if (!allowSlash && parts.length > 1) throw new Error(label + " 不得含斜杠");
  if (parts.some((p) => p === "" || p === "." || p === ".."))
    throw new Error(label + " 不得穿越目录");
  return value;
}

function validateManifestPaths(raw: any): void {
  assertSafePathFragment(raw.defaultSkin, "theme.json: defaultSkin");
  for (const [page, main] of Object.entries(raw.mains ?? {})) {
    assertSafePathFragment(page, "theme.json: mains key");
    assertSafePathFragment(main, "theme.json: mains." + page, true);
  }
  for (const [page, scripts] of Object.entries(raw.scripts ?? {})) {
    assertSafePathFragment(page, "theme.json: scripts key");
    if (!Array.isArray(scripts)) throw new Error("theme.json: scripts." + page + " 必须为数组");
    for (const script of scripts)
      assertSafePathFragment(script, "theme.json: scripts." + page + "[]", true);
  }
  for (const [page, widgets] of Object.entries(raw.widgets ?? {})) {
    assertSafePathFragment(page, "theme.json: widgets key");
    if (!Array.isArray(widgets)) throw new Error("theme.json: widgets." + page + " 必须为数组");
    for (const widget of widgets)
      assertSafePathFragment(widget, "theme.json: widgets." + page + "[]");
  }
  if (raw.assets !== undefined && !Array.isArray(raw.assets))
    throw new Error("theme.json: assets 必须为数组");
  for (const asset of raw.assets ?? [])
    assertSafePathFragment(asset, "theme.json: assets[]", true);
}

// 读主题清单 theme.json; 缺文件或缺关键字段抛中文错误.
export function loadThemeManifest(fs: FileStore, themeDir: string): ThemeManifest {
  const text = fs.read(themeDir + "/theme.json");
  if (text === null) throw new Error("找不到主题清单: " + themeDir + "/theme.json");
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("主题清单 JSON 解析失败: " + themeDir + "/theme.json");
  }
  if (!raw.defaultSkin || typeof raw.defaultSkin !== "string")
    throw new Error("theme.json: defaultSkin 缺失");
  if (!raw.mains || typeof raw.mains !== "object")
    throw new Error("theme.json: mains 缺失");
  if (!raw.scripts || typeof raw.scripts !== "object")
    throw new Error("theme.json: scripts 缺失");
  if (!Array.isArray(raw.nav)) throw new Error("theme.json: nav 必须为数组");
  if (!raw.widgets || typeof raw.widgets !== "object")
    throw new Error("theme.json: widgets 缺失");
  validateManifestPaths(raw);
  return {
    defaultSkin: raw.defaultSkin,
    mains: raw.mains,
    scripts: raw.scripts,
    nav: raw.nav,
    widgets: raw.widgets,
    assets: Array.isArray(raw.assets) ? raw.assets : [],
  };
}

/**
 * 解析所选主题与皮肤的各路径 (相对内容仓根), 并校验存在性.
 * skin 缺省取 theme.json.defaultSkin. 主题/皮肤缺失抛中文错误.
 */
export function resolveThemePaths(
  cfg: Config,
  fs: FileStore,
  themesRoot: string = "themes",
): ThemePaths {
  assertSafePathFragment(cfg.theme.name, "config/appearance.json: theme.name");
  const themeDir = themesRoot.replace(/\/+$/, "") + "/" + cfg.theme.name;
  // 读清单同时校验主题存在 (theme.json 缺失即主题不存在).
  const manifest = loadThemeManifest(fs, themeDir);
  const skin = cfg.theme.skin || manifest.defaultSkin;
  assertSafePathFragment(skin, "config/appearance.json: theme.skin");
  if (!skin) throw new Error("主题 " + cfg.theme.name + " 未指定皮肤且无 defaultSkin");

  const contractPath = themeDir + "/styles/contract.css";
  const fontsPath = themeDir + "/styles/fonts.css";
  const layoutCssPath = themeDir + "/styles/layout.css";
  const skinPath = themeDir + "/styles/skins/" + skin + ".css";
  if (!fs.exists(contractPath))
    throw new Error("主题缺少令牌契约: " + contractPath);
  if (!fs.exists(fontsPath))
    throw new Error("主题缺少字体定义: " + fontsPath);
  if (!fs.exists(layoutCssPath))
    throw new Error("主题缺少结构样式: " + layoutCssPath);
  if (!fs.exists(skinPath))
    throw new Error("皮肤文件不存在: " + skinPath);

  return {
    themeDir,
    templatesDir: themeDir + "/templates",
    assetsDir: themeDir + "/assets",
    contractPath,
    fontsPath,
    layoutCssPath,
    skinPath,
  };
}

/**
 * 生成交 Tailwind 的入口 CSS 字符串.
 * 策略: 三份主题 CSS (contract/layout/skin) 直接内联文件内容 (不留路径, 规避 Windows
 * 反斜杠绝对路径非法 CSS URL 的坑); @source 用相对入口文件 (.build/) 的相对路径.
 * 字体不在此处理 (由主题 head.html 直接注入 <link>).
 */
export function buildCssEntry(
  cfg: Config,
  fs: FileStore,
  themesRoot: string = "themes",
): string {
  const paths = resolveThemePaths(cfg, fs, themesRoot);
  const contract = fs.read(paths.contractPath);
  const fonts = fs.read(paths.fontsPath);
  const layout = fs.read(paths.layoutCssPath);
  const skin = fs.read(paths.skinPath);
  if (contract === null) throw new Error("读不到令牌契约: " + paths.contractPath);
  if (fonts === null) throw new Error("读不到字体定义: " + paths.fontsPath);
  if (layout === null) throw new Error("读不到结构样式: " + paths.layoutCssPath);
  if (skin === null) throw new Error("读不到皮肤文件: " + paths.skinPath);

  // 入口写在 .build/ 下, 故 @source 相对路径前缀 "../" 指回内容仓根.
  const srcTemplates = "../" + paths.templatesDir;
  const srcAssets = "../" + paths.assetsDir;

  return [
    '@import "tailwindcss";',
    '@plugin "@tailwindcss/typography";',
    "@custom-variant dark (&:where(.dark, .dark *));",
    `@source "${srcTemplates}";`,
    `@source "${srcAssets}";`,
    "",
    "/* ===== theme fonts.css (自托管 @font-face, font-display: block) ===== */",
    fonts,
    "/* ===== theme contract.css ===== */",
    contract,
    "/* ===== theme layout.css ===== */",
    layout,
    "/* ===== theme skin ===== */",
    skin,
    "",
  ].join("\n");
}

// 内置导航页 -> href; 未知页回退 %ROOT%<page>.html.
function navHref(page: string): string {
  return PAGE_HREF[page] ?? "%ROOT%" + page + ".html";
}

/**
 * 派生填入外壳 partial 的 HTML 片段 (运行时由 chrome.js 注入挂载点).
 * 内部跨页链接含 %ROOT% 占位 (chrome.js 按 data-root 替换); 外链为绝对 URL, 不占位.
 * nav = 内置导航 (manifest.nav, 指向既有页面) + 外链 (cfg.appearance.links, 追加尾部).
 * 文本经 escapeHtml, 内链 href 含占位; 备案带工信部/公安官方链接 (绝对 URL).
 */
export function deriveChromeVars(cfg: Config, manifest: ThemeManifest): ChromeVars {
  const ap = cfg.appearance;

  // logo: text -> 文本链接; image -> 图片链接 (均回首页, 含 %ROOT% 占位).
  const logo =
    ap.logo.type === "image"
      ? `<a class="site-logo-link" href="%ROOT%index.html"><img class="site-logo-img" src="${escapeHtmlAttr(
          encodeURI(ap.logo.value),
        )}" alt="${escapeHtmlAttr(cfg.site.title)}" /></a>`
      : `<a class="site-logo-link" href="%ROOT%index.html">${escapeHtmlText(ap.logo.value)}</a>`;

  // nav: 内置导航 + 外链.
  const builtin = manifest.nav
    .map(
      (n) => `<a href="${escapeHtmlAttr(navHref(n.page))}">${escapeHtmlText(n.label)}</a>`,
    )
    .join("");
  const external = ap.links
    .map(
      (l) =>
        `<a class="nav-external" href="${escapeHtmlAttr(encodeURI(l.href))}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(
          l.label,
        )}</a>`,
    )
    .join("");
  const nav = builtin + external;

  // 页脚: 版权 / ICP 备案 (工信部) / 公安备案 (含官方链接).
  const footerCopyright = ap.footer.copyright ? escapeHtmlText(ap.footer.copyright) : "";
  const footerIcp = ap.footer.icp
    ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${escapeHtmlText(
        ap.footer.icp,
      )}</a>`
    : "";
  const policeHref =
    "https://beian.mps.gov.cn/#/query/webSearch?code=" +
    encodeURIComponent(ap.footer.policeCode);
  const footerPolice = ap.footer.police
    ? `<a class="footer-beian" href="${escapeHtmlAttr(policeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(ap.footer.police)}</a>`
    : "";

  // rssLinks: 按 rss.formats 生成 (关闭/空则为空).
  const rssLinks = cfg.rss.enabled ? renderRssLinks(cfg.rss.formats) : "";

  // giscus 主题值: 有 site.url 则用自托管自定义主题 CSS 的绝对 URL, 否则回退 giscus 内置 light/dark.
  const base = cfg.site.url ? cfg.site.url.replace(/\/+$/, "") : "";
  const giscusThemeLight = base ? base + "/giscus-light.css" : "light";
  const giscusThemeDark = base ? base + "/giscus-dark.css" : "dark";

  return {
    logo,
    nav,
    footerCopyright,
    footerIcp,
    footerPolice,
    rssLinks,
    giscusThemeLight,
    giscusThemeDark,
    giscusThemeLightJs: jsStringLiteral(giscusThemeLight),
    giscusThemeDarkJs: jsStringLiteral(giscusThemeDark),
    lang: cfg.site.language, // <html lang> 源 (config.ts 已保证缺省 zh-CN); 经 render 的 ...chrome 注入, toChromeData 不带出故不入 chrome.json
  };
}

const RSS_FILE: Record<string, { file: string; label: string }> = {
  rss: { file: "%ROOT%feed.xml", label: "RSS" },
  atom: { file: "%ROOT%atom.xml", label: "Atom" },
  json: { file: "%ROOT%feed.json", label: "JSON" },
};
function renderRssLinks(formats: readonly string[]): string {
  return formats
    .map((f) => RSS_FILE[f])
    .filter((x): x is { file: string; label: string } => Boolean(x))
    .map((x) => `<a href="${x.file}">${x.label}</a>`)
    .join("");
}

/**
 * 把构建期 ChromeVars 整理为运行时 chrome.json 模型 ChromeData.
 * footer 合并版权/ICP/公安备案为单片段; 不含 giscus 主题 (giscus 主题留在 ChromeVars,
 * 由 head 内联脚本与 #giscus-mount 构建期烘焙, 见 §4.4).
 */
export function toChromeData(chrome: ChromeVars, siteTitle: string): ChromeData {
  return {
    // 原文 (不转义): chrome.js 经 textContent 注入, 由浏览器保证安全; 预转义会导致双重转义.
    siteTitle: siteTitle,
    logo: chrome.logo,
    nav: chrome.nav,
    footer: chrome.footerCopyright + chrome.footerIcp + chrome.footerPolice,
    rssLinks: chrome.rssLinks,
  };
}

// 自定义错误页 (多 HTTP 码): 与托管无关的通用静态页. 复用 assemblePage + 构建期 chrome 片段.
// 关键: 错误页会被托管在任意深层路径响应, 故以 site.url 派生的绝对根前缀渲染资源/导航引用,
// 避免普通页的相对 data-root 令 app.css/favicon/脚本/导航错位 (设计 §4.4).
import type {
  ChromeVars,
  Config,
  TemplateProvider,
  ThemeManifest,
} from "./types.ts";
import { assemblePage, escapeHtml } from "./template.ts";

// 各码文案 (中文): 版式一致, 文案不同; 未覆盖的码用 default.
const ERROR_COPY: Record<string, { message: string; desc: string }> = {
  "403": { message: "无权访问", desc: "你没有权限查看此页面。" },
  "404": { message: "页面走丢了", desc: "你要找的页面不存在, 或已被移动。" },
  "500": { message: "服务器开小差", desc: "服务器出了点问题, 请稍后再试。" },
  "502": { message: "网关错误", desc: "上游服务暂时不可用, 请稍后再试。" },
  "503": { message: "服务不可用", desc: "服务暂时不可用, 请稍后再试。" },
  default: { message: "出错了", desc: "发生了一个错误。" },
};

/**
 * 由配置码表派生待生成的错误页 (去重). 空码表 -> 空数组 (不生成).
 * @returns [{ file: "<code>.html", code }]
 */
export function errorPagesToWrite(cfg: Config): { file: string; code: number }[] {
  const seen = new Set<number>();
  const out: { file: string; code: number }[] = [];
  for (const code of cfg.content.errorPages.codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ file: code + ".html", code });
  }
  return out;
}

// 由 site.url 派生绝对根前缀 (尾部带 /); 无 site.url 退回 "/" (根托管兜底).
function absoluteRoot(siteUrl: string): string {
  return siteUrl ? siteUrl.replace(/\/+$/, "") + "/" : "/";
}

/**
 * 渲染单个错误页 (完整静态页): 套外壳 + 超大码字 + 文案 + 返回首页.
 * rootPrefix 用绝对根前缀, 使资源/导航 (含 chrome.js 的 %ROOT% 运行时替换) 在任意路径都正确.
 */
export function renderErrorPage(
  code: number,
  templates: TemplateProvider,
  manifest: ThemeManifest,
  chrome: ChromeVars,
  cfg: Config,
): string {
  const copy = ERROR_COPY[String(code)] ?? ERROR_COPY.default!;
  const rootPrefix = absoluteRoot(cfg.site.url);
  const vars: Record<string, string> = {
    rootPrefix,
    pageTitle: code + " · " + escapeHtml(cfg.site.title),
    siteTitle: escapeHtml(cfg.site.title),
    errorCode: String(code),
    errorMessage: escapeHtml(copy.message),
    errorDesc: escapeHtml(copy.desc),
    metaDescription: `<meta name="description" content="${escapeHtml(copy.message)}" />`,
    ...chrome,
  };
  return assemblePage(templates, manifest, "error", vars);
}

// 多端接线说明 (随产物输出, 与页面本身无关; 各托管商自定义错误页方式不同, 设计 §4.4).
export function errorWiringDoc(): string {
  return [
    "# 错误页多端接线说明",
    "",
    "本目录已生成各 HTTP 码错误页 (如 404.html / 403.html / 500.html). 页面与托管无关, 仅接线方式不同:",
    "",
    "## GitHub Pages",
    "自动服务 404.html (纯静态托管, 其余码不可自定义, 页面仍生成备用).",
    "",
    "## Netlify",
    "404.html 自动生效; 其余码经 _redirects 或 netlify.toml, 例如 _redirects:",
    "  /* /404.html 404",
    "",
    "## Vercel",
    "vercel.json 路由 / 框架约定, 例如:",
    '  { "routes": [{ "src": "/.*", "status": 404, "dest": "/404.html" }] }',
    "",
    "## Nginx (自建)",
    "  error_page 404 /404.html;",
    "  error_page 403 /403.html;",
    "  error_page 500 502 503 504 /500.html;",
    "",
  ].join("\n");
}

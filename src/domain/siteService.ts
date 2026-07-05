// 站点目录写入: 文章页(+图片夹清理), site.json, chrome.json, 列表页外壳, 主题脚本资产, full 站点根清理. 依赖 FileStore.
import type {
  ChromeData,
  ChromeVars,
  Config,
  FileStore,
  SiteConfig,
  TemplateProvider,
  ThemeManifest,
} from "./types.ts";
import { postUrl, postImgDir } from "./postService.ts";
import { renderListPage } from "./template.ts";
import { errorPagesToWrite, renderErrorPage, errorWiringDoc } from "./errorService.ts";

const SITE_FILE = "site.json";
const CHROME_FILE = "chrome.json";

// full 构建清理站点根时保留的顶层白名单 (版本控制/部署元数据).
export const SITE_KEEP = [".git", ".nojekyll", "CNAME"];

// 列表页类型 -> 输出文件名 (正文由客户端脚本运行时读 JSON 填充). 供组装与重组共用.
// tags = 标签聚合页 (标签云, 区别于单标签页 tag.html); 客户端 tags.js 读 data/tags.json 渲染.
export const LIST_PAGES: Record<string, string> = {
  home: "index.html",
  archive: "archive.html",
  tag: "tag.html",
  dir: "dir.html",
  tags: "tags.html",
};

export function writePostPage(
  fs: FileStore,
  nodeId: string,
  postDir: string,
  html: string,
): void {
  fs.write(postUrl(nodeId, postDir), html);
}

// 删文章页 + 其图片文件夹内文件 (不存在则忽略). 空目录残留无害 (git 不跟踪空目录).
export function deletePostPage(fs: FileStore, nodeId: string, postDir: string): void {
  fs.remove(postUrl(nodeId, postDir));
  const dir = postImgDir(nodeId, postDir);
  for (const name of fs.list(dir)) fs.remove(dir + "/" + name);
}

export function writeSiteJson(fs: FileStore, site: SiteConfig): void {
  fs.write(SITE_FILE, JSON.stringify(site));
}

// 写运行时外壳片段 (chrome.json), 供 chrome.js 各页注入挂载点.
export function writeChromeJson(fs: FileStore, data: ChromeData): void {
  fs.write(CHROME_FILE, JSON.stringify(data));
}

// 清空站点根 (full 专用): 删除除白名单 (.git/.nojekyll/CNAME) 外的全部产物, 杜绝旧版布局孤儿文件.
export function cleanSiteRoot(fs: FileStore, keep: string[] = SITE_KEEP): void {
  fs.clearExcept(keep);
}

// 组装并写出列表页外壳 (home->index/archive/tag/dir). 风格来自共享 baseof + layout.css + 令牌.
export function writeListPages(
  fs: FileStore,
  provider: TemplateProvider,
  manifest: ThemeManifest,
  site: SiteConfig,
  chrome: ChromeVars,
  cfg: Config,
): void {
  for (const [pageType, file] of Object.entries(LIST_PAGES)) {
    fs.write(file, renderListPage(provider, manifest, pageType, site, chrome, cfg));
  }
}

// 生成各 HTTP 码错误页 (完整静态页, 绝对根前缀) + 多端接线说明. 空码表则不生成.
export function writeErrorPages(
  fs: FileStore,
  provider: TemplateProvider,
  manifest: ThemeManifest,
  chrome: ChromeVars,
  cfg: Config,
): void {
  const pages = errorPagesToWrite(cfg);
  if (pages.length === 0) return;
  for (const { file, code } of pages) {
    fs.write(file, renderErrorPage(code, provider, manifest, chrome, cfg));
  }
  fs.write("error-pages.txt", errorWiringDoc());
}

// 主题静态资产清单: manifest.scripts 各页脚本并集 + widgets.js + chrome.js (各页固定加载) + manifest.assets.
export function themeScriptAssets(manifest: ThemeManifest): string[] {
  const set = new Set<string>();
  for (const arr of Object.values(manifest.scripts)) for (const s of arr) set.add(s);
  set.add("widgets.js");
  set.add("chrome.js");
  for (const a of manifest.assets ?? []) set.add(a);
  return [...set];
}

// 从主题 assets 目录拷贝客户端脚本与静态资产到站点根. (主样式 app.css 由 tailwind 单独产出.)
export function copyThemeAssets(
  fs: FileStore,
  assetsDir: string,
  manifest: ThemeManifest,
): void {
  for (const name of themeScriptAssets(manifest)) {
    fs.copyInto(assetsDir + "/" + name, name);
  }
}

// 正文图片扩展名: 转码产物 webp + 原样保留的常见格式. 仅用于区分"正文图片"与文本/脚本产物.
const IMAGE_EXTS = new Set(["webp", "png", "jpg", "jpeg", "gif", "avif", "svg", "bmp", "ico"]);

// 是否为正文图片产物: 位于子目录 (post/<id>/ 或独立页 <id>/) 且图片扩展名.
// 顶层文件 (favicon.svg/app.css/*.js/*.html) 一律不算: 主题资产/页面/样式各由自身流程重写, 不进图片回收.
export function isContentImage(path: string): boolean {
  if (!path.includes("/")) return false; // 顶层文件 (favicon.svg 等主题资产) 排除
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

// full 清站点根: 保留白名单 (.git/.nojekyll/CNAME) 与正文图片 (转码代价高, 判存复用), 删除其余全部产物.
// 返回保留下来的图片路径集, 供构建结束后 pruneOrphanImages 回收孤儿. 用于 full (替代 cleanSiteRoot 全清).
export function cleanSiteRootKeepImages(fs: FileStore, keep: string[] = SITE_KEEP): string[] {
  const keepSet = new Set(keep);
  const images: string[] = [];
  for (const path of fs.listAll("")) {
    if (keepSet.has(path.split("/")[0]!)) continue; // 白名单顶层 (.git/...) 整树保留
    if (isContentImage(path)) {
      images.push(path); // 正文图片保留, 待构建期判存复用
      continue;
    }
    fs.remove(path); // 其余 (HTML/js/css/json/feed/txt 等) 删除, full 会重建
  }
  return images;
}

// 孤儿图片回收: existing (构建前保留的图) 中本次未被任何文章/独立页引用 (不在 used) 的删除.
// used 取自各篇 finalizeContent 的 assets (含判存命中复用的图); 清理"文章删除/正文换图"残留的旧图.
export function pruneOrphanImages(fs: FileStore, existing: string[], used: Set<string>): void {
  for (const path of existing) if (!used.has(path)) fs.remove(path);
}

const KNOWN_TOP_LEVEL_THEME_ASSETS = new Set([
  "app.js",
  "archive.js",
  "browse.js",
  "chrome.js",
  "dir.js",
  "tag.js",
  "tags.js",
  "widgets.js",
  "comic-ink-icon.js",
  "comic-tag-rough.js",
  "giscus-light.css",
  "giscus-dark.css",
  "favicon.svg",
]);

// reassemble 清主题资产: 仅删当前主题清单与内置已知的顶层主题/runtime 资产.
// 随后 copyThemeAssets 重拷当前主题资产; app.css 由 build 末尾 compileCss 重写 (run() 后无条件编译).
// 仅顶层: 子目录 data/、post/<id>/、独立页 <id>/ 一律不动, 也不按扩展名误删用户根级资源.
export function cleanThemeAssets(fs: FileStore, manifest: ThemeManifest): void {
  const keepSet = new Set(SITE_KEEP);
  const assetSet = new Set([...KNOWN_TOP_LEVEL_THEME_ASSETS, ...themeScriptAssets(manifest)]);
  for (const path of fs.listAll("")) {
    if (path.includes("/")) continue; // 仅顶层 (子目录产物不动)
    if (keepSet.has(path)) continue;
    if (assetSet.has(path)) fs.remove(path);
  }
}

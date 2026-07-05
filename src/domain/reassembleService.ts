// 本地重组 (reassemble): 不触 GitHub、不渲 Markdown. 取站点仓已渲正文 (标记间), 套新外壳/模板重写.
// 用于模板/样式/配置变更: 改外壳/外链/备案/正文模板结构/<head>/导航/切主题时, 用现有正文重出页面.
import type {
  ChromeVars,
  Config,
  FileStore,
  PageDoc,
  Post,
  TemplateProvider,
  ThemeManifest,
} from "./types.ts";
import { toSiteConfig, postDirDepth, rootPrefixFor } from "./config.ts";
import { loadPages } from "./manifestService.ts";
import { loadAllEntries } from "./shardService.ts";
import { nodeIdFromUrl } from "./postService.ts";
import { extractContentHtml } from "./contentMarkers.ts";
import { renderPageHtml, renderStandalonePageHtml, renderListPage } from "./template.ts";
import { LIST_PAGES, cleanThemeAssets, copyThemeAssets, writeChromeJson } from "./siteService.ts";
import { errorPagesToWrite, renderErrorPage } from "./errorService.ts";
import { toChromeData } from "./themeService.ts";
import { removeFeeds } from "./feedService.ts";

export interface ReassembleDeps {
  fs: FileStore; // 站点目录 (含已渲染产物)
  cfg: Config;
  templates: TemplateProvider;
  manifest: ThemeManifest;
  chrome: ChromeVars;
  assetsDir: string; // 主题 assets 目录 (重组时一并刷新脚本/giscus 主题等静态资产)
}

export interface ReassembleResult {
  rewritten: number;
  skipped: number;
  warned: number;
}

// 指纹比对: 新旧 HTML 完全一致即视为未变 (精确, 无哈希碰撞风险), 一致则不写避免 git 空 diff.
function writeIfChanged(
  fs: FileStore,
  url: string,
  existing: string | null,
  next: string,
  r: ReassembleResult,
): void {
  if (existing === next) {
    r.skipped++;
    return;
  }
  fs.write(url, next);
  r.rewritten++;
}

/**
 * 遍历 manifest/pages: extractContentHtml -> 套新外壳重组 -> 指纹决定写/跳; 列表页重写外壳.
 * 兜底: 缺 content 标记或站点文件缺失 -> 中文告警 + 跳过不写 (不破坏原文件).
 */
export function reassembleAll(deps: ReassembleDeps): ReassembleResult {
  const { fs, cfg, templates, manifest, chrome, assetsDir } = deps;
  const site = toSiteConfig(cfg);
  const postDir = cfg.build.postDir;
  const postPrefix = rootPrefixFor(postDirDepth(postDir));
  const r: ReassembleResult = { rewritten: 0, skipped: 0, warned: 0 };

  // 文章: 用年份分片 (data/year/*.json) 枚举 + 抽取的正文重组 (posts.json 已移除).
  for (const e of loadAllEntries(fs)) {
    const existing = fs.read(e.url);
    if (existing === null) {
      console.log("[重组] 站点缺文件, 跳过: " + e.url);
      r.warned++;
      continue;
    }
    const content = extractContentHtml(existing);
    if (content === null) {
      console.log("[重组] 文章缺正文标记, 跳过: " + e.url);
      r.warned++;
      continue;
    }
    const post: Post = {
      nodeId: nodeIdFromUrl(e.url, postDir),
      url: e.url,
      title: e.title,
      date: e.date,
      contentHtml: content,
      tags: e.tags ?? [],
      dirs: e.dirs ?? [],
      // 派生字段从分片读出透传 (reassemble 不重算 Markdown/派生), 保文章页 meta 行/head 完整.
      summary: e.summary,
      cover: e.cover,
      readingTime: e.readingTime,
      words: e.words,
    };
    const next = renderPageHtml(post, site, templates, manifest, chrome, cfg, postPrefix);
    writeIfChanged(fs, e.url, existing, next, r);
  }

  // 独立页: 用 pages.json 元数据 + 抽取的正文重组.
  for (const p of loadPages(fs)) {
    const existing = fs.read(p.url);
    if (existing === null) {
      console.log("[重组] 站点缺文件, 跳过: " + p.url);
      r.warned++;
      continue;
    }
    const content = extractContentHtml(existing);
    if (content === null) {
      console.log("[重组] 独立页缺正文标记, 跳过: " + p.url);
      r.warned++;
      continue;
    }
    const page: PageDoc = {
      nodeId: p.nodeId,
      url: p.url,
      title: p.title,
      contentHtml: content,
    };
    const next = renderStandalonePageHtml(page, site, templates, manifest, chrome, cfg);
    writeIfChanged(fs, p.url, existing, next, r);
  }

  // 列表页: 无正文, 直接重写外壳 (指纹跳过未变).
  for (const [pageType, file] of Object.entries(LIST_PAGES)) {
    const existing = fs.read(file);
    const next = renderListPage(templates, manifest, pageType, site, chrome, cfg);
    writeIfChanged(fs, file, existing, next, r);
  }

  // 错误页: 多码独立重渲 (依赖 cfg/模板/chrome), 与列表页同阶段; 指纹跳过未变.
  for (const { file, code } of errorPagesToWrite(cfg)) {
    const existing = fs.read(file);
    const next = renderErrorPage(code, templates, manifest, chrome, cfg);
    writeIfChanged(fs, file, existing, next, r);
  }

  // 运行时外壳片段: 重写 chrome.json (外壳变更经此生效, 文章/独立页指纹不变).
  writeChromeJson(fs, toChromeData(chrome, cfg.site.title));
  if (!cfg.rss.enabled) removeFeeds(fs);

  // 切主题残留清理: 先删站点根顶层已知主题/runtime 资产, 再重拷当前主题资产.
  // app.css 由 build 末尾 compileCss 重写; HTML/data/图片子目录不受影响.
  // cleanThemeAssets 仅动顶层已知 runtime/theme 资产与当前 manifest 资产, 不按扩展名清用户根级资源.
  cleanThemeAssets(fs, manifest);
  // 刷新主题静态资产 (客户端脚本 + giscus 主题 CSS 等); 内容不变时 copyInto 不产生 git diff.
  copyThemeAssets(fs, assetsDir, manifest);

  return r;
}

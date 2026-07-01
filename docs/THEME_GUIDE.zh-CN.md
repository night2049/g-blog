# 主题开发指南

[English](THEME_GUIDE.md) · **简体中文**

主题以**文件夹自包含**：模板 + 样式令牌 + 机制脚本 + 清单。换主题只改 `config/appearance.json` 的 `theme.name`/`theme.skin`。本指南基于内置 `default` 与 `comic` 主题的现状。

## 目录结构

```
src/runtime/                    # 项目级公共 runtime (跨主题共用, 主题不再拷贝)
├─ chrome.js widgets.js browse.js app.js archive.js tag.js dir.js tags.js

themes/<name>/
├─ theme.json                 # 主题清单 (页类型->模板/脚本, 导航, 部件, 资产)
├─ styles/
│  ├─ contract.css            # --gb-* 令牌契约 (兜底默认值, 全主题应保留全套令牌)
│  ├─ fonts.css               # 字体定义 (可空/系统字体栈)
│  ├─ layout.css              # 结构样式 (只消费 --gb-* 令牌, 不硬编码颜色)
│  └─ skins/<skin>.css        # 皮肤 (覆盖 --gb-* 取值; :root 浅色 + .dark 暗色)
├─ templates/
│  ├─ baseof.html             # 外层骨架 (占位 + 硬编码 chrome.js)
│  └─ partials/{head,header,footer,main-post,main-page,main-list,main-tagcloud,main-error}.html
└─ assets/                    # 主题专属资产 + 主题装饰脚本 (可选)
   ├─ favicon.svg
   ├─ giscus-light.css giscus-dark.css
   └─ <theme>-<feat>.js ...   # 主题装饰脚本 (如 comic-ink-icon.js / comic-tag-rough.js)
```

## runtime 与主题装饰脚本

**runtime 脚本是项目级公共代码**: 翻页/卡片渲染/外壳注入/自定义元素挂载等机制, 与具体主题无关.
存放于 `src/runtime/`, 构建期由 `prepareThemeAssets` 统一 minify 到 `.build/theme-assets/` 再拷到站点根.

主题 `theme.json.scripts` 列出页型脚本时, **构建期按名解析源**: 主题 `assets/` 同名文件优先 (允许主题
完全覆写 runtime), 缺失则 fallback 到 `src/runtime/`. 因此主题想换一套翻页逻辑, 只需在自己 `assets/`
下放 `browse.js` 同名覆写; 不动则继承 runtime.

**主题装饰脚本**: 仅在某主题需要的视觉装饰 (如 comic 的手绘抖线 / rough.js 描边), 放主题 `assets/`,
命名建议 `<theme>-<feat>.js` 避开 runtime 文件名. 切入策略: 用 `MutationObserver`/`customElements.whenDefined`
等候 runtime 渲染产物出现, 无需 runtime 配合发事件, 保持零侵入. 加载顺序由 `theme.json.scripts` 数组
顺序决定; defer 保序, 装饰脚本在 runtime 入口 (如 `browse.js`+`app.js`) **之后**列出即可.

## theme.json schema

| 字段 | 含义 |
| --- | --- |
| `defaultSkin` | `theme.skin` 为空时取此皮肤 |
| `mains` | 页类型 → main 片段文件名（`post`/`page`/`home`/`archive`/`tag`/`dir`/`tags`/`error`） |
| `scripts` | 页类型 → 客户端脚本列表（如 `home: ["browse.js","app.js"]`） |
| `nav` | 内置导航 `[{label,page}]`（page 指向既有页面键） |
| `widgets` | 各页类型部件占位声明（如 `post: ["reading-progress","back-to-top","back-to-home"]`） |
| `assets` | 需原样拷到站点根的静态资产（如 giscus 主题 CSS、favicon） |

`resolveThemePaths` 会校验 `styles/{contract,fonts,layout}.css` 与 `styles/skins/<skin>.css` 存在，缺失即报错。

## --gb-* 令牌契约

`contract.css` 定义全套 `--gb-*` 令牌（颜色角色、表层、字体族、间距/尺寸、代码高亮、阴影、层级、灯箱遮罩等）的兜底默认值。**皮肤只覆盖需要变化的子集**（通常是配色与代码高亮），纯尺寸令牌继承 contract。

规则：

- `layout.css` 与皮肤**只用 `--gb-*` 令牌取色/取间距**，不硬编码颜色，保证换肤可控、明暗一致。
- 明暗双态：皮肤 `:root` 为浅色基准，`.dark` 覆盖暗色取值。`--gb-*` 在用时重解析，正文 prose 等无需 `dark:` 变体。
- 形状/纯尺寸常量（如手绘圆角值）非颜色，可在 layout 内以局部变量给定，不违反"颜色只用令牌"。

## 机制不可改清单（换肤不可破坏）

新主题只改视觉, runtime 脚本由项目统一维护, **主题不再持有机制脚本拷贝**:

- **runtime 脚本契约 (位于 `src/runtime/`)**: `chrome/widgets/browse/app/archive/tag/dir/tags.js` 依赖固定挂载点 id、`window.gblog`/`window.__content`/`window.__data`/`window.__chrome`、`<html data-root>`、`chrome:ready` 事件、自定义元素（`post-toc`/`reading-progress`/`back-to-top`/`back-to-home`）。主题想替换 runtime 某脚本时, 在自己 `assets/` 放同名文件即可覆写。
- **模板挂载点/占位**：`baseof` 的 `{{lang}}/{{rootPrefix}}/{{> partial}}/{{widgets}}/{{scripts}}` 与硬编码 `chrome.js`；`header` 的 `#site-logo/#site-nav/#nav-toggle/#rss-menu/#rss-toggle/#rss-links/#theme-toggle`；`footer` 的 `#site-footer`；`main-list` 的 `#page-title/#years/#map/#posts/#pager`；`main-post` 的 `.post-article/.prose/<post-toc>/<!--content:start/end-->/{{content}}/{{comments}}`。
- **机制 class**：`browse.js` 产出 `.post-card*`/`.post-meta`/`.tag.tag-link`/`.pager`；`widgets.js` 选 `.post-article`/`.prose` 等。这些 class **可改视觉，不可删名**。

## 新增皮肤步骤

1. 在 `themes/<name>/styles/skins/` 下新建 `<skin>.css`，`:root` + `.dark` 覆盖 `--gb-*` 配色子集。
2. 把 `config/appearance.json` 的 `theme.skin` 改为该文件名（不含 `.css`），或设为主题 `defaultSkin`。
3. `bun run preview:local` 肉眼核对明暗两态。

## 新增主题步骤

1. 复制 `themes/default` 为 `themes/<name>`（只含 `theme.json` + `styles/` + `templates/` + `assets/` 主题资产, 无机制脚本拷贝）。
2. 模板（`templates/**`）保持原样（保留全部挂载点/占位/class）。
3. 重写 `styles/layout.css`（只用 `--gb-*`）与新增 `styles/skins/<skin>.css`；`contract.css` 保留全套令牌，`fonts.css` 按需。
4. `theme.json` 的 `defaultSkin` 指向你的皮肤；`mains/scripts/nav/widgets/assets` 结构与 default 等价；`scripts` 列出页型用的 runtime 脚本（如 `["browse.js", "app.js"]`），构建期自动从 `src/runtime/` 解析。
5. (可选) 主题专属视觉装饰: 在 `assets/` 加 `<theme>-<feat>.js`, `theme.json.scripts` 对应页型追加该脚本; 切入用 MutationObserver/`customElements.whenDefined` 等候 runtime 产物出现.
6. (可选) 主题想覆写某 runtime 脚本: 在 `assets/` 放同名文件 (如 `browse.js`), 构建期主题文件优先, 否则继承 runtime.
7. 改 `config/appearance.json` 的 `theme.name`，`bun run preview:local` 验证。

> CSS 编译：`buildCssEntry` 把 `fonts + contract + layout + skin` 内联后交 Tailwind（v4 + typography 插件），`@source` 指向主题 `templates`/`assets` 以保留被用到的工具类。

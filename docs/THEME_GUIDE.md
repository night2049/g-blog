# Theme Development Guide

**English** · [简体中文](THEME_GUIDE.zh-CN.md)

A theme is **self-contained in a folder**: templates + style tokens + mechanism scripts + a manifest. To switch themes, change only `theme.name`/`theme.skin` in `config/appearance.json`. This guide is based on the current state of the built-in `default` and `comic` themes.

## Directory Structure

```
src/runtime/                    # Project-level shared runtime (shared across themes; no longer copied into themes)
├─ chrome.js widgets.js browse.js app.js archive.js tag.js dir.js tags.js

themes/<name>/
├─ theme.json                 # Theme manifest (page type -> template/script, nav, widgets, assets)
├─ styles/
│  ├─ contract.css            # --gb-* token contract (fallback defaults; every theme should keep the full token set)
│  ├─ fonts.css               # Font definitions (can be empty / a system font stack)
│  ├─ layout.css              # Structural styles (only consume --gb-* tokens; no hardcoded colors)
│  └─ skins/<skin>.css        # Skin (overrides --gb-* values; :root for light + .dark for dark)
├─ templates/
│  ├─ baseof.html             # Outer skeleton (placeholders + hardcoded chrome.js)
│  └─ partials/{head,header,footer,main-post,main-page,main-list,main-tagcloud,main-error}.html
└─ assets/                    # Theme-specific assets + theme decoration scripts (optional)
   ├─ favicon.svg
   ├─ giscus-light.css giscus-dark.css
   └─ <theme>-<feat>.js ...   # Theme decoration scripts (e.g. comic-ink-icon.js / comic-tag-rough.js)
```

## Runtime and Theme Decoration Scripts

**Runtime scripts are project-level shared code**: mechanisms such as pagination, card rendering, shell injection, and custom-element mounting are independent of any specific theme. They live in `src/runtime/` and, at build time, are minified in one place by `prepareThemeAssets` to `.build/theme-assets/` and then copied to the site root.

When a theme's `theme.json.scripts` lists page-type scripts, **the source is resolved by name at build time**: a same-named file in the theme's `assets/` takes priority (allowing a theme to fully override the runtime), and it falls back to `src/runtime/` when missing. So if a theme wants a different pagination logic, it only needs to place a same-named `browse.js` override under its own `assets/`; without one, it inherits the runtime.

**Theme decoration scripts**: visual decorations needed only by a particular theme (e.g. comic's hand-drawn jitter lines / rough.js strokes) go in the theme's `assets/`, ideally named `<theme>-<feat>.js` to avoid runtime filenames. Cut-in strategy: use `MutationObserver`/`customElements.whenDefined` to wait for the runtime's rendered output to appear — no runtime cooperation or events required, keeping it zero-intrusion. Load order is determined by the order of the `theme.json.scripts` array; `defer` preserves order, so just list decoration scripts **after** the runtime entries (such as `browse.js`+`app.js`).

## theme.json schema

| Field | Meaning |
| --- | --- |
| `defaultSkin` | The skin used when `theme.skin` is empty |
| `mains` | Page type → main partial filename (`post`/`page`/`home`/`archive`/`tag`/`dir`/`tags`/`error`) |
| `scripts` | Page type → list of client scripts (e.g. `home: ["browse.js","app.js"]`) |
| `nav` | Built-in navigation `[{label,page}]` (page points to an existing page key) |
| `widgets` | Widget placeholder declarations per page type (e.g. `post: ["reading-progress","back-to-top","back-to-home"]`) |
| `assets` | Static assets copied to the site root as-is (e.g. giscus theme CSS, favicon) |

`resolveThemePaths` validates that `styles/{contract,fonts,layout}.css` and `styles/skins/<skin>.css` exist, and errors if any are missing.

## The --gb-* Token Contract

`contract.css` defines the fallback defaults for the full set of `--gb-*` tokens (color roles, surfaces, font families, spacing/sizing, code highlighting, shadows, layers, lightbox overlay, and so on). **A skin overrides only the subset that needs to change** (usually the color scheme and code highlighting), while pure sizing tokens inherit from the contract.

Rules:

- `layout.css` and skins **only use `--gb-*` tokens for colors/spacing**, with no hardcoded colors, keeping skinning controllable and light/dark consistent.
- Light/dark dual states: a skin's `:root` is the light baseline, and `.dark` overrides the dark values. `--gb-*` is re-resolved at use time, so prose body content and the like need no `dark:` variants.
- Shape / pure-sizing constants (such as hand-drawn corner-radius values) are not colors and may be given as local variables inside layout, without violating the "colors use tokens only" rule.

## Mechanism-Immutable Checklist (Must Not Break When Skinning)

A new theme changes only visuals; runtime scripts are maintained centrally by the project, and **themes no longer hold copies of mechanism scripts**:

- **Runtime script contract (in `src/runtime/`)**: `chrome/widgets/browse/app/archive/tag/dir/tags.js` depend on fixed mount-point ids, `window.gblog`/`window.__content`/`window.__data`/`window.__chrome`, `<html data-root>`, the `chrome:ready` event, and custom elements (`post-toc`/`reading-progress`/`back-to-top`/`back-to-home`). When a theme wants to replace a runtime script, it can override it by placing a same-named file under its own `assets/`.
- **Template mount points/placeholders**: `baseof`'s `{{lang}}/{{rootPrefix}}/{{> partial}}/{{widgets}}/{{scripts}}` and the hardcoded `chrome.js`; `header`'s `#site-logo/#site-nav/#nav-toggle/#rss-menu/#rss-toggle/#rss-links/#theme-toggle`; `footer`'s `#site-footer`; `main-list`'s `#page-title/#years/#map/#posts/#pager`; `main-post`'s `.post-article/.prose/<post-toc>/<!--content:start/end-->/{{content}}/{{comments}}`.
- **Mechanism classes**: `browse.js` produces `.post-card*`/`.post-meta`/`.tag.tag-link`/`.pager`; `widgets.js` selects `.post-article`/`.prose` and so on. These classes **may change visually, but their names must not be removed**.

## Steps to Add a Skin

1. Create a new `<skin>.css` under `themes/<name>/styles/skins/`, with `:root` + `.dark` overriding the `--gb-*` color subset.
2. Change `theme.skin` in `config/appearance.json` to that filename (without `.css`), or set it as the theme's `defaultSkin`.
3. Run `bun run preview:local` and visually verify both light and dark states.

## Steps to Add a Theme

1. Copy `themes/default` to `themes/<name>` (containing only `theme.json` + `styles/` + `templates/` + `assets/` theme assets, with no mechanism script copies).
2. Keep the templates (`templates/**`) as-is (preserve all mount points/placeholders/classes).
3. Rewrite `styles/layout.css` (using only `--gb-*`) and add `styles/skins/<skin>.css`; keep the full token set in `contract.css`, and adjust `fonts.css` as needed.
4. Point `theme.json`'s `defaultSkin` to your skin; keep the `mains/scripts/nav/widgets/assets` structure equivalent to default; `scripts` lists the runtime scripts used per page type (e.g. `["browse.js", "app.js"]`), resolved automatically from `src/runtime/` at build time.
5. (Optional) Theme-specific visual decoration: add `<theme>-<feat>.js` under `assets/`, and append that script to the corresponding page type in `theme.json.scripts`; cut in via MutationObserver/`customElements.whenDefined` to wait for the runtime output to appear.
6. (Optional) If the theme wants to override a runtime script: place a same-named file under `assets/` (e.g. `browse.js`); at build time the theme file takes priority, otherwise it inherits the runtime.
7. Change `theme.name` in `config/appearance.json`, and verify with `bun run preview:local`.

> CSS compilation: `buildCssEntry` inlines `fonts + contract + layout + skin` and hands it to Tailwind (v4 + the typography plugin), with `@source` pointing to the theme's `templates`/`assets` to preserve the utility classes in use.

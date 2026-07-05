// 客户端浏览页共享逻辑: 分片取数、卡片渲染、分页器、首页全局分页定位. 供 app/archive/tag/dir 复用.
// 数据改为按维度分片取 (data/years.json + data/year|tag|dir/<key>.json), 不再整份下载 posts.json.
// 仅输出语义类 (.post-card / .post-card-title / .post-meta / .tag / .tag-link / .pager).

// 本页相对站点根前缀 (列表页在根级, 一般为 ./); 供解析 data/ 与跨页链接.
function root() {
  return document.documentElement.getAttribute("data-root") || "./";
}

// 取 JSON, 失败兜底 fallback.
function getJson(url, fallback) {
  return fetch(url)
    .then((r) => (r.ok ? r.json() : fallback))
    .catch(() => fallback);
}

// 站点公开配置 (含 pagination). 优先消费 head 内联 kickoff 预取的 window.__data.site, 缺失自取.
function loadSite() {
  return (window.__data && window.__data.site) || getJson(root() + "site.json", {});
}
// 年份索引 [{year,count}] (降序). 优先消费 window.__data.years (home/archive 注入), 缺失自取.
function loadYearIndex() {
  return (window.__data && window.__data.years) || getJson(root() + "data/years.json", []);
}
// 标签/目录索引 [{name,slug,count}]. kind: "tag" | "dir".
function loadTaxonomyIndex(kind) {
  return getJson(root() + "data/" + (kind === "tag" ? "tags" : "dirs") + ".json", []);
}
// 单分片 ManifestEntry[]. kind: "year"|"tag"|"dir"; key: 年份或 slug(已 encodeURIComponent).
// key 再编码一次: 分片文件名字面含 % (slug=encodeURIComponent(name)), 经服务器对 URL 路径解码一次后
// 正好命中字面文件名; 对纯 ASCII 年份/标签为 no-op. 否则非 ASCII 标签/目录分片会 404.
function loadShard(kind, key) {
  return getJson(root() + "data/" + kind + "/" + encodeURIComponent(key) + ".json", []);
}

// 每页条数: site.pagination[view], 非正则回退 fallback.
function perPageOf(site, view, fallback) {
  const n = Number(site && site.pagination && site.pagination[view]);
  return n > 0 ? n : fallback;
}

// 设置站点标题 (文档标题 + 页头 #site-title, 若存在).
function applySiteTitle(site, suffix) {
  const base = (site && site.title) || "博客";
  document.title = suffix ? base + " - " + suffix : base;
  const el = document.getElementById("site-title");
  if (el) el.textContent = base;
}

// 当前 ?page=N (>=1).
function currentPage() {
  const p = parseInt(new URLSearchParams(location.search).get("page") || "1", 10);
  return Number.isFinite(p) && p >= 1 ? p : 1;
}

/**
 * 首页全局分页定位 (镜像领域纯函数 shardService.planTimelinePage).
 * 年份降序累加 count 定位覆盖全局区间 [(page-1)*perPage, page*perPage) 的年份.
 * @returns { years:[降序年份], start, end } 拼接后切片下标 [start,end)
 */
function planTimelinePage(yearIndex, page, perPage) {
  const sorted = yearIndex.slice().sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0));
  const total = sorted.reduce((s, y) => s + y.count, 0);
  const p = Math.max(1, page);
  const startGlobal = (p - 1) * perPage;
  if (startGlobal >= total) return { years: [], start: 0, end: 0 };
  const endGlobal = Math.min(startGlobal + perPage, total);
  const years = [];
  let acc = 0;
  let startInFirst = 0;
  for (const y of sorted) {
    const yStart = acc;
    const yEnd = acc + y.count;
    if (yEnd > startGlobal && yStart < endGlobal) {
      if (years.length === 0) startInFirst = startGlobal - yStart;
      years.push(y.year);
    }
    acc = yEnd;
    if (acc >= endGlobal) break;
  }
  return { years: years, start: startInFirst, end: startInFirst + (endGlobal - startGlobal) };
}

// 全站总条数 (年份索引求和).
function totalOf(yearIndex) {
  return yearIndex.reduce((s, y) => s + y.count, 0);
}

// 资产路径解析: 绝对 URL/协议相对/根路径/data: 原样; 相对路径 (如 post/<id>/x.webp) 加 root 前缀.
function resolveAsset(r, src) {
  return /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/)/.test(src) ? src : r + src;
}

// 渲染一篇文章卡片 (<li><article>...). url 含 <postDir>/ 前缀, 经 root 解析.
// 顺序: 标题 → 首图(标题下/正文上) → 摘要(正文) → meta(日期·阅读时长·字数·标签).
// 派生字段 (cover/summary/readingTime/words) 有则显示无则收起: 老文章无图不留空位.
function postCard(p) {
  const r = root();
  const li = document.createElement("li");
  const article = document.createElement("article");
  article.className = "post-card";
  const a = document.createElement("a");
  a.href = r + p.url;
  a.className = "post-card-main";

  const title = document.createElement("div");
  title.className = "post-card-title";
  title.textContent = p.title;
  a.appendChild(title);

  // 首图缩略: 标题下、正文(摘要)上; 绝对 URL 原样, 相对路径经 root 解析.
  if (p.cover) {
    const cover = document.createElement("img");
    cover.className = "post-card-cover";
    cover.src = resolveAsset(r, p.cover);
    cover.alt = "";
    cover.loading = "lazy";
    cover.decoding = "async";
    a.appendChild(cover);
  }

  // 摘要 (正文, 一到两行; CSS line-clamp 截断). 无摘要则回到紧凑形态.
  if (p.summary) {
    const summary = document.createElement("p");
    summary.className = "post-card-summary";
    summary.textContent = p.summary;
    a.appendChild(summary);
  }

  const meta = document.createElement("div");
  meta.className = "post-meta";
  const date = document.createElement("span");
  date.className = "post-card-date";
  date.textContent = (p.date || "").slice(0, 10);
  meta.appendChild(date);
  // 阅读时长 / 字数 (派生字段, 有则显示; 与文章页 meta 行一致风格).
  if (p.readingTime) {
    const rt = document.createElement("span");
    rt.className = "post-card-reading";
    rt.textContent = "约 " + p.readingTime + " 分钟";
    meta.appendChild(rt);
  }
  if (p.words) {
    const wd = document.createElement("span");
    wd.className = "post-card-words";
    wd.textContent = formatThousands(p.words) + " 字";
    meta.appendChild(wd);
  }
  for (const t of p.tags || []) {
    const tag = document.createElement("a");
    tag.className = "tag tag-link";
    tag.href = r + "tag.html?tag=" + encodeURIComponent(t);
    tag.textContent = "#" + t;
    meta.appendChild(tag);
  }
  article.appendChild(a);
  article.appendChild(meta);
  li.appendChild(article);
  return li;
}

// 千分位 (与文章页 meta 一致): 1234 -> 1,234
function formatThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 把文章数组渲染进指定 <ul>; 空时显示空态.
function renderList(listEl, posts, emptyText) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyText || "暂无内容";
    listEl.appendChild(empty);
    return;
  }
  for (const p of posts) listEl.appendChild(postCard(p));
}

// 分页器: 保留当前 query 其它参数, 仅改 page.
function renderPager(pagerEl, page, totalPages) {
  if (!pagerEl) return;
  pagerEl.innerHTML = "";
  const hrefFor = (target) => {
    const params = new URLSearchParams(location.search);
    params.set("page", String(target));
    return "?" + params.toString();
  };
  const mk = (label, target, disabled) => {
    const el = document.createElement(disabled ? "span" : "a");
    el.textContent = label;
    if (disabled) el.className = "disabled";
    else el.setAttribute("href", hrefFor(target));
    return el;
  };
  pagerEl.appendChild(mk("上一页", page - 1, page <= 1));
  const info = document.createElement("span");
  info.textContent = page + " / " + totalPages;
  pagerEl.appendChild(info);
  pagerEl.appendChild(mk("下一页", page + 1, page >= totalPages));
}

// 通用"切片 + 渲染 + 分页"流程 (用于单分片来源: 归档/标签/目录).
function paginateInto(listEl, pagerEl, posts, perPage, page, emptyText) {
  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
  const cur = Math.min(page, totalPages);
  const slice = posts.slice((cur - 1) * perPage, cur * perPage);
  renderList(listEl, slice, emptyText);
  renderPager(pagerEl, cur, totalPages);
}

// ---- SPA 同页导航 + 文章预取 (仅列表页; 渐进增强, 始终保留真实 <a href>) ----

// 串页防护令牌: render() 入口调用得一个 stale 检查器; await 取数后若期间又触发新导航则 stale()=true, 丢弃本次 DOM 写入.
let navSeq = 0;
function spaToken() {
  const token = ++navSeq;
  return function stale() {
    return token !== navSeq;
  };
}

// 纯判定: target 是否与当前页同 origin 同 pathname (仅查询串/无差异) -> 可原地重渲; 否则放行真跳转.
function isSamePageNav(currentHref, targetHref) {
  try {
    const cur = new URL(currentHref);
    const tgt = new URL(targetHref, currentHref);
    return cur.origin === tgt.origin && cur.pathname === tgt.pathname;
  } catch (e) {
    return false;
  }
}

/**
 * 列表页 SPA: document 级委托拦截同页导航 (翻页/换年/切目录/返回 map) -> preventDefault + pushState + render().
 * 渐进增强: 修饰键/中键/新标签/download/跨 pathname 一律放行浏览器原生行为. 注册一次, 跨重渲存活.
 * 滚动: 离开前 replaceState 存当前条目滚动位; popstate 后按 history.state 恢复; scrollRestoration=manual 自管.
 * @param render 各页幂等渲染函数 (读当前 URL 重渲)
 */
function enhanceSpa(render) {
  if (window.__spaOn) return; // 防重复注册
  window.__spaOn = true;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = e.target.closest && e.target.closest("a");
    if (!a) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;
    if (!isSamePageNav(location.href, a.href)) return; // 跨页类型: 放行真跳转
    e.preventDefault();
    history.replaceState({ scroll: window.scrollY }, ""); // 当前条目滚动位存入历史
    history.pushState({}, "", a.href);
    render();
    window.scrollTo(0, 0);
  });
  window.addEventListener("popstate", function () {
    Promise.resolve(render()).then(function () {
      window.scrollTo(0, (history.state && history.state.scroll) || 0);
    });
  });
}

window.gblog = {
  root,
  loadSite,
  loadYearIndex,
  loadTaxonomyIndex,
  loadShard,
  perPageOf,
  applySiteTitle,
  currentPage,
  planTimelinePage,
  totalOf,
  renderList,
  renderPager,
  paginateInto,
  spaToken,
  isSamePageNav,
  enhanceSpa,
};

// 目录页: 无 ?dir -> 读 data/dirs.json 索引渲染 map (列出全部目录, 可点击);
// 有 ?dir=X -> 读 data/dir/<slug>.json 分片 (slug=encodeURIComponent(dir)), 按 directory 分页.
// 幂等 render(): SPA 在 map<->list 间切换时, 入口须显式清空各容器, 否则返回链接堆叠 / 残留旧列表.
async function render() {
  const g = window.gblog;
  const stale = g.spaToken();
  const dir = new URLSearchParams(location.search).get("dir") || "";
  const site = await g.loadSite();

  const mapEl = document.getElementById("map");
  const postsEl = document.getElementById("posts");
  const pagerEl = document.getElementById("pager");
  const titleEl = document.getElementById("page-title");

  if (!dir) {
    // map 视图: 读目录索引 [{name,slug,count}].
    const index = await g.loadTaxonomyIndex("dir");
    if (stale()) return;
    // 切回 map: 清空上次列表视图残留的 posts/pager (map 自身由 renderMap 清空重填).
    if (postsEl) postsEl.innerHTML = "";
    if (pagerEl) pagerEl.innerHTML = "";
    g.applySiteTitle(site, "目录");
    if (titleEl) titleEl.textContent = "目录";
    renderMap(mapEl, index);
    return;
  }

  // 列表视图.
  const posts = await g.loadShard("dir", encodeURIComponent(dir));
  if (stale()) return;
  // 清空 map (避免上次的返回链接 / map 项堆叠); posts/pager 由 paginateInto 清空重填.
  if (mapEl) mapEl.innerHTML = "";
  g.applySiteTitle(site, dir);
  if (titleEl) titleEl.textContent = dir;
  if (mapEl) {
    const back = document.createElement("a");
    back.className = "back-link";
    back.href = g.root() + "dir.html";
    back.textContent = "← 全部目录";
    mapEl.appendChild(back);
  }

  const perPage = g.perPageOf(site, "directory", 10);
  g.paginateInto(postsEl, pagerEl, posts, perPage, g.currentPage(), "该目录下暂无文章");
}

// map: 每个目录一个可点击项 (名称 + 计数), 链接到 ?dir=name.
function renderMap(mapEl, index) {
  if (!mapEl) return;
  mapEl.innerHTML = "";
  if (!index.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无目录";
    mapEl.appendChild(empty);
    return;
  }
  for (const g of index) {
    const a = document.createElement("a");
    a.className = "dir-map-item";
    a.href = "./dir.html?dir=" + encodeURIComponent(g.name);
    const name = document.createElement("span");
    name.textContent = g.name;
    a.appendChild(name);
    const count = document.createElement("span");
    count.className = "dir-count";
    count.textContent = String(g.count);
    a.appendChild(count);
    mapEl.appendChild(a);
  }
}

render();
window.gblog.enhanceSpa(render);

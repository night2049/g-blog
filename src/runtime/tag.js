// 标签页: 读 ?tag=X, 取 data/tag/<slug>.json 分片 (slug=encodeURIComponent(tag)), 按 tag 分页.
// 幂等 render(): 每次读当前 URL 重渲 (paginateInto 本就清空容器).
async function render() {
  const g = window.gblog;
  const stale = g.spaToken();
  const tag = new URLSearchParams(location.search).get("tag") || "";
  const site = await g.loadSite();
  const posts = tag ? await g.loadShard("tag", encodeURIComponent(tag)) : [];
  if (stale()) return;

  g.applySiteTitle(site, tag ? "#" + tag : "标签");
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = tag ? "#" + tag : "标签";

  const perPage = g.perPageOf(site, "tag", 10);
  g.paginateInto(
    document.getElementById("posts"),
    document.getElementById("pager"),
    posts,
    perPage,
    g.currentPage(),
    "该标签下暂无文章",
  );
}

render();
window.gblog.enhanceSpa(render);

// 首页: 读 data/years.json, 按全局页码 (pagination.home) 经 planTimelinePage 取所需年份分片,
// 拼接切片渲染. 支持 ?page=N. 复用 browse.js 的卡片/分页渲染. 首页无标题 (#page-title 留空).
// 幂等 render(): 每次读当前 URL 重渲; SPA 翻页直接复用 (容器本就清空重填).
async function render() {
  const g = window.gblog;
  const stale = g.spaToken(); // 串页防护: await 后若已被新导航取代则丢弃本次渲染
  const [site, yearIndex] = await Promise.all([g.loadSite(), g.loadYearIndex()]);
  const perPage = g.perPageOf(site, "home", 10);
  const total = g.totalOf(yearIndex);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // 超界页码 clamp 到末页 (与归档/标签/目录列表页行为一致).
  const page = Math.min(g.currentPage(), totalPages);

  const plan = g.planTimelinePage(yearIndex, page, perPage);
  // 取覆盖该页的年份分片 (各分片已 date 倒序, 年份降序), 拼接后切片.
  const shards = await Promise.all(plan.years.map((y) => g.loadShard("year", y)));
  if (stale()) return;
  const slice = shards.reduce((acc, s) => acc.concat(s), []).slice(plan.start, plan.end);

  g.applySiteTitle(site);
  g.renderList(document.getElementById("posts"), slice, "暂无文章");
  g.renderPager(document.getElementById("pager"), page, totalPages);
}

render();
window.gblog.enhanceSpa(render);

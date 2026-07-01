// 年度归档: 顶部年份导航 (读 data/years.json, 含各年计数, 可点击切换), 下方展示选中年份分片.
// 选中年份取 ?year, 缺省为最新年; 年内按 archive 分页 (?year=Y&page=N).
// 幂等 render(): 每次读当前 URL 重渲; SPA 换年/翻页直接复用 (renderYearNav/paginateInto 本就清空容器).
async function render() {
  const g = window.gblog;
  const stale = g.spaToken();
  const [site, yearIndex] = await Promise.all([g.loadSite(), g.loadYearIndex()]);

  // 年份索引已降序; 容错再排一次.
  const years = yearIndex.slice().sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0));
  const param = new URLSearchParams(location.search).get("year");
  const selected = years.some((y) => y.year === param) ? param : (years[0] && years[0].year);

  const posts = selected ? await g.loadShard("year", selected) : [];
  if (stale()) return;

  g.applySiteTitle(site, "归档");
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = "归档";
  renderYearNav(document.getElementById("years"), years, selected);

  const perPage = g.perPageOf(site, "archive", 100);
  g.paginateInto(
    document.getElementById("posts"),
    document.getElementById("pager"),
    posts,
    perPage,
    g.currentPage(),
    "暂无文章",
  );
}

// 年份导航: 每年一个 .year-link (文案 "2026 (21)"), 当前年加 .active; 链接重置到该年第一页.
function renderYearNav(el, years, selected) {
  if (!el) return;
  el.innerHTML = "";
  for (const y of years) {
    const a = document.createElement("a");
    a.className = "year-link" + (y.year === selected ? " active" : "");
    a.href = "?year=" + encodeURIComponent(y.year);
    a.textContent = y.year + " (" + y.count + ")";
    el.appendChild(a);
  }
}

render();
window.gblog.enhanceSpa(render);

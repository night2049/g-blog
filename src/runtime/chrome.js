// 运行时外壳注入: 各页固定加载 (baseof 直接引用). 读 chrome.json 把外壳片段注入挂载点.
// 片段内的 %ROOT% 占位按本页 data-root 替换, 使不同目录深度的页面 (如 <postDir>/) 链接正确.
// 注入导航后派发 chrome:ready, 供 head 脚本重跑当前项高亮.
(function () {
  var root = document.documentElement.getAttribute("data-root") || "./";
  setupRssMenu(); // 下拉开合接线: 按钮为静态外壳, 与 chrome.json 取数无依赖, 可同步接线.
  setupNavMenu(); // 导航折叠 (移动端 ☰): 同上, 静态按钮同步接线.
  // 优先消费 head 内联 kickoff 预取的 chrome.json (window.__chrome); 缺失则自取 (健壮兜底).
  var pending =
    window.__chrome ||
    fetch(root + "chrome.json").then(function (r) {
      return r.ok ? r.json() : null;
    });
  pending
    .then(function (data) {
      if (!data) return;
      inject("site-logo", resolve(data.logo, root));
      inject("site-nav", resolve(data.nav, root));
      // footer 仅注入版权/备案; 注入前 .footer-line:empty 隐藏, 消除空分隔线闪现.
      inject("site-footer", resolve(data.footer, root));
      // RSS 链接改注入页头下拉面板; #rss-links 为空时整组由 CSS :has(:empty) 隐藏 (rss 关闭/无 formats).
      inject("rss-links", resolve(data.rssLinks, root));
      setText("site-title", data.siteTitle); // #site-title 文本 (不改本页 document.title)
      // 通知 head 脚本: 导航已就位, 重跑当前项高亮.
      document.dispatchEvent(new Event("chrome:ready"));
    })
    .catch(function () {
      /* 外壳获取失败: 正文仍可读, 静默 */
    });

  // 把片段内 %ROOT% 占位替换为本页相对根前缀.
  function resolve(html, prefix) {
    return (html || "").split("%ROOT%").join(prefix);
  }
  // 注入 HTML 片段到挂载点 (存在才注入).
  function inject(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  // 设置元素文本 (存在才设).
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el && text) el.textContent = text;
  }

  // RSS 下拉: 点击切换展开/收起; 点击面板外或按 Esc 关闭 (Esc 回焦按钮).
  // 面板内容由上方 inject("rss-links") 异步填充, 与本接线无依赖; #rss-links 为空时整组由 CSS 隐藏.
  function setupRssMenu() {
    var menu = document.getElementById("rss-menu");
    var btn = document.getElementById("rss-toggle");
    var panel = document.getElementById("rss-links");
    if (!menu || !btn || !panel) return;
    function close() {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      btn.setAttribute("aria-expanded", String(willOpen));
    });
    document.addEventListener("click", function (e) {
      if (!menu.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) {
        close();
        btn.focus();
      }
    });
  }

  // 导航折叠 (移动端): #nav-toggle 切 #site-nav 的 .is-open (桌面端 CSS 始终内联, 该类无副作用).
  // 按钮为静态外壳, 同步接线; 导航链接由本文件异步注入 #site-nav, 故点击关闭用事件委托.
  function setupNavMenu() {
    var btn = document.getElementById("nav-toggle");
    var nav = document.getElementById("site-nav");
    if (!btn || !nav) return;
    function close() {
      nav.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = !nav.classList.contains("is-open");
      nav.classList.toggle("is-open", willOpen);
      btn.setAttribute("aria-expanded", String(willOpen));
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) close();
    });
    document.addEventListener("click", function (e) {
      if (!nav.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        close();
        btn.focus();
      }
    });
  }
})();

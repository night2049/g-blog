// 文章页客户端部件 + giscus 懒加载. 第三方库 (tocbot/medium-zoom/sharer.js) 由 Bun.build 打包进本 IIFE.
// 各部件按 window.__content 开关门控 (模板注入); 文章页 (.post-article 存在) 才启用阅读类部件.
// giscus 懒加载逻辑保留不变. 文章页整页加载, DOMContentLoaded 后 init 一次, 无 SPA 重绑.
import tocbot from "tocbot";
import mediumZoom from "medium-zoom";
import "sharer.js"; // 副作用导入: 暴露 window.Sharer (对动态按钮用 Sharer.add 触发分享)

(function () {
  // 客户端开关 (缺省全开, 兜底); 由模板注入的 window.__content 覆盖.
  var flags = window.__content || {
    toc: true,
    tocMinHeadings: 2,
    tocCollapseBelow: 5,
    codeCopy: true,
    imageZoom: true,
    share: { enabled: true, networks: ["copy", "x", "telegram", "weibo"] },
    widgets: true,
  };

  registerWidgetStubs();

  // 评论 (giscus) 加载独立于部件: 只依赖挂载点存在, 不与阅读进度/TOC/FAB 等耦合
  // (本不该随部件改动; 此处显式拆开, 任何部件异常都不影响评论加载).
  onReady(setupGiscusLazyLoad);

  // 客户端部件: 文章页阅读类 (TOC/复制/灯箱/进度) + 列表与文章页 FAB.
  onReady(function () {
    var isArticle = !!document.querySelector(".post-article");
    var hasToc =
      isArticle && flags.toc
        ? initToc(flags.tocMinHeadings || 2, flags.tocCollapseBelow || 5)
        : false;
    if (isArticle && flags.codeCopy) initCodeCopy();
    if (isArticle && flags.imageZoom) initImageZoom();
    if (flags.widgets) initFabCluster(isArticle, hasToc);
    if (isArticle && flags.widgets) initReadingProgress();
  });

  function onReady(fn) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  // 注册空占位自定义元素 (无 shadow DOM, 仅为合法元素; 样式见 layout.css).
  function registerWidgetStubs() {
    if (!window.customElements) return;
    var names = ["post-toc", "reading-progress", "back-to-top", "back-to-home"];
    for (var i = 0; i < names.length; i++) {
      if (!customElements.get(names[i]))
        customElements.define(names[i], class extends HTMLElement {});
    }
  }

  // ---- 目录 TOC (tocbot): 锚定构建期注入的标题 id, 不足阈值不渲染 (返回 false -> 不出目录 FAB) ----
  // 填充后前置 .toc-head (PC 折叠态的展开开关 / 移动 sheet 标题); 条目少于 collapseBelow 标 few-entries,
  // 供 CSS 在 PC 端折叠 (移动端恒为浮层 sheet, 由目录 FAB 切换). 返回是否成功渲染目录.
  function initToc(minHeadings, collapseBelow) {
    var prose = document.querySelector(".prose");
    var toc = document.querySelector("post-toc");
    if (!prose || !toc) return false;
    if (prose.querySelectorAll("h1,h2,h3,h4,h5,h6").length < minHeadings) return false;
    try {
      tocbot.init({
        tocSelector: "post-toc",
        contentSelector: ".prose",
        headingSelector: "h1, h2, h3, h4, h5, h6",
        scrollSmooth: true,
        headingsOffset: 80,
        scrollSmoothOffset: -80,
        collapseDepth: 6,
      });
    } catch (e) {
      return false;
    }
    var count = toc.querySelectorAll(".toc-link").length;
    if (count === 0) {
      toc.innerHTML = ""; // 无命中条目: 清空, 由 :empty 隐藏
      return false;
    }
    // 前置标题/开关: PC 折叠态点击展开列表, 移动 sheet 作标题. 点击切 is-open.
    var head = document.createElement("button");
    head.type = "button";
    head.className = "toc-head";
    head.textContent = "目录";
    head.addEventListener("click", function () {
      toc.classList.toggle("is-open");
    });
    toc.insertBefore(head, toc.firstChild);
    if (count < (collapseBelow || 5)) toc.classList.add("few-entries");
    // 点目录内链接后收起浮层/折叠 (平滑滚动由 tocbot 处理).
    toc.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".toc-link")) toc.classList.remove("is-open");
    });
    return true;
  }

  // ---- 代码复制: 每个代码块右上角按钮, 原生 Clipboard API + 成功态 ----
  function initCodeCopy() {
    var pres = document.querySelectorAll(".post-article pre");
    for (var i = 0; i < pres.length; i++) addCopyButton(pres[i]);
  }
  function addCopyButton(pre) {
    if (pre.querySelector(".code-copy")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy";
    btn.textContent = "复制";
    btn.addEventListener("click", function () {
      var code = pre.querySelector("code");
      var text = code ? code.textContent : pre.textContent;
      copyText(text || "", function () {
        btn.textContent = "已复制";
        btn.classList.add("is-copied");
        setTimeout(function () {
          btn.textContent = "复制";
          btn.classList.remove("is-copied");
        }, 1500);
      });
    });
    pre.appendChild(btn);
  }

  // 复制文本: 优先 navigator.clipboard, 回退 execCommand.
  function copyText(text, onOk) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () {});
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onOk();
    } catch (e) {}
  }

  // ---- 图片灯箱 (medium-zoom): 遮罩色由 layout.css 的 --gb-zoom-overlay 覆盖 ----
  function initImageZoom() {
    var imgs = document.querySelectorAll(".prose img");
    if (!imgs.length) return;
    for (var i = 0; i < imgs.length; i++) imgs[i].setAttribute("data-zoomable", "");
    try {
      mediumZoom(imgs);
    } catch (e) {}
  }

  // ---- 阅读进度: 顶部细线, 宽度随滚动比例 (rAF 节流) ----
  function initReadingProgress() {
    var bar = document.querySelector("reading-progress");
    if (!bar) return;
    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var pct = max > 0 ? Math.min(100, ((doc.scrollTop || window.scrollY) / max) * 100) : 0;
      bar.style.width = pct + "%";
    }
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  // ---- 操作簇: 右下角按钮栈; 自上而下 目录(仅移动,有目录时) / 分享(文章) / 回首页 / 回顶部; 滚动超阈值浮现 ----
  function initFabCluster(isArticle, hasToc) {
    var cluster = document.createElement("div");
    cluster.className = "fab-cluster";

    // 目录 FAB: 仅文章且有目录时建; CSS 在 >=1280px 隐藏 (桌面用左栏目录). 点击切目录浮层 sheet.
    if (isArticle && hasToc) {
      var tocFab = makeFab("目录", svgList());
      tocFab.className = "fab fab-toc";
      tocFab.addEventListener("click", function (e) {
        e.stopPropagation();
        var toc = document.querySelector("post-toc");
        if (toc) toc.classList.toggle("is-open");
      });
      cluster.appendChild(tocFab);
      // 点浮层外部关闭 (与 share/RSS 菜单同模式); 点 FAB 自身经 stopPropagation 不触发.
      document.addEventListener("click", function (e) {
        var toc = document.querySelector("post-toc");
        if (
          toc &&
          toc.classList.contains("is-open") &&
          !toc.contains(e.target) &&
          !tocFab.contains(e.target)
        )
          toc.classList.remove("is-open");
      });
    }

    if (isArticle && flags.share && flags.share.enabled)
      cluster.appendChild(buildShare(flags.share.networks || []));

    var home = makeFab("回首页", svgHome());
    home.addEventListener("click", function () {
      var r = document.documentElement.getAttribute("data-root") || "./";
      location.href = r + "index.html";
    });
    cluster.appendChild(home);

    var top = makeFab("回顶部", svgTop());
    top.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    cluster.appendChild(top);

    document.body.appendChild(cluster);
    // 移除占位自定义元素, 避免与簇内按钮重复.
    var stubs = document.querySelectorAll("back-to-top, back-to-home");
    for (var i = 0; i < stubs.length; i++) stubs[i].remove();

    function toggle() {
      cluster.classList.toggle("is-visible", (window.scrollY || 0) > 300);
    }
    window.addEventListener("scroll", toggle, { passive: true });
    toggle();
  }

  // 分享按钮: 移动端优先 navigator.share; 否则弹各渠道菜单 (sharer.js 处理 URL, copy 用 Clipboard).
  function buildShare(networks) {
    var wrap = document.createElement("div");
    wrap.style.position = "relative";
    var btn = makeFab("分享", svgShare());
    wrap.appendChild(btn);
    var url = location.href;
    var title = document.title;
    var menu = null;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
        return;
      }
      if (!menu) menu = buildShareMenu(wrap, networks, url, title);
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", function () {
      if (menu) menu.hidden = true;
    });
    return wrap;
  }

  function buildShareMenu(wrap, networks, url, title) {
    var menu = document.createElement("div");
    menu.className = "share-menu";
    menu.hidden = true;
    for (var i = 0; i < networks.length; i++) {
      menu.appendChild(shareItem(networks[i], url, title));
    }
    wrap.appendChild(menu);
    return menu;
  }

  function shareItem(net, url, title) {
    var b = document.createElement("button");
    b.type = "button";
    if (net === "copy") {
      b.textContent = "复制链接";
      b.addEventListener("click", function () {
        copyText(url, function () {
          b.textContent = "已复制";
          setTimeout(function () {
            b.textContent = "复制链接";
          }, 1500);
        });
      });
    } else {
      b.textContent = shareLabel(net);
      b.setAttribute("data-sharer", net);
      b.setAttribute("data-url", url);
      b.setAttribute("data-title", title);
      b.addEventListener("click", function (ev) {
        if (window.Sharer) window.Sharer.add(ev);
      });
    }
    return b;
  }

  function shareLabel(net) {
    var map = {
      x: "X",
      twitter: "Twitter",
      telegram: "Telegram",
      weibo: "微博",
      facebook: "Facebook",
      linkedin: "LinkedIn",
      reddit: "Reddit",
      whatsapp: "WhatsApp",
      email: "邮件",
    };
    return map[net] || net;
  }

  // FAB 按钮: 圆形, aria-label, 内嵌 SVG (fill currentColor).
  function makeFab(label, svg) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fab";
    btn.setAttribute("aria-label", label);
    btn.innerHTML = svg;
    return btn;
  }
  function svgTop() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l8 8h-5v8h-6v-8H4z"/></svg>';
  }
  function svgHome() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3L2 12h3v8h5v-6h4v6h5v-8h3z"/></svg>';
  }
  function svgShare() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 00-2.3 1.1l-6-3.3a3 3 0 000-1.6l6-3.3A3 3 0 1015 6l-6 3.3a3 3 0 100 5.4l6 3.3A3 3 0 1018 16z"/></svg>';
  }
  function svgList() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>';
  }

  // ---- giscus 加载: 接近视口即早加载(IO), 并以 idle 兜底保证最终必加载 ----
  // 此前仅靠 IO(rootMargin 800px): 长文不滚到接近底部就不触发, 表现为"评论压根没加载".
  // 现加 requestIdleCallback/超时兜底: 页面空闲后无条件加载, 不再依赖滚动到底; 明暗切换仍由 head 脚本负责.
  function setupGiscusLazyLoad() {
    var mount = document.getElementById("giscus-mount");
    if (!mount) return;
    var done = false;
    var io = null;
    function go() {
      if (done) return;
      done = true;
      if (io) io.disconnect();
      loadGiscus(mount);
    }
    // 早加载: 接近视口即触发 (放宽到约 1.5 屏).
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              go();
              break;
            }
          }
        },
        { rootMargin: "1200px 0px" },
      );
      io.observe(mount);
    }
    // 兜底: 空闲后(或 2.5s 超时)无条件加载, 保证 client.js 请求必发, 不依赖滚动/文章长度.
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2500 });
    else setTimeout(go, 2000);
  }
  function loadGiscus(mount) {
    if (mount.dataset.loaded) return;
    mount.dataset.loaded = "1";
    var s = document.createElement("script");
    s.src = "https://giscus.app/client.js";
    s.crossOrigin = "anonymous";
    s.async = true;
    var attrs = mount.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      if (a.name.indexOf("data-") === 0 && a.name !== "data-loaded")
        s.setAttribute(a.name, a.value);
    }
    // 加载失败 (网络/被拦截) 兜底: 显示直达 GitHub Discussions 链接, 不静默空白.
    s.onerror = function () {
      if (mount.querySelector(".giscus-fallback")) return;
      var repo = mount.getAttribute("data-repo") || "";
      var link = document.createElement("a");
      link.className = "giscus-fallback";
      link.href = "https://github.com/" + repo + "/discussions";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "评论区加载失败, 点此前往 GitHub Discussions 参与讨论 →";
      mount.appendChild(link);
    };
    mount.appendChild(s);
  }
})();

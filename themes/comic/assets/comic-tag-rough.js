// comic 主题装饰脚本: 给 runtime tags.js 渲染出的 .tag-cloud-item 加 rough.js 手绘描边 SVG.
// 零侵入 runtime: MutationObserver 监听 #tag-cloud 内 chip 出现, 命中后先把首个文本节点包成
// <span class="tag-cloud-label"> (z-index 提升, 避免被 SVG 描边盖住), 再两层 rAF 等 layout 稳定
// 后量 chip 实际 W/H 渲染描边. 兜底: rough.js 异常静默回退到 CSS 默认描边, 不破坏视觉.
import rough from "roughjs/bundled/rough.esm.js";

(function () {
  var ROUGH_OPTS = {
    roughness: 1.4,
    bowing: 1.6,
    strokeWidth: 1.5,
  };

  function wrapLabel(chip) {
    if (chip.querySelector(".tag-cloud-label")) return;
    var first = chip.firstChild;
    if (!first || first.nodeType !== 3) return;
    var span = document.createElement("span");
    span.className = "tag-cloud-label";
    span.textContent = first.textContent || "";
    chip.replaceChild(span, first);
  }

  function drawRoughBg(chip, seed) {
    if (chip.querySelector(".rough-bg")) return;
    try {
      var w = chip.offsetWidth;
      var h = chip.offsetHeight;
      if (w < 4 || h < 4) return;
      var pad = 3; // 与 .rough-bg inset:-3px 对齐, 给抖线留余量
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "rough-bg");
      svg.setAttribute("width", String(w + pad * 2));
      svg.setAttribute("height", String(h + pad * 2));
      svg.setAttribute("viewBox", "0 0 " + (w + pad * 2) + " " + (h + pad * 2));
      var rc = rough.svg(svg);
      var stroke = getComputedStyle(chip).getPropertyValue("--gb-outline").trim() || "currentColor";
      var node = rc.rectangle(pad, pad, w, h, {
        roughness: ROUGH_OPTS.roughness,
        bowing: ROUGH_OPTS.bowing,
        strokeWidth: ROUGH_OPTS.strokeWidth,
        stroke: stroke,
        seed: seed * 131 + 7, // 每 chip 独立种子, 形状不雷同
      });
      svg.appendChild(node);
      chip.insertBefore(svg, chip.firstChild);
      chip.classList.add("is-rough");
    } catch (e) {
      /* rough.js 异常: 静默回退 CSS 默认描边 */
    }
  }

  function decorate(chips) {
    for (var i = 0; i < chips.length; i++) wrapLabel(chips[i]);
    // 双 rAF 等 layout 稳定 (单 rAF 在部分浏览器尚未完成 reflow).
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var j = 0; j < chips.length; j++) drawRoughBg(chips[j], j);
      });
    });
  }

  function scan() {
    var wrap = document.getElementById("tag-cloud");
    if (!wrap) return false;
    var chips = wrap.querySelectorAll(".tag-cloud-item");
    if (!chips.length) return false;
    decorate(chips);
    return true;
  }

  if (scan()) return; // 万一已渲染完
  // tags.js 异步 fetch + 渲染, 用 MutationObserver 等 chip 出现.
  // 兜底: DOMContentLoaded 后 #tag-cloud 容器若仍不存在 (非标签云页), 直接断开.
  function start() {
    var wrap = document.getElementById("tag-cloud");
    if (!wrap) return;
    var mo = new MutationObserver(function () {
      if (scan()) mo.disconnect();
    });
    mo.observe(wrap, { childList: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

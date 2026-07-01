// comic 主题装饰脚本: 给 widgets.js 生成的 FAB 内 SVG 加 ink-icon class.
// layout.css 的 .ink-icon { filter: url(#ink-wobble) } 由此触发手绘抖线滤镜.
// 零侵入 runtime: MutationObserver 监听 .fab-cluster .fab 出现, 命中即加 class,
// 同次首屏若已渲染则首扫覆盖, 全部加完后 observer 不停 (后续动态新增 FAB 也能命中).
(function () {
  function applyToSvg(svg) {
    if (!svg) return;
    if (!svg.classList.contains("ink-icon")) svg.classList.add("ink-icon");
  }
  function applyToFab(fab) {
    applyToSvg(fab.querySelector("svg"));
  }
  function scanAll(root) {
    var fabs = (root || document).querySelectorAll(".fab-cluster .fab");
    for (var i = 0; i < fabs.length; i++) applyToFab(fabs[i]);
  }
  scanAll(document);
  var mo = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (!n || n.nodeType !== 1) continue;
        if (n.matches && n.matches(".fab")) applyToFab(n);
        if (n.querySelectorAll) {
          var fs = n.querySelectorAll(".fab");
          for (var k = 0; k < fs.length; k++) applyToFab(fs[k]);
        }
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();

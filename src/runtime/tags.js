// 标签聚合页 (标签云): 读标签分片索引 (data/tags.json), 字号按文章数从小到大映射, 居中流式排布.
// 字号在 [--gb-tagcloud-min, --gb-tagcloud-max] 间按频次线性插值 (经 CSS calc, 尊重皮肤令牌).
// 依赖 browse.js 的 window.gblog (root/loadTaxonomyIndex); 优先消费 head 预取的 window.__data.tags.
(function () {
  var g = window.gblog;
  if (!g) return;

  function render(tags) {
    var wrap = document.getElementById("tag-cloud");
    var empty = document.getElementById("tag-cloud-empty");
    if (!wrap) return;
    wrap.innerHTML = "";
    var list = (tags || []).filter(function (t) {
      return t && t.count > 0;
    });
    if (!list.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    var r = g.root();
    for (var i = 0; i < list.length; i++) {
      wrap.appendChild(tagChip(list[i], r));
    }
  }

  // 全部统一样式与字号 (不再按频次缩放), 风格对齐站内 .tag: 标签名 + 计数.
  function tagChip(tag, r) {
    var a = document.createElement("a");
    a.className = "tag-cloud-item";
    a.href = r + "tag.html?tag=" + encodeURIComponent(tag.name);
    a.appendChild(document.createTextNode(tag.name));
    var count = document.createElement("span");
    count.className = "tag-cloud-count";
    count.textContent = tag.count;
    a.appendChild(count);
    return a;
  }

  var src = (window.__data && window.__data.tags) || g.loadTaxonomyIndex("tag");
  Promise.resolve(src).then(render).catch(function () {
    render([]);
  });
})();

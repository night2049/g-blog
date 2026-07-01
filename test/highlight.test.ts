import { test, expect, describe } from "bun:test";
import {
  decodeEntities,
  highlightCodeBlocks,
  createHighlighter,
} from "../src/domain/highlight.ts";

describe("decodeEntities", () => {
  test("解码 < > \" ' 且 &amp; 最后处理 (不双重解码)", () => {
    expect(decodeEntities("a &lt;b&gt; &quot;c&quot; &#39;d&#39;")).toBe(
      "a <b> \"c\" 'd'",
    );
    // &amp;lt; 表示作者写的字面 &lt;, 解码后应是 &lt; 而非 <
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });
});

describe("highlightCodeBlocks (纯管线, 注入 hl)", () => {
  test("带语言: 解码后传给 hl, 重组 class=hljs language-x", () => {
    const html =
      '<pre><code class="language-ts">const x = &lt;T&gt;();</code></pre>';
    const out = highlightCodeBlocks(html, (code, lang) => {
      expect(lang).toBe("ts");
      expect(code).toBe("const x = <T>();"); // 已解码为原始文本
      return "HL";
    });
    expect(out).toBe('<pre><code class="hljs language-ts">HL</code></pre>');
  });
  test("无语言: lang=null, class 只含 hljs", () => {
    const out = highlightCodeBlocks(
      "<pre><code>plain</code></pre>",
      (_c, lang) => {
        expect(lang).toBeNull();
        return "X";
      },
    );
    expect(out).toBe('<pre><code class="hljs">X</code></pre>');
  });
  test("非代码块内容原样保留", () => {
    const html = "<p>hello</p><pre><code>x</code></pre><p>bye</p>";
    const out = highlightCodeBlocks(html, () => "Y");
    expect(out).toBe('<p>hello</p><pre><code class="hljs">Y</code></pre><p>bye</p>');
  });
});

describe("createHighlighter (真实 hljs)", () => {
  test("ts 代码块高亮后含 hljs span 类", () => {
    const html =
      '<pre><code class="language-ts">const x: number = 1;</code></pre>';
    const out = createHighlighter().highlight(html);
    expect(out).toContain('class="hljs language-ts"');
    expect(out).toContain("hljs-keyword");
  });
  test("含 < & 的代码高亮后无双重转义 (不出现 &amp;lt;)", () => {
    const html =
      '<pre><code class="language-ts">const a = b &amp;&amp; c &lt; d;</code></pre>';
    const out = createHighlighter().highlight(html);
    expect(out).not.toContain("&amp;lt;");
    expect(out).not.toContain("&amp;amp;");
    // 原始 < 应以单层实体存在
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;&amp;");
  });
  test("无语言代码块回退 highlightAuto, 仍标记 hljs", () => {
    const out = createHighlighter().highlight(
      "<pre><code>def f():\n    return 1</code></pre>",
    );
    expect(out).toContain('class="hljs"');
  });
});

import { describe, expect, test } from "bun:test";
import katex from "katex";
import { sanitizeContentHtml } from "../src/domain/sanitize.ts";

describe("sanitizeContentHtml", () => {
  test("移除主动内容和事件属性, 保留安全 img", () => {
    const html = sanitizeContentHtml(
      '<script>alert(1)</script><img src="images/a.png" alt="a" onerror="alert(1)">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onerror");
    expect(html).toContain('<img src="images/a.png" alt="a" />');
  });

  test("移除 img 上的非图片协议和协议相对 URL", () => {
    const html = sanitizeContentHtml(
      [
        '<img src="mailto:a@example.com">',
        '<img src="tel:+123">',
        '<img src="//evil.example/a.png">',
        '<img src="javascript:alert(1)">',
        '<img src="./safe.png">',
        '<img src="https://example.com/safe.png">',
      ].join(""),
    );
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("//evil.example");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('src="./safe.png"');
    expect(html).toContain('src="https://example.com/safe.png"');
  });

  test("移除 javascript: href, 保留 https/mailto/tel/相对/hash 链接", () => {
    const html = sanitizeContentHtml(
      [
        '<a href="javascript:alert(1)">bad</a>',
        '<a href="https://example.com">https</a>',
        '<a href="mailto:a@example.com">mail</a>',
        '<a href="tel:+123">tel</a>',
        '<a href="./rel.html">rel</a>',
        '<a href="#top">hash</a>',
      ].join(""),
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<a>bad</a>");
    expect(html).toContain('<a href="https://example.com">https</a>');
    expect(html).toContain('<a href="mailto:a@example.com">mail</a>');
    expect(html).toContain('<a href="tel:+123">tel</a>');
    expect(html).toContain('<a href="./rel.html">rel</a>');
    expect(html).toContain('<a href="#top">hash</a>');
  });

  test('target="_blank" 补 noopener noreferrer 且保留已有 rel token', () => {
    const html = sanitizeContentHtml(
      '<a href="https://example.com" target="_blank" rel="nofollow">x</a>',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  test("保留 highlight.js 与 KaTeX 常用标签和 class", () => {
    const html = sanitizeContentHtml(
      [
        '<pre><code class="hljs language-ts"><span class="hljs-keyword">const</span></code></pre>',
        '<span class="katex"><span class="katex-html" aria-hidden="true"><span class="mord">x</span></span></span>',
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">x+1</annotation></semantics></math>',
      ].join(""),
    );
    expect(html).toContain('class="hljs language-ts"');
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
    expect(html).toContain("<semantics>");
    expect(html).toContain('<annotation encoding="application/x-tex">x+1</annotation>');
  });

  test("真实 KaTeX 输出保留安全布局 style, 丢弃非 KaTeX span style", () => {
    const raw = katex.renderToString("x_i^2", { throwOnError: false });
    const html = sanitizeContentHtml(raw + '<span style="height:999em">x</span>');
    expect(html).toContain('class="katex"');
    expect(html).toContain("style=");
    expect(html).not.toContain('<span style="height:999em">x</span>');
  });

  test("xmp/textarea/option/noscript 内容整段丢弃", () => {
    const html = sanitizeContentHtml(
      '<xmp><img src=x onerror=alert(1)></xmp><textarea><script>alert(2)</script></textarea><option>bad</option><noscript><img src=x onerror=alert(3)></noscript>',
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("bad");
  });
});

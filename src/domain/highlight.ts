// 构建期代码高亮: 对 Bun.markdown 输出的 <pre><code> 块用 highlight.js 着色.
// 关键: Bun.markdown 输出的代码内容已是 HTML 转义态 (&lt; &gt; &amp;), 而 hljs 期望
// 原始文本并会自行再转义. 故必须 先解码实体 -> hljs 高亮 -> 放回, 否则双重转义 (&amp;lt;).
import hljs from "highlight.js";
import type { Highlighter } from "./types.ts";

// 匹配 Bun.markdown 产出的代码块: <pre><code class="language-x">…</code></pre>
// 或无语言的 <pre><code>…</code></pre>. 代码内 < 已被转义为 &lt;, 不会误匹配闭合标签.
const CODE_BLOCK_RE =
  /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g;

// 解码 Bun.markdown 在代码块内产生的实体. &amp; 必须最后处理, 避免把 &amp;lt; 误解成 <.
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// 纯函数: 用注入的 hl(code, lang) 重写所有代码块. 便于在不依赖 hljs 的情况下单测管线.
// hl 接收已解码的原始代码, 须返回已转义的高亮 HTML.
export function highlightCodeBlocks(
  html: string,
  hl: (code: string, lang: string | null) => string,
): string {
  return html.replace(CODE_BLOCK_RE, (_m, lang: string | undefined, body) => {
    const raw = decodeEntities(body);
    const highlighted = hl(raw, lang ?? null);
    const cls = lang ? `hljs language-${lang}` : "hljs";
    return `<pre><code class="${cls}">${highlighted}</code></pre>`;
  });
}

// 真实高亮器: 已注册语言用指定语言, 未知/无语言回退 highlightAuto.
export function createHighlighter(): Highlighter {
  return {
    highlight(html) {
      return highlightCodeBlocks(html, (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      });
    },
  };
}

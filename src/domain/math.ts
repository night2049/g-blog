// KaTeX 渲前保护: 包裹 Markdown 端口. 在底层 render 前抽出 $…$ / $$…$$ 换占位 (排除围栏/行内代码),
// 渲染后用注入的 render(tex, display) 回填. 避免 markdown 吞掉 \ _ {} 等数学字符.
// 装配 (build.ts) 注入 katex.renderToString 作为 render; postService 不感知.

export interface MathToken {
  tex: string;
  display: boolean; // true=块级 $$, false=行内 $
}

// 私有区占位符 (PUA): markdown 不会改动, 渲染后可精确回填. 代码挖空用另一对 PUA.
const MATH_OPEN = "\uE000";
const MATH_CLOSE = "\uE001";
const CODE_OPEN = "\uE010";
const CODE_CLOSE = "\uE011";

function mathPlaceholder(i: number): string {
  return MATH_OPEN + i + MATH_CLOSE;
}

/**
 * 抽取 markdown 源中的数学公式换占位, 返回剥离后的 md 与 token 表.
 * 先把围栏代码块 (``` / ~~~) 与行内代码挖空, 防止其中的 $ 被误当公式; 抽完再还原代码.
 * @returns { md: 占位后的源, tokens: 公式表 (顺序即占位序号) }
 */
export function protectMath(md: string): { md: string; tokens: MathToken[] } {
  const tokens: MathToken[] = [];
  // 1. 挖空代码区 (围栏 + 行内), 避免内部 $ 被抽取.
  const codeStore: string[] = [];
  const stashCode = (s: string): string => {
    codeStore.push(s);
    return CODE_OPEN + (codeStore.length - 1) + CODE_CLOSE;
  };
  let masked = md
    .replace(/```[\s\S]*?```/g, stashCode)
    .replace(/~~~[\s\S]*?~~~/g, stashCode)
    .replace(/`+[^`\n]*`+/g, stashCode);

  // 2. 块级 $$…$$ 优先, 再行内 $…$ (行内: $ 后非空白、$ 前非空白、不跨行, 支持 \$ 转义).
  masked = masked.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
    tokens.push({ tex: tex.trim(), display: true });
    return mathPlaceholder(tokens.length - 1);
  });
  masked = masked.replace(
    /(?<![\\A-Za-z0-9])\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?![A-Za-z0-9])/g,
    (_m, tex: string) => {
      tokens.push({ tex: tex.trim(), display: false });
      return mathPlaceholder(tokens.length - 1);
    },
  );

  // 3. 还原代码占位.
  masked = masked.replace(
    new RegExp(CODE_OPEN + "(\\d+)" + CODE_CLOSE, "g"),
    (_m, i: string) => codeStore[Number(i)] ?? _m,
  );
  return { md: masked, tokens };
}

/**
 * 渲染后回填: 把占位替换为 render(tex, display) 的产物.
 * @param render 注入的数学渲染器 (装配层给 katex.renderToString); 须返回安全 HTML.
 */
export function restoreMath(
  html: string,
  tokens: MathToken[],
  render: (tex: string, display: boolean) => string,
): string {
  return html.replace(
    new RegExp(MATH_OPEN + "(\\d+)" + MATH_CLOSE, "g"),
    (_m, i: string) => {
      const t = tokens[Number(i)];
      return t ? render(t.tex, t.display) : _m;
    },
  );
}

import { test, expect, describe } from "bun:test";
import { protectMath, restoreMath } from "../src/domain/math.ts";

// 测试用渲染器: 不依赖 katex, 直观回填以验证占位/回填一一对应与 display 标志.
const fakeRender = (tex: string, display: boolean): string =>
  display ? `[D:${tex}]` : `[I:${tex}]`;

describe("protectMath", () => {
  test("抽取行内 $…$", () => {
    const { tokens } = protectMath("文字 $x+y$ 结尾");
    expect(tokens).toEqual([{ tex: "x+y", display: false }]);
  });

  test("抽取块级 $$…$$", () => {
    const { tokens } = protectMath("$$\\frac{a}{b}$$");
    expect(tokens).toEqual([{ tex: "\\frac{a}{b}", display: true }]);
  });

  test("代码块/行内代码内的 $ 不被抽取", () => {
    const fenced = "```\ncost = $5 + $x\n```";
    expect(protectMath(fenced).tokens).toEqual([]);
    const inline = "用 `$x$` 表示";
    expect(protectMath(inline).tokens).toEqual([]);
  });

  test("\\frac / _ / {} 在 token 中保真", () => {
    const { tokens } = protectMath("$$x_i^2 + \\frac{a}{b}$$");
    expect(tokens[0]!.tex).toBe("x_i^2 + \\frac{a}{b}");
  });

  test("无公式原样返回, tokens 空", () => {
    const { md, tokens } = protectMath("普通文字, 价格说明无 $ 符号");
    expect(tokens).toEqual([]);
    expect(md).toBe("普通文字, 价格说明无 $ 符号");
  });

  test("货币文本不被误判为行内公式", () => {
    expect(protectMath("价格$5和$10").tokens).toEqual([]);
    expect(protectMath("USD $5 and $10").tokens).toEqual([]);
  });

  test("正常行内公式仍识别", () => {
    expect(protectMath("这是 $x_i$ 公式").tokens).toEqual([
      { tex: "x_i", display: false },
    ]);
    expect(protectMath("$x+y$").tokens).toEqual([{ tex: "x+y", display: false }]);
  });

  test("转义美元不识别为公式", () => {
    expect(protectMath("\\$5").tokens).toEqual([]);
  });
});

describe("restoreMath (与 protectMath 一一对应)", () => {
  test("行内 + 块级混合: 占位回填正确且 display 标志正确", () => {
    const { md, tokens } = protectMath("$a$ 与 $$b$$");
    // 模拟 markdown 渲染 (占位为 PUA 字符, 渲染器原样保留)
    const html = "<p>" + md + "</p>";
    const out = restoreMath(html, tokens, fakeRender);
    expect(out).toBe("<p>[I:a] 与 [D:b]</p>");
  });

  test("无占位时原样返回", () => {
    expect(restoreMath("<p>无公式</p>", [], fakeRender)).toBe("<p>无公式</p>");
  });
});

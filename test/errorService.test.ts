import { test, expect, describe } from "bun:test";
import { errorPagesToWrite, renderErrorPage } from "../src/domain/errorService.ts";
import {
  fakeThemeProvider,
  fakeThemeManifest,
  fakeChrome,
  fixtureConfig,
} from "./fakes.ts";

describe("errorPagesToWrite", () => {
  test("默认 404/403/500", () => {
    expect(errorPagesToWrite(fixtureConfig())).toEqual([
      { file: "404.html", code: 404 },
      { file: "403.html", code: 403 },
      { file: "500.html", code: 500 },
    ]);
  });
  test("自定义码表", () => {
    const cfg = fixtureConfig();
    cfg.content.errorPages.codes = [404, 410];
    expect(errorPagesToWrite(cfg).map((p) => p.code)).toEqual([404, 410]);
  });
  test("空码表 -> 空数组", () => {
    const cfg = fixtureConfig();
    cfg.content.errorPages.codes = [];
    expect(errorPagesToWrite(cfg)).toEqual([]);
  });
  test("去重", () => {
    const cfg = fixtureConfig();
    cfg.content.errorPages.codes = [404, 404, 500];
    expect(errorPagesToWrite(cfg).map((p) => p.code)).toEqual([404, 500]);
  });
});

describe("renderErrorPage", () => {
  const manifest = fakeThemeManifest({
    mains: { ...fakeThemeManifest().mains, error: "main-error.html" },
  });
  const provider = fakeThemeProvider({
    "partials/main-error.html":
      '<section class="error-page"><div class="error-code">{{errorCode}}</div><p class="error-message">{{errorMessage}}</p><a class="error-home" href="{{rootPrefix}}index.html">返回首页</a></section>',
  });

  test("各码文案 + 超大码字 + 绝对返回链接 + 外壳挂载点", () => {
    const cfg = fixtureConfig(); // site.url = https://blog.example.com
    const html = renderErrorPage(404, provider, manifest, fakeChrome(), cfg);
    expect(html).toContain('class="error-code">404</div>');
    expect(html).toContain("页面走丢了");
    // 绝对根前缀: data-root 与返回首页链接均为绝对, 错误页在任意路径都不错位
    expect(html).toContain('data-root="https://blog.example.com/"');
    expect(html).toContain('href="https://blog.example.com/index.html">返回首页');
    expect(html).toContain('id="site-logo"'); // 外壳挂载点 (chrome.js 运行时填充)
  });

  test("未覆盖码用 default 文案", () => {
    const html = renderErrorPage(418, provider, manifest, fakeChrome(), fixtureConfig());
    expect(html).toContain("出错了");
  });

  test("无 site.url 时退回 / 根前缀", () => {
    const cfg = fixtureConfig();
    cfg.site.url = "";
    const html = renderErrorPage(404, provider, manifest, fakeChrome(), cfg);
    expect(html).toContain('data-root="/"');
    expect(html).toContain('href="/index.html">返回首页');
  });
});

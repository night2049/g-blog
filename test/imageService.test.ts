import { test, expect, describe } from "bun:test";
import {
  extractImageUrls,
  extractLocalImagePaths,
  hashLocalImage,
  hashUrl,
  processImages,
  processLocalImages,
  enhanceImages,
} from "../src/domain/imageService.ts";
import { memFileStore } from "./fakes.ts";
import type { ImageDownloader } from "../src/domain/types.ts";

describe("extractImageUrls", () => {
  test("提取远程 img, 去重, 跳过相对路径", () => {
    const html = `<img src="https://x/a.png"><img src="https://x/a.png"><img src="./local.png">`;
    expect(extractImageUrls(html)).toEqual(["https://x/a.png"]);
  });
});

describe("hashUrl", () => {
  test("同 URL 稳定, 不同 URL 不同", () => {
    expect(hashUrl("https://x/a")).toBe(hashUrl("https://x/a"));
    expect(hashUrl("https://x/a")).not.toBe(hashUrl("https://x/b"));
  });
});

// 计数下载器: 记录 download 调用次数, 验证判存跳过.
function countingDownloader(
  map: Record<string, { bytes: Uint8Array; ext: string }>,
): ImageDownloader & { calls: number } {
  const d = {
    calls: 0,
    download: async (url: string) => {
      d.calls++;
      return map[url] ?? null;
    },
  };
  return d;
}

describe("processImages (分文件夹 + 判存跳过)", () => {
  const b1 = new Uint8Array([1, 2, 3]);
  const b2 = new Uint8Array([9, 8]);
  const imgDir = "post/I_x";
  const relPrefix = "I_x/";

  test("下载并改写为 relPrefix 相对路径, 字节落 imgDir", async () => {
    const fs = memFileStore();
    const u = "https://x/a.png";
    const dl = countingDownloader({ [u]: { bytes: b1, ext: "png" } });
    const r = await processImages(`<img src="${u}" alt="a">`, {
      downloader: dl,
      fs,
      imgDir,
      relPrefix,
    });
    const name = `${hashUrl(u)}.png`;
    expect(r.html).toContain(`src="${relPrefix}${name}"`);
    expect(r.html).not.toContain(u);
    expect(fs.dumpBytes()[`${imgDir}/${name}`]).toEqual(b1);
    expect(dl.calls).toBe(1);
  });

  test("命中 fs.list 的 <hash>.* -> 不下载, 用真实文件名改写", async () => {
    const u = "https://x/a.png";
    const name = `${hashUrl(u)}.png`;
    // 预置该文章图片文件夹已有文件 (字节存在即代表已下载).
    const fs = memFileStore();
    fs.writeBytes(`${imgDir}/${name}`, b1);
    const dl = countingDownloader({ [u]: { bytes: b2, ext: "png" } });
    const r = await processImages(`<img src="${u}">`, {
      downloader: dl,
      fs,
      imgDir,
      relPrefix,
    });
    expect(dl.calls).toBe(0); // 判存跳过
    expect(r.html).toContain(`src="${relPrefix}${name}"`);
    expect(fs.dumpBytes()[`${imgDir}/${name}`]).toEqual(b1); // 未被覆盖
  });

  test("多图去重 + 不同图各写一次", async () => {
    const fs = memFileStore();
    const ua = "https://x/a.png";
    const ub = "https://x/b.jpg";
    const dl = countingDownloader({
      [ua]: { bytes: b1, ext: "png" },
      [ub]: { bytes: b2, ext: "jpg" },
    });
    const r = await processImages(
      `<img src="${ua}"><img src="${ua}"><img src="${ub}">`,
      { downloader: dl, fs, imgDir, relPrefix },
    );
    expect(r.assets.length).toBe(2);
    expect(Object.keys(fs.dumpBytes()).length).toBe(2);
    expect(dl.calls).toBe(2);
  });

  test("下载失败保留原链接, 不写任何全局 images.json", async () => {
    const fs = memFileStore();
    const u = "https://x/missing.png";
    const r = await processImages(`<img src="${u}">`, {
      downloader: countingDownloader({}),
      fs,
      imgDir,
      relPrefix,
    });
    expect(r.html).toContain(u);
    expect(r.assets).toEqual([]);
    expect(Object.keys(fs.dumpBytes()).length).toBe(0);
    expect("images.json" in fs.dump()).toBe(false);
  });

  test("只改真实 img src, 不改 a href 或正文文本中的同 URL", async () => {
    const fs = memFileStore();
    const u = "https://x/a.png";
    const dl = countingDownloader({ [u]: { bytes: b1, ext: "png" } });
    const r = await processImages(
      `<p>${u}</p><a href="${u}">原图</a><img src="${u}"><img src="${u}">`,
      { downloader: dl, fs, imgDir, relPrefix },
    );
    const name = `${hashUrl(u)}.png`;
    expect(r.html).toContain(`<p>${u}</p>`);
    expect(r.html).toContain(`<a href="${u}">`);
    expect((r.html.match(new RegExp(`src="${relPrefix}${name}"`, "g")) ?? []).length).toBe(2);
    expect(dl.calls).toBe(1);
  });
});

describe("processImages 尺寸汇出 (dims)", () => {
  const imgDir = "post/I_x";
  const relPrefix = "I_x/";
  const b1 = new Uint8Array([1, 2, 3]);

  test("新下载带尺寸 -> dims 记录(键为改写后相对 src); 判存命中/下载失败均不入 dims", async () => {
    const fs = memFileStore();
    const ua = "https://x/a.png"; // 新下载, downloader 带出尺寸
    const ub = "https://x/b.png"; // 下载失败
    const uc = "https://x/c.png"; // 判存命中 (预置文件)
    const nameC = `${hashUrl(uc)}.png`;
    fs.writeBytes(`${imgDir}/${nameC}`, b1);
    const dl: ImageDownloader = {
      download: async (url: string) =>
        url === ua ? { bytes: b1, ext: "png", width: 120, height: 80 } : null,
    };
    const r = await processImages(
      `<img src="${ua}"><img src="${ub}"><img src="${uc}">`,
      { downloader: dl, fs, imgDir, relPrefix },
    );
    const nameA = `${hashUrl(ua)}.png`;
    expect(r.dims[`${relPrefix}${nameA}`]).toEqual({ width: 120, height: 80 });
    expect(r.dims[`${relPrefix}${nameC}`]).toBeUndefined(); // 命中跳过下载
    expect(Object.keys(r.dims).length).toBe(1); // ub 失败不入
  });

  test("downloader 未带尺寸 -> dims 为空 (仍正常改写/落盘)", async () => {
    const fs = memFileStore();
    const u = "https://x/a.png";
    const dl: ImageDownloader = {
      download: async () => ({ bytes: b1, ext: "png" }),
    };
    const r = await processImages(`<img src="${u}">`, { downloader: dl, fs, imgDir, relPrefix });
    expect(Object.keys(r.dims).length).toBe(0);
    expect(r.html).toContain(`${relPrefix}${hashUrl(u)}.png`);
  });
});

describe("enhanceImages (纯函数, 幂等)", () => {
  test("首图仅 decoding (不加 loading); 后续图加 loading+decoding", () => {
    const out = enhanceImages('<img src="a.png"><p>x</p><img src="b.png">');
    const imgs = out.match(/<img[^>]*>/g)!;
    expect(imgs[0]).toContain('decoding="async"');
    expect(imgs[0]).not.toContain("loading");
    expect(imgs[1]).toContain('loading="lazy"');
    expect(imgs[1]).toContain('decoding="async"');
  });

  test("dims 命中补 width/height; 未命中不补", () => {
    const out = enhanceImages(
      '<img src="x/a.png"><img src="x/b.png">',
      { "x/a.png": { width: 100, height: 50 } },
    );
    const imgs = out.match(/<img[^>]*>/g)!;
    expect(imgs[0]).toContain('width="100"');
    expect(imgs[0]).toContain('height="50"');
    expect(imgs[1]).not.toContain("width=");
    expect(imgs[1]).not.toContain("height=");
  });

  test("已含 loading/width 的 img 保持不变 (幂等)", () => {
    const html =
      '<img loading="eager" width="10" height="10" decoding="sync" src="a.png">';
    expect(enhanceImages(html, { "a.png": { width: 100, height: 50 } })).toBe(html);
  });

  test("data-width 不被误判为 width (仍补 width/height)", () => {
    const out = enhanceImages('<img data-width="9" src="a.png">', {
      "a.png": { width: 100, height: 50 },
    });
    expect(out).toContain('width="100"');
    expect(out).toContain('height="50"');
  });

  test("无 <img> -> 原样返回", () => {
    expect(enhanceImages("<p>无图</p>")).toBe("<p>无图</p>");
  });
});

describe("extractLocalImagePaths", () => {
  test("仅收相对; 排除 http(s)/协议相对/根/data:; 去重", () => {
    const html = [
      '<img src="images/a.png">',
      '<img src="images/a.png">', // 去重
      '<img src="./b.jpg">',
      '<img src="https://x/c.png">', // 远程
      '<img src="//cdn/d.png">', // 协议相对
      '<img src="/root.png">', // 根绝对
      '<img src="data:image/png;base64,xxx">', // data
      '<img src="mailto:a@example.com">', // 非图片协议
      '<img src="tel:+123">', // 非图片协议
    ].join("");
    expect(extractLocalImagePaths(html)).toEqual(["images/a.png", "./b.jpg"]);
  });
  test("无 img -> []", () => {
    expect(extractLocalImagePaths("<p>无图</p>")).toEqual([]);
  });
});

// 本地图 reader: 按 relSrc -> {bytes,ext(,dims)} 映射; 未命中返回 null (模拟缺文件).
function fakeLocalReader(
  map: Record<
    string,
    {
      bytes: Uint8Array;
      ext: string;
      width?: number;
      height?: number;
      sourceBytes?: Uint8Array;
      sourceExt?: string;
    }
  >,
): ImageDownloader & { calls: number } {
  const r = {
    calls: 0,
    download: async (relSrc: string) => {
      r.calls++;
      const hit = map[relSrc];
      return hit
        ? {
            ...hit,
            sourceBytes: hit.sourceBytes ?? hit.bytes,
            sourceExt: hit.sourceExt ?? hit.ext,
          }
        : null;
    },
  };
  return r;
}

describe("processLocalImages (本地相对图)", () => {
  const imgDir = "post/abc123";
  const relPrefix = "abc123/";
  const b1 = new Uint8Array([1, 2, 3]);
  const b2 = new Uint8Array([4, 5]);

  test("相对图读盘改写 + dims; 不触远程图", async () => {
    const fs = memFileStore();
    const reader = fakeLocalReader({
      "images/a.png": { bytes: b1, ext: "png", width: 200, height: 100 },
    });
    const html = '<img src="images/a.png"><img src="https://x/remote.png">';
    const r = await processLocalImages(html, { reader, fs, imgDir, relPrefix });
    const name = `${hashLocalImage(b1, "png")}.png`;
    expect(r.html).toContain(`src="${relPrefix}${name}"`);
    expect(r.html).toContain('src="https://x/remote.png"'); // 远程图原样保留
    expect(fs.dumpBytes()[`${imgDir}/${name}`]).toEqual(b1);
    expect(r.dims[`${relPrefix}${name}`]).toEqual({ width: 200, height: 100 });
    expect(reader.calls).toBe(1); // 远程图不进本通道
  });

  test("判存跳过: imgDir 已有内容 hash 命中时不重复写入, 仍保留尺寸", async () => {
    const fs = memFileStore();
    const name = `${hashLocalImage(b1, "png")}.png`;
    fs.writeBytes(`${imgDir}/${name}`, b1);
    const reader = fakeLocalReader({
      "images/a.png": {
        bytes: b2,
        ext: "png",
        sourceBytes: b1,
        sourceExt: "png",
        width: 320,
        height: 180,
      },
    });
    const r = await processLocalImages('<img src="images/a.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
    });
    expect(reader.calls).toBe(1);
    expect(r.html).toContain(`src="${relPrefix}${name}"`);
    expect(fs.dumpBytes()[`${imgDir}/${name}`]).toEqual(b1); // 未覆盖
    expect(r.dims[`${relPrefix}${name}`]).toEqual({ width: 320, height: 180 });
  });

  test("判存必须精确到输出扩展名, 不用同 hash 旧扩展误命中", async () => {
    const fs = memFileStore();
    const hash = hashLocalImage(b1, "png");
    fs.writeBytes(`${imgDir}/${hash}.png`, b1);
    const reader = fakeLocalReader({
      "images/a.png": { bytes: b2, ext: "webp", sourceBytes: b1, sourceExt: "png" },
    });
    const r = await processLocalImages('<img src="images/a.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
    });
    expect(r.html).toContain(`src="${relPrefix}${hash}.webp"`);
    expect(fs.dumpBytes()[`${imgDir}/${hash}.png`]).toEqual(b1);
    expect(fs.dumpBytes()[`${imgDir}/${hash}.webp`]).toEqual(b2);
  });

  test("reader 返回 null (缺文件) 保留原链接", async () => {
    const fs = memFileStore();
    const reader = fakeLocalReader({});
    const r = await processLocalImages('<img src="missing.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
    });
    expect(r.html).toContain('src="missing.png"');
    expect(r.assets).toEqual([]);
    expect(Object.keys(fs.dumpBytes()).length).toBe(0);
  });

  test("定向替换: 仅改 <img src>, 不误伤正文同名子串", async () => {
    const fs = memFileStore();
    const reader = fakeLocalReader({ "a.png": { bytes: b1, ext: "png" } });
    const html = '<p>引用 a.png 文件</p><img src="a.png">';
    const r = await processLocalImages(html, { reader, fs, imgDir, relPrefix });
    expect(r.html).toContain("<p>引用 a.png 文件</p>"); // 正文未被改写
    expect(r.html).toContain(`src="${relPrefix}${hashLocalImage(b1, "png")}.png"`);
  });

  test("reader 缺 sourceBytes/sourceExt 时 fail closed 保留原链接", async () => {
    const fs = memFileStore();
    const reader: ImageDownloader = {
      download: async () => ({ bytes: b1, ext: "png" }),
    };
    const r = await processLocalImages('<img src="a.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
    });
    expect(r.html).toContain('src="a.png"');
    expect(r.assets).toEqual([]);
    expect(Object.keys(fs.dumpBytes()).length).toBe(0);
  });

  test("同一路径不同源字节生成不同文件名", async () => {
    const name1 = `${hashLocalImage(b1, "png")}.png`;
    const name2 = `${hashLocalImage(b2, "png")}.png`;
    expect(name1).not.toBe(name2);
  });

  test("同源字节命中缓存不覆盖既有文件", async () => {
    const fs = memFileStore();
    const name = `${hashLocalImage(b1, "png")}.png`;
    fs.writeBytes(`${imgDir}/${name}`, b1);
    const reader = fakeLocalReader({
      "same.png": { bytes: b2, ext: "png", sourceBytes: b1, sourceExt: "png" },
    });
    const r = await processLocalImages('<img src="same.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
    });
    expect(reader.calls).toBe(1);
    expect(r.html).toContain(`src="${relPrefix}${name}"`);
    expect(fs.dumpBytes()[`${imgDir}/${name}`]).toEqual(b1);
  });

  test("webp quality 变化会生成不同文件名", async () => {
    const fs = memFileStore();
    const reader = fakeLocalReader({ "a.png": { bytes: b1, ext: "webp", sourceBytes: b1, sourceExt: "png" } });
    const r80 = await processLocalImages('<img src="a.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
      webp: { enabled: true, quality: 80 },
    });
    const r90 = await processLocalImages('<img src="a.png">', {
      reader,
      fs,
      imgDir,
      relPrefix,
      webp: { enabled: true, quality: 90 },
    });
    expect(r80.html).toContain(`${hashLocalImage(b1, "png", { enabled: true, quality: 80 })}.webp`);
    expect(r90.html).toContain(`${hashLocalImage(b1, "png", { enabled: true, quality: 90 })}.webp`);
    expect(r80.html).not.toBe(r90.html);
  });
});

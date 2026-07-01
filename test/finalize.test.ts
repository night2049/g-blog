import { test, expect, describe } from "bun:test";
import { finalizeContent } from "../src/domain/finalize.ts";
import { hashUrl } from "../src/domain/imageService.ts";
import { memFileStore } from "./fakes.ts";
import type { ImageDownloader } from "../src/domain/types.ts";

// reader: 按 relSrc 返回字节; 远程 downloader: 按 url 返回字节. 未命中 null.
function reader(map: Record<string, { bytes: Uint8Array; ext: string; width?: number; height?: number }>): ImageDownloader {
  return { download: async (s) => map[s] ?? null };
}

describe("finalizeContent (本地图通道扩展)", () => {
  const imgDir = "post/nid";
  const relPrefix = "nid/";
  const bytes = new Uint8Array([1, 2, 3]);

  test("传 localImages 时本地相对图进管线并改写 + 补尺寸", async () => {
    const fs = memFileStore();
    const localImages = reader({
      "img/a.png": { bytes, ext: "png", width: 300, height: 150 },
    });
    const { html } = await finalizeContent('<img src="img/a.png">', {
      fs,
      imgDir,
      relPrefix,
      localImages,
    });
    const name = `${hashUrl("img/a.png")}.png`;
    expect(html).toContain(`src="${relPrefix}${name}"`);
    expect(html).toContain('width="300"');
    expect(html).toContain('height="150"');
    expect(fs.dumpBytes()[`${imgDir}/${name}`]).toEqual(bytes);
  });

  test("不传 localImages 时本地相对图 no-op (原样保留)", async () => {
    const fs = memFileStore();
    const { html } = await finalizeContent('<img src="img/a.png">', {
      fs,
      imgDir,
      relPrefix,
    });
    expect(html).toContain('src="img/a.png"'); // 未改写
    expect(Object.keys(fs.dumpBytes()).length).toBe(0);
  });

  test("本地图先行: 远程图改写产物不被本地通道误扫", async () => {
    const fs = memFileStore();
    const localImages = reader({ "local/a.png": { bytes, ext: "png" } });
    const images = reader({ "https://x/r.png": { bytes, ext: "png" } });
    const { html } = await finalizeContent(
      '<img src="local/a.png"><img src="https://x/r.png">',
      { fs, imgDir, relPrefix, localImages, images },
    );
    expect(html).toContain(`src="${relPrefix}${hashUrl("local/a.png")}.png"`);
    expect(html).toContain(`src="${relPrefix}${hashUrl("https://x/r.png")}.png"`);
  });
});

describe("finalizeContent (assets 透传, 供 full 孤儿回收)", () => {
  const imgDir = "post/nid";
  const relPrefix = "nid/";
  const bytes = new Uint8Array([1, 2, 3]);

  test("本地图落盘路径进 assets", async () => {
    const fs = memFileStore();
    const localImages = reader({ "img/a.png": { bytes, ext: "png" } });
    const { assets } = await finalizeContent('<img src="img/a.png">', {
      fs,
      imgDir,
      relPrefix,
      localImages,
    });
    expect(assets).toContain(`${imgDir}/${hashUrl("img/a.png")}.png`);
  });

  test("远程图与本地图 assets 合并", async () => {
    const fs = memFileStore();
    const localImages = reader({ "local/a.png": { bytes, ext: "png" } });
    const images = reader({ "https://x/r.png": { bytes, ext: "png" } });
    const { assets } = await finalizeContent(
      '<img src="local/a.png"><img src="https://x/r.png">',
      { fs, imgDir, relPrefix, localImages, images },
    );
    expect(assets).toContain(`${imgDir}/${hashUrl("local/a.png")}.png`);
    expect(assets).toContain(`${imgDir}/${hashUrl("https://x/r.png")}.png`);
    expect(assets.length).toBe(2);
  });

  test("判存命中也计入 assets (复用图不会被当孤儿误删)", async () => {
    const fs = memFileStore();
    const name = `${hashUrl("img/a.png")}.png`;
    fs.writeBytes(`${imgDir}/${name}`, bytes); // 预置: 模拟上次已下载
    const localImages = reader({ "img/a.png": { bytes, ext: "png" } });
    const { assets } = await finalizeContent('<img src="img/a.png">', {
      fs,
      imgDir,
      relPrefix,
      localImages,
    });
    expect(assets).toContain(`${imgDir}/${name}`); // 命中跳过下载, 仍记入
  });
});

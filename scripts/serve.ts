// 本地预览静态服务器: 用 Bun 内置 Bun.serve 把构建产物目录 (默认 _preview) 通过 HTTP 提供,
// 解决站点重客户端渲染 (browse.js fetch data/*.json、chrome.js fetch chrome.json) 在 file:// 下
// 因 CORS 拉不到 JSON 的问题, 形成"本地写作 -> 预览"闭环。不引第三方依赖, 仅用 Bun.serve / Bun.file。
//
// 参数 (CLI 优先于环境变量, 环境变量优先于默认值):
//   --root <dir>  站点根目录, 默认 "_preview"; 亦可由环境变量 PREVIEW_ROOT 覆盖。
//   --port <n>    监听端口, 默认 3000; 亦可由环境变量 PORT 覆盖。
//
// 行为:
//   - 请求映射: URL path -> <root>/<path>; path 为 "/" 或以 "/" 结尾的目录 -> 该目录下 index.html。
//   - 命中文件用 Bun.file 直接返回 (Bun.serve 自动设 Content-Type 与流式传输)。
//   - 404: 文件不存在返回 404; 若站点根存在 404.html 则回退返回其内容 (贴近线上 Pages), 状态码仍为 404。
//   - 安全: 路径经 decodeURIComponent 后做越界判定, 解析结果必须仍在 root 内 (防 ".." 越界与绝对路径逃逸),
//           越界返回 400。
import { join, resolve, sep } from "node:path";

const DEFAULT_ROOT = "_preview";
const DEFAULT_PORT = 3000;

// 纯函数: 把 URL path 解析为站点根内的绝对文件路径, 越界 (".." 逃逸或绝对路径注入) 返回 null。
// 先 decodeURIComponent 再判定, 避免 %2e%2e / %2f 等编码绕过越界检查。
// 入参 root 可为相对或绝对路径, 内部统一 resolve 为绝对路径后比较。
// 返回值: 站点根内的绝对路径 (目录请求已拼接 index.html); 解码失败或越界返回 null。
export function resolvePreviewPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // 非法百分号编码 (如孤立的 "%")
  }
  if (decoded.includes("\0")) return null; // 拒绝空字节注入

  // 目录请求 ("/" 或以 "/" 结尾) 映射到该目录下的 index.html。
  let rel = decoded;
  if (rel === "" || rel === "/" || rel.endsWith("/")) {
    rel += "index.html";
  }
  // 去掉前导斜杠, 使其作为相对 root 的路径; resolve 会归一化内部的 "." / ".."。
  const relClean = rel.replace(/^\/+/, "");

  const rootResolved = resolve(root);
  const targetResolved = resolve(rootResolved, relClean);
  // 越界判定: 目标必须等于 root 自身或位于 root 子树内 (拼 sep 防 "_previewX" 这类前缀误判)。
  if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + sep)) {
    return null;
  }
  return targetResolved;
}

// 解析命令行与环境变量, 得到 root 与 port。CLI 覆盖环境变量, 环境变量覆盖默认值。
function parseArgs(argv: string[]): { root: string; port: number } {
  let root = process.env.PREVIEW_ROOT ?? DEFAULT_ROOT;
  let port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && i + 1 < argv.length) {
      root = argv[++i]!;
    } else if (arg === "--port" && i + 1 < argv.length) {
      port = Number(argv[++i]);
    }
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("[serve] 非法端口: " + port);
  }
  return { root, port };
}

function startServer(argv: string[]): void {
  const { root, port } = parseArgs(argv);
  const rootResolved = resolve(root);

  const server = Bun.serve({
    port,
    async fetch(req): Promise<Response> {
      const { pathname } = new URL(req.url);
      const filePath = resolvePreviewPath(rootResolved, pathname);
      if (filePath === null) {
        console.warn("[serve] 拦截越界请求 -> " + pathname);
        return new Response("400 Bad Request", { status: 400 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      // 回退到站点根 404.html (若存在), 贴近线上 Pages 行为; 状态码仍为 404。
      const notFound = Bun.file(join(rootResolved, "404.html"));
      if (await notFound.exists()) {
        console.log("[serve] 404 (回退 404.html) -> " + pathname);
        return new Response(notFound, { status: 404 });
      }
      console.log("[serve] 404 -> " + pathname);
      return new Response("404 Not Found", { status: 404 });
    },
  });

  console.log(
    "[serve] 预览服务已启动 -> http://localhost:" + server.port + " (根目录: " + root + ")",
  );
}

// 仅在作为入口直接运行时启动服务; 被测试 import 时不启动, 避免常驻进程阻塞 bun test。
if (import.meta.main) {
  startServer(process.argv.slice(2));
}

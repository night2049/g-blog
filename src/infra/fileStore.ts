// 以 baseDir 为根的文件读写适配器. 所有 rel 路径相对 baseDir. read 去除可能的 UTF-8 BOM.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import type { FileStore } from "../domain/types.ts";

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function nearestExisting(path: string): string {
  let cur = path;
  while (!existsSync(cur)) {
    const next = dirname(cur);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

export function safeResolve(baseDir: string, rel: string): string {
  if (typeof rel !== "string") throw new Error("路径必须为字符串");
  if (rel.includes("\0")) throw new Error("路径不得含 NUL 字符: " + rel);
  if (rel.includes("\\")) throw new Error("路径不得含反斜杠: " + rel);
  if (isAbsolute(rel)) throw new Error("路径必须为相对路径: " + rel);

  const root = resolve(baseDir);
  const target = resolve(root, rel || ".");
  if (!within(root, target)) throw new Error("路径越界: " + rel);

  const realRoot = existsSync(root) ? realpathSync(root) : root;
  if (existsSync(target)) {
    const realTarget = realpathSync(target);
    if (!within(realRoot, realTarget)) throw new Error("路径 realpath 越界: " + rel);
  } else {
    const parent = nearestExisting(dirname(target));
    if (existsSync(parent)) {
      const realParent = realpathSync(parent);
      if (!within(realRoot, realParent)) throw new Error("路径父目录 realpath 越界: " + rel);
    }
  }
  return target;
}

export function createFileStore(baseDir: string): FileStore {
mkdirSync(resolve(baseDir), { recursive: true });
const abs = (rel: string): string => safeResolve(baseDir, rel);
const ensureDir = (p: string): void => { mkdirSync(dirname(p), { recursive: true }); };
return {
read(rel) { const p = abs(rel); return existsSync(p) ? readFileSync(p, "utf8").replace(/^\uFEFF/, "") : null; },
write(rel, content) { const p = abs(rel); ensureDir(p); writeFileSync(p, content, "utf8"); },
writeBytes(rel, bytes) { const p = abs(rel); ensureDir(p); writeFileSync(p, bytes); },
remove(rel) { const p = abs(rel); if (existsSync(p)) rmSync(p); },
exists(rel) { return existsSync(abs(rel)); },
copyInto(srcAbs, rel) { const p = abs(rel); ensureDir(p); copyFileSync(srcAbs, p); },
list(dir) { const p = abs(dir); return existsSync(p) ? readdirSync(p) : []; },
listAll(dir) {
  const root = abs(dir);
  if (!existsSync(root)) return [];
  const realRoot = realpathSync(root);
  const out: string[] = [];
  const base = dir.replace(/\/+$/, "");
  const walk = (curAbs: string, relPrefix: string): void => {
    for (const ent of readdirSync(curAbs, { withFileTypes: true })) {
      const childRel = relPrefix ? relPrefix + "/" + ent.name : ent.name;
      const childAbs = join(curAbs, ent.name);
      if (ent.isDirectory()) {
        if (within(realRoot, realpathSync(childAbs))) walk(childAbs, childRel);
      }
      else out.push(childRel);
    }
  };
  walk(root, base);
  return out;
},
clearExcept(keep) {
  const root = abs("");
  if (!existsSync(root)) return;
  const keepSet = new Set(keep);
  for (const name of readdirSync(root)) {
    if (keepSet.has(name)) continue;
    const target = abs(name);
    rmSync(target, { recursive: true, force: true });
  }
},
};
}

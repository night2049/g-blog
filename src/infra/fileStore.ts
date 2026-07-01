// 以 baseDir 为根的文件读写适配器. 所有 rel 路径相对 baseDir. read 去除可能的 UTF-8 BOM.
import { existsSync, readFileSync, writeFileSync, rmSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { FileStore } from "../domain/types.ts";

export function createFileStore(baseDir: string): FileStore {
const abs = (rel: string): string => join(baseDir, rel);
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
  const out: string[] = [];
  const base = dir.replace(/\/+$/, "");
  const walk = (curAbs: string, relPrefix: string): void => {
    for (const ent of readdirSync(curAbs, { withFileTypes: true })) {
      const childRel = relPrefix ? relPrefix + "/" + ent.name : ent.name;
      if (ent.isDirectory()) walk(join(curAbs, ent.name), childRel);
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
    rmSync(join(root, name), { recursive: true, force: true });
  }
},
};
}

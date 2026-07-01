// 模板提供者适配器: 从指定目录按名读取模板文件. 实现 TemplateProvider 端口.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TemplateProvider } from "../domain/types.ts";

export function createTemplateProvider(dir: string): TemplateProvider {
  return {
    read(name: string): string {
      return readFileSync(join(dir, name), "utf8");
    },
  };
}

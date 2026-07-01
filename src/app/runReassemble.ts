// 重组编排: 调 reassembleAll (本地重组, 不触 GitHub/不渲 Markdown) 并打印汇总.
import { reassembleAll } from "../domain/reassembleService.ts";
import type { ReassembleDeps } from "../domain/reassembleService.ts";

export async function runReassemble(deps: ReassembleDeps): Promise<void> {
  const r = reassembleAll(deps);
  console.log(
    "[重组] 完成: 重写 " + r.rewritten + ", 跳过 " + r.skipped + ", 告警 " + r.warned,
  );
}


import type { Markdown } from "../domain/types.ts";

export function createMarkdown(): Markdown {
  return {
    render(md: string): string {
      return Bun.markdown.html(md);
    },
  };
}

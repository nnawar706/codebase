import type { FileNode } from "@/parser/types";
import { TypeSwatch, extensionOf } from "./FileType";

export function CategoryRail({ files }: { files: readonly Pick<FileNode, "path">[] }) {
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = extensionOf(f.path);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1));

  return (
    <ul className="flex flex-col">
      {rows.map(([ext, count]) => (
        <li key={ext} className="flex h-6 items-center gap-2 px-3">
          <TypeSwatch ext={ext} />
          <span className="truncate font-mono">{ext}</span>
          <span className="ml-auto text-muted tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  );
}

import { countByCategory } from "@/lib/map/category";
import type { FileNode } from "@/parser/types";
import { TypeSwatch } from "./FileType";

export function CategoryRail({ files }: { files: readonly Pick<FileNode, "path">[] }) {
  const rows = countByCategory(files.map((f) => f.path));

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

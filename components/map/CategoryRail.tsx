import { countByCategory } from "@/lib/map/category";
import type { FileNode } from "@/parser/types";
import { TypeSwatch } from "./FileType";

// Picking a category dims the rest of the map rather than removing it, so the
// shape of the whole repository stays on screen. Picking it again clears it.
export function CategoryRail({
  files,
  active,
  onPick,
}: {
  files: readonly Pick<FileNode, "path">[];
  active: string | null;
  onPick: (category: string | null) => void;
}) {
  const rows = countByCategory(files.map((f) => f.path));

  return (
    <ul className="flex flex-col">
      {rows.map(([ext, count]) => (
        <li key={ext}>
          <button
            type="button"
            aria-pressed={active === ext}
            onClick={() => onPick(active === ext ? null : ext)}
            className={`flex h-6 w-full cursor-pointer items-center gap-2 px-3 text-left ${
              active === ext ? "bg-accent/10 text-accent" : "hover:bg-surface"
            }`}
          >
            <TypeSwatch ext={ext} />
            <span className="truncate font-mono">{ext}</span>
            <span className={`ml-auto tabular-nums ${active === ext ? "" : "text-muted"}`}>{count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

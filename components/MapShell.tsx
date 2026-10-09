import type { ReactNode } from "react";

// The shell is fixed: rail on the left, map in the middle, detail pane on the
// right. Later phases fill these slots; they don't move them. The detail pane
// is a real column rather than an overlay so nothing on the map is ever hidden
// behind it.
export function MapShell({ rail, map, detail }: { rail?: ReactNode; map?: ReactNode; detail?: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_320px]">
      <aside aria-label="Categories" className="flex min-h-0 flex-col overflow-y-auto border-r border-border">
        <h2 className="flex h-7 shrink-0 items-center px-3 text-[11px] text-muted">Categories</h2>
        {rail}
      </aside>
      <section aria-label="Map" className="relative min-h-0 min-w-0 overflow-hidden">
        {map}
      </section>
      <aside aria-label="Detail" className="flex min-h-0 flex-col overflow-y-auto border-l border-border">
        {detail}
      </aside>
    </div>
  );
}

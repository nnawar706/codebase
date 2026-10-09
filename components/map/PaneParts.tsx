import { useState, type ReactNode } from "react";
import { extensionOf } from "@/lib/map/category";
import type { Folding } from "@/lib/map/fold";
import type { Hover } from "@/lib/map/view";
import { TypeSwatch } from "./FileType";

// Pieces shared by everything that lists files beside the map: the detail
// pane and the insights panel. A path listed in either links back the same way.

// Same mark the map uses for what the pointer is over on the other side.
export const MARK = "ring-1 ring-inset ring-accent";

/** What a path row needs to link back to the map. */
export interface Linking {
  marked: (path: string) => boolean;
  onFocus: (path: string) => void;
  onHover: (h: Hover | null) => void;
}

export function linkingFor(
  hover: Hover | null,
  folding: Folding,
  onFocus: (path: string) => void,
  onHover: (h: Hover | null) => void,
): Linking {
  // A hovered folder on the map marks every listed file inside it.
  const marked = (path: string) =>
    hover === null ? false : hover.kind === "file" ? hover.path === path : folding.groupOf.get(path) === hover.id;
  return { marked, onFocus, onHover };
}

export function Section({
  title,
  count,
  sub,
  children,
}: {
  title: string;
  count?: ReactNode;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border pb-1 last:border-b-0">
      <h3 className="flex h-7 items-center gap-2 px-3 text-[11px] text-muted">
        <span>{title}</span>
        {count !== undefined && <span className="font-mono tabular-nums">{count}</span>}
        {sub && <span className="ml-auto">{sub}</span>}
      </h3>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-1.5 text-muted">{children}</p>;
}

// The folder truncates and the file name never does, so a row always says
// which file it is even when the path is longer than the pane.
export function PathRow({ path, linking, children }: { path: string; linking: Linking; children?: ReactNode }) {
  const slash = path.lastIndexOf("/");
  return (
    <li>
      <button
        type="button"
        title={path}
        onClick={() => linking.onFocus(path)}
        onMouseEnter={() => linking.onHover({ kind: "file", path })}
        onMouseLeave={() => linking.onHover(null)}
        className={`flex h-6 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-surface ${
          linking.marked(path) ? MARK : ""
        }`}
      >
        <TypeSwatch ext={extensionOf(path)} />
        <span className="flex min-w-0 font-mono text-[12px]">
          <span className="truncate text-muted">{path.slice(0, slash + 1)}</span>
          <span className="shrink-0">{path.slice(slash + 1)}</span>
        </span>
        {children && <span className="ml-auto shrink-0 pl-2">{children}</span>}
      </button>
    </li>
  );
}

/** A long list cut to its first few rows, with a toggle for the rest. */
export function Expandable<T>({
  items,
  shown,
  children,
}: {
  items: readonly T[];
  shown: number;
  children: (visible: readonly T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  return (
    <>
      {children(all ? items : items.slice(0, shown))}
      {items.length > shown && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="flex h-6 w-full cursor-pointer items-center px-3 text-left text-muted hover:text-foreground"
        >
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

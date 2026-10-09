"use client";

import { useCallback, useMemo, useState } from "react";
import { fold } from "@/lib/map/fold";
import { MAX_ROWS, busiestFirst, revealOffset, type Hover, type Selection } from "@/lib/map/view";
import type { Edge, FileNode } from "@/parser/types";
import { MapShell } from "../MapShell";
import { CategoryRail } from "./CategoryRail";
import { DependencyMap, type MapActions } from "./DependencyMap";
import { DetailPane, type Tab } from "./DetailPane";
import { InsightsPanel } from "./InsightsPanel";
import { linkingFor } from "./PaneParts";

// The map and the detail pane read and change the same selection, open folders
// and hover, so that state lives here rather than in either. Everything either
// side shows is already in the browser: nothing here fetches.
export function Workspace({
  name,
  adapter,
  files,
  edges,
  skipped,
  unresolved,
}: {
  name: string;
  adapter: string;
  files: readonly FileNode[];
  edges: readonly Edge[];
  skipped: number;
  unresolved: number;
}) {
  const folding = useMemo(() => fold(files), [files]);
  const sizes = useMemo(() => new Map(folding.groups.map((g) => [g.id, g.files.length])), [folding]);
  // Each file's position in its folder's panel, in the order the panel lists them.
  const rowIndex = useMemo(() => {
    const byPath = new Map(files.map((f) => [f.path, f]));
    return new Map(
      folding.groups.flatMap((g) =>
        g.files
          .flatMap((p) => byPath.get(p) ?? [])
          .sort(busiestFirst)
          .map((f, i) => [f.path, i] as const),
      ),
    );
  }, [files, folding]);

  const [open, setOpen] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Kept apart from the selection so the open tab survives changing it.
  const [tab, setTab] = useState<Tab>("structure");
  // A file category picked in the rail: everything outside it dims on the map.
  const [category, setCategory] = useState<string | null>(null);

  const actions = useMemo<MapActions>(
    () => ({
      open: (id) => {
        setOpen((prev) => new Map(prev).set(id, 0));
        setSelection({ kind: "group", id });
      },
      close: (id) => {
        setOpen((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        // A selection inside the closed panel has nothing left to point at.
        setSelection((prev) => (prev && (prev.kind === "group" ? prev.id : prev.group) === id ? null : prev));
      },
      scroll: (id, rows) =>
        setOpen((prev) => {
          const current = prev.get(id);
          if (current === undefined) return prev;
          const last = Math.max(0, (sizes.get(id) ?? 0) - MAX_ROWS);
          const next = Math.max(0, Math.min(current + rows, last));
          return next === current ? prev : new Map(prev).set(id, next);
        }),
      selectFile: (path, group) => setSelection({ kind: "file", path, group }),
      clear: () => setSelection(null),
      hover: setHover,
    }),
    [sizes],
  );

  // Selecting a file from the pane selects it on the map as a row, never as
  // the folded node it sits in: its folder opens if it's closed, and the
  // panel scrolls just far enough to show it.
  const focusFile = useCallback(
    (path: string) => {
      const group = folding.groupOf.get(path);
      const index = rowIndex.get(path);
      if (group === undefined || index === undefined) throw new Error(`${path} is not on the map`);
      const last = Math.max(0, (sizes.get(group) ?? 0) - MAX_ROWS);
      setOpen((prev) => {
        const current = prev.get(group);
        const next = Math.min(revealOffset(index, current), last);
        return next === current ? prev : new Map(prev).set(group, next);
      });
      setSelection({ kind: "file", path, group });
      // The row under the pointer now shows a different list, so whatever it
      // was hovering is stale.
      setHover(null);
    },
    [folding, rowIndex, sizes],
  );

  const linking = linkingFor(hover, folding, focusFile, setHover);

  return (
    <MapShell
      rail={<CategoryRail files={files} active={category} onPick={setCategory} />}
      map={
        <DependencyMap
          files={files}
          edges={edges}
          folding={folding}
          open={open}
          selection={selection}
          hover={hover}
          category={category}
          actions={actions}
        />
      }
      detail={
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DetailPane
              name={name}
              adapter={adapter}
              files={files}
              edges={edges}
              skipped={skipped}
              unresolved={unresolved}
              folding={folding}
              selection={selection}
              hover={hover}
              tab={tab}
              onTab={setTab}
              onFocus={focusFile}
              onHover={setHover}
            />
          </div>
          <InsightsPanel files={files} edges={edges} linking={linking} />
        </>
      }
    />
  );
}

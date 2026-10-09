"use client";

import { useMemo, useState, type ReactNode } from "react";
import { INSIGHT_SENTENCES, insights, type InsightKind } from "@/lib/graph/insights";
import type { Edge, FileNode } from "@/parser/types";
import { Empty, Expandable, PathRow, type Linking } from "./PaneParts";

/** Rows each kind shows before it's expanded. */
const SHOWN = 8;

const TITLES: Record<InsightKind, string> = {
  unimported: "Imported by nothing",
  manyImporters: "Imported by many",
  cycles: "Import loops",
  long: "Long files",
};

// Starts collapsed and sits under the pane rather than in it: this explains a
// codebase, it doesn't grade one, so it's never the first thing on screen. It
// stays put whatever is selected, so a loop can be walked file by file.
export function InsightsPanel({
  files,
  edges,
  linking,
}: {
  files: readonly FileNode[];
  edges: readonly Edge[];
  linking: Linking;
}) {
  const [open, setOpen] = useState(false);
  const found = useMemo(() => insights(files, edges), [files, edges]);

  return (
    <section
      aria-label="Insights"
      className={`flex shrink-0 flex-col border-t border-border ${open ? "max-h-[55%]" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-[11px] text-muted hover:text-foreground"
      >
        <span className="w-2">{open ? "▾" : "▸"}</span>
        <span>Insights</span>
      </button>
      {open && (
        <div className="min-h-0 overflow-y-auto border-t border-border">
          {/* Order is deliberate: what explains the repository first, what reads closer to a verdict after. */}
          <Kind kind="unimported" count={found.unimported.length}>
            <Expandable items={found.unimported} shown={SHOWN}>
              {(visible) => (
                <ul>
                  {visible.map((f) => (
                    <PathRow key={f.path} path={f.path} linking={linking} />
                  ))}
                </ul>
              )}
            </Expandable>
          </Kind>
          <Kind kind="manyImporters" count={found.manyImporters.length}>
            <Expandable items={found.manyImporters} shown={SHOWN}>
              {(visible) => (
                <ul>
                  {visible.map((f) => (
                    <PathRow key={f.path} path={f.path} linking={linking}>
                      <span className="font-mono text-incoming tabular-nums">←{f.fanIn}</span>
                    </PathRow>
                  ))}
                </ul>
              )}
            </Expandable>
          </Kind>
          <Kind kind="cycles" count={found.cycles.length}>
            {found.cycles.map((loop) => (
              <ol key={loop[0]} className="border-l border-border ml-3 mb-1">
                {loop.map((path, i) => (
                  <PathRow key={path} path={path} linking={linking}>
                    <span className="font-mono text-[11px] text-muted tabular-nums">{i + 1}</span>
                  </PathRow>
                ))}
                <li className="flex h-6 items-center px-3 font-mono text-[11px] text-muted">↺ back to 1</li>
              </ol>
            ))}
          </Kind>
          <Kind kind="long" count={found.long.length}>
            <Expandable items={found.long} shown={SHOWN}>
              {(visible) => (
                <ul>
                  {visible.map((f) => (
                    <PathRow key={f.path} path={f.path} linking={linking}>
                      <span className="text-muted tabular-nums">{f.lines}</span>
                    </PathRow>
                  ))}
                </ul>
              )}
            </Expandable>
          </Kind>
        </div>
      )}
    </section>
  );
}

function Kind({ kind, count, children }: { kind: InsightKind; count: number; children: ReactNode }) {
  return (
    <section className="border-b border-border pb-1 last:border-b-0">
      <h3 className="flex h-7 items-center gap-2 px-3 text-[11px] text-muted">
        <span>{TITLES[kind]}</span>
        <span className="font-mono tabular-nums">{count}</span>
      </h3>
      <p className="px-3 pb-1 text-[11px] text-muted">{INSIGHT_SENTENCES[kind]}</p>
      {count === 0 ? <Empty>None in this repository.</Empty> : children}
    </section>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { countByCategory, extensionOf } from "@/lib/map/category";
import { adjacency, summarise, type Neighbour } from "@/lib/map/detail";
import type { Folding } from "@/lib/map/fold";
import type { Hover, Selection } from "@/lib/map/view";
import { DEFAULT_DEPTH, walk, type Direction } from "@/lib/graph/walk";
import type { Edge, FileNode, Route, UnrecoveredRoute } from "@/parser/types";
import { TypeSwatch } from "./FileType";
import { Empty, Expandable, MARK, PathRow, Section, linkingFor, type Linking } from "./PaneParts";

export type Tab = "structure" | "explanation";

/** Files the "imported by nothing" list shows before it's expanded. */
const UNIMPORTED_SHOWN = 10;
/** Routes the table shows before it's expanded. */
const ROUTES_SHOWN = 15;

interface Props {
  name: string;
  /** The detected framework's name, or null when none was. */
  framework: string | null;
  files: readonly FileNode[];
  edges: readonly Edge[];
  routes: readonly Route[];
  unrecovered: readonly UnrecoveredRoute[];
  skipped: number;
  /** Imports the parser couldn't resolve to a file. */
  unresolved: number;
  folding: Folding;
  selection: Selection | null;
  hover: Hover | null;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** Moves the map's selection to a file. */
  onFocus: (path: string) => void;
  onHover: (h: Hover | null) => void;
}

export function DetailPane(props: Props) {
  const { files, edges, folding, selection, hover, tab, onTab, onFocus, onHover } = props;
  // All derived once per result: selecting or hovering only looks things up.
  const adj = useMemo(() => adjacency(edges), [edges]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const groupFiles = useMemo(() => new Map(folding.groups.map((g) => [g.id, g.files])), [folding]);

  const linking = linkingFor(hover, folding, onFocus, onHover);

  if (selection === null) return <Summary {...props} linking={linking} />;

  if (selection.kind === "group") {
    const paths = groupFiles.get(selection.id) ?? [];
    return (
      <>
        <Heading
          title={selection.id === "." ? "./" : `${selection.id}/`}
          sub={`Folder · ${paths.length} ${paths.length === 1 ? "file" : "files"}`}
        />
        <Tabs tab={tab} onTab={onTab} />
        {tab === "explanation" ? (
          <Explanation />
        ) : (
          <Section title="File kinds">
            <ul>
              {countByCategory(paths).map(([ext, count]) => (
                <li key={ext} className="flex h-6 items-center gap-2 px-3">
                  <TypeSwatch ext={ext} />
                  <span className="font-mono">{ext}</span>
                  <span className="ml-auto text-muted tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </>
    );
  }

  const file = byPath.get(selection.path);
  if (!file) throw new Error(`Selected ${selection.path} is not in the parser's files`);
  const imports = adj.imports.get(file.path) ?? [];
  const importers = adj.importers.get(file.path) ?? [];
  return (
    <>
      <Heading title={file.path} />
      <Tabs tab={tab} onTab={onTab} />
      {tab === "explanation" ? (
        <Explanation />
      ) : (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-border px-3 py-2">
            <dt className="text-muted">Kind</dt>
            <dd className="flex items-center gap-2">
              <TypeSwatch ext={extensionOf(file.path)} />
              <span className="font-mono">{extensionOf(file.path)}</span>
            </dd>
            <dt className="text-muted">Role</dt>
            <dd>{file.role ?? <span className="text-muted">none, no convention matched</span>}</dd>
            <dt className="text-muted">Length</dt>
            <dd className="tabular-nums">{file.lines} lines</dd>
          </dl>
          {/* Keyed by file so a walk never outlives the selection it was run from. */}
          <Walk key={file.path} path={file.path} edges={edges} linking={linking} />
          {/* Counts are the lists' own lengths, so the number and the rows can't disagree. */}
          <Section title="Imports" count={<span className="text-outgoing">{imports.length}→</span>}>
            <NeighbourList neighbours={imports} empty="Imports no file in this repository." linking={linking} />
          </Section>
          <Section title="Imported by" count={<span className="text-incoming">←{importers.length}</span>}>
            <NeighbourList neighbours={importers} empty="No file in this repository imports it." linking={linking} />
          </Section>
        </>
      )}
    </>
  );
}

// The pane's resting state: what this repository is, before anything is clicked.
function Summary({
  name,
  framework,
  files,
  routes,
  unrecovered,
  skipped,
  unresolved,
  linking,
}: Pick<Props, "name" | "framework" | "files" | "routes" | "unrecovered" | "skipped" | "unresolved"> & {
  linking: Linking;
}) {
  const summary = useMemo(() => summarise(files), [files]);

  return (
    <>
      <header className="border-b border-border px-3 py-2">
        <h2 className="font-mono text-[13px] font-medium break-all">{name}</h2>
        <p>
          <span className="text-muted">Framework</span> {framework ?? "none detected"}
        </p>
      </header>
      <dl className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <Stat label="Files" value={summary.files} sub={`${skipped} skipped`} />
        <Stat label="Imports" value={summary.imports} sub={`${unresolved} unresolved`} />
        <Stat label="Routes" value={routes.length} sub={`${unrecovered.length} not recovered`} />
      </dl>
      <p className="border-b border-border px-3 py-2">
        <span className="tabular-nums">{summary.unidentified}</span>{" "}
        <span className="text-muted">{summary.unidentified === 1 ? "file" : "files"} matched no convention</span>
      </p>
      <RouteTable routes={routes} unrecovered={unrecovered} linking={linking} />
      <Section title="Most depended on">
        {summary.mostDependedOn.length === 0 ? (
          <Empty>No file is imported by another.</Empty>
        ) : (
          <ul>
            {summary.mostDependedOn.map((f) => (
              <PathRow key={f.path} path={f.path} linking={linking}>
                <span className="font-mono text-incoming tabular-nums">←{f.fanIn}</span>
              </PathRow>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Imported by nothing" count={summary.unimported.length} sub="Where reading starts">
        <Expandable items={summary.unimported} shown={UNIMPORTED_SHOWN}>
          {(visible) => (
            <ul>
              {visible.map((f) => (
                <PathRow key={f.path} path={f.path} linking={linking}>
                  <span className="font-mono text-outgoing tabular-nums">{f.fanOut}→</span>
                </PathRow>
              ))}
            </ul>
          )}
        </Expandable>
      </Section>
    </>
  );
}

// Every route is a method and a full pattern read from the code, with the line
// it's declared on so it can be checked by eye. Where one couldn't be read
// exactly, the table has no row for it, and the list under it says why.
function RouteTable({
  routes,
  unrecovered,
  linking,
}: {
  routes: readonly Route[];
  unrecovered: readonly UnrecoveredRoute[];
  linking: Linking;
}) {
  return (
    <Section title="Routes" count={routes.length}>
      {routes.length === 0 ? (
        <Empty>No routes recovered.</Empty>
      ) : (
        <Expandable items={routes} shown={ROUTES_SHOWN}>
          {(visible) => (
            <ul>
              {visible.map((r) => (
                <li key={`${r.method} ${r.path} ${r.file}:${r.line}`}>
                  <button
                    type="button"
                    title={`${r.file}:${r.line}`}
                    onClick={() => linking.onFocus(r.file)}
                    onMouseEnter={() => linking.onHover({ kind: "file", path: r.file })}
                    onMouseLeave={() => linking.onHover(null)}
                    className={`grid w-full cursor-pointer grid-cols-[3.75rem_minmax(0,1fr)] px-3 py-0.5 text-left hover:bg-surface ${
                      linking.marked(r.file) ? MARK : ""
                    }`}
                  >
                    <span className="font-mono text-[12px] leading-5">{r.method}</span>
                    <span className="truncate font-mono text-[12px] leading-5">{r.path}</span>
                    <span className="col-start-2 truncate font-mono text-[11px] leading-4 text-muted">
                      {r.file}:{r.line}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Expandable>
      )}
      {unrecovered.length > 0 && <Unrecovered items={unrecovered} />}
    </Section>
  );
}

function Unrecovered({ items }: { items: readonly UnrecoveredRoute[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-full cursor-pointer items-center gap-2 px-3 text-left text-muted hover:text-foreground"
      >
        <span className="w-2">{open ? "▾" : "▸"}</span>
        <span>
          <span className="tabular-nums">{items.length}</span> not recovered, so not listed
        </span>
      </button>
      {open && (
        <ul>
          {items.map((u) => (
            <li key={`${u.file}:${u.line} ${u.detail}`} className="px-3 py-0.5 pl-7">
              <p className="truncate font-mono text-[11px]" title={`${u.file}:${u.line}`}>
                {u.file}:{u.line}
              </p>
              <p className="text-muted">{u.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-[15px] leading-6 tabular-nums">{value}</dd>
      <dd className="truncate text-[11px] text-muted">{sub}</dd>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="border-b border-border px-3 py-2">
      <h2 className="font-mono text-[12px] break-all">{title}</h2>
      {sub && <p className="text-muted">{sub}</p>}
    </header>
  );
}

function Tabs({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const tabs: [Tab, string][] = [
    ["structure", "Structure"],
    ["explanation", "Explanation"],
  ];
  return (
    <div role="tablist" className="flex shrink-0 border-b border-border px-1">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={`-mb-px h-7 cursor-pointer border-b px-2 ${
            tab === id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Explanation() {
  return <Empty>No explanation yet. One is written by a model, and nothing calls one in this build.</Empty>;
}

function NeighbourList({ neighbours, empty, linking }: { neighbours: Neighbour[]; empty: string; linking: Linking }) {
  if (neighbours.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul>
      {neighbours.map((n) => {
        // A plain import is the default and goes unlabelled; anything else says what it is.
        const other = n.kinds.filter((k) => k !== "import");
        return (
          <PathRow key={n.path} path={n.path} linking={linking}>
            {other.length > 0 && <span className="text-[11px] text-muted">{other.join(", ")}</span>}
          </PathRow>
        );
      })}
    </ul>
  );
}

const WALKS: { direction: Direction; label: string; empty: string }[] = [
  {
    direction: "dependents",
    label: "Blast radius",
    empty: "No file in this repository imports it, so a change here reaches nothing else.",
  },
  { direction: "dependencies", label: "Dependency chain", empty: "It imports no file in this repository." },
];

// Everything that breaks if this file changes, or everything it needs. Worked
// out on click from the edges already in the browser: no request, no spinner.
function Walk({ path, edges, linking }: { path: string; edges: readonly Edge[]; linking: Linking }) {
  const [direction, setDirection] = useState<Direction | null>(null);
  const reached = useMemo(() => (direction ? walk(edges, path, direction) : null), [edges, path, direction]);
  const active = WALKS.find((w) => w.direction === direction);
  const steps = Array.from({ length: DEFAULT_DEPTH }, (_, i) => i + 1);

  return (
    <section className="border-b border-border pb-1">
      <div className="flex gap-1.5 px-3 py-2">
        {WALKS.map((w) => (
          <button
            key={w.direction}
            type="button"
            aria-pressed={direction === w.direction}
            onClick={() => setDirection((d) => (d === w.direction ? null : w.direction))}
            className={`h-6 cursor-pointer rounded border px-2 ${
              direction === w.direction
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-foreground hover:border-muted"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>
      {active &&
        reached &&
        (reached.length === 0 ? (
          <Empty>{active.empty}</Empty>
        ) : (
          steps.map((step) => {
            const at = reached.filter((r) => r.depth === step);
            return (
              <div key={step}>
                <h4 className="flex h-6 items-center gap-2 px-3 text-[11px] text-muted">
                  <span>{step === 1 ? "Directly" : `${step} steps away`}</span>
                  <span
                    className={`font-mono tabular-nums ${
                      direction === "dependents" ? "text-incoming" : "text-outgoing"
                    }`}
                  >
                    {direction === "dependents" ? `←${at.length}` : `${at.length}→`}
                  </span>
                </h4>
                {at.length > 0 && (
                  <ul>
                    {at.map((r) => (
                      <PathRow key={r.path} path={r.path} linking={linking} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        ))}
    </section>
  );
}

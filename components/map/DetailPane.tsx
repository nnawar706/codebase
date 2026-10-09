"use client";

import { useMemo, useState, type ReactNode } from "react";
import { countByCategory, extensionOf } from "@/lib/map/category";
import { adjacency, summarise, type Neighbour } from "@/lib/map/detail";
import type { Folding } from "@/lib/map/fold";
import type { Hover, Selection } from "@/lib/map/view";
import type { Edge, FileNode } from "@/parser/types";
import { TypeSwatch } from "./FileType";

export type Tab = "structure" | "explanation";

/** Files the "imported by nothing" list shows before it's expanded. */
const UNIMPORTED_SHOWN = 10;

// Same mark the map uses for what the pointer is over on the other side.
const MARK = "ring-1 ring-inset ring-accent";

interface Props {
  name: string;
  adapter: string;
  files: readonly FileNode[];
  edges: readonly Edge[];
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

/** What a path row needs to link back to the map. */
interface Linking {
  marked: (path: string) => boolean;
  onFocus: (path: string) => void;
  onHover: (h: Hover | null) => void;
}

export function DetailPane(props: Props) {
  const { files, edges, folding, selection, hover, tab, onTab, onFocus, onHover } = props;
  // All derived once per result: selecting or hovering only looks things up.
  const adj = useMemo(() => adjacency(edges), [edges]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const groupFiles = useMemo(() => new Map(folding.groups.map((g) => [g.id, g.files])), [folding]);

  // A hovered folder on the map marks every listed file inside it.
  const marked = (path: string) =>
    hover === null ? false : hover.kind === "file" ? hover.path === path : folding.groupOf.get(path) === hover.id;
  const linking: Linking = { marked, onFocus, onHover };

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
  adapter,
  files,
  skipped,
  unresolved,
  linking,
}: Pick<Props, "name" | "adapter" | "files" | "skipped" | "unresolved"> & { linking: Linking }) {
  const summary = useMemo(() => summarise(files), [files]);
  const [showAll, setShowAll] = useState(false);
  const unimported = showAll ? summary.unimported : summary.unimported.slice(0, UNIMPORTED_SHOWN);
  const framework = adapter === "none" ? null : adapter;

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
        {/* The parser recovers no routes yet. Absent, with why, rather than a 0
            that claims it looked. */}
        <Stat label="Routes" value="—" sub={framework ? "not recovered" : "no adapter"} />
      </dl>
      <p className="border-b border-border px-3 py-2">
        <span className="tabular-nums">{summary.unidentified}</span>{" "}
        <span className="text-muted">{summary.unidentified === 1 ? "file" : "files"} matched no convention</span>
      </p>
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
        <ul>
          {unimported.map((f) => (
            <PathRow key={f.path} path={f.path} linking={linking}>
              <span className="font-mono text-outgoing tabular-nums">{f.fanOut}→</span>
            </PathRow>
          ))}
        </ul>
        {summary.unimported.length > UNIMPORTED_SHOWN && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex h-6 w-full cursor-pointer items-center px-3 text-left text-muted hover:text-foreground"
          >
            {showAll ? "Show fewer" : `Show all ${summary.unimported.length}`}
          </button>
        )}
      </Section>
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

function Section({
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

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-1.5 text-muted">{children}</p>;
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

// The folder truncates and the file name never does, so a row always says
// which file it is even when the path is longer than the pane.
function PathRow({ path, linking, children }: { path: string; linking: Linking; children?: ReactNode }) {
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

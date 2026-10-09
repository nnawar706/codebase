import type { Edge, FileNode } from "../../parser/types.ts";
import type { Folding } from "./fold.ts";
import { shortestUniqueLabels } from "./labels.ts";

// What's on the canvas for a given set of open folders, derived from the
// parser's files and edges without reshaping them. Pure: same inputs, same view.

/** Rows a panel shows at once. Past this it scrolls, a row at a time. */
export const MAX_ROWS = 12;

// Sizes are computed here rather than measured in the browser so the layout is
// known before anything renders and never shifts after. Mono at 12px is 0.6em wide.
const CHAR_W = 7.2;
const PAD_X = 20;
export const ROW_H = 20;
export const HEADER_H = 26;
const FOLDED_MIN_H = 36;
// A row's type swatch and the gap after it, in characters.
const SWATCH_CHARS = 2;
// Height grows with the square root of fan-in so a folder forty files lean on
// stands out without one hub dwarfing the whole canvas.
const FAN_IN_SCALE = 5;

/**
 * Where an edge can land. A folded group, a file row in an open panel, or the
 * "above" / "below" row standing in for files scrolled out of a panel's window.
 */
export type Endpoint = `g:${string}` | `f:${string}` | `u:${string}` | `d:${string}`;

/**
 * The connection point an endpoint uses on its node. A panel's points are
 * slots, not files: scrolling changes which file fills a slot, never where the
 * slot is, so React Flow never has to re-measure a handle.
 */
export type HandleId = "node" | "above" | "below" | `row-${number}`;

export interface Row {
  path: string;
  label: string;
  fanIn: number;
  fanOut: number;
}

interface ItemBase {
  /** The group id: a directory path. */
  id: string;
  label: string;
  files: number;
  /** Distinct files outside the group that import something in it. */
  fanIn: number;
  /** Distinct files outside the group that something in it imports. */
  fanOut: number;
  width: number;
  height: number;
}

export interface FoldedItem extends ItemBase {
  kind: "folded";
}

export interface PanelItem extends ItemBase {
  kind: "panel";
  /** The window of files currently shown, busiest first. */
  rows: Row[];
  /** Whether the folder has more files than rows, and so scrolls. */
  scrolls: boolean;
  /** Files before and after the window. */
  above: number;
  below: number;
}

export type Item = FoldedItem | PanelItem;

export interface ViewEdge {
  id: string;
  /** Group ids at each end. */
  source: string;
  target: string;
  from: Endpoint;
  to: Endpoint;
  sourceHandle: HandleId;
  targetHandle: HandleId;
  /** File-level edges folded into this one. */
  count: number;
}

export interface View {
  items: Item[];
  edges: ViewEdge[];
  /** Where every file's edges land right now. */
  endpoints: Map<string, Endpoint>;
}

/** The stats line as drawn: file count, then fan-in and fan-out with their arrows. */
const statsText = (files: number | null, fanIn: number, fanOut: number) =>
  `${files === null ? "" : `${files} files  `}←${fanIn}  ${fanOut}→`;

const groupLabel = (id: string, label: string) => (id === "." ? "./" : label);

/** Busiest first, so the rows a panel opens on are the ones most leaned on. */
export const busiestFirst = (a: FileNode, b: FileNode) => b.fanIn - a.fanIn || (a.path < b.path ? -1 : 1);

/**
 * The window offset that brings the row at `index` into view, moving the
 * window from `current` as little as possible. A panel not yet open puts the
 * row at the top; deriveView clamps that if it runs past the last window.
 */
export function revealOffset(index: number, current: number | undefined): number {
  if (current === undefined || index < current) return index;
  if (index >= current + MAX_ROWS) return index - MAX_ROWS + 1;
  return current;
}

/**
 * @param open Open folders, each with the index of the first file its window
 * shows. Out-of-range offsets are clamped.
 */
export function deriveView(
  files: readonly FileNode[],
  edges: readonly Edge[],
  folding: Folding,
  open: ReadonlyMap<string, number>,
): View {
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const groupOf = (path: string) => {
    const g = folding.groupOf.get(path);
    if (g === undefined) throw new Error(`${path} is not in any folded group`);
    return g;
  };

  // Group fan counts over distinct files, matching how the parser counts a file's.
  const importers = new Map<string, Set<string>>();
  const imported = new Map<string, Set<string>>();
  for (const e of edges) {
    const from = groupOf(e.from);
    const to = groupOf(e.to);
    if (from === to) continue;
    if (!importers.has(to)) importers.set(to, new Set());
    importers.get(to)?.add(e.from);
    if (!imported.has(from)) imported.set(from, new Set());
    imported.get(from)?.add(e.to);
  }

  const ordered = new Map<string, FileNode[]>();
  const windows = new Map<string, { offset: number; rows: FileNode[] }>();
  for (const g of folding.groups) {
    const requested = open.get(g.id);
    if (requested === undefined) continue;
    const members = g.files.map((p) => {
      const f = fileByPath.get(p);
      if (!f) throw new Error(`Folded file ${p} is not in the parser's files`);
      return f;
    });
    members.sort(busiestFirst);
    const offset = Math.max(0, Math.min(requested, members.length - MAX_ROWS));
    ordered.set(g.id, members);
    windows.set(g.id, { offset, rows: members.slice(offset, offset + MAX_ROWS) });
  }

  const groupIds = folding.groups.map((g) => g.id);
  const labels = shortestUniqueLabels([
    ...groupIds,
    ...[...windows.values()].flatMap((w) => w.rows.map((r) => r.path)),
  ]);
  const label = (p: string) => labels.get(p) ?? p;
  // Widths come from labelling every file in the open folders as if all were on
  // screen. A larger set only ever needs longer labels, so this is the widest a
  // row can get at any scroll position, and a panel never resizes as it scrolls.
  const widestLabels = shortestUniqueLabels([...groupIds, ...[...ordered.values()].flat().map((f) => f.path)]);

  const items: Item[] = folding.groups.map((g) => {
    const base = {
      id: g.id,
      label: groupLabel(g.id, label(g.id)),
      files: g.files.length,
      fanIn: importers.get(g.id)?.size ?? 0,
      fanOut: imported.get(g.id)?.size ?? 0,
    };
    const win = windows.get(g.id);
    const members = ordered.get(g.id);
    if (!win || !members) {
      const chars = Math.max(base.label.length, statsText(base.files, base.fanIn, base.fanOut).length);
      return {
        ...base,
        kind: "folded",
        width: Math.round(chars * CHAR_W + PAD_X),
        height: Math.round(FOLDED_MIN_H + FAN_IN_SCALE * Math.sqrt(base.fanIn)),
      };
    }
    const rows = win.rows.map((f) => ({ path: f.path, label: label(f.path), fanIn: f.fanIn, fanOut: f.fanOut }));
    const scrolls = members.length > MAX_ROWS;
    const header = `${base.label}  ${statsText(base.files, base.fanIn, base.fanOut)}`;
    const widest = Math.max(
      header.length,
      SWATCH_CHARS + `${members.length} below`.length,
      ...members.map(
        (f) => SWATCH_CHARS + `${widestLabels.get(f.path) ?? f.path}  ${statsText(null, f.fanIn, f.fanOut)}`.length,
      ),
    );
    return {
      ...base,
      kind: "panel",
      rows,
      scrolls,
      above: win.offset,
      below: members.length - win.offset - rows.length,
      width: Math.round(widest * CHAR_W + PAD_X),
      // A scrolling panel always keeps both its above and below rows, even at
      // zero, so its height is fixed and scrolling never moves the layout.
      height: HEADER_H + ROW_H * (rows.length + (scrolls ? 2 : 0)),
    };
  });

  const endpoints = new Map<string, Endpoint>();
  const handles = new Map<Endpoint, HandleId>();
  for (const g of folding.groups) {
    const win = windows.get(g.id);
    const members = ordered.get(g.id);
    if (!win || !members) {
      for (const p of g.files) endpoints.set(p, `g:${g.id}`);
      handles.set(`g:${g.id}`, "node");
      continue;
    }
    handles.set(`u:${g.id}`, "above");
    handles.set(`d:${g.id}`, "below");
    members.forEach((f, i) => {
      if (i < win.offset) endpoints.set(f.path, `u:${g.id}`);
      else if (i >= win.offset + win.rows.length) endpoints.set(f.path, `d:${g.id}`);
      else {
        endpoints.set(f.path, `f:${f.path}`);
        handles.set(`f:${f.path}`, `row-${i - win.offset}`);
      }
    });
  }
  const endpointOf = (path: string): Endpoint => {
    const end = endpoints.get(path);
    if (!end) throw new Error(`${path} has no endpoint`);
    return end;
  };
  const handleOf = (end: Endpoint): HandleId => {
    const h = handles.get(end);
    if (!h) throw new Error(`${end} has no handle`);
    return h;
  };

  // Edges inside one group aren't drawn: a folded node or a panel is one object,
  // and a line from it back into itself says nothing. Selection still finds them.
  const merged = new Map<string, ViewEdge>();
  for (const e of edges) {
    const source = groupOf(e.from);
    const target = groupOf(e.to);
    if (source === target) continue;
    const from = endpointOf(e.from);
    const to = endpointOf(e.to);
    const id = `${from}->${to}`;
    const existing = merged.get(id);
    // Kinds collapse here: two files joined by both an import and a re-export
    // are one line on the map.
    if (existing) existing.count += 1;
    else {
      merged.set(id, { id, source, target, from, to, sourceHandle: handleOf(from), targetHandle: handleOf(to), count: 1 });
    }
  }

  return { items, edges: [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), endpoints };
}

export type Selection = { kind: "group"; id: string } | { kind: "file"; path: string; group: string };

/** What the pointer is over, on the map or in the detail pane. Each side marks it on the other. */
export type Hover = { kind: "file"; path: string } | { kind: "group"; id: string };

export interface Highlight {
  /** Drawn edges touching the selection, by direction relative to it. */
  edges: Map<string, "in" | "out">;
  /** Groups whose box stays at full strength. */
  groups: Set<string>;
  /** Rows (and above / below rows) that stay at full strength. */
  endpoints: Set<Endpoint>;
}

/**
 * What stays at full strength for a selection: the selection, its edges, and
 * whatever those edges reach. Built from the file edges as well as the drawn
 * ones, so a sibling row in the same panel lights up even with no line to it.
 */
export function highlight(view: View, fileEdges: readonly Edge[], folding: Folding, selection: Selection): Highlight {
  const result: Highlight = { edges: new Map(), groups: new Set(), endpoints: new Set() };
  const panels = new Map(view.items.flatMap((i) => (i.kind === "panel" ? [[i.id, i] as const] : [])));

  const inSelection =
    selection.kind === "group"
      ? (path: string) => folding.groupOf.get(path) === selection.id
      : (path: string) => path === selection.path;

  result.groups.add(selection.kind === "group" ? selection.id : selection.group);
  if (selection.kind === "group") {
    for (const r of panels.get(selection.id)?.rows ?? []) result.endpoints.add(`f:${r.path}`);
    result.endpoints.add(`u:${selection.id}`);
    result.endpoints.add(`d:${selection.id}`);
  }
  // A selected file scrolled out of its window is represented by the above or
  // below row it went behind, so its edges still show where they go.
  const selectedFileEnd = selection.kind === "file" ? view.endpoints.get(selection.path) : undefined;
  if (selectedFileEnd) result.endpoints.add(selectedFileEnd);

  for (const e of fileEdges) {
    const fromIn = inSelection(e.from);
    const toIn = inSelection(e.to);
    if (fromIn === toIn) continue;
    const other = fromIn ? e.to : e.from;
    const otherEnd = view.endpoints.get(other);
    const group = folding.groupOf.get(other);
    if (otherEnd) result.endpoints.add(otherEnd);
    if (group !== undefined) result.groups.add(group);
  }

  const groupOfEnd = (end: Endpoint) => (end.startsWith("f:") ? folding.groupOf.get(end.slice(2)) : end.slice(2));
  const selectedEnd = (end: Endpoint) =>
    selection.kind === "group" ? groupOfEnd(end) === selection.id : end === selectedFileEnd;
  for (const e of view.edges) {
    if (selectedEnd(e.from)) result.edges.set(e.id, "out");
    else if (selectedEnd(e.to)) result.edges.set(e.id, "in");
  }
  return result;
}

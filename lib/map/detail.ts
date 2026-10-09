import { EDGE_KINDS, type Edge, type EdgeKind, type FileNode } from "../../parser/types.ts";

// What the detail pane lists, derived from the parser's files and edges. Pure,
// and computed once per result, so selecting or hovering never recomputes it.

export interface Neighbour {
  path: string;
  /** How the two files are joined. A pair joined two ways is one neighbour. */
  kinds: EdgeKind[];
}

export interface Adjacency {
  /** Per file, the files it imports, by path. */
  imports: ReadonlyMap<string, Neighbour[]>;
  /** Per file, the files that import it, by path. */
  importers: ReadonlyMap<string, Neighbour[]>;
}

// Neighbours are one per distinct file, the same way the parser counts fan-in
// and fan-out, so a list's length always equals the count shown beside it.
export function adjacency(edges: readonly Edge[]): Adjacency {
  const out = new Map<string, Map<string, Set<EdgeKind>>>();
  const into = new Map<string, Map<string, Set<EdgeKind>>>();
  const add = (m: typeof out, key: string, other: string, kind: EdgeKind) => {
    if (!m.has(key)) m.set(key, new Map());
    const row = m.get(key);
    if (!row?.has(other)) row?.set(other, new Set());
    row?.get(other)?.add(kind);
  };
  for (const e of edges) {
    add(out, e.from, e.to, e.kind);
    add(into, e.to, e.from, e.kind);
  }
  const flatten = (m: typeof out) =>
    new Map(
      [...m].map(([path, others]) => [
        path,
        [...others]
          .map(([other, kinds]) => ({ path: other, kinds: EDGE_KINDS.filter((k) => kinds.has(k)) }))
          .sort((a, b) => (a.path < b.path ? -1 : 1)),
      ]),
    );
  return { imports: flatten(out), importers: flatten(into) };
}

/** How many of the most depended-on files the summary ranks. */
export const MOST_DEPENDED_ON = 10;

export interface RepoSummary {
  files: number;
  /** Distinct importing file to imported file pairs. */
  imports: number;
  /** Files with importers, most importers first. */
  mostDependedOn: FileNode[];
  /** Files nothing imports, the ones importing the most first. */
  unimported: FileNode[];
  /** Files no adapter convention recognised. */
  unidentified: number;
}

export function summarise(files: readonly FileNode[]): RepoSummary {
  const byPath = (a: FileNode, b: FileNode) => (a.path < b.path ? -1 : 1);
  return {
    files: files.length,
    imports: files.reduce((n, f) => n + f.fanOut, 0),
    mostDependedOn: files
      .filter((f) => f.fanIn > 0)
      .sort((a, b) => b.fanIn - a.fanIn || byPath(a, b))
      .slice(0, MOST_DEPENDED_ON),
    unimported: files.filter((f) => f.fanIn === 0).sort((a, b) => b.fanOut - a.fanOut || byPath(a, b)),
    unidentified: files.filter((f) => f.role === null).length,
  };
}

import type { Edge, FileNode } from "../../parser/types.ts";

// Four facts read straight off the files and edges. No model finds or words
// them: each kind has one fixed sentence, and every entry is something the
// parser recorded, never an estimate.

/** Imported by at least this many files. A fixed bar, so it means the same in every repository. */
export const MANY_IMPORTERS = 20;
/** At least this many lines. */
export const LONG_LINES = 500;

export const INSIGHT_KINDS = ["unimported", "manyImporters", "cycles", "long"] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_SENTENCES: Record<InsightKind, string> = {
  unimported: "Nothing imports these files, and no convention says what reaches them.",
  manyImporters: `Each of these is imported by ${MANY_IMPORTERS} or more files.`,
  cycles: "Each of these is a loop: every file imports the next, and the last imports the first.",
  long: `Each of these is ${LONG_LINES} lines or longer.`,
};

export interface Insights {
  /** By path. */
  unimported: FileNode[];
  /** Most importers first. */
  manyImporters: FileNode[];
  /**
   * One loop per tangle of files that reach each other: the shortest one
   * through the tangle's first file by path, in import order. The last file
   * imports the first.
   */
  cycles: string[][];
  /** Longest first. */
  long: FileNode[];
}

export function insights(files: readonly FileNode[], edges: readonly Edge[]): Insights {
  const byPath = (a: FileNode, b: FileNode) => (a.path < b.path ? -1 : 1);
  return {
    // A file with a role is reached by its framework or tooling, by name or
    // position. The import graph can't see that, so it isn't unused.
    unimported: files.filter((f) => f.fanIn === 0 && f.role === null).sort(byPath),
    manyImporters: files.filter((f) => f.fanIn >= MANY_IMPORTERS).sort((a, b) => b.fanIn - a.fanIn || byPath(a, b)),
    cycles: cycles(files.map((f) => f.path), edges),
    long: files.filter((f) => f.lines >= LONG_LINES).sort((a, b) => b.lines - a.lines || byPath(a, b)),
  };
}

export function cycles(paths: readonly string[], edges: readonly Edge[]): string[][] {
  const sorted = [...paths].sort();
  const id = new Map(sorted.map((p, i) => [p, i]));
  const next: number[][] = sorted.map(() => []);
  const pairs = new Set<string>();
  for (const e of edges) {
    const from = id.get(e.from);
    const to = id.get(e.to);
    if (from === undefined || to === undefined) throw new Error(`Edge ${e.from} -> ${e.to} has an end that is not a file`);
    // Two files joined by an import and a re-export are one step, not two.
    const key = `${from}:${to}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    next[from].push(to);
  }
  for (const targets of next) targets.sort((a, b) => a - b);

  return components(next)
    .filter((c) => c.length > 1 || next[c[0]].includes(c[0]))
    .map((c) => shortestLoop(c, next).map((i) => sorted[i]))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * Tarjan's strongly connected components, with an explicit stack instead of
 * recursion: a long import chain in a real repository is deeper than the call
 * stack.
 */
function components(next: readonly number[][]): number[][] {
  const n = next.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const found: number[][] = [];
  let counter = 0;

  const visit = (v: number) => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = 1;
  };

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    visit(root);
    // Each frame is a file and how many of its imports have been followed.
    const work: [node: number, followed: number][] = [[root, 0]];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      if (i < next[v].length) {
        frame[1] = i + 1;
        const w = next[v][i];
        if (index[w] === -1) {
          visit(w);
          work.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w]);
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low[parent] = Math.min(low[parent], low[v]);
      }
      if (low[v] === index[v]) {
        const component: number[] = [];
        let w: number;
        do {
          w = stack.pop() ?? -1;
          onStack[w] = 0;
          component.push(w);
        } while (w !== v);
        found.push(component.sort((a, b) => a - b));
      }
    }
  }
  return found;
}

/**
 * The fewest files that lead from the component's first file back to itself,
 * staying inside the component. A tangle of fourteen files isn't something a
 * person can walk by hand; a loop through it is.
 */
function shortestLoop(component: readonly number[], next: readonly number[][]): number[] {
  const inside = new Set(component);
  const start = component[0];
  const parent = new Map<number, number>();
  let frontier = [start];
  while (frontier.length > 0) {
    const reached: number[] = [];
    for (const v of frontier) {
      for (const w of next[v]) {
        if (!inside.has(w)) continue;
        if (w === start) {
          const loop = [v];
          for (let at = v; at !== start; ) {
            const p = parent.get(at);
            if (p === undefined) throw new Error("Loop lost its way back to the start");
            loop.push(p);
            at = p;
          }
          return loop.reverse();
        }
        if (parent.has(w)) continue;
        parent.set(w, v);
        reached.push(w);
      }
    }
    frontier = reached;
  }
  throw new Error("A strongly connected component has no loop through its first file");
}

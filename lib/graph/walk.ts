import type { Edge } from "../../parser/types.ts";

// Blast radius and dependency chain are one walk in two directions. Pure over
// the edge list, so both answer instantly from what the browser already holds.

/** "dependents" follows edges backwards (who imports this); "dependencies" forwards. */
export type Direction = "dependents" | "dependencies";

/** Past two steps the walk returns most of a repository and stops being an answer. */
export const DEFAULT_DEPTH = 2;

export interface Reached {
  path: string;
  /** Fewest steps from the start. */
  depth: number;
}

/** Every file `depth` steps or fewer from `start`, nearest first, then by path. The start is never included. */
export function walk(edges: readonly Edge[], start: string, direction: Direction, depth = DEFAULT_DEPTH): Reached[] {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const [from, to] = direction === "dependencies" ? [e.from, e.to] : [e.to, e.from];
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  }

  // Breadth-first, so the depth recorded for a file is its shortest distance.
  const seen = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  for (let step = 1; step <= depth && frontier.length > 0; step++) {
    const reached: string[] = [];
    for (const path of frontier) {
      for (const other of next.get(path) ?? []) {
        if (seen.has(other)) continue;
        seen.set(other, step);
        reached.push(other);
      }
    }
    frontier = reached;
  }
  seen.delete(start);
  return [...seen]
    .map(([path, d]) => ({ path, depth: d }))
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : 1));
}

import type { Edge, EdgeKind } from "./types.ts";

export interface ResolvedImport {
  from: string;
  to: string;
  kind: EdgeKind;
}

/** One edge per (from, to, kind), however many times the import repeats. */
export function dedupeEdges(imports: readonly ResolvedImport[]): Edge[] {
  const seen = new Map<string, Edge>();
  for (const { from, to, kind } of imports) {
    const key = `${from}\0${to}\0${kind}`;
    if (!seen.has(key)) seen.set(key, { from, to, kind });
  }
  return [...seen.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
}

/**
 * Fan counts over distinct (from, to) pairs: a file that both imports and
 * re-exports another still counts it once.
 */
export function fanCounts(
  paths: readonly string[],
  edges: readonly Edge[],
): Map<string, { fanIn: number; fanOut: number }> {
  const pairs = new Set(edges.map((e) => `${e.from}\0${e.to}`));
  const counts = new Map(paths.map((p) => [p, { fanIn: 0, fanOut: 0 }]));
  for (const pair of pairs) {
    const [from, to] = pair.split("\0");
    const out = counts.get(from);
    const into = counts.get(to);
    if (!out || !into) throw new Error(`Edge ${from} -> ${to} has an end that is not a file`);
    out.fanOut += 1;
    into.fanIn += 1;
  }
  return counts;
}

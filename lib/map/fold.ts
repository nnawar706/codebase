import type { FileNode } from "../../parser/types.ts";

// Folding decides what a node on the map is. Every directory starts as its own
// node; small ones merge upward until the map is readable. The threshold is
// solved for from the repository's shape, never chosen in advance.

/** The most nodes a folded map should show before the threshold is raised. */
export const MAX_FOLDED_NODES = 24;

export interface Group {
  /** The directory the group is named for, repository-relative. "." is the root. */
  id: string;
  /** Every file folded into this group, sorted. */
  files: string[];
}

export interface Folding {
  /** Directories holding fewer files than this merged into their parent. */
  threshold: number;
  /** Sorted by id. */
  groups: Group[];
  /** File path -> group id. */
  groupOf: Map<string, string>;
}

const parentOf = (dir: string) => {
  const slash = dir.lastIndexOf("/");
  return slash === -1 ? "." : dir.slice(0, slash);
};
const depthOf = (dir: string) => (dir === "." ? 0 : dir.split("/").length);

/** One folding pass at a fixed threshold. */
export function foldAt(files: readonly Pick<FileNode, "path" | "module">[], threshold: number): Folding {
  // Every directory on the way to a file is a candidate, even one holding no
  // files directly, so a merge always has a real parent to land in.
  const holding = new Map<string, string[]>();
  for (const f of files) {
    for (let dir = f.module; ; dir = parentOf(dir)) {
      if (!holding.has(dir)) holding.set(dir, []);
      if (dir === ".") break;
    }
    holding.get(f.module)?.push(f.path);
  }

  const maxDepth = Math.max(0, ...[...holding.keys()].map(depthOf));
  for (let depth = maxDepth; depth >= 1; depth--) {
    // Decide every merge at this depth before applying any, so one merge can't
    // change what a sibling's decision sees.
    const merging = [...holding.entries()].filter(([dir, held]) => depthOf(dir) === depth && held.length < threshold);
    for (const [dir, held] of merging) {
      holding.get(parentOf(dir))?.push(...held);
      holding.delete(dir);
    }
  }

  const groups = [...holding.entries()]
    .filter(([, held]) => held.length > 0)
    .map(([id, held]) => ({ id, files: [...held].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const groupOf = new Map(groups.flatMap((g) => g.files.map((f) => [f, g.id] as const)));
  return { threshold, groups, groupOf };
}

/** The lowest threshold, from 2 up, whose folding lands at or under MAX_FOLDED_NODES. */
export function fold(files: readonly Pick<FileNode, "path" | "module">[]): Folding {
  for (let threshold = 2; ; threshold++) {
    const folding = foldAt(files, threshold);
    // Past files.length everything sits in the root, so this always ends.
    if (folding.groups.length <= MAX_FOLDED_NODES || threshold > files.length) return folding;
  }
}

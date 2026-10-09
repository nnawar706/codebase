// A file's category is its type, read off its extension. The rail, the panel
// rows and the detail pane all read it from here, so a file is one category
// everywhere.

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : name;
}

/** Files per category, most first, ties alphabetical. */
export function countByCategory(paths: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const ext = extensionOf(p);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1));
}

/**
 * The shortest trailing run of path segments that no other visible path shares,
 * so `src/utils` reads as `utils` unless another `utils` is on screen.
 */
export function shortestUniqueLabels(paths: readonly string[]): Map<string, string> {
  const segments = new Map(paths.map((p) => [p, p.split("/")]));
  const suffix = (p: string, k: number) => {
    const parts = segments.get(p) ?? [];
    return parts.slice(Math.max(0, parts.length - k)).join("/");
  };
  const longest = Math.max(1, ...[...segments.values()].map((s) => s.length));

  const labels = new Map<string, string>();
  let pending = [...new Set(paths)];
  for (let k = 1; k <= longest && pending.length > 0; k++) {
    const counts = new Map<string, number>();
    for (const p of paths) counts.set(suffix(p, k), (counts.get(suffix(p, k)) ?? 0) + 1);
    pending = pending.filter((p) => {
      if (counts.get(suffix(p, k)) !== 1) return true;
      labels.set(p, suffix(p, k));
      return false;
    });
  }
  // Only identical paths are left, and those can't be told apart by any suffix.
  for (const p of pending) labels.set(p, p);
  return labels;
}

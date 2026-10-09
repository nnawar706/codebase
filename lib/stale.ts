// Nothing here has a queue or a timeout, so a process that dies mid-run leaves
// its row unfinished forever. A run that hasn't written anything for this long
// is called stale, so abandoned reads differently from working. Every stage
// writes within seconds on any repository this can parse.
const STALE_AFTER_MS = 5 * 60 * 1000;

/** Judged once, when the server renders the row. */
export function isStale(status: string, updatedAt: string): boolean {
  const unfinished = status === "queued" || status === "running";
  return unfinished && Date.now() - Date.parse(updatedAt) > STALE_AFTER_MS;
}

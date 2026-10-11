import { fanCounts } from "@/parser/graph";
import { readStoredResult, type StoredResult } from "@/parser/read";
import { EDGE_KINDS, type EdgeKind } from "@/parser/types";
import { moduleOf } from "@/parser/walk";
import type { createServerSupabase } from "./supabase";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

// The API returns at most this many rows per request whatever is asked for,
// so a large repository is read in pages. Each read checks it got as many
// rows as the count says exist: a map missing its last thousand files must
// fail, not render.
const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

async function readAll<T>(what: string, page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  do {
    const { data, error, count } = await page(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(`Couldn't read ${what}: ${error.message}`);
    if (count === null) throw new Error(`Reading ${what} returned no count`);
    total ??= count;
    if (!data || data.length === 0) break;
    rows.push(...data);
  } while (rows.length < total);
  if (rows.length !== total) throw new Error(`Read ${rows.length} ${what} of ${total}`);
  return rows;
}

const edgeKind = (kind: string): EdgeKind => {
  const known = EDGE_KINDS.find((k) => k === kind);
  if (!known) throw new Error(`Stored edge kind "${kind}" is not one the explorer knows`);
  return known;
};

/**
 * Reassembles what the parser produced from the stored rows, read through the
 * person's own token. Fan counts and folders aren't stored; they're the same
 * arithmetic over paths and edges the parser does.
 */
const has = (v: unknown, key: string): v is Record<string, unknown> => typeof v === "object" && v !== null && key in v;

/**
 * An analysis stored by an earlier parser can't be read as if it were current.
 * Before routes were recovered there's no route coverage, and the roles came
 * from adapters that no longer exist: it would show an empty route table that
 * never looked. Before require() was read there's no count for it, and a
 * CommonJS repository would show no edges and full coverage of nothing.
 */
export function predatesParser(coverage: unknown): boolean {
  if (!has(coverage, "routes")) return true;
  const imports = has(coverage, "imports") ? coverage.imports : null;
  const byKind = has(imports, "byKind") ? imports.byKind : null;
  return !has(byKind, "require");
}

/**
 * What was stored, and apart from it the roles a model gave files no
 * convention matched. Those are labels: they never become a file's role,
 * because a role decides the rail and the entry-point colouring and only
 * convention may decide those.
 */
export interface StoredAnalysis {
  result: StoredResult;
  /** Path -> model-given role. */
  labels: Map<string, string>;
}

export async function loadStoredResult(
  supabase: Supabase,
  analysisId: string,
  adapter: string,
  coverage: unknown,
): Promise<StoredAnalysis> {
  // Ordered by id so pages don't overlap or skip while reading.
  const [files, roles, edges, routes] = await Promise.all([
    readAll("files", (from, to) =>
      supabase.from("files").select("id, path, lines, hash", { count: "exact" }).eq("analysis_id", analysisId).order("id").range(from, to),
    ),
    readAll("file roles", (from, to) =>
      supabase.from("file_roles").select("file_id, role, source", { count: "exact" }).eq("analysis_id", analysisId).order("id").range(from, to),
    ),
    readAll("edges", (from, to) =>
      supabase
        .from("edges")
        .select("source_file_id, target_file_id, kind", { count: "exact" })
        .eq("analysis_id", analysisId)
        .order("id")
        .range(from, to),
    ),
    readAll("routes", (from, to) =>
      supabase
        .from("routes")
        .select("file_id, method, path, line", { count: "exact" })
        .eq("analysis_id", analysisId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const pathOf = new Map(files.map((f) => [f.id, f.path]));
  const roleOf = new Map(roles.filter((r) => r.source === "convention").map((r) => [r.file_id, r.role]));
  const labelOf = new Map(roles.filter((r) => r.source === "ai").map((r) => [r.file_id, r.role]));
  const named = edges.map((e) => {
    const from = pathOf.get(e.source_file_id);
    const to = pathOf.get(e.target_file_id);
    if (!from || !to) throw new Error("A stored edge points at a file that wasn't read");
    return { from, to, kind: edgeKind(e.kind) };
  });

  const located = routes.map((r) => {
    const file = pathOf.get(r.file_id);
    if (!file) throw new Error("A stored route points at a file that wasn't read");
    return { file, line: r.line, method: r.method, path: r.path };
  });

  const paths = files.map((f) => f.path);
  const fans = fanCounts(paths, named);
  const result = readStoredResult({
    adapter,
    files: files
      .map((f) => {
        const fan = fans.get(f.path);
        if (!fan) throw new Error(`No fan counts for ${f.path}`);
        return {
          path: f.path,
          module: moduleOf(f.path),
          lines: f.lines,
          hash: f.hash,
          role: roleOf.get(f.id) ?? null,
          fanIn: fan.fanIn,
          fanOut: fan.fanOut,
        };
      })
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
    edges: named.sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
    ),
    routes: located,
    coverage,
  });
  const labels = new Map(
    [...labelOf].map(([fileId, role]) => {
      const path = pathOf.get(fileId);
      if (!path) throw new Error("A stored label points at a file that wasn't read");
      return [path, role] as const;
    }),
  );
  return { result, labels };
}

import { fanCounts } from "./graph.ts";
import {
  EDGE_KINDS,
  EXCLUDED_REASONS,
  IMPORT_OUTCOMES,
  SCHEMA_VERSION,
  SKIP_REASONS,
  UNRESOLVED_REASONS,
  type Coverage,
  type Edge,
  type FileNode,
  type OutcomeCounts,
  type ParseResult,
  type SkippedFile,
  type UnresolvedImport,
} from "./types.ts";

// Reading the parser's output back is where a silently drifted shape would
// slip into everything downstream, so every field is checked, not assumed.

class ShapeError extends Error {}

type Obj = Record<string, unknown>;

const fail = (at: string, expected: string): never => {
  throw new ShapeError(`${at}: expected ${expected}`);
};
const obj = (v: unknown, at: string): Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : fail(at, "an object");
const str = (v: unknown, at: string): string => (typeof v === "string" ? v : fail(at, "a string"));
const int = (v: unknown, at: string): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fail(at, "a non-negative integer");
const arr = <T>(v: unknown, at: string, item: (x: unknown, at: string) => T): T[] =>
  Array.isArray(v) ? v.map((x, i) => item(x, `${at}[${i}]`)) : fail(at, "an array");
const oneOf = <T extends string>(values: readonly T[]) => (v: unknown, at: string): T =>
  values.find((x) => x === v) ?? fail(at, `one of ${values.join(", ")}`);

const edgeKind = oneOf(EDGE_KINDS);

const fileNode = (v: unknown, at: string): FileNode => {
  const o = obj(v, at);
  return {
    path: str(o.path, `${at}.path`),
    module: str(o.module, `${at}.module`),
    lines: int(o.lines, `${at}.lines`),
    hash: /^[0-9a-f]{64}$/.test(str(o.hash, `${at}.hash`)) ? str(o.hash, `${at}.hash`) : fail(`${at}.hash`, "sha256 hex"),
    role: o.role === null ? null : str(o.role, `${at}.role`),
    fanIn: int(o.fanIn, `${at}.fanIn`),
    fanOut: int(o.fanOut, `${at}.fanOut`),
  };
};

const edge = (v: unknown, at: string): Edge => {
  const o = obj(v, at);
  return { from: str(o.from, `${at}.from`), to: str(o.to, `${at}.to`), kind: edgeKind(o.kind, `${at}.kind`) };
};

const skippedFile = (v: unknown, at: string): SkippedFile => {
  const o = obj(v, at);
  return {
    path: str(o.path, `${at}.path`),
    reason: oneOf(SKIP_REASONS)(o.reason, `${at}.reason`),
    detail: str(o.detail, `${at}.detail`),
  };
};

const unresolvedImport = (v: unknown, at: string): UnresolvedImport => {
  const o = obj(v, at);
  return {
    from: str(o.from, `${at}.from`),
    line: int(o.line, `${at}.line`),
    specifier: str(o.specifier, `${at}.specifier`),
    kind: edgeKind(o.kind, `${at}.kind`),
    reason: oneOf(UNRESOLVED_REASONS)(o.reason, `${at}.reason`),
    detail: str(o.detail, `${at}.detail`),
  };
};

const outcomeCounts = (v: unknown, at: string): OutcomeCounts => {
  const o = obj(v, at);
  const counts: OutcomeCounts = {
    total: int(o.total, `${at}.total`),
    internal: int(o.internal, `${at}.internal`),
    external: int(o.external, `${at}.external`),
    excluded: int(o.excluded, `${at}.excluded`),
    unresolved: int(o.unresolved, `${at}.unresolved`),
  };
  const sum = IMPORT_OUTCOMES.reduce((n, k) => n + counts[k], 0);
  if (sum !== counts.total) fail(at, `outcomes summing to total ${counts.total}, got ${sum}`);
  return counts;
};

const coverage = (v: unknown, at: string): Coverage => {
  const o = obj(v, at);
  const f = obj(o.files, `${at}.files`);
  const i = obj(o.imports, `${at}.imports`);
  const k = obj(i.byKind, `${at}.imports.byKind`);
  const x = obj(i.excludedByReason, `${at}.imports.excludedByReason`);
  return {
    files: {
      found: int(f.found, `${at}.files.found`),
      parsed: int(f.parsed, `${at}.files.parsed`),
      skipped: int(f.skipped, `${at}.files.skipped`),
      skippedFiles: arr(f.skippedFiles, `${at}.files.skippedFiles`, skippedFile),
      excludedDirectories: arr(f.excludedDirectories, `${at}.files.excludedDirectories`, str),
    },
    imports: {
      total: outcomeCounts(i.total, `${at}.imports.total`),
      byKind: {
        import: outcomeCounts(k.import, `${at}.imports.byKind.import`),
        "re-export": outcomeCounts(k["re-export"], `${at}.imports.byKind.re-export`),
        "dynamic-import": outcomeCounts(k["dynamic-import"], `${at}.imports.byKind.dynamic-import`),
      },
      excludedByReason: {
        "skipped-file": int(x["skipped-file"], `${at}.imports.excludedByReason.skipped-file`),
        "excluded-directory": int(x["excluded-directory"], `${at}.imports.excludedByReason.excluded-directory`),
        "non-source-file": int(x["non-source-file"], `${at}.imports.excludedByReason.non-source-file`),
      },
      unresolved: arr(i.unresolved, `${at}.imports.unresolved`, unresolvedImport),
    },
    configWarnings: arr(o.configWarnings, `${at}.configWarnings`, str),
  };
};

/** Checks the relationships between fields, which the shape alone can't. */
function checkInvariants(r: ParseResult): void {
  const { files: fc, imports } = r.coverage;
  if (fc.found !== fc.parsed + fc.skipped) fail("coverage.files", `found = parsed + skipped (${fc.found} vs ${fc.parsed} + ${fc.skipped})`);
  if (fc.parsed !== r.files.length) fail("coverage.files.parsed", `${r.files.length}, the number of files`);
  if (fc.skipped !== fc.skippedFiles.length) fail("coverage.files.skipped", `${fc.skippedFiles.length}, the number listed`);

  const paths = new Set(r.files.map((f) => f.path));
  if (paths.size !== r.files.length) fail("files", "unique paths");
  for (const s of fc.skippedFiles) if (paths.has(s.path)) fail(`coverage.files.skippedFiles ${s.path}`, "a file that is not also parsed");

  const edgeKeys = new Set<string>();
  for (const e of r.edges) {
    if (!paths.has(e.from) || !paths.has(e.to)) fail(`edges ${e.from} -> ${e.to}`, "both ends to be files");
    const key = `${e.from}\0${e.to}\0${e.kind}`;
    if (edgeKeys.has(key)) fail(`edges ${e.from} -> ${e.to}`, "no duplicate edges");
    edgeKeys.add(key);
  }

  const fans = fanCounts([...paths], r.edges);
  for (const f of r.files) {
    const expected = fans.get(f.path);
    if (expected?.fanIn !== f.fanIn || expected.fanOut !== f.fanOut) fail(`files ${f.path}`, "fan counts that match the edges");
  }

  const sumOver = (k: keyof OutcomeCounts) => EDGE_KINDS.reduce((n, kind) => n + imports.byKind[kind][k], 0);
  for (const k of [...IMPORT_OUTCOMES, "total"] as const) {
    if (sumOver(k) !== imports.total[k]) fail(`coverage.imports.total.${k}`, "the sum over kinds");
  }
  if (imports.unresolved.length !== imports.total.unresolved) fail("coverage.imports.unresolved", "every unresolved import listed");
  const excludedSum = EXCLUDED_REASONS.reduce((n, k) => n + imports.excludedByReason[k], 0);
  if (excludedSum !== imports.total.excluded) fail("coverage.imports.excludedByReason", "reasons summing to the excluded total");
}

/** Parses and validates a parser output file's contents. Throws on any mismatch. */
export function readParseResult(json: string): ParseResult {
  const o = obj(JSON.parse(json), "result");
  if (o.schemaVersion !== SCHEMA_VERSION) fail("result.schemaVersion", String(SCHEMA_VERSION));
  const result: ParseResult = {
    schemaVersion: SCHEMA_VERSION,
    root: str(o.root, "result.root"),
    adapter: str(o.adapter, "result.adapter"),
    files: arr(o.files, "result.files", fileNode),
    edges: arr(o.edges, "result.edges", edge),
    coverage: coverage(o.coverage, "result.coverage"),
  };
  checkInvariants(result);
  return result;
}

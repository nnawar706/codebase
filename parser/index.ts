import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Project, ts } from "ts-morph";
import { pickAdapter, type FrameworkAdapter } from "./adapter.ts";
import { dedupeEdges, fanCounts, type ResolvedImport } from "./graph.ts";
import { findImports } from "./imports.ts";
import { createResolver, type Resolution } from "./resolve.ts";
import {
  SCHEMA_VERSION,
  type EdgeKind,
  type ExcludedReason,
  type OutcomeCounts,
  type ParseResult,
  type SkippedFile,
  type UnresolvedImport,
} from "./types.ts";
import { isDeclarationPath, moduleOf, walk } from "./walk.ts";

export type { ParseResult } from "./types.ts";

// Large enough for any hand-written file; past it, it's almost always generated.
const MAX_FILE_BYTES = 1_000_000;

const emptyCounts = (): OutcomeCounts => ({ total: 0, internal: 0, external: 0, excluded: 0, unresolved: 0 });

const countLines = (text: string) => {
  if (text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/).length;
  return /(\r\n|\r|\n)$/.test(text) ? lines - 1 : lines;
};

/** Names declared by the repository's own package.json files. */
function packageNames(root: string, manifests: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const rel of manifests) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(`${root}/${rel}`, "utf8"));
    } catch {
      // A broken package.json declares nothing; it isn't a code file, so it isn't counted.
      continue;
    }
    if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string") {
      names.add(parsed.name);
    }
  }
  return names;
}

export function parseRepository(rootPath: string, adapters: readonly FrameworkAdapter[] = []): ParseResult {
  const root = path.resolve(rootPath).replace(/\\/g, "/");
  const adapter = pickAdapter(root, adapters);
  const { sourceFiles, symlinks, manifests, excludedDirectories } = walk(root);

  const skippedFiles: SkippedFile[] = symlinks.map((p) => ({
    path: p,
    reason: "symlink",
    detail: "symbolic links are not followed",
  }));

  // Parse-only project: no type checking, no lib, no following imports. Paths
  // are virtual so nothing touches the disk after the read below.
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve },
  });

  const read = new Map<string, { text: string; hash: string }>();
  for (const rel of sourceFiles) {
    if (isDeclarationPath(rel)) {
      skippedFiles.push({ path: rel, reason: "declaration-file", detail: "types only, no runtime code" });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(`${root}/${rel}`);
    } catch (error) {
      skippedFiles.push({ path: rel, reason: "unreadable", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (bytes.length > MAX_FILE_BYTES) {
      skippedFiles.push({ path: rel, reason: "too-large", detail: `${bytes.length} bytes, limit ${MAX_FILE_BYTES}` });
      continue;
    }
    if (bytes.includes(0)) {
      skippedFiles.push({ path: rel, reason: "binary", detail: "contains a NUL byte" });
      continue;
    }
    const text = bytes.toString("utf8");
    read.set(rel, { text, hash: createHash("sha256").update(bytes).digest("hex") });
    project.createSourceFile(`/${rel}`, text);
  }

  // A file the parser can't read cleanly could yield half its imports. Better
  // to skip it by name than to draw a partial set of edges with confidence.
  const program = project.getProgram().compilerObject;
  const parsed = new Map<string, ts.SourceFile>();
  for (const rel of read.keys()) {
    const sf = program.getSourceFile(`/${rel}`);
    if (!sf) throw new Error(`Parsed project lost ${rel}`);
    const [first] = program.getSyntacticDiagnostics(sf);
    if (first) {
      const at = first.start === undefined ? "" : `line ${sf.getLineAndCharacterOfPosition(first.start).line + 1}: `;
      skippedFiles.push({
        path: rel,
        reason: "syntax-error",
        detail: `${at}${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
      });
      continue;
    }
    parsed.set(rel, sf);
  }

  const nodes = new Set(parsed.keys());
  const { resolve, warnings } = createResolver({
    root,
    nodes,
    skipped: new Set(skippedFiles.map((s) => s.path)),
    workspacePackages: packageNames(root, manifests),
  });

  const total = emptyCounts();
  const byKind: Record<EdgeKind, OutcomeCounts> = {
    import: emptyCounts(),
    "re-export": emptyCounts(),
    "dynamic-import": emptyCounts(),
  };
  const excludedByReason: Record<ExcludedReason, number> = {
    "skipped-file": 0,
    "excluded-directory": 0,
    "non-source-file": 0,
  };
  const unresolved: UnresolvedImport[] = [];
  const resolved: ResolvedImport[] = [];

  for (const [from, sf] of parsed) {
    for (const found of findImports(sf)) {
      const result: Resolution = resolve(from, found.specifier, found.kind, found.literal);
      for (const counts of [total, byKind[found.kind]]) {
        counts.total += 1;
        counts[result.outcome] += 1;
      }
      if (result.outcome === "internal") resolved.push({ from, to: result.target, kind: found.kind });
      else if (result.outcome === "excluded") excludedByReason[result.reason] += 1;
      else if (result.outcome === "unresolved") {
        unresolved.push({
          from,
          line: found.line,
          specifier: found.specifier,
          kind: found.kind,
          reason: result.reason,
          detail: result.detail,
        });
      }
    }
  }

  const edges = dedupeEdges(resolved);
  const fans = fanCounts([...nodes], edges);
  const files = [...nodes].sort().map((p) => {
    const fan = fans.get(p);
    const contents = read.get(p);
    if (!fan || !contents) throw new Error(`Lost track of ${p}`);
    return {
      path: p,
      module: moduleOf(p),
      lines: countLines(contents.text),
      hash: contents.hash,
      role: adapter.roleOf(p),
      fanIn: fan.fanIn,
      fanOut: fan.fanOut,
    };
  });

  skippedFiles.sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    adapter: adapter.name,
    files,
    edges,
    coverage: {
      files: {
        found: sourceFiles.length + symlinks.length,
        parsed: files.length,
        skipped: skippedFiles.length,
        skippedFiles,
        excludedDirectories,
      },
      imports: { total, byKind, excludedByReason, unresolved },
      configWarnings: warnings,
    },
  };
}

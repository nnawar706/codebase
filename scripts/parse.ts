// Runs the parser against a directory and prints what it found.
//
//   node scripts/parse.ts <dir> [--out result.json]
//   node scripts/parse.ts --read result.json
//
// --read loads a written result through the validator, so a file that no longer
// matches the contract fails here rather than downstream.

import { readFileSync, writeFileSync } from "node:fs";
import { ADAPTERS } from "../parser/adapters/index.ts";
import { parseRepository } from "../parser/index.ts";
import { readParseResult } from "../parser/read.ts";
import { EDGE_KINDS, IMPORT_OUTCOMES, type ParseResult } from "../parser/types.ts";

const UNRESOLVED_SHOWN = 25;

function print(result: ParseResult): void {
  const { files: fc, imports } = result.coverage;
  const modules = new Set(result.files.map((f) => f.module));
  const lines = result.files.reduce((n, f) => n + f.lines, 0);

  console.log(`root     ${result.root}`);
  console.log(`adapter  ${result.adapter}`);
  console.log();
  console.log(`files    found ${fc.found}  parsed ${fc.parsed}  skipped ${fc.skipped}`);
  console.log(`         ${modules.size} folders, ${lines} lines`);
  for (const s of fc.skippedFiles) console.log(`  skip   ${s.path}  [${s.reason}] ${s.detail}`);
  if (fc.excludedDirectories.length > 0) console.log(`  not walked: ${fc.excludedDirectories.join(", ")}`);
  console.log();

  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`imports  ${"".padEnd(14)}${["total", ...IMPORT_OUTCOMES].map((h) => pad(h, 11)).join("")}`);
  for (const kind of [...EDGE_KINDS, "all"] as const) {
    const c = kind === "all" ? imports.total : imports.byKind[kind];
    console.log(`         ${kind.padEnd(14)}${[c.total, ...IMPORT_OUTCOMES.map((o) => c[o])].map((n) => pad(n, 11)).join("")}`);
  }
  const excluded = Object.entries(imports.excludedByReason).filter(([, n]) => n > 0);
  if (excluded.length > 0) console.log(`  excluded by reason: ${excluded.map(([r, n]) => `${r} ${n}`).join(", ")}`);
  console.log();

  const kinds = EDGE_KINDS.map((k) => `${k} ${result.edges.filter((e) => e.kind === k).length}`).join(", ");
  console.log(`edges    ${result.edges.length} (${kinds})`);
  console.log();

  const roles = new Map<string, number>();
  for (const f of result.files) roles.set(f.role ?? "(none)", (roles.get(f.role ?? "(none)") ?? 0) + 1);
  console.log(`roles    ${[...roles].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, n]) => `${r} ${n}`).join(", ")}`);
  console.log();

  const { unrecovered } = result.coverage.routes;
  console.log(`routes   ${result.routes.length}, ${unrecovered.length} not recovered`);
  for (const r of result.routes) console.log(`  ${r.method.padEnd(7)} ${r.path}  ${r.file}:${r.line}`);
  for (const u of unrecovered) console.log(`  none    ${u.file}:${u.line}  ${u.detail}`);
  console.log();

  console.log(`unresolved ${imports.unresolved.length}`);
  for (const u of imports.unresolved.slice(0, UNRESOLVED_SHOWN)) {
    console.log(`  ${u.from}:${u.line}  ${u.kind} "${u.specifier}"  [${u.reason}] ${u.detail}`);
  }
  if (imports.unresolved.length > UNRESOLVED_SHOWN) {
    console.log(`  … ${imports.unresolved.length - UNRESOLVED_SHOWN} more, all listed in the output file`);
  }
  for (const w of result.coverage.configWarnings) console.log(`config warning  ${w}`);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value) throw new Error(`${name} needs a path`);
  args.splice(i, 2);
  return value;
};

const readPath = flag("--read");
const outPath = flag("--out");

if (readPath) {
  const result = readParseResult(readFileSync(readPath, "utf8"));
  console.log(`read back ${readPath}: valid, schema v${result.schemaVersion}`);
  print(result);
} else {
  const [dir] = args;
  if (!dir || args.length > 1) {
    console.error("usage: node scripts/parse.ts <dir> [--out result.json] | --read result.json");
    process.exit(1);
  }
  const started = performance.now();
  const result = parseRepository(dir, ADAPTERS);
  print(result);
  console.log(`\nparsed in ${Math.round(performance.now() - started)} ms`);
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`wrote ${outPath}`);
  }
}

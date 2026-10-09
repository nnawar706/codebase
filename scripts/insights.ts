// Prints the insights for a written parser result, and checks every reported
// loop edge by edge against the result's own edges.
//
//   node scripts/insights.ts data/preview-react-hook-form.json [--walk <path>]

import { readFileSync } from "node:fs";
import { INSIGHT_SENTENCES, insights } from "../lib/graph/insights.ts";
import { walk } from "../lib/graph/walk.ts";
import { readParseResult } from "../parser/read.ts";

const args = process.argv.slice(2);
const w = args.indexOf("--walk");
const walkFrom = w === -1 ? undefined : args.splice(w, 2)[1];
const [input] = args;
if (!input) {
  console.error("usage: node scripts/insights.ts result.json [--walk <path>]");
  process.exit(1);
}

const { files, edges } = readParseResult(readFileSync(input, "utf8"));
const found = insights(files, edges);
const joined = new Set(edges.map((e) => `${e.from}\0${e.to}`));

console.log(`unimported ${found.unimported.length}  ${INSIGHT_SENTENCES.unimported}`);
for (const f of found.unimported) console.log(`  ${f.path}`);
console.log(`\nmany importers ${found.manyImporters.length}  ${INSIGHT_SENTENCES.manyImporters}`);
for (const f of found.manyImporters) console.log(`  ←${f.fanIn}  ${f.path}`);
console.log(`\ncycles ${found.cycles.length}  ${INSIGHT_SENTENCES.cycles}`);
for (const loop of found.cycles) {
  const broken = loop.filter((p, i) => !joined.has(`${p}\0${loop[(i + 1) % loop.length]}`));
  if (broken.length > 0) throw new Error(`Loop ${loop.join(" -> ")} is not in the edges after ${broken.join(", ")}`);
  console.log(`  ${[...loop, loop[0]].join(" -> ")}`);
}
console.log(`\nlong ${found.long.length}  ${INSIGHT_SENTENCES.long}`);
for (const f of found.long) console.log(`  ${String(f.lines).padStart(5)}  ${f.path}`);

if (walkFrom) {
  for (const direction of ["dependents", "dependencies"] as const) {
    const reached = walk(edges, walkFrom, direction);
    console.log(`\n${direction} of ${walkFrom}: ${reached.length}`);
    for (const r of reached) console.log(`  ${r.depth}  ${r.path}`);
  }
}

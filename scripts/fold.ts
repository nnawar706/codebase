// Folds a written parser result the way the map does and prints the counts the
// phase 4 check asks for: nodes, files per node, and whether every edge lands.
//
//   node scripts/fold.ts data/preview-react-hook-form.json [--open <group>[:<scroll offset>]]...

import { readFileSync } from "node:fs";
import { fold, foldAt } from "../lib/map/fold.ts";
import { layout } from "../lib/map/layout.ts";
import { deriveView } from "../lib/map/view.ts";
import { readParseResult } from "../parser/read.ts";

const args = process.argv.slice(2);
const open = new Map<string, number>();
for (let i = args.indexOf("--open"); i !== -1; i = args.indexOf("--open")) {
  const group = args[i + 1];
  if (!group) throw new Error("--open needs a group id");
  const [id, offset] = group.split(":");
  open.set(id, Number(offset ?? 0));
  args.splice(i, 2);
}
const [input] = args;
if (!input) {
  console.error("usage: node scripts/fold.ts result.json [--open <group>]...");
  process.exit(1);
}

const result = readParseResult(readFileSync(input, "utf8"));
for (let t = 2; t <= 6; t++) console.log(`threshold ${t}: ${foldAt(result.files, t).groups.length} nodes`);
const folding = fold(result.files);
for (const g of open.keys()) if (!folding.groups.some((x) => x.id === g)) throw new Error(`No group ${g}`);

const view = deriveView(result.files, result.edges, folding, open);
const sizes = folding.groups.map((g) => g.files.length);
console.log();
console.log(`threshold ${folding.threshold}`);
console.log(`nodes     ${view.items.length} for ${result.files.length} files (one per ${(result.files.length / view.items.length).toFixed(1)})`);
console.log(`files per node  min ${Math.min(...sizes)}  max ${Math.max(...sizes)}  single-file nodes ${sizes.filter((n) => n === 1).length}`);

// An edge lands if its group is on the canvas and, for a panel, the row or
// "more" row it names exists in that panel.
const landing = new Set<string>();
for (const item of view.items) {
  if (item.kind === "folded") landing.add(`g:${item.id}`);
  else {
    for (const r of item.rows) landing.add(`f:${r.path}`);
    if (item.scrolls) landing.add(`u:${item.id}`).add(`d:${item.id}`);
  }
}
const dangling = view.edges.filter((e) => !landing.has(e.from) || !landing.has(e.to));
const fileEdges = view.edges.reduce((n, e) => n + e.count, 0);
console.log(`edges     ${view.edges.length} drawn, carrying ${fileEdges} of ${result.edges.length} file edges (rest are inside one node)`);
console.log(`dangling  ${dangling.length}`);
for (const e of dangling) console.log(`  ${e.id}`);

const { bounds } = layout(view);
console.log(`layout    ${Math.round(bounds.width)} x ${Math.round(bounds.height)}`);
console.log();
for (const item of view.items) {
  const extra = item.kind === "panel" ? `  panel ${item.rows.length} rows, ${item.above} above, ${item.below} below` : "";
  console.log(`${String(item.files).padStart(5)}  in ${String(item.fanIn).padStart(3)}  out ${String(item.fanOut).padStart(3)}  h ${String(item.height).padStart(3)}  ${item.label.padEnd(24)} ${item.id}${extra}`);
}

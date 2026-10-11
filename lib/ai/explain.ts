import { adjacency } from "../map/detail.ts";
import type { Folding } from "../map/fold.ts";
import type { Edge, EdgeKind, FileNode } from "../../parser/types.ts";
import { cacheKey, type Cache } from "./cache.ts";
import { MODEL, generate, traced } from "./client.ts";

// Everything the model is told comes from the parser: the paths, the roles and
// every edge. It's handed the whole neighbourhood up front and asked to
// describe it, never to find it, so it has no way to walk the graph and
// nothing to invent a connection from.

// Bump when a prompt changes, so cached answers to the old one are misses.
const PROMPT_VERSION = 1;
// The parser reads files up to 1 MB. Past this much source, the rest is cut
// and the model is told so, rather than sending a generated bundle whole.
const SOURCE_CHARS = 60_000;

const FORMAT = `Formatting: short paragraphs of plain prose. Only three kinds of formatting are allowed: \`inline code\`, **bold**, and bullet lists whose lines start with "- ". No headings, numbered lists, tables, code blocks, links or italics.

Write every repository file path in full, exactly as listed, inside inline code. Mention no file that isn't listed.

The import lists are the parser's complete record of how these files connect. Don't state or suggest any connection that isn't in them.

Describe, don't evaluate: no ratings, scores, problems, risks or suggestions.`;

/** A neighbour as the model sees it: where it is and what it is. */
export interface NeighbourFact {
  path: string;
  /** Convention's role, or the model-given label marked as such, or null. */
  role: string | null;
  kinds: EdgeKind[];
}

export interface FileQuestion {
  path: string;
  role: string | null;
  lines: number;
  /** sha256 of the source below; the source was checked against it. */
  hash: string;
  source: string;
  imports: NeighbourFact[];
  importers: NeighbourFact[];
}

export interface FolderQuestion {
  id: string;
  files: { path: string; role: string | null; lines: number; hash: string }[];
  /** Every edge from a file outside the folder to one inside it. */
  inbound: { from: string; to: string }[];
  /** Every edge from a file inside the folder to one outside it. */
  outbound: { from: string; to: string }[];
}

export interface Explained {
  text: string;
  /** Whether this came from the cache rather than a model call. */
  cached: boolean;
}

/** Convention's role where there is one, otherwise the model's label, said to be one. */
export function roleFor(file: Pick<FileNode, "path" | "role">, labels: ReadonlyMap<string, string>): string | null {
  if (file.role !== null) return file.role;
  const label = labels.get(file.path);
  return label === undefined ? null : `${label} (labelled by model)`;
}

export function fileQuestion(
  file: FileNode,
  source: string,
  files: readonly FileNode[],
  edges: readonly Edge[],
  labels: ReadonlyMap<string, string>,
): FileQuestion {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const adj = adjacency(edges);
  const fact = (n: { path: string; kinds: EdgeKind[] }): NeighbourFact => {
    const other = byPath.get(n.path);
    if (!other) throw new Error(`${n.path} is an edge's end but not a parsed file`);
    return { path: n.path, role: roleFor(other, labels), kinds: n.kinds };
  };
  return {
    path: file.path,
    role: roleFor(file, labels),
    lines: file.lines,
    hash: file.hash,
    source,
    imports: (adj.imports.get(file.path) ?? []).map(fact),
    importers: (adj.importers.get(file.path) ?? []).map(fact),
  };
}

export function folderQuestion(
  id: string,
  folding: Folding,
  files: readonly FileNode[],
  edges: readonly Edge[],
  labels: ReadonlyMap<string, string>,
): FolderQuestion {
  const group = folding.groups.find((g) => g.id === id);
  if (!group) throw new Error(`${id} is not a folder on the map`);
  const inside = new Set(group.files);
  const byPath = new Map(files.map((f) => [f.path, f]));
  // One line per pair of files, however many ways they're joined.
  const pairs = (keep: (e: Edge) => boolean) =>
    [...new Map(edges.filter(keep).map((e) => [`${e.from}\0${e.to}`, { from: e.from, to: e.to }])).values()];
  return {
    id,
    files: group.files.map((p) => {
      const f = byPath.get(p);
      if (!f) throw new Error(`${p} is in a folder but not a parsed file`);
      return { path: f.path, role: roleFor(f, labels), lines: f.lines, hash: f.hash };
    }),
    inbound: pairs((e) => !inside.has(e.from) && inside.has(e.to)),
    outbound: pairs((e) => inside.has(e.from) && !inside.has(e.to)),
  };
}

const describeRole = (role: string | null) => role ?? "no role identified";
const list = (items: readonly string[], empty: string) => (items.length === 0 ? empty : items.join("\n"));
const neighbourLine = (n: NeighbourFact) =>
  `- ${n.path} (${describeRole(n.role)}${n.kinds.some((k) => k !== "import") ? `; ${n.kinds.join(", ")}` : ""})`;

function filePrompt(q: FileQuestion): string {
  const cut = q.source.length > SOURCE_CHARS;
  const source = cut ? `${q.source.slice(0, SOURCE_CHARS)}\n… (cut here; the file is ${q.lines} lines)` : q.source;
  return `File: ${q.path}
Role: ${describeRole(q.role)}
Length: ${q.lines} lines

Files it imports (${q.imports.length}):
${list(q.imports.map(neighbourLine), "none in this repository")}

Files that import it (${q.importers.length}):
${list(q.importers.map(neighbourLine), "none in this repository")}

Source of ${q.path}:
${source}`;
}

function folderPrompt(q: FolderQuestion): string {
  const name = q.id === "." ? "the repository root" : q.id;
  return `Folder: ${name}
On the map this is one box holding ${q.files.length} files, including files in its subfolders.

Files in it:
${q.files.map((f) => `- ${f.path} (${describeRole(f.role)}, ${f.lines} lines)`).join("\n")}

Imports from outside the folder into it (${q.inbound.length}), as importer -> imported:
${list(q.inbound.map((e) => `- ${e.from} -> ${e.to}`), "none")}

Imports from it to files outside (${q.outbound.length}), as importer -> imported:
${list(q.outbound.map((e) => `- ${e.from} -> ${e.to}`), "none")}`;
}

const FILE_TASK = `You explain one file of a TypeScript or JavaScript repository to a developer reading its dependency map. Say what the file does, what it uses from the files it imports, and what the files importing it rely on it for. Two or three short paragraphs.

${FORMAT}`;

const FOLDER_TASK = `You explain one folder of a TypeScript or JavaScript repository to a developer reading its dependency map. Explain what the folder is for as a whole, not what any single file in it does, and why the files outside it that import from it depend on it. You have file paths and roles, not source, so say what the paths and the imports show and no more. Two or three short paragraphs.

${FORMAT}`;

/**
 * The key covers everything the prompt is built from. The source is covered
 * by its hash, which the caller checked the fetched bytes against.
 */
const fileKey = (q: FileQuestion) =>
  cacheKey({ v: PROMPT_VERSION, path: q.path, hash: q.hash, role: q.role, imports: q.imports, importers: q.importers });
const folderKey = (q: FolderQuestion) =>
  cacheKey({ v: PROMPT_VERSION, id: q.id, files: q.files, inbound: q.inbound, outbound: q.outbound });

/** Answers from the cache inside the traced run, so a hit is a run with no model call in it. */
async function answer(cache: Cache, subject: "file" | "folder", key: string, ask: () => Promise<string>): Promise<Explained> {
  const hit = (await cache.read(subject, [key])).get(key);
  if (hit !== undefined) return { text: hit, cached: true };
  const text = await ask();
  await cache.write(subject, new Map([[key, text]]));
  return { text, cached: false };
}

export const explainFile = traced(
  "explain file",
  ({ cache, question }: { cache: Cache; question: FileQuestion }) =>
    answer(cache, "file", fileKey(question), () => generate(filePrompt(question), { systemInstruction: FILE_TASK })),
  {
    inputs: ({ question }) => ({
      path: question.path,
      model: MODEL,
      key: fileKey(question),
      imports: question.imports.length,
      importers: question.importers.length,
    }),
    outputs: ({ text, cached }) => ({ cached, text }),
  },
);

export const explainFolder = traced(
  "explain folder",
  ({ cache, question }: { cache: Cache; question: FolderQuestion }) =>
    answer(cache, "folder", folderKey(question), () => generate(folderPrompt(question), { systemInstruction: FOLDER_TASK })),
  {
    inputs: ({ question }) => ({
      folder: question.id,
      model: MODEL,
      key: folderKey(question),
      files: question.files.length,
      inbound: question.inbound.length,
    }),
    outputs: ({ text, cached }) => ({ cached, text }),
  },
);

import type { Cache } from "./cache.ts";
import { cacheKey } from "./cache.ts";
import { MODEL, generate, traced } from "./client.ts";

// Roles the model may give a file no adapter recognised. None of them is
// structural: page, route and controller decide the route table and the
// entry-point colouring, and only convention may say those. The database
// refuses any other role with source 'ai', so this list and that check agree.
export const AI_ROLES = ["service", "repository", "model", "util", "config", "component", "hook"] as const;
export type AiRole = (typeof AI_ROLES)[number];

const NONE = "none";
// Bump when the prompt changes, so every cached label is asked again.
const PROMPT_VERSION = 1;
// Files per model call, and how much of each it sees. Enough of a file to
// tell a hook from a helper, small enough that a batch stays well inside the
// free tier's per-minute token limit.
const BATCH = 50;
const EXCERPT_LINES = 120;
const EXCERPT_CHARS = 6000;

export interface LabelInput {
  path: string;
  hash: string;
  source: string;
}

export interface Labelled {
  /** Path -> role, for every file the model gave a role. */
  labels: Map<string, AiRole>;
  /** Files the model said none of the roles fits. */
  noFit: number;
  /** Files the model's answer left out or answered with something not on the list. */
  unanswered: number;
}

const isRole = (v: unknown): v is AiRole => AI_ROLES.some((r) => r === v);

export function excerptOf(source: string): string {
  const lines = source.split(/\r\n|\r|\n/);
  const head = lines.slice(0, EXCERPT_LINES).join("\n").slice(0, EXCERPT_CHARS);
  return head.length < source.length ? `${head}\n… (${lines.length} lines in total, the rest not shown)` : head;
}

const INSTRUCTIONS = `You label files in a TypeScript or JavaScript repository. No framework convention identified these files, so each needs a role.

Give each file exactly one of these roles:
- service: business logic, or code that talks to an external system on the app's behalf
- repository: reads and writes stored data
- model: data shapes — types, schemas, entities, validators
- util: general helpers with no domain of their own
- config: configuration read by the app or a tool
- component: a UI component
- hook: a React hook
- none: none of the above fits

Judge each file only by its own path and source. Answer for every path, written exactly as given.`;

const SCHEMA = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, role: { type: "string", enum: [...AI_ROLES, NONE] } },
        required: ["path", "role"],
      },
    },
  },
  required: ["labels"],
};

/** Reads the model's JSON. Anything not shaped as asked is no answer, never a guess at one. */
function readAnswer(text: string, asked: ReadonlySet<string>): Map<string, AiRole | typeof NONE> {
  const answers = new Map<string, AiRole | typeof NONE>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${MODEL} answered the labelling request with something that isn't JSON`);
  }
  const labels = typeof parsed === "object" && parsed !== null && "labels" in parsed ? parsed.labels : null;
  if (!Array.isArray(labels)) throw new Error(`${MODEL}'s labelling answer has no list of labels`);
  for (const item of labels) {
    if (typeof item !== "object" || item === null || !("path" in item) || !("role" in item)) continue;
    const { path, role } = item;
    if (typeof path !== "string" || !asked.has(path) || answers.has(path)) continue;
    if (isRole(role) || role === NONE) answers.set(path, role);
  }
  return answers;
}

const keyOf = (f: LabelInput) => cacheKey({ v: PROMPT_VERSION, path: f.path, hash: f.hash });

/**
 * Labels every file given, from the cache where it can. A run whose labels are
 * all cached makes no model call. "none" is cached like any role, so a file
 * nothing fits isn't asked about again; a file the model skipped isn't
 * cached, so it is.
 */
export const labelFiles = traced(
  "label files",
  async ({ cache, files }: { cache: Cache; files: readonly LabelInput[] }): Promise<Labelled> => {
    const keys = new Map(files.map((f) => [f.path, keyOf(f)]));
    const cached = await cache.read("role", [...new Set(keys.values())]);

    const answered = new Map<string, string>();
    const missing: LabelInput[] = [];
    for (const f of files) {
      const hit = cached.get(keyOf(f));
      if (hit === undefined) missing.push(f);
      else answered.set(f.path, hit);
    }

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const prompt = batch.map((f) => `=== ${f.path}\n${excerptOf(f.source)}`).join("\n\n");
      const text = await generate(prompt, {
        systemInstruction: INSTRUCTIONS,
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
      });
      const answers = readAnswer(text, new Set(batch.map((f) => f.path)));
      const fresh = new Map<string, string>();
      for (const f of batch) {
        const role = answers.get(f.path);
        if (role === undefined) continue;
        answered.set(f.path, role);
        fresh.set(keyOf(f), role);
      }
      // Written per batch, so a later batch failing keeps what was already paid for.
      await cache.write("role", fresh);
    }

    const labels = new Map<string, AiRole>();
    let noFit = 0;
    for (const [path, role] of answered) {
      if (isRole(role)) labels.set(path, role);
      else if (role === NONE) noFit += 1;
    }
    return { labels, noFit, unanswered: files.length - labels.size - noFit };
  },
  {
    inputs: ({ files }) => ({ model: MODEL, files: files.length }),
    outputs: ({ labels, noFit, unanswered }) => ({ labelled: labels.size, noFit, unanswered }),
  },
);

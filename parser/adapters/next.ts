import { readFileSync } from "node:fs";
import type { FrameworkAdapter } from "../adapter.ts";
import { toolingRole } from "./tooling.ts";

// Next.js reaches these files by where they sit and what they're called, never
// by an import, so the import graph alone would call every one of them unused.

const SCRIPT = /\.[jt]sx?$/;

// App router files whose name is their role.
const APP_FILES = new Set([
  "page",
  "route",
  "layout",
  "template",
  "loading",
  "error",
  "global-error",
  "not-found",
  "default",
]);
const APP_METADATA = new Set(["sitemap", "robots", "manifest", "icon", "apple-icon", "opengraph-image", "twitter-image"]);

// Root-level files Next loads by name. Next 16 renamed middleware to proxy.
const ROOT_FILES: Record<string, string> = {
  middleware: "middleware",
  proxy: "middleware",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
};

function nextRole(path: string): string | null {
  if (!SCRIPT.test(path)) return null;
  const segments = path.replace(SCRIPT, "").split("/");
  // Next looks in the project root or in src/, nowhere deeper.
  const start = segments[0] === "src" ? 1 : 0;
  const top = segments[start];
  const rest = segments.slice(start + 1);
  const name = segments[segments.length - 1];

  if (rest.length === 0) return ROOT_FILES[top] ?? null;

  if (top === "app") {
    // A folder starting with an underscore is private: nothing under it is routed.
    if (rest.slice(0, -1).some((s) => s.startsWith("_"))) return null;
    if (APP_FILES.has(name)) return name;
    if (APP_METADATA.has(name)) return "metadata";
    return null;
  }

  if (top === "pages") {
    if (rest[0] === "api") return "route";
    if (name === "_app" || name === "_document") return "layout";
    return "page";
  }

  return null;
}

function dependsOnNext(root: string): boolean {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  } catch {
    return false;
  }
  if (typeof manifest !== "object" || manifest === null) return false;
  const hasNext = (deps: unknown) => typeof deps === "object" && deps !== null && "next" in deps;
  return (
    ("dependencies" in manifest && hasNext(manifest.dependencies)) ||
    ("devDependencies" in manifest && hasNext(manifest.devDependencies))
  );
}

export const nextAdapter: FrameworkAdapter = {
  name: "next",
  detect: dependsOnNext,
  roleOf: (path) => nextRole(path) ?? toolingRole(path),
};

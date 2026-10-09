import { readFileSync } from "node:fs";

/** Whether the repository's root package.json lists `name` as a dependency or dev dependency. */
export function dependsOn(root: string, name: string): boolean {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  } catch {
    return false;
  }
  if (typeof manifest !== "object" || manifest === null) return false;
  const lists = (deps: unknown) => typeof deps === "object" && deps !== null && name in deps;
  return (
    ("dependencies" in manifest && lists(manifest.dependencies)) ||
    ("devDependencies" in manifest && lists(manifest.devDependencies))
  );
}

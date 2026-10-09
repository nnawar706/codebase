import { frameworkOf, type Framework } from "../../parser/adapters/taxonomy.ts";
import type { FileNode } from "../../parser/types.ts";

// The rail's rows: the adapter's categories in the taxonomy's fixed order,
// each with the files in it, then the files no convention matched.

export interface RailRow {
  label: string;
  paths: ReadonlySet<string>;
}

export interface Rail {
  framework: Framework;
  categories: RailRow[];
  /** Files no convention identified. Always last, so the categories above add up with it to every file. */
  unmatched: RailRow;
}

export const UNMATCHED_LABEL = "No convention";

export function frameworkFor(adapter: string): Framework {
  const framework = frameworkOf(adapter);
  if (!framework) throw new Error(`Adapter "${adapter}" has no categories in the taxonomy`);
  return framework;
}

export function rail(adapter: string, files: readonly Pick<FileNode, "path" | "role">[]): Rail {
  const framework = frameworkFor(adapter);
  const categoryOf = new Map(framework.categories.flatMap((c, i) => c.roles.map((r) => [r, i] as const)));
  const members = framework.categories.map(() => new Set<string>());
  const unmatched = new Set<string>();
  for (const f of files) {
    if (f.role === null) {
      unmatched.add(f.path);
      continue;
    }
    // A role the taxonomy doesn't list would be silently missing from the rail.
    const index = categoryOf.get(f.role);
    if (index === undefined) throw new Error(`${f.path} has role "${f.role}", which ${adapter} has no category for`);
    members[index].add(f.path);
  }
  return {
    framework,
    categories: framework.categories.map((c, i) => ({ label: c.label, paths: members[i] })),
    unmatched: { label: UNMATCHED_LABEL, paths: unmatched },
  };
}

/** Whether a file with this role is reached by its framework or tooling rather than by an import. */
export function reachedByConvention(framework: Framework): (role: string | null) => boolean {
  const roles = new Set(framework.categories.filter((c) => c.reachedByConvention).flatMap((c) => c.roles));
  return (role) => role !== null && roles.has(role);
}

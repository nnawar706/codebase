import type { ts } from "ts-morph";
import type { Route, UnrecoveredRoute } from "./types.ts";

// Framework knowledge lives behind this interface so the parser never branches
// on a framework. An adapter only adds meaning to files the parser already
// found; it can't add files or edges.

export interface RouteScan {
  routes: Route[];
  unrecovered: UnrecoveredRoute[];
}

export interface FrameworkAdapter {
  name: string;
  /** Whether this adapter applies to the repository at `root`. */
  detect(root: string): boolean;
  /** What the file is by this framework's conventions, or null if nothing. */
  roleOf(path: string, source: ts.SourceFile): string | null;
  /**
   * Every route the parsed files declare, given all of them at once: a prefix
   * set in one file can change the pattern of a route declared in another.
   */
  routesOf(root: string, files: ReadonlyMap<string, ts.SourceFile>): RouteScan;
}

/** Assumes no framework: recognises nothing, so every role is null and there are no routes. */
export const fallbackAdapter: FrameworkAdapter = {
  name: "none",
  detect: () => true,
  roleOf: () => null,
  routesOf: () => ({ routes: [], unrecovered: [] }),
};

export function pickAdapter(root: string, adapters: readonly FrameworkAdapter[]): FrameworkAdapter {
  return adapters.find((a) => a.detect(root)) ?? fallbackAdapter;
}

// Framework knowledge lives behind this interface so the parser never branches
// on a framework. An adapter only adds meaning to files the parser already
// found; it can't add files or edges.

export interface FrameworkAdapter {
  name: string;
  /** Whether this adapter applies to the repository at `root`. */
  detect(root: string): boolean;
  /** What the file is by this framework's conventions, or null if nothing. */
  roleOf(path: string): string | null;
}

/** Assumes no framework: recognises nothing, so every role is null. */
export const fallbackAdapter: FrameworkAdapter = {
  name: "none",
  detect: () => true,
  roleOf: () => null,
};

export function pickAdapter(root: string, adapters: readonly FrameworkAdapter[]): FrameworkAdapter {
  return adapters.find((a) => a.detect(root)) ?? fallbackAdapter;
}

// The shape the parser writes. Everything downstream reads this, so a change
// here is a change to a contract: bump SCHEMA_VERSION when it changes.
//
// Type aliases, not interfaces: only an alias is assignable to a JSON column's
// type, and the result is stored as-is.

export const SCHEMA_VERSION = 2;

// Matches the `kind` values the edges table accepts. `require` is not parsed yet.
export const EDGE_KINDS = ["import", "re-export", "dynamic-import"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type FileNode = {
  /** Repository-relative, forward slashes. */
  path: string;
  /** The folder the file sits in, repository-relative. "." for the root. */
  module: string;
  lines: number;
  /** sha256 of the raw bytes, hex. */
  hash: string;
  /** What a framework adapter recognised this file as. null when nothing did. */
  role: string | null;
  /** Distinct files that import this one. */
  fanIn: number;
  /** Distinct files this one imports. */
  fanOut: number;
};

/** One per (from, to, kind). Both ends are always entries in `files`. */
export type Edge = {
  from: string;
  to: string;
  kind: EdgeKind;
};

export const SKIP_REASONS = ["declaration-file", "too-large", "binary", "unreadable", "syntax-error", "symlink"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type SkippedFile = {
  path: string;
  reason: SkipReason;
  detail: string;
};

export const IMPORT_OUTCOMES = ["internal", "external", "excluded", "unresolved"] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

/** Resolved to a real file in the repository that deliberately isn't a node. */
export const EXCLUDED_REASONS = ["skipped-file", "excluded-directory", "non-source-file"] as const;
export type ExcludedReason = (typeof EXCLUDED_REASONS)[number];

export const UNRESOLVED_REASONS = [
  "not-found",
  "alias-target-missing",
  "base-url-target-missing",
  "case-mismatch",
  "workspace-package-not-linked",
  "non-literal-dynamic",
] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

export type UnresolvedImport = {
  from: string;
  line: number;
  /** For a non-literal dynamic import, the expression's source text. */
  specifier: string;
  kind: EdgeKind;
  reason: UnresolvedReason;
  detail: string;
};

export type OutcomeCounts = Record<ImportOutcome, number> & { total: number };

export type Coverage = {
  files: {
    found: number;
    parsed: number;
    skipped: number;
    skippedFiles: SkippedFile[];
    /** Directories never walked into, repository-relative. */
    excludedDirectories: string[];
  };
  imports: {
    total: OutcomeCounts;
    byKind: Record<EdgeKind, OutcomeCounts>;
    excludedByReason: Record<ExcludedReason, number>;
    /** Every unresolved import, not a sample. */
    unresolved: UnresolvedImport[];
  };
  /** Problems reading the repository's own tsconfig/jsconfig files. */
  configWarnings: string[];
};

export type ParseResult = {
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  adapter: string;
  files: FileNode[];
  edges: Edge[];
  coverage: Coverage;
};

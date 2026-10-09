import { readdirSync } from "node:fs";
import path from "node:path";

export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

// Installed packages and build output. Hidden directories are tool state by
// convention, which covers framework caches without naming any framework.
const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist", "build", "out", "coverage"]);

export function isExcludedDirName(name: string): boolean {
  return name.startsWith(".") || EXCLUDED_DIR_NAMES.has(name);
}

export function isSourcePath(p: string): boolean {
  return SOURCE_EXTENSIONS.has(path.posix.extname(p));
}

export function isDeclarationPath(p: string): boolean {
  return /\.d\.([^/]+\.)?[mc]?ts$/.test(p);
}

/** Repository-relative folder a file belongs to. */
export function moduleOf(relPath: string): string {
  return path.posix.dirname(relPath);
}

export interface WalkResult {
  /** Repository-relative source files, forward slashes, sorted. */
  sourceFiles: string[];
  /** Symlinked source files: found, but not followed. */
  symlinks: string[];
  /** Repository-relative package.json files outside excluded directories. */
  manifests: string[];
  excludedDirectories: string[];
}

/**
 * Keeps whole directories rather than picking files, so a kept file never
 * imports a leaf that was dropped by a size cut.
 */
export function walk(root: string): WalkResult {
  const sourceFiles: string[] = [];
  const symlinks: string[] = [];
  const manifests: string[] = [];
  const excludedDirectories: string[] = [];

  const visit = (rel: string) => {
    const entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (isExcludedDirName(entry.name)) excludedDirectories.push(childRel);
        else visit(childRel);
      } else if (entry.isFile() && isSourcePath(childRel)) {
        sourceFiles.push(childRel);
      } else if (entry.isFile() && entry.name === "package.json") {
        manifests.push(childRel);
      } else if (entry.isSymbolicLink() && isSourcePath(childRel)) {
        symlinks.push(childRel);
      }
    }
  };
  visit("");

  return { sourceFiles: sourceFiles.sort(), symlinks: symlinks.sort(), manifests: manifests.sort(), excludedDirectories: excludedDirectories.sort() };
}

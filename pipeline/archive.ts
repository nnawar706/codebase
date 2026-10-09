import path from "node:path";
import { list, extract, type ReadEntry } from "tar";

// Checked against the listing before anything is written, so a repository
// over a limit fails by name instead of filling the disk first. The byte cap
// is on what extraction would write: a small archive can still expand hugely.
export const MAX_ENTRIES = 50_000;
export const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

// Headers the format uses to describe the next entry. Not content.
const METADATA = new Set(["GlobalExtendedHeader", "ExtendedHeader", "NextFileHasLongPath", "NextFileHasLongLinkpath", "OldGnuLongPath"]);

export interface Selection {
  /** The repository's root directory on disk. */
  root: string;
  files: number;
  bytes: number;
  /**
   * Repository-relative. Not written to disk: a link can point outside the
   * repository, and the resolver follows links when it checks a file exists.
   * Windows also can't create them without developer mode.
   */
  symlinks: string[];
}

/**
 * GitHub wraps every archive in one directory named after the commit. Each
 * entry is checked for that prefix rather than assuming it, so an archive
 * shaped differently fails instead of extracting somewhere unexpected.
 */
const splitPrefix = (entryPath: string) => {
  const clean = entryPath.replace(/\/+$/, "");
  const slash = clean.indexOf("/");
  return slash === -1 ? { prefix: clean, rel: "" } : { prefix: clean.slice(0, slash), rel: clean.slice(slash + 1) };
};

export async function selectArchive(file: string, dest: string): Promise<Selection> {
  const prefixes = new Set<string>();
  let entries = 0;
  let files = 0;
  let bytes = 0;
  const symlinks: string[] = [];
  const problems: string[] = [];

  await list({
    file,
    strict: true,
    onReadEntry: (entry: ReadEntry) => {
      if (METADATA.has(entry.type)) return;
      entries += 1;
      const split = splitPrefix(entry.path);
      prefixes.add(split.prefix);
      if (entry.type === "File" || entry.type === "OldFile" || entry.type === "ContiguousFile") {
        files += 1;
        bytes += entry.size ?? 0;
      } else if (entry.type === "SymbolicLink") {
        symlinks.push(split.rel);
      } else if (entry.type !== "Directory") {
        // A git archive only holds files, folders and links. Anything else
        // means this isn't what it claims to be.
        problems.push(`${entry.path} is a ${entry.type} entry, which a git archive never contains`);
      }
    },
  });

  if (prefixes.size > 1) problems.unshift(`entries sit under ${prefixes.size} top-level folders instead of one`);
  if (problems.length > 0) {
    throw new Error(`The archive isn't shaped like a GitHub archive: ${problems.slice(0, 3).join("; ")}`);
  }
  const [prefix] = prefixes;
  if (prefix === undefined) throw new Error("The archive is empty");
  if (entries > MAX_ENTRIES) {
    throw new Error(`The repository has ${entries} files and folders; the limit is ${MAX_ENTRIES}`);
  }
  if (bytes > MAX_EXTRACTED_BYTES) {
    throw new Error(
      `The repository unpacks to ${Math.round(bytes / 1024 / 1024)} MB; the limit is ${MAX_EXTRACTED_BYTES / 1024 / 1024} MB`,
    );
  }

  // strict turns tar's warnings into errors, so a path it refuses to write
  // (absolute, or climbing out with ..) fails the run instead of going missing.
  await extract({
    file,
    cwd: dest,
    strict: true,
    noChmod: true,
    filter: (_path, entry) => "type" in entry && entry.type !== "SymbolicLink",
  });

  return { root: path.join(dest, prefix), files, bytes, symlinks: symlinks.sort() };
}

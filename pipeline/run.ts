import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ADAPTERS } from "../parser/adapters/index.ts";
import { parseRepository } from "../parser/index.ts";
import type { FileNode, ParseResult } from "../parser/types.ts";
import { isExcludedDirName, isSourcePath } from "../parser/walk.ts";
import { createCache } from "../lib/ai/cache.ts";
import { describeFailure, flushTraces } from "../lib/ai/client.ts";
import { labelFiles, type AiRole } from "../lib/ai/label.ts";
import type { Database } from "../lib/database.types.ts";
import { selectArchive } from "./archive.ts";
import type { PipelineDb } from "./db.ts";
import { downloadArchive, resolveHeadCommit, type RepoRef } from "./github.ts";

export const STAGES = ["fetching", "selecting", "parsing", "labelling", "storing"] as const;
export type Stage = (typeof STAGES)[number];

export type RunOutcome =
  | { status: "complete"; commit: string; files: number; edges: number }
  | { status: "failed"; stage: Stage | null; error: string };

type AnalysisUpdate = Database["public"]["Tables"]["analyses"]["Update"];

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Links aren't written to disk (see selectArchive), so the walk never sees
 * them. Reporting the ones it would have reported keeps coverage honest: a
 * link the walker would have listed is counted as found and skipped, never
 * silently absent. Links the walker wouldn't reach aren't counted.
 */
function withSymlinks(result: ParseResult, symlinks: readonly string[]): ParseResult {
  const reported = symlinks.filter(
    (p) => isSourcePath(p) && !p.split("/").slice(0, -1).some(isExcludedDirName),
  );
  if (reported.length === 0) return result;
  const { files } = result.coverage;
  const skippedFiles = [
    ...files.skippedFiles,
    ...reported.map((p) => ({ path: p, reason: "symlink" as const, detail: "symbolic links are not followed" })),
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    ...result,
    coverage: {
      ...result.coverage,
      files: { ...files, found: files.found + reported.length, skipped: skippedFiles.length, skippedFiles },
    },
  };
}

interface Labelling {
  labels: Map<string, AiRole>;
  message: string;
  /** Why no file was labelled, when it couldn't be done. Stored with the analysis. */
  error: string | null;
}

/**
 * Gives a role to each file no convention matched. A failure here doesn't
 * fail the run: the map doesn't depend on a model, so it's stored without
 * labels and the reason is stored beside it, to be shown rather than hidden.
 */
async function label(db: PipelineDb, analysisId: string, root: string, unmatched: readonly FileNode[]): Promise<Labelling> {
  if (unmatched.length === 0) return { labels: new Map(), message: "Every file matched a convention", error: null };
  try {
    const { data, error } = await db.from("analyses").select("org_id").eq("id", analysisId).single();
    if (error) throw new Error(`Couldn't read the analysis's organization: ${error.message}`);
    // No person's token here, so the cache is read with the secret key and
    // scoped to this organization by hand.
    const cache = createCache({ reader: db, writer: db, orgId: data.org_id, scope: true });
    const files = await Promise.all(
      unmatched.map(async (f) => ({ path: f.path, hash: f.hash, source: await readFile(path.join(root, f.path), "utf8") })),
    );
    const { labels, noFit, unanswered } = await labelFiles({ cache, files });
    const parts = [`Labelled ${labels.size} of ${unmatched.length}`];
    if (noFit > 0) parts.push(`${noFit} fit no role`);
    if (unanswered > 0) parts.push(`${unanswered} left unanswered`);
    return { labels, message: parts.join(", "), error: null };
  } catch (failure) {
    const reason = describeFailure(failure);
    return { labels: new Map(), message: `Labelling failed, storing without labels: ${reason}`, error: reason };
  } finally {
    await flushTraces();
  }
}

/**
 * fetch → select → parse → label → store, against an analysis row that already
 * exists. Never throws for a failure inside the run: whatever goes wrong is
 * written to the row with the stage it happened in, so no row is left saying
 * it's still working. It throws only if that write itself fails.
 */
export async function runAnalysis(
  db: PipelineDb,
  analysisId: string,
  repo: RepoRef,
  onStage?: (stage: Stage, message: string) => void,
): Promise<RunOutcome> {
  let stage: Stage | null = null;

  const write = async (values: AnalysisUpdate) => {
    const { error } = await db.from("analyses").update(values).eq("id", analysisId).select("id").single();
    if (error) throw new Error(`Couldn't update analysis ${analysisId}: ${error.message}`);
  };
  const enter = async (next: Stage, message: string, extra: AnalysisUpdate = {}) => {
    stage = next;
    onStage?.(next, message);
    await write({ ...extra, stage: next, stage_message: message });
  };
  const say = async (message: string) => {
    if (stage) onStage?.(stage, message);
    await write({ stage_message: message });
  };

  const work = await mkdtemp(path.join(tmpdir(), "codebase-"));
  try {
    // A re-run starts from a clean status; the old files stay until the new
    // ones replace them in one transaction.
    await enter("fetching", `Finding the latest commit of ${repo.owner}/${repo.name}`, {
      status: "running",
      error: null,
      started_at: new Date().toISOString(),
      finished_at: null,
    });
    const commit = await resolveHeadCommit(repo);
    await say(`Downloading ${commit.slice(0, 7)}`);
    const archive = path.join(work, "archive.tar.gz");
    const size = await downloadArchive(repo, commit, archive);
    // The SHA goes into the message only. The commit_sha column is written
    // with the stored files, so it can't name a commit whose parse failed.
    await say(`Downloaded ${commit.slice(0, 7)}, ${mb(size)}`);

    await enter("selecting", `Unpacking ${mb(size)}`);
    const unpacked = path.join(work, "repo");
    await mkdir(unpacked);
    const selection = await selectArchive(archive, unpacked);
    await rm(archive);
    await say(`Unpacked ${selection.files} files`);

    await enter("parsing", `Parsing ${selection.files} files`);
    const result = withSymlinks(parseRepository(selection.root, ADAPTERS), selection.symlinks);
    const { parsed, skipped } = result.coverage.files;
    await say(`Parsed ${parsed} source files, skipped ${skipped}`);

    const unmatched = result.files.filter((f) => f.role === null);
    await enter("labelling", `Labelling ${unmatched.length} files no convention identified`);
    const labelling = await label(db, analysisId, result.root, unmatched);
    await say(labelling.message);

    await enter(
      "storing",
      `Storing ${result.files.length} files, ${result.edges.length} edges and ${result.routes.length} routes`,
      { label_error: labelling.error },
    );
    // The parser's own root is a temp directory, meaningless once it's gone,
    // so it isn't stored. Coverage is stored whole.
    const { error } = await db.rpc("store_parse", {
      p_analysis_id: analysisId,
      p_commit_sha: commit,
      p_adapter: result.adapter,
      p_files: result.files.map(({ path: p, lines, hash, role }) => ({
        path: p,
        lines,
        hash,
        role,
        label: labelling.labels.get(p) ?? null,
      })),
      p_edges: result.edges,
      p_routes: result.routes,
      p_coverage: result.coverage,
    });
    if (error) throw new Error(`Storing the parse failed: ${error.message}`);
    onStage?.("storing", `Stored ${result.files.length} files, ${result.edges.length} edges and ${result.routes.length} routes`);

    return { status: "complete", commit, files: result.files.length, edges: result.edges.length };
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    // The stage column is left where it was: that is the stage it failed in.
    await write({ status: "failed", error: message, finished_at: new Date().toISOString() });
    return { status: "failed", stage, error: message };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

"use server";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { createCache } from "@/lib/ai/cache";
import { describeFailure, flushTraces } from "@/lib/ai/client";
import { explainFile, explainFolder, fileQuestion, folderQuestion, type Explained } from "@/lib/ai/explain";
import { fold } from "@/lib/map/fold";
import { loadStoredResult, predatesParser, type StoredAnalysis } from "@/lib/stored-analysis";
import { createServerSupabase } from "@/lib/supabase";
import { createPipelineDb } from "@/pipeline/db";
import { fetchFileAt, resolveHeadCommit, type RepoRef } from "@/pipeline/github";

/** How what was analysed compares with the repository now. */
export type Staleness =
  | { state: "current" }
  /** The repository has commits past the analysed one. `file` is absent for a folder. */
  | { state: "moved"; head: string; file?: "unchanged" | "changed" | "deleted" }
  /** The check itself couldn't run. Said, not treated as current. */
  | { state: "unknown"; reason: string };

export type ExplainOutcome =
  | ({ ok: true; staleness: Staleness } & Explained)
  | { ok: false; error: string; staleness: Staleness | null };

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

interface Context {
  orgId: string;
  repo: RepoRef;
  commit: string;
  stored: StoredAnalysis;
  supabase: Awaited<ReturnType<typeof createServerSupabase>>;
}

/**
 * Everything is read again through the person's own token, the same way the
 * page reads it. Nothing the browser sends is taken as a fact about the
 * repository: it names a file or folder, and the stored parse says what
 * that file imports and what imports it.
 */
async function load(analysisId: string): Promise<Context> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, org_id, status, commit_sha, adapter, coverage, project:projects(repo_owner, repo_name)")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read the analysis: ${error.message}`);
  if (!data) throw new Error("This analysis doesn't exist, or isn't in your organization.");
  if (data.status !== "complete" || !data.adapter || !data.commit_sha) throw new Error("This analysis has no stored map to explain.");
  if (predatesParser(data.coverage)) throw new Error("This analysis was stored by an earlier parser. Re-run it first.");
  const stored = await loadStoredResult(supabase, data.id, data.adapter, data.coverage);
  return {
    orgId: data.org_id,
    repo: { owner: data.project.repo_owner, name: data.project.repo_name },
    commit: data.commit_sha,
    stored,
    supabase,
  };
}

/**
 * Reads are the person's, so the policy decides which organization's cache
 * they see. Writes need the secret key, since nobody is granted insert.
 */
const cacheFor = (ctx: Context) =>
  createCache({ reader: ctx.supabase, writer: createPipelineDb(), orgId: ctx.orgId, scope: false });

async function headCommit(repo: RepoRef): Promise<{ head: string } | { reason: string }> {
  try {
    return { head: await resolveHeadCommit(repo) };
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

async function fileStaleness(repo: RepoRef, commit: string, path: string, hash: string): Promise<Staleness> {
  const now = await headCommit(repo);
  if ("reason" in now) return { state: "unknown", reason: now.reason };
  if (now.head === commit) return { state: "current" };
  try {
    const bytes = await fetchFileAt(repo, now.head, path);
    const file = bytes === null ? "deleted" : sha256(bytes) === hash ? "unchanged" : "changed";
    return { state: "moved", head: now.head, file };
  } catch (failure) {
    return { state: "unknown", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

async function folderStaleness(repo: RepoRef, commit: string): Promise<Staleness> {
  const now = await headCommit(repo);
  if ("reason" in now) return { state: "unknown", reason: now.reason };
  return now.head === commit ? { state: "current" } : { state: "moved", head: now.head };
}

export async function explainFileAction(analysisId: string, path: string): Promise<ExplainOutcome> {
  let staleness: Staleness | null = null;
  try {
    const ctx = await load(analysisId);
    const { files, edges } = ctx.stored.result;
    const file = files.find((f) => f.path === path);
    if (!file) throw new Error(`${path} is not a file in this analysis`);

    const [bytes, checked] = await Promise.all([
      fetchFileAt(ctx.repo, ctx.commit, path),
      fileStaleness(ctx.repo, ctx.commit, path, file.hash),
    ]);
    staleness = checked;
    // The explanation is of the file that was parsed. If GitHub hands back
    // different bytes for that commit, explaining them would describe a file
    // the map isn't drawn from.
    if (bytes === null) throw new Error(`GitHub has no ${path} at ${ctx.commit.slice(0, 7)}, the commit that was analysed`);
    if (sha256(bytes) !== file.hash) throw new Error(`${path} at ${ctx.commit.slice(0, 7)} isn't the file that was parsed`);

    const question = fileQuestion(file, bytes.toString("utf8"), files, edges, ctx.stored.labels);
    const explained = await explainFile({ cache: cacheFor(ctx), question });
    return { ok: true, staleness, ...explained };
  } catch (failure) {
    return { ok: false, error: describeFailure(failure), staleness };
  } finally {
    after(flushTraces);
  }
}

export async function explainFolderAction(analysisId: string, id: string): Promise<ExplainOutcome> {
  let staleness: Staleness | null = null;
  try {
    const ctx = await load(analysisId);
    const { files, edges } = ctx.stored.result;
    // The same pure folding the map draws, so the folder asked about is the
    // box that was clicked.
    const question = folderQuestion(id, fold(files), files, edges, ctx.stored.labels);
    const [explained, checked] = await Promise.all([
      explainFolder({ cache: cacheFor(ctx), question }),
      folderStaleness(ctx.repo, ctx.commit),
    ]);
    staleness = checked;
    return { ok: true, staleness, ...explained };
  } catch (failure) {
    return { ok: false, error: describeFailure(failure), staleness };
  } finally {
    after(flushTraces);
  }
}

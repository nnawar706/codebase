import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";
import { env } from "../lib/env.ts";
import type { RepoRef } from "./github.ts";

export type PipelineDb = SupabaseClient<Database>;

// The pipeline writes with the secret key because a run outlives the Clerk
// token of whoever started it. It's used for writes and for looking up the row
// being written; anything a person reads still goes through their own token
// and the policies.
export function createPipelineDb(): PipelineDb {
  return createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * One analysis per repository per organization. A repository already analyzed
 * returns its existing analysis with `created: false` and nothing is touched;
 * running it again is the caller's deliberate choice. Both inserts lean on
 * the unique constraints, so two submissions at once still make one row.
 */
export async function findOrCreateAnalysis(
  db: PipelineDb,
  orgId: string,
  repo: RepoRef,
): Promise<{ analysisId: string; created: boolean }> {
  const projectKey = { org_id: orgId, repo_owner: repo.owner, repo_name: repo.name };
  const upserted = await db
    .from("projects")
    .upsert(projectKey, { onConflict: "org_id,repo_owner,repo_name", ignoreDuplicates: true });
  if (upserted.error) throw new Error(`Couldn't record the project: ${upserted.error.message}`);

  const project = await db
    .from("projects")
    .select("id")
    .eq("org_id", orgId)
    .eq("repo_owner", repo.owner)
    .eq("repo_name", repo.name)
    .single();
  if (project.error) throw new Error(`Couldn't read the project back: ${project.error.message}`);

  const inserted = await db
    .from("analyses")
    .upsert({ org_id: orgId, project_id: project.data.id }, { onConflict: "project_id", ignoreDuplicates: true })
    .select("id");
  if (inserted.error) throw new Error(`Couldn't create the analysis: ${inserted.error.message}`);
  const [created] = inserted.data;
  if (created) return { analysisId: created.id, created: true };

  const existing = await db.from("analyses").select("id").eq("project_id", project.data.id).single();
  if (existing.error) throw new Error(`Couldn't read the existing analysis: ${existing.error.message}`);
  return { analysisId: existing.data.id, created: false };
}

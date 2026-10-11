"use server";

import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { isStale } from "@/lib/stale";
import { createServerSupabase } from "@/lib/supabase";
import { createPipelineDb } from "@/pipeline/db";
import { runAnalysis } from "@/pipeline/run";

export type RerunState = { error: string | null };

/**
 * Runs the same analysis again, on the repository's latest commit, keeping
 * its row and so its address. The old files, edges and routes stay until the
 * parse is stored, which replaces them all in one transaction: a re-run that
 * fails leaves nothing half-replaced.
 */
export async function rerunAnalysis(_previous: RerunState, form: FormData): Promise<RerunState> {
  const analysisId = String(form.get("id") ?? "");
  const { orgId } = await auth();
  if (!orgId) return { error: "No active organization. Pick one from the switcher above." };

  // Read through the person's own token, so the policy decides whether they
  // can see this analysis at all, and so whether they can re-run it.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, updated_at, project:projects(repo_owner, repo_name)")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) return { error: `Couldn't read the analysis: ${error.message}` };
  if (!data) return { error: "This analysis no longer exists." };

  const unfinished = data.status === "queued" || data.status === "running";
  if (unfinished && !isStale(data.status, data.updated_at)) return { error: "This analysis is still running." };

  // Queued before the response goes out, so the page it lands on is already
  // watching a run. Only the row as it was read is claimed: if another run
  // touched it since, nothing changes and nothing starts twice.
  const db = createPipelineDb();
  const claimed = await db
    .from("analyses")
    .update({ status: "queued", stage: null, stage_message: null, error: null })
    .eq("id", data.id)
    .eq("updated_at", data.updated_at)
    .select("id");
  if (claimed.error) return { error: `Couldn't queue the analysis: ${claimed.error.message}` };
  if (claimed.data.length === 0) return { error: "This analysis changed since the page loaded. Reload and try again." };

  const repo = { owner: data.project.repo_owner, name: data.project.repo_name };
  after(async () => {
    // runAnalysis writes any failure to the row itself; it only throws when
    // that write fails, which leaves the row for the dashboard to mark stale.
    try {
      await runAnalysis(db, data.id, repo);
    } catch (failure) {
      console.error(`Analysis ${data.id} could not record its outcome`, failure);
    }
  });
  redirect(`/analyses/${data.id}`);
}

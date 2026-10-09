"use server";

import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createPipelineDb, findOrCreateAnalysis } from "@/pipeline/db";
import { parseRepoUrl, type RepoRef } from "@/pipeline/github";
import { runAnalysis } from "@/pipeline/run";

export type AnalyzeState = { error: string | null; url: string };

/**
 * Submitting a repository this organization already analyzed lands on that
 * analysis and starts nothing. Only a new analysis runs, and it runs after the
 * response: the redirect goes out immediately and the progress page watches
 * the stages arrive.
 */
export async function analyzeRepository(_previous: AnalyzeState, form: FormData): Promise<AnalyzeState> {
  const { orgId, sessionClaims } = await auth();
  const url = String(form.get("url") ?? "");
  if (!orgId) return { error: "No active organization. Pick one from the switcher above.", url };
  // The organizations row is created on first use; its name comes off the
  // token, never from a guess.
  const orgName = sessionClaims?.org_name;
  if (!orgName) return { error: "The session token has no org_name claim, so the organization can't be recorded.", url };

  let repo: RepoRef;
  try {
    repo = parseRepoUrl(url);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), url };
  }

  const db = createPipelineDb();
  const org = await db
    .from("organizations")
    .upsert({ id: orgId, name: orgName }, { onConflict: "id", ignoreDuplicates: true });
  if (org.error) return { error: `Couldn't record the organization: ${org.error.message}`, url };

  const { analysisId, created } = await findOrCreateAnalysis(db, orgId, repo);
  if (created) {
    after(async () => {
      // runAnalysis writes any failure to the row itself; it only throws when
      // that write fails, which leaves the row for the dashboard to mark stale.
      try {
        await runAnalysis(db, analysisId, repo);
      } catch (error) {
        console.error(`Analysis ${analysisId} could not record its outcome`, error);
      }
    });
  }
  redirect(`/analyses/${analysisId}`);
}

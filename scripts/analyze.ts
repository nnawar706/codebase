// Runs the pipeline for one repository and prints each stage as it's written.
//
//   node --env-file=.env.local scripts/analyze.ts <github-url> <org_id> [--rerun]
//
// A repository the organization already analyzed is left alone and its
// existing analysis printed, unless --rerun asks for it to run again.

import { createPipelineDb, findOrCreateAnalysis } from "../pipeline/db.ts";
import { parseRepoUrl } from "../pipeline/github.ts";
import { runAnalysis } from "../pipeline/run.ts";

const args = process.argv.slice(2);
const rerun = args.includes("--rerun");
const [url, orgId, ...rest] = args.filter((a) => a !== "--rerun");
if (!url || !orgId || rest.length > 0) {
  console.error("usage: node --env-file=.env.local scripts/analyze.ts <github-url> <org_id> [--rerun]");
  process.exit(1);
}

const repo = parseRepoUrl(url);
const db = createPipelineDb();
const { analysisId, created } = await findOrCreateAnalysis(db, orgId, repo);
console.log(`${created ? "created" : "existing"} analysis ${analysisId} for ${repo.owner}/${repo.name}`);

if (!created && !rerun) {
  const { data, error } = await db
    .from("analyses")
    .select("status, stage, stage_message, error, commit_sha")
    .eq("id", analysisId)
    .single();
  if (error) throw new Error(error.message);
  console.log(`status ${data.status}, stage ${data.stage ?? "none"}: ${data.error ?? data.stage_message ?? ""}`);
  console.log("already analyzed; pass --rerun to run it again");
  process.exit(0);
}

const started = performance.now();
const outcome = await runAnalysis(db, analysisId, repo, (stage, message) => {
  console.log(`  ${stage.padEnd(10)} ${message}`);
});
const seconds = ((performance.now() - started) / 1000).toFixed(1);

if (outcome.status === "complete") {
  console.log(`complete in ${seconds}s at ${outcome.commit}: ${outcome.files} files, ${outcome.edges} edges`);
} else {
  console.log(`failed in ${outcome.stage ?? "setup"} after ${seconds}s: ${outcome.error}`);
  process.exit(1);
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnalysisStages } from "@/components/AnalysisProgress";
import { Workspace } from "@/components/map/Workspace";
import { isStale } from "@/lib/stale";
import { loadStoredResult, predatesParser } from "@/lib/stored-analysis";
import { createServerSupabase } from "@/lib/supabase";
import { RerunButton } from "./rerun-button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's top line. Re-run is offered only when nothing is working on the analysis. */
function TopBar({
  id,
  owner,
  name,
  commit,
  canRerun,
}: {
  id: string;
  owner: string;
  name: string;
  commit: string | null;
  canRerun: boolean;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border px-3">
      <Link href="/dashboard" className="inline-flex h-7 items-center text-muted hover:text-foreground">
        ← Analyses
      </Link>
      <h1 className="font-mono text-[13px] font-medium">
        <span className="text-muted">{owner}/</span>
        {name}
      </h1>
      {commit && (
        <span className="font-mono text-muted" title={commit}>
          {commit.slice(0, 7)}
        </span>
      )}
      <div className="ml-auto">{canRerun && <RerunButton analysisId={id} />}</div>
    </div>
  );
}

// One address per analysis. While it runs this shows the stages; when the run
// finishes the stage list refreshes the page, and the same address renders
// the map, so finishing lands on it without a redirect.
//
// Read through the person's own token: an analysis from another organization
// comes back as no row, and is a 404 like any id that doesn't exist.
async function Analysis({ id }: { id: string }) {
  if (!UUID.test(id)) notFound();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, error, commit_sha, updated_at, adapter, coverage, project:projects(repo_owner, repo_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read analysis: ${error.message}`);
  if (!data) notFound();

  const stale = isStale(data.status, data.updated_at);
  const bar = (
    <TopBar
      id={data.id}
      owner={data.project.repo_owner}
      name={data.project.repo_name}
      commit={data.commit_sha}
      canRerun={data.status === "complete" || data.status === "failed" || stale}
    />
  );

  if (data.status === "complete") {
    if (!data.adapter) throw new Error(`Analysis ${data.id} is complete but has no adapter recorded`);
    if (predatesParser(data.coverage)) {
      return (
        <>
          {bar}
          <p className="max-w-2xl px-3 py-2">
            This analysis was stored by an earlier version of the parser, so its map can&apos;t be shown as it is now.
            It needs to run again.
          </p>
        </>
      );
    }
    const result = await loadStoredResult(supabase, data.id, data.adapter, data.coverage);
    return (
      <>
        {bar}
        <Workspace
          name={`${data.project.repo_owner}/${data.project.repo_name}`}
          adapter={result.adapter}
          files={result.files}
          edges={result.edges}
          routes={result.routes}
          unrecovered={result.coverage.routes.unrecovered}
          skipped={result.coverage.files.skipped}
          unresolved={result.coverage.imports.total.unresolved}
        />
      </>
    );
  }

  return (
    <>
      {bar}
      <section className="flex max-w-2xl flex-col gap-3 p-3">
        <AnalysisStages
          id={data.id}
          updatedAt={data.updated_at}
          initial={{
            status: data.status,
            stage: data.stage,
            message: data.error ?? data.stage_message,
          }}
        />
        {stale && (
          <p>
            Nothing has been written for this run since{" "}
            <span className="font-mono">{data.updated_at.slice(11, 16)} UTC</span>. The process running it has most
            likely stopped.
          </p>
        )}
      </section>
    </>
  );
}

export default function AnalysisPage({ params }: PageProps<"/analyses/[id]">) {
  return (
    <Suspense>
      {params.then(({ id }) => (
        <Analysis id={id} />
      ))}
    </Suspense>
  );
}

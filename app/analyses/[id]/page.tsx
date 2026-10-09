import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnalysisStages } from "@/components/AnalysisProgress";
import { Workspace } from "@/components/map/Workspace";
import { isStale } from "@/lib/stale";
import { loadStoredResult } from "@/lib/stored-analysis";
import { createServerSupabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (data.status === "complete") {
    if (!data.adapter) throw new Error(`Analysis ${data.id} is complete but has no adapter recorded`);
    const result = await loadStoredResult(supabase, data.id, data.adapter, data.coverage);
    return (
      <Workspace
        name={`${data.project.repo_owner}/${data.project.repo_name}`}
        adapter={result.adapter}
        files={result.files}
        edges={result.edges}
        skipped={result.coverage.files.skipped}
        unresolved={result.coverage.imports.total.unresolved}
      />
    );
  }

  const stale = isStale(data.status, data.updated_at);

  return (
    <section className="flex max-w-2xl flex-col gap-3 px-3 pb-3">
      <Link href="/dashboard" className="inline-flex h-7 items-center text-muted hover:text-foreground">
        ← Analyses
      </Link>
      <header className="flex items-baseline gap-2">
        <h1 className="font-mono text-[13px] font-medium">
          <span className="text-muted">{data.project.repo_owner}/</span>
          {data.project.repo_name}
        </h1>
        {data.commit_sha && (
          <span className="font-mono text-muted" title={data.commit_sha}>
            {data.commit_sha.slice(0, 7)}
          </span>
        )}
      </header>
      <AnalysisStages
        id={data.id}
        updatedAt={data.updated_at}
        initial={{ status: data.status, stage: data.stage, message: data.error ?? data.stage_message }}
      />
      {stale && (
        <p>
          Nothing has been written for this run since{" "}
          <span className="font-mono">{data.updated_at.slice(11, 16)} UTC</span>. The process running it has most
          likely stopped.
        </p>
      )}
    </section>
  );
}

export default function AnalysisPage({ params }: PageProps<"/analyses/[id]">) {
  return <Suspense>{params.then(({ id }) => <Analysis id={id} />)}</Suspense>;
}

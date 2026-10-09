import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase";
import { ActivateOrganization } from "./activate-organization";

// Timestamps are rendered on the server, so they're shown in UTC rather than in
// whatever timezone the server happens to run in.
function formatTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatDuration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const seconds = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// No org filter here on purpose. The token carries the active organization and
// the row-level policy narrows to it, so switching organization changes the
// rows without this query changing. If another org's row ever shows up, the
// bug is the policy, not this code.
async function Analyses() {
  const { orgId, sessionClaims } = await auth();
  if (!orgId) return <ActivateOrganization />;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, error, created_at, finished_at, project:projects(repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Couldn't read analyses: ${error.message}`);

  return (
    <section className="flex flex-col gap-2">
      <h1 className="flex items-baseline gap-2">
        <span className="font-medium">Analyses</span>
        <span className="text-muted">
          {sessionClaims?.org_name ?? <span className="font-mono">{orgId}</span>}
        </span>
      </h1>

      {data.length === 0 ? (
        <p className="text-muted">
          This organization hasn&apos;t analyzed a repository yet.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th className="py-1 pr-4 font-normal">repository</th>
              <th className="py-1 pr-4 font-normal">state</th>
              <th className="py-1 pr-4 font-normal">started</th>
              <th className="py-1 pr-4 font-normal">took</th>
              <th className="py-1 font-normal" />
            </tr>
          </thead>
          <tbody>
            {data.map((analysis) => (
              <tr key={analysis.id} className="border-b border-border align-top">
                <td className="py-1 pr-4 font-mono">
                  {analysis.project.repo_owner}/{analysis.project.repo_name}
                </td>
                <td className="py-1 pr-4">{analysis.status}</td>
                <td className="py-1 pr-4 font-mono text-muted">
                  {formatTime(analysis.created_at)}
                </td>
                <td className="py-1 pr-4 font-mono text-muted">
                  {formatDuration(analysis.created_at, analysis.finished_at) ?? "—"}
                </td>
                <td className="py-1 text-muted">{analysis.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Dashboard() {
  return (
    <div className="p-3">
      <Suspense>
        <Analyses />
      </Suspense>
    </div>
  );
}

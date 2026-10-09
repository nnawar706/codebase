import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase";
import { ActivateOrganization } from "./activate-organization";
import { AnalysisStatus } from "@/components/AnalysisStatus";

// Rendered on the server, so shown in UTC rather than whatever timezone the
// server runs in. The column header says UTC once instead of every row.
function formatTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatDuration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const seconds = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const th = "h-7 px-3 text-left font-normal text-muted first:pl-0";
const td = "h-7 px-3 first:pl-0";

/* 
/ No org filter here on purpose. The token carries the active organization and
/ the row-level policy narrows to it, so switching organization changes the
/ rows without this query changing.
*/

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

  const orgName = sessionClaims?.org_name;

  return (
    <section className="flex flex-col">
      <header className="flex h-9 items-baseline gap-2 pt-3">
        <h1 className="text-[13px] font-medium">Analyses</h1>
        <span className="tabular-nums text-muted">{data.length}</span>
        <span className="ml-auto truncate text-muted">
          {orgName ?? <span className="font-mono">{orgId}</span>}
        </span>
      </header>

      {data.length === 0 ? (
        <div className="mt-2 border-t border-border pt-6 text-muted">
          <p className="text-foreground">No repositories analyzed yet.</p>
          <p className="mt-1">
            Analyses run in this organization are listed here for everyone in it.
          </p>
        </div>
      ) : (
        <div className="-mx-3 overflow-x-auto px-3">
          <table className="w-full border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Repository</th>
                <th className={th}>State</th>
                <th className={th}>Started (UTC)</th>
                <th className={`${th} text-right`}>Time Taken</th>
                <th className={`${th} w-full`}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.map((analysis) => (
                <tr key={analysis.id} className="border-b border-border hover:bg-surface">
                  <td className={`${td} font-mono`}>
                    <span className="text-muted">{analysis.project.repo_owner}/</span>
                    {analysis.project.repo_name}
                  </td>
                  <td className={td}>
                    <AnalysisStatus status={analysis.status} />
                  </td>
                  <td className={`${td} font-mono tabular-nums text-muted`}>
                    {formatTime(analysis.created_at)}
                  </td>
                  <td className={`${td} text-right font-mono tabular-nums text-muted`}>
                    {formatDuration(analysis.created_at, analysis.finished_at) ?? ""}
                  </td>
                  <td className={`${td} whitespace-normal text-muted`}>{analysis.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  return (
    <div className="px-3 pb-3">
      <Suspense>
        <Analyses />
      </Suspense>
    </div>
  );
}

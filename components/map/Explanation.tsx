"use client";

import { useMemo } from "react";
import type { ExplainOutcome, Staleness } from "@/app/analyses/[id]/explain";
import { RerunButton } from "@/app/analyses/[id]/rerun-button";
import { parseProse, type Inline } from "@/lib/map/prose";
import { MARK, type Linking } from "./PaneParts";

/** Whether model calls are being traced, decided on the server. */
export type Tracing = { on: true; project: string } | { on: false; reason: string };

export type ExplainEntry = { status: "pending" } | { status: "done"; outcome: ExplainOutcome };

/** What the tab is about: a file, or a folded folder by its id. */
export type Subject = { kind: "file"; path: string } | { kind: "folder"; id: string };

export const subjectKey = (s: Subject) => (s.kind === "file" ? `file:${s.path}` : `folder:${s.id}`);

// Nothing here asks for anything until Explain is clicked. Once an answer is
// in, the workspace keeps it, so coming back to this file shows it again
// without a second click.
export function Explanation({
  analysisId,
  subject,
  entry,
  onExplain,
  paths,
  model,
  tracing,
  linking,
}: {
  analysisId: string;
  subject: Subject;
  entry: ExplainEntry | undefined;
  onExplain: (subject: Subject) => void;
  paths: ReadonlySet<string>;
  model: string;
  tracing: Tracing;
  linking: Linking;
}) {
  const pending = entry?.status === "pending";
  const outcome = entry?.status === "done" ? entry.outcome : null;
  return (
    <section>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onExplain(subject)}
          className="h-6 cursor-pointer rounded border border-border px-2 hover:border-muted disabled:cursor-default disabled:opacity-60"
        >
          {pending ? "Explaining…" : outcome?.ok ? "Explain again" : "Explain"}
        </button>
        {outcome?.ok && <span className="text-[11px] text-muted">{outcome.cached ? "from cache" : "new"}</span>}
        <span className="ml-auto font-mono text-[11px] text-muted">{model}</span>
      </div>
      {outcome && outcome.staleness && <Stale staleness={outcome.staleness} subject={subject} analysisId={analysisId} />}
      {outcome && !outcome.ok && (
        <p role="alert" className="border-b border-border px-3 py-2">
          {outcome.error}
        </p>
      )}
      {outcome?.ok && <Prose text={outcome.text} paths={paths} linking={linking} />}
      {!entry && (
        <p className="px-3 py-2 text-muted">
          {subject.kind === "file"
            ? "Written by a model from this file's source and every file it imports or is imported by."
            : "Written by a model from the paths and roles in this folder and every import crossing its edge."}
        </p>
      )}
      <p className="px-3 py-2 text-[11px] text-muted">
        {tracing.on ? `Traced to LangSmith, project ${tracing.project}` : `Not traced: ${tracing.reason}`}
      </p>
    </section>
  );
}

function Stale({ staleness, subject, analysisId }: { staleness: Staleness; subject: Subject; analysisId: string }) {
  if (staleness.state === "current") return null;
  if (staleness.state === "unknown") {
    return (
      <p className="border-b border-border px-3 py-2 text-muted">
        Couldn&apos;t check whether the repository has moved on: {staleness.reason}
      </p>
    );
  }
  const head = <span className="font-mono">{staleness.head.slice(0, 7)}</span>;
  const message =
    subject.kind === "folder" || staleness.file === undefined ? (
      <>The repository has moved past the analysed commit; it&apos;s now at {head}. This describes the analysed version.</>
    ) : staleness.file === "changed" ? (
      <>This file has changed since it was analysed; the repository is now at {head}. This describes the analysed version.</>
    ) : staleness.file === "deleted" ? (
      <>This file no longer exists at {head}, the repository&apos;s latest commit. This describes the analysed version.</>
    ) : (
      <>The repository has moved on to {head}. This file is unchanged, but what imports it may not be.</>
    );
  return (
    <div className="flex items-start gap-2 border-b border-border px-3 py-2">
      <p className="min-w-0 flex-1">
        <span className="font-medium">Stale.</span> {message}
      </p>
      <RerunButton analysisId={analysisId} label="Re-analyse" />
    </div>
  );
}

function Prose({ text, paths, linking }: { text: string; paths: ReadonlySet<string>; linking: Linking }) {
  const blocks = useMemo(() => parseProse(text, paths), [text, paths]);
  return (
    <div className="flex flex-col gap-2 px-3 py-2 leading-5">
      {blocks.map((block, i) =>
        block.kind === "list" ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-4">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inlines parts={item} linking={linking} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && " "}
                <Inlines parts={line} linking={linking} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function Inlines({ parts, linking }: { parts: readonly Inline[]; linking: Linking }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "text":
            return <span key={i}>{part.text}</span>;
          case "code":
            return (
              <code key={i} className="rounded bg-surface px-1 font-mono text-[11px]">
                {part.text}
              </code>
            );
          case "bold":
            return (
              <strong key={i} className="font-medium">
                <Inlines parts={part.children} linking={linking} />
              </strong>
            );
          case "path":
            // Same behaviour as every other path in the pane: click moves the
            // map, hover marks it there.
            return (
              <button
                key={i}
                type="button"
                title={part.path}
                onClick={() => linking.onFocus(part.path)}
                onMouseEnter={() => linking.onHover({ kind: "file", path: part.path })}
                onMouseLeave={() => linking.onHover(null)}
                className={`cursor-pointer break-all font-mono text-[11px] text-accent hover:underline ${
                  linking.marked(part.path) ? MARK : ""
                }`}
              >
                {part.path}
              </button>
            );
        }
      })}
    </>
  );
}

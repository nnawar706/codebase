"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useBrowserSupabase } from "@/lib/supabase-browser";
import { AnalysisStatus } from "./AnalysisStatus";

// Mirrors the stages the pipeline writes. A stage this list doesn't know is
// shown by name rather than mapped onto one it does.
const STAGES = ["fetching", "selecting", "parsing", "storing"] as const;

export type Progress = {
  status: string;
  stage: string | null;
  message: string | null;
};

/** One message as it was written, and when. */
type Entry = { stage: string; message: string; at: string };

const finished = (status: string) => status === "complete" || status === "failed";

// The channel carries what the trigger built; anything else is ignored rather
// than half-applied.
function readProgress(payload: unknown): Progress | null {
  if (typeof payload !== "object" || payload === null) return null;
  const status = "status" in payload ? payload.status : undefined;
  const stage = "stage" in payload ? payload.stage : undefined;
  const message = "message" in payload ? payload.message : undefined;
  if (typeof status !== "string") return null;
  if (stage !== null && typeof stage !== "string") return null;
  if (message !== null && typeof message !== "string") return null;
  return { status, stage, message };
}

/**
 * Subscribes to one analysis's channel while it's unfinished. After joining it
 * reads the row once, because a stage written between the page's render and
 * the join would otherwise never arrive. When the run finishes, the server
 * render is refreshed once so everything not carried by the channel catches up.
 *
 * Also keeps the messages seen while watching, each with a real time: the
 * row's updated_at for what was already there, the arrival time for what came
 * over the channel. Nothing from before the page opened is reconstructed.
 */
function useProgress(id: string, initial: Progress, initialAt: string | null) {
  const supabase = useBrowserSupabase();
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [log, setLog] = useState<Entry[]>(() =>
    initial.stage && initial.message && initialAt ? [{ stage: initial.stage, message: initial.message, at: initialAt }] : [],
  );
  // Whether the run has published anything since this page loaded: the only
  // evidence that something is still working on it.
  const [heard, setHeard] = useState(false);
  const live = !finished(initial.status);

  useEffect(() => {
    if (!live) return;
    let settled = false;
    const apply = (next: Progress, at: string) => {
      setProgress(next);
      const { stage, message } = next;
      if (stage && message) {
        setLog((prev) => {
          const last = prev.at(-1);
          return last && last.stage === stage && last.message === message ? prev : [...prev, { stage, message, at }];
        });
      }
      if (finished(next.status) && !settled) {
        settled = true;
        router.refresh();
      }
    };

    const channel = supabase
      .channel(`analysis:${id}`, { config: { private: true } })
      .on("broadcast", { event: "progress" }, (message) => {
        const next = readProgress(message.payload);
        if (next) {
          setHeard(true);
          apply(next, new Date().toISOString());
        }
      })
      .subscribe(async (state, error) => {
        if (state === "SUBSCRIBED") {
          const { data } = await supabase
            .from("analyses")
            .select("status, stage, stage_message, error, updated_at")
            .eq("id", id)
            .single();
          if (data) {
            apply({ status: data.status, stage: data.stage, message: data.error ?? data.stage_message }, data.updated_at);
          }
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          // Said out loud: a page that silently stops updating looks exactly
          // like a stuck run.
          console.error(`Progress channel for analysis ${id}: ${state}`, error);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, live, supabase, router]);

  return { progress, heard, log };
}

/** The dashboard's state cell: the mark, and while running, where it is. */
export function LiveAnalysisState({ id, initial, stale }: { id: string; initial: Progress; stale: boolean }) {
  const { progress, heard } = useProgress(id, initial, null);
  const running = !finished(progress.status);
  return (
    <span className="inline-flex items-baseline gap-2">
      <AnalysisStatus status={progress.status} />
      {running && progress.stage && <span className="font-mono text-muted">{progress.stage}</span>}
      {running && stale && !heard && (
        <span title="No progress written for several minutes; the process running it has likely stopped.">
          stale
        </span>
      )}
    </span>
  );
}

type StageState = "done" | "current" | "failed" | "pending";

// Shape, not colour, carries state: colour is reserved for direction and kind.
function Node({ state }: { state: StageState }) {
  return (
    <svg viewBox="0 0 10 10" className={`h-2.5 w-2.5 shrink-0 ${state === "pending" ? "text-muted" : ""}`} aria-hidden>
      {state === "done" && <circle cx="5" cy="5" r="4" fill="currentColor" />}
      {state === "current" && (
        <>
          <circle cx="5" cy="5" r="3.5" fill="var(--background)" stroke="currentColor" />
          <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )}
      {state === "failed" && (
        <>
          <circle cx="5" cy="5" r="4.5" fill="var(--background)" />
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
      {state === "pending" && <circle cx="5" cy="5" r="3.5" fill="var(--background)" stroke="currentColor" />}
    </svg>
  );
}

const clock = (iso: string) => iso.slice(11, 19);

function headline(progress: Progress, at: number): string {
  const step = at === -1 ? "" : `, step ${at + 1} of ${STAGES.length}`;
  const stage = progress.stage ? progress.stage[0].toUpperCase() + progress.stage.slice(1) : null;
  switch (progress.status) {
    case "queued":
      return "Queued, not started yet";
    case "running":
      return stage ? `${stage}${step}` : "Starting";
    case "failed":
      return progress.stage ? `Failed while ${progress.stage}` : "Failed before it started";
    case "complete":
      return "Complete, opening the map";
    default:
      return progress.status;
  }
}

/**
 * The progress page's stages, drawn like a commit graph: one node per stage on
 * a rail, and under each, the messages it wrote while this page watched.
 */
export function AnalysisStages({ id, initial, updatedAt }: { id: string; initial: Progress; updatedAt: string }) {
  const { progress, log } = useProgress(id, initial, updatedAt);
  const at = progress.stage === null ? -1 : STAGES.findIndex((s) => s === progress.stage);
  const unknownStage = progress.stage !== null && at === -1;
  const failed = progress.status === "failed";

  const stateOf = (i: number): StageState =>
    progress.status === "complete" || i < at ? "done" : i === at ? (failed ? "failed" : "current") : "pending";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]" role="status">
        {headline(progress, at)}
        <span className="ml-2 text-muted">times in UTC</span>
      </p>

      <ol className="flex flex-col">
        {STAGES.map((stage, i) => {
          const state = stateOf(i);
          const entries = log.filter((e) => e.stage === stage);
          const last = i === STAGES.length - 1;
          return (
            <li key={stage} className="grid grid-cols-[10px_minmax(0,1fr)] gap-x-3">
              {/* The rail: solid behind the run, faint ahead of it. */}
              <div className="flex flex-col items-center">
                <div className="flex h-6 items-center">
                  <Node state={state} />
                </div>
                {!last && <div className={`w-px flex-1 ${state === "done" ? "bg-foreground" : "bg-border"}`} />}
              </div>

              <div className={`flex min-w-0 flex-col ${last ? "" : "pb-2"}`}>
                <div className="flex h-6 items-center gap-2">
                  <span className={`font-mono ${state === "pending" ? "text-muted" : "font-medium"}`}>{stage}</span>
                  <span className="sr-only">{state}</span>
                </div>
                {entries.map((entry, j) => {
                  const isFailure = failed && i === at && j === entries.length - 1;
                  return (
                    <div key={`${entry.at}-${j}`} className="flex gap-3 py-px">
                      <time dateTime={entry.at} className="shrink-0 font-mono tabular-nums text-muted">
                        {clock(entry.at)}
                      </time>
                      <span className={isFailure ? "" : "text-muted"}>{entry.message}</span>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      {unknownStage && (
        <p className="text-muted">
          At stage <span className="font-mono">{progress.stage}</span>: {progress.message}
        </p>
      )}
    </div>
  );
}

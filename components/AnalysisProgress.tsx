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
 */
function useProgress(id: string, initial: Progress): { progress: Progress; heard: boolean } {
  const supabase = useBrowserSupabase();
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  // Whether the run has published anything since this page loaded: the only
  // evidence that something is still working on it.
  const [heard, setHeard] = useState(false);
  const live = !finished(initial.status);

  useEffect(() => {
    if (!live) return;
    let settled = false;
    const apply = (next: Progress) => {
      setProgress(next);
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
          apply(next);
        }
      })
      .subscribe(async (state, error) => {
        if (state === "SUBSCRIBED") {
          const { data } = await supabase
            .from("analyses")
            .select("status, stage, stage_message, error")
            .eq("id", id)
            .single();
          if (data) apply({ status: data.status, stage: data.stage, message: data.error ?? data.stage_message });
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

  return { progress, heard };
}

/** The dashboard's state cell: the mark, and while running, where it is. */
export function LiveAnalysisState({ id, initial, stale }: { id: string; initial: Progress; stale: boolean }) {
  const { progress, heard } = useProgress(id, initial);
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

const mark = (state: "done" | "current" | "failed" | "pending") => {
  switch (state) {
    case "done":
      return <circle cx="5" cy="5" r="4" fill="currentColor" />;
    case "current":
      return (
        <>
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />
          <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      );
    case "failed":
      return <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />;
    case "pending":
      return <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />;
  }
};

/** The progress page's stage list, one line per stage, the message beside the current one. */
export function AnalysisStages({ id, initial }: { id: string; initial: Progress }) {
  const { progress } = useProgress(id, initial);
  const at = progress.stage === null ? -1 : STAGES.findIndex((s) => s === progress.stage);
  const unknownStage = progress.stage !== null && at === -1;

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col">
        {STAGES.map((stage, i) => {
          const state =
            progress.status === "complete" || i < at
              ? "done"
              : i === at
                ? progress.status === "failed"
                  ? "failed"
                  : "current"
                : "pending";
          return (
            <li key={stage} className={`flex h-7 items-center gap-2 ${state === "pending" ? "text-muted" : ""}`}>
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" aria-hidden>
                {mark(state)}
              </svg>
              <span className="w-20 shrink-0 font-mono">{stage}</span>
              <span className="sr-only">{state}</span>
              {i === at && progress.message && (
                <span className={`truncate ${state === "failed" ? "" : "text-muted"}`}>{progress.message}</span>
              )}
            </li>
          );
        })}
      </ol>
      {progress.status === "queued" && <p className="mt-1 text-muted">Queued, not started yet.</p>}
      {unknownStage && (
        <p className="mt-1 text-muted">
          At stage <span className="font-mono">{progress.stage}</span>: {progress.message}
        </p>
      )}
    </div>
  );
}

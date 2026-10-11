"use client";

import { useActionState } from "react";
import { rerunAnalysis, type RerunState } from "./actions";

const initial: RerunState = { error: null };

export function RerunButton({ analysisId, label = "Re-run" }: { analysisId: string; label?: string }) {
  const [state, action, pending] = useActionState(rerunAnalysis, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={analysisId} />
      {state.error && <p role="alert">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        title="Analyze the repository's latest commit again"
        className="h-6 shrink-0 rounded border border-border px-2 hover:bg-surface disabled:opacity-60"
      >
        {pending ? "Starting…" : label}
      </button>
    </form>
  );
}

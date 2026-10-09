"use client";

import { useActionState } from "react";
import { analyzeRepository, type AnalyzeState } from "./actions";

const initial: AnalyzeState = { error: null, url: "" };

export function AnalyzeForm() {
  const [state, action, pending] = useActionState(analyzeRepository, initial);
  return (
    <form action={action} className="flex flex-col gap-1 pt-3">
      <div className="flex gap-2">
        <input
          name="url"
          type="text"
          required
          defaultValue={state.url}
          placeholder="https://github.com/owner/name"
          aria-label="Public GitHub repository URL"
          spellCheck={false}
          autoComplete="off"
          className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 font-mono outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-7 shrink-0 rounded bg-accent px-3 text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Starting…" : "Analyze"}
        </button>
      </div>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}

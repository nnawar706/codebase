import type { ReactNode } from "react";

// Colour is reserved for direction and file kind, so states are told apart by
// shape: empty, half, full, crossed. The mark reads at a glance down a column;
// the word beside it is what a screen reader gets.
const marks: Record<string, ReactNode> = {
  queued: <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />,
  running: (
    <>
      <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />
      <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
    </>
  ),
  complete: <circle cx="5" cy="5" r="4" fill="currentColor" />,
  failed: <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />,
};

export function AnalysisStatus({ status }: { status: string }) {
  // A state this component doesn't know gets its word and no mark, rather
  // than borrowing the shape of one it does.
  const mark = marks[status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${status === "queued" ? "text-muted" : ""}`}>
      {mark && (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" aria-hidden>
          {mark}
        </svg>
      )}
      {status}
    </span>
  );
}

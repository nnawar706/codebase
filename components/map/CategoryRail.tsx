import type { Rail, RailRow } from "@/lib/map/roles";

// One row per category the framework has, in the taxonomy's fixed order, even
// at zero: a category is always in the same place, and a zero says the
// adapter looked and found none. Picking a category dims the rest of the map
// rather than removing it, so the shape of the whole repository stays on
// screen. Picking it again clears it.
export function CategoryRail({
  rail,
  active,
  onPick,
}: {
  rail: Rail;
  active: string | null;
  onPick: (label: string | null) => void;
}) {
  return (
    <>
      <ul className="flex flex-col">
        {rail.categories.map((row) => (
          <Row key={row.label} row={row} active={active} onPick={onPick} />
        ))}
      </ul>
      <ul className="mt-1 flex flex-col border-t border-border pt-1">
        <Row row={rail.unmatched} active={active} onPick={onPick} />
      </ul>
    </>
  );
}

function Row({ row, active, onPick }: { row: RailRow; active: string | null; onPick: (label: string | null) => void }) {
  const on = active === row.label;
  const count = row.paths.size;
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        disabled={count === 0}
        onClick={() => onPick(on ? null : row.label)}
        className={`flex h-6 w-full items-center gap-2 px-3 text-left disabled:text-muted ${
          on ? "bg-accent/10 text-accent" : "enabled:cursor-pointer enabled:hover:bg-surface"
        }`}
      >
        <span className="truncate">{row.label}</span>
        <span className={`ml-auto tabular-nums ${on ? "" : "text-muted"}`}>{count}</span>
      </button>
    </li>
  );
}

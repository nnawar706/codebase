// The four common types get a hue; the rest share an outlined grey swatch.
// Blue, green and amber are taken by selection and direction, so none of these
// come near them. Everything that shows a type draws from here, so a type is
// one colour everywhere.
const HUES: Record<string, string> = {
  ".ts": "#8b5cf6",
  ".tsx": "#ec4899",
  ".js": "#14b8a6",
  ".jsx": "#f43f5e",
};

export function TypeSwatch({ ext }: { ext: string }) {
  const hue = HUES[ext];
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-sm ${hue ? "" : "border border-muted"}`}
      style={hue ? { background: hue } : undefined}
    />
  );
}

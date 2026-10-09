import { readFileSync } from "node:fs";
import path from "node:path";
import { CategoryRail } from "@/components/map/CategoryRail";
import { DependencyMap } from "@/components/map/DependencyMap";
import { MapShell } from "@/components/MapShell";
import { readParseResult } from "@/parser/read";

// Renders the real interface from a parser result checked into the project, so
// the map can be built without an account, a database or a network. Read
// through the validator, so a file that drifted from the contract fails here.
const result = readParseResult(readFileSync(path.join(process.cwd(), "data/preview-react-hook-form.json"), "utf8"));

export default function Preview() {
  return (
    <MapShell
      rail={<CategoryRail files={result.files} />}
      map={<DependencyMap files={result.files} edges={result.edges} />}
    />
  );
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { Workspace } from "@/components/map/Workspace";
import { readParseResult } from "@/parser/read";

// Renders the real interface from a parser result checked into the project, so
// the map can be built without an account, a database or a network. Read
// through the validator, so a file that drifted from the contract fails here.
const result = readParseResult(readFileSync(path.join(process.cwd(), "data/preview-react-hook-form.json"), "utf8"));

// The parser records where it ran, not what the repository is called, so the
// name comes from whoever chose the data file.
const NAME = "react-hook-form";

export default function Preview() {
  return (
    <Workspace
      name={NAME}
      adapter={result.adapter}
      files={result.files}
      edges={result.edges}
      skipped={result.coverage.files.skipped}
      unresolved={result.coverage.imports.total.unresolved}
    />
  );
}

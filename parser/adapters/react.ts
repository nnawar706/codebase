import type { FrameworkAdapter } from "../adapter.ts";
import { dependsOn } from "./manifest.ts";
import { toolingRole } from "./tooling.ts";

// React's conventions are naming ones. A hook's name starts with "use", which
// React's own lint rules enforce; a .jsx or .tsx file is one that holds JSX.
// React itself routes nothing, so there are no routes to read.

const HOOK = /^use([A-Z0-9]|-[a-z0-9])/;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const JSX = /\.[jt]sx$/;

export function reactRole(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!SCRIPT.test(name)) return null;
  if (HOOK.test(name)) return "hook";
  if (JSX.test(name)) return "component";
  return null;
}

export const reactAdapter: FrameworkAdapter = {
  name: "react",
  detect: (root) => dependsOn(root, "react"),
  // Tooling first: Button.test.tsx is a test, not a component.
  roleOf: (path) => toolingRole(path) ?? reactRole(path),
  routesOf: () => ({ routes: [], unrecovered: [] }),
};

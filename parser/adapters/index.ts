import type { FrameworkAdapter } from "../adapter.ts";
import { nestAdapter } from "./nest.ts";
import { nextAdapter } from "./next.ts";
import { reactAdapter } from "./react.ts";
import { toolingRole } from "./tooling.ts";

/** No framework detected: only the conventions every repository shares. */
const noFramework: FrameworkAdapter = {
  name: "none",
  detect: () => true,
  roleOf: toolingRole,
  routesOf: () => ({ routes: [], unrecovered: [] }),
};

/**
 * In the order they're tried; the first that matches wins and the last always
 * does. Next.js comes before React because every Next.js app depends on React.
 */
export const ADAPTERS: readonly FrameworkAdapter[] = [nextAdapter, nestAdapter, reactAdapter, noFramework];

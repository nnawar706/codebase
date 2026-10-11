import type { FrameworkAdapter } from "../adapter.ts";
import { expressAdapter } from "./express.ts";
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
 * NestJS comes before Express because it runs on Express by default. Express
 * comes before React: a package that serves with Express is a server, even
 * when it also renders React.
 */
export const ADAPTERS: readonly FrameworkAdapter[] = [nextAdapter, nestAdapter, expressAdapter, reactAdapter, noFramework];

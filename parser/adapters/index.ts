import type { FrameworkAdapter } from "../adapter.ts";
import { nextAdapter } from "./next.ts";
import { toolingRole } from "./tooling.ts";

/** No framework detected: only the conventions every repository shares. */
const noFramework: FrameworkAdapter = {
  name: "none",
  detect: () => true,
  roleOf: toolingRole,
};

/** In the order they're tried. The last always applies. */
export const ADAPTERS: readonly FrameworkAdapter[] = [nextAdapter, noFramework];

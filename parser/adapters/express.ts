import type { FrameworkAdapter } from "../adapter.ts";
import { dependsOn } from "./manifest.ts";
import { toolingRole } from "./tooling.ts";

// Express has no file conventions of its own; projects sort files into folders
// by layer, named either singular or plural. The nearest such folder decides,
// so src/routes/v1/user.js is a route.
//
// Routes aren't read. Express assembles them at runtime from routers mounted
// on paths held in variables and middleware chains, so no pattern could be
// read whole from one place in the syntax.

const FOLDER_ROLES: Readonly<Record<string, string>> = {
  route: "route",
  routes: "route",
  router: "route",
  routers: "route",
  controller: "controller",
  controllers: "controller",
  service: "service",
  services: "service",
  model: "model",
  models: "model",
  middleware: "middleware",
  middlewares: "middleware",
};

function expressRole(path: string): string | null {
  const folders = path.split("/").slice(0, -1);
  for (let i = folders.length - 1; i >= 0; i--) {
    if (Object.hasOwn(FOLDER_ROLES, folders[i])) return FOLDER_ROLES[folders[i]];
  }
  return null;
}

export const expressAdapter: FrameworkAdapter = {
  name: "express",
  detect: (root) => dependsOn(root, "express"),
  // Tooling first: routes/user.test.js is a test, not a route.
  roleOf: (path) => toolingRole(path) ?? expressRole(path),
  routesOf: () => ({ routes: [], unrecovered: [] }),
};

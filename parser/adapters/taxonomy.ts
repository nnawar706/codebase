// What each adapter's roles are called on screen, and in what order. Kept
// apart from the adapters and importing nothing, so the browser can read the
// category names without pulling in a parser or a filesystem library.
//
// Order is reading order and never changes: routable surfaces first, then the
// layers behind them, then plumbing. Every category is listed even when a
// repository has none of it, so a category sits in the same place every time.

export interface Category {
  /** Concrete, as someone reading this framework's code would say it. */
  label: string;
  /** The role strings an adapter writes for files in this category. */
  roles: readonly string[];
  /**
   * The framework or a tool loads these files by name or position, never by
   * an import, so nothing importing one says nothing about whether it's used.
   */
  reachedByConvention: boolean;
}

export interface Framework {
  /** Shown as the detected framework. Null when none was. */
  label: string | null;
  categories: readonly Category[];
}

const components: Category = { label: "Components", roles: ["component"], reachedByConvention: false };
const hooks: Category = { label: "Hooks", roles: ["hook"], reachedByConvention: false };
const tests: Category = { label: "Tests", roles: ["test"], reachedByConvention: true };
const config: Category = { label: "Config", roles: ["config"], reachedByConvention: true };

const convention = (label: string, roles: readonly string[]): Category => ({ label, roles, reachedByConvention: true });
const imported = (label: string, roles: readonly string[]): Category => ({ label, roles, reachedByConvention: false });

/** Keyed by adapter name. */
export const TAXONOMY: Readonly<Record<string, Framework>> = {
  nextjs: {
    label: "Next.js",
    categories: [
      convention("Page routes", ["page"]),
      convention("API endpoints", ["route"]),
      // Reached by being imported into a component or passed as a form action.
      imported("Server actions", ["server-action"]),
      convention("Layouts", ["layout", "template", "default"]),
      convention("Loading & error UI", ["loading", "error", "global-error", "not-found"]),
      convention("Metadata files", ["metadata"]),
      components,
      hooks,
      convention("Middleware", ["middleware"]),
      convention("Instrumentation", ["instrumentation"]),
      tests,
      config,
    ],
  },
  // NestJS reaches each of these through a module's import of it, so none is
  // reached by convention.
  nestjs: {
    label: "NestJS",
    categories: [
      imported("Controllers", ["controller"]),
      imported("Resolvers", ["resolver"]),
      imported("Gateways", ["gateway"]),
      imported("Services", ["service"]),
      imported("Repositories", ["repository"]),
      imported("Entities", ["entity"]),
      imported("DTOs", ["dto"]),
      imported("Modules", ["module"]),
      imported("Guards", ["guard"]),
      imported("Interceptors", ["interceptor"]),
      imported("Pipes", ["pipe"]),
      imported("Filters", ["filter"]),
      imported("Middleware", ["middleware"]),
      tests,
      config,
    ],
  },
  react: { label: "React", categories: [components, hooks, tests, config] },
  none: { label: null, categories: [tests, config] },
};

export function frameworkOf(adapter: string): Framework | null {
  return Object.hasOwn(TAXONOMY, adapter) ? TAXONOMY[adapter] : null;
}

import { existsSync } from "node:fs";
import { ts } from "ts-morph";
import type { FrameworkAdapter, RouteScan } from "../adapter.ts";
import type { RouteMethod } from "../types.ts";
import { dependsOn } from "./manifest.ts";
import { reactRole } from "./react.ts";
import { exportedNames, hasDirective, lineOf, literalString } from "./syntax.ts";
import { toolingRole } from "./tooling.ts";

// Next.js reaches these files by where they sit and what they're called, never
// by an import, so the import graph alone would call every one of them unused.
// The same paths are the routes: a page's URL is its folder.

const SCRIPT = /\.[jt]sx?$/;

// App router files whose name is their role.
const APP_FILES = new Set([
  "page",
  "route",
  "layout",
  "template",
  "loading",
  "error",
  "global-error",
  "not-found",
  "default",
]);
const APP_METADATA = new Set(["sitemap", "robots", "manifest", "icon", "apple-icon", "opengraph-image", "twitter-image"]);

// Root-level files Next loads by name. Next 16 renamed middleware to proxy.
const ROOT_FILES: Record<string, string> = {
  middleware: "middleware",
  proxy: "middleware",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
};

// Pages-router files that render something but aren't reached at a URL of their own.
const PAGES_SPECIAL = new Set(["_app", "_document", "_error", "404", "500"]);

// The methods a route handler can export. Any other export isn't a handler.
const HANDLER_METHODS: readonly RouteMethod[] = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

interface Place {
  /** "app" or "pages". */
  top: string;
  /** Folder segments under it. */
  folders: string[];
  /** The file name without its extension. */
  name: string;
}

/** Where a file sits relative to Next's app or pages directory, or null if it's under neither. */
function placeOf(path: string): Place | null {
  if (!SCRIPT.test(path)) return null;
  const segments = path.replace(SCRIPT, "").split("/");
  // Next looks in the project root or in src/, nowhere deeper.
  const start = segments[0] === "src" ? 1 : 0;
  const top = segments[start];
  if (top !== "app" && top !== "pages") return null;
  const rest = segments.slice(start + 1);
  if (rest.length === 0) return null;
  return { top, folders: rest.slice(0, -1), name: rest[rest.length - 1] };
}

function nextRole(path: string, sf: ts.SourceFile): string | null {
  if (!SCRIPT.test(path)) return null;
  const segments = path.replace(SCRIPT, "").split("/");
  if (segments.length === 1 || (segments.length === 2 && segments[0] === "src")) {
    const role = ROOT_FILES[segments[segments.length - 1]];
    if (role) return role;
  }

  const place = placeOf(path);
  if (place?.top === "app") {
    // A folder starting with an underscore is private: nothing under it is routed.
    if (!place.folders.some((s) => s.startsWith("_"))) {
      if (APP_FILES.has(place.name)) return place.name;
      if (APP_METADATA.has(place.name)) return "metadata";
    }
  } else if (place?.top === "pages") {
    if (place.folders[0] === "api") return "route";
    if (place.name === "_app" || place.name === "_document") return "layout";
    return "page";
  }

  // A module-level "use server" makes every export a server action.
  if (hasDirective(sf, "use server")) return "server-action";
  return null;
}

// --- Routes ---

const CONFIG_NAMES = ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts", "next.config.mts"];

interface ConfigSetting {
  value: ts.Node | null;
  line: number;
}

/** Every place the config file sets one of these keys, however it's nested. */
function settingsIn(sf: ts.SourceFile, keys: ReadonlySet<string>): Map<string, ConfigSetting[]> {
  const found = new Map<string, ConfigSetting[]>();
  const add = (key: string, value: ts.Node | null, at: ts.Node) => {
    if (!keys.has(key)) return;
    found.set(key, [...(found.get(key) ?? []), { value, line: lineOf(sf, at) }]);
  };
  const nameOf = (n: ts.PropertyName) => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null);
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const key = nameOf(node.name);
      if (key) add(key, node.initializer, node);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      add(node.name.text, null, node);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      add(node.left.name.text, node.right, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

interface Blocker {
  detail: string;
}

/**
 * What the config does to every URL. A basePath written out as a string is a
 * known prefix; anything else that changes URLs, or a config that can't be
 * read, means no pattern can be stated exactly, so the routes it affects go.
 */
function readConfig(
  root: string,
  files: ReadonlyMap<string, ts.SourceFile>,
): { basePath: string; all: Blocker | null; pages: Blocker | null } {
  const names = CONFIG_NAMES.filter((n) => files.has(n) || existsSync(`${root}/${n}`));
  if (names.length === 0) return { basePath: "", all: null, pages: null };
  if (names.length > 1) return { basePath: "", all: { detail: `more than one config (${names.join(", ")})` }, pages: null };
  const [name] = names;
  const sf = files.get(name);
  if (!sf) return { basePath: "", all: { detail: `${name} wasn't parsed, so its basePath can't be read` }, pages: null };

  const settings = settingsIn(sf, new Set(["basePath", "trailingSlash", "pageExtensions", "i18n"]));
  const at = (s: ConfigSetting) => `${name}:${s.line}`;

  const extensions = settings.get("pageExtensions");
  if (extensions) return { basePath: "", all: { detail: `${at(extensions[0])} sets pageExtensions, which changes which files are pages` }, pages: null };

  const trailing = settings.get("trailingSlash") ?? [];
  const notFalse = trailing.find((s) => s.value?.kind !== ts.SyntaxKind.FalseKeyword);
  if (notFalse) return { basePath: "", all: { detail: `${at(notFalse)} sets trailingSlash, which changes every URL's ending` }, pages: null };

  const base = settings.get("basePath") ?? [];
  let basePath = "";
  if (base.length > 1) {
    return { basePath: "", all: { detail: `basePath is set in more than one place (${base.map(at).join(", ")})` }, pages: null };
  }
  if (base.length === 1) {
    const value = base[0].value ? literalString(base[0].value) : null;
    if (value === null || (value !== "" && !value.startsWith("/"))) {
      return { basePath: "", all: { detail: `${at(base[0])} sets basePath to a value that isn't written out` }, pages: null };
    }
    basePath = value.replace(/\/+$/, "");
  }

  // i18n prefixes pages-router URLs with a locale; the app router ignores it.
  const i18n = settings.get("i18n");
  const pages = i18n ? { detail: `${at(i18n[0])} sets i18n, which prefixes pages-router URLs with a locale` } : null;
  return { basePath, all: null, pages };
}

/** A segment that shapes the URL but isn't in it: (group). Interception markers like (.) are not groups. */
const isGroup = (s: string) => /^\([^.)][^)]*\)$/.test(s);
const isInterception = (s: string) => /^\(\.{1,3}\)/.test(s);

function nextRoutes(root: string, files: ReadonlyMap<string, ts.SourceFile>): RouteScan {
  const config = readConfig(root, files);
  const scan: RouteScan = { routes: [], unrecovered: [] };
  const skip = (file: string, line: number, detail: string) => scan.unrecovered.push({ file, line, detail });

  // Next uses app/ and pages/ at the root and ignores src/app and src/pages
  // when those exist, so routes under src/ only count without them.
  const atRoot = new Set([...files.keys()].map((p) => p.split("/")[0]));

  for (const [file, sf] of files) {
    const place = placeOf(file);
    if (!place) continue;
    if (file.startsWith("src/") && atRoot.has(place.top)) continue;
    const { names, starFrom } = exportedNames(sf);
    const defaultExport = names.find((n) => n.name === "default");
    const found: { method: RouteMethod; line: number; segments: string[]; blocker: Blocker | null }[] = [];

    if (place.top === "app") {
      if (place.name !== "page" && place.name !== "route") continue;
      if (place.folders.some((s) => s.startsWith("_"))) continue;
      const slot = place.folders.find((s) => s.startsWith("@"));
      const intercepting = place.folders.find(isInterception);
      const line = (place.name === "page" ? defaultExport?.line : names[0]?.line) ?? 1;
      if (slot) {
        skip(file, line, `inside parallel route slot ${slot}: which URL renders it depends on the other slots`);
        continue;
      }
      if (intercepting) {
        skip(file, line, `intercepting route ${intercepting}: the URL it answers depends on where navigation came from`);
        continue;
      }
      const segments = place.folders.filter((s) => !isGroup(s));
      if (place.name === "page") {
        if (!defaultExport) skip(file, 1, "page has no default export, so Next.js has nothing to render here");
        else found.push({ method: "GET", line: defaultExport.line, segments, blocker: config.all });
      } else {
        const handlers = names.filter((n): n is { name: RouteMethod; line: number } =>
          HANDLER_METHODS.some((m) => m === n.name),
        );
        for (const h of handlers) found.push({ method: h.name, line: h.line, segments, blocker: config.all });
        for (const star of starFrom) {
          skip(file, star.line, `re-exports everything from "${star.name}", so any handler it exports can't be seen here`);
        }
        if (handlers.length === 0 && starFrom.length === 0) skip(file, 1, "exports no HTTP method handler");
      }
    } else {
      if (place.folders[0] === "api") {
        skip(file, defaultExport?.line ?? 1, "pages-router API handler: the method is decided inside the function body");
        continue;
      }
      if (place.folders.length === 0 && PAGES_SPECIAL.has(place.name)) continue;
      if (!defaultExport) {
        skip(file, 1, "page has no default export, so Next.js has nothing to render here");
        continue;
      }
      const segments = place.name === "index" ? place.folders : [...place.folders, place.name];
      found.push({ method: "GET", line: defaultExport.line, segments, blocker: config.all ?? config.pages });
    }

    for (const f of found) {
      if (f.blocker) skip(file, f.line, f.blocker.detail);
      else scan.routes.push({ file, line: f.line, method: f.method, path: `${config.basePath}/${f.segments.join("/")}` });
    }
  }

  // A basePath with the root page is the basePath itself, without a trailing slash.
  for (const r of scan.routes) if (r.path.length > 1 && r.path.endsWith("/")) r.path = r.path.slice(0, -1);
  return scan;
}

export const nextAdapter: FrameworkAdapter = {
  name: "nextjs",
  detect: (root) => dependsOn(root, "next"),
  // Next's own conventions first, then tooling, then React's naming: a page.tsx
  // is a page, not a component.
  roleOf: (path, sf) => nextRole(path, sf) ?? toolingRole(path) ?? reactRole(path),
  routesOf: nextRoutes,
};

import { ts } from "ts-morph";
import type { FrameworkAdapter, RouteScan } from "../adapter.ts";
import type { RouteMethod } from "../types.ts";
import { dependsOn } from "./manifest.ts";
import { lineOf, literalString } from "./syntax.ts";
import { toolingRole } from "./tooling.ts";

// NestJS names a file for what it is: users.controller.ts, users.service.ts.
// Its routes are two decorators read together, the controller's path and the
// method's, joined the way Nest joins them.

const SUFFIX = /\.(controller|resolver|gateway|service|repository|entity|dto|module|guard|interceptor|pipe|filter|middleware)\.[cm]?[jt]s$/;

function nestRole(path: string): string | null {
  return path.match(SUFFIX)?.[1] ?? null;
}

const METHOD_DECORATORS: Readonly<Record<string, RouteMethod>> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Options: "OPTIONS",
  Head: "HEAD",
  All: "ALL",
  Search: "SEARCH",
};

// Keys of @Controller({...}) that don't change a URL. Any other key (host,
// version) does, and isn't followed.
const URL_NEUTRAL_OPTIONS = new Set(["path", "scope", "durable"]);

/**
 * What each local name in the file refers to in @nestjs/common or
 * @nestjs/core. Only a decorator imported from Nest is read as one: a
 * project's own @Get means whatever the project made it mean.
 */
function nestImports(sf: ts.SourceFile) {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    if (s.moduleSpecifier.text !== "@nestjs/common" && s.moduleSpecifier.text !== "@nestjs/core") continue;
    const bindings = s.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else for (const e of bindings.elements) named.set(e.name.text, (e.propertyName ?? e.name).text);
  }
  return {
    /** The Nest export a call's callee names, or null. */
    resolve(callee: ts.Expression): string | null {
      if (ts.isIdentifier(callee)) return named.get(callee.text) ?? null;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) {
        return callee.name.text;
      }
      return null;
    },
  };
}

type Paths = { paths: string[] } | { detail: string };

/** A decorator's path argument: nothing, a string, or an array of strings, all written out. */
function pathsOf(arg: ts.Expression | undefined, what: string): Paths {
  if (arg === undefined) return { paths: [""] };
  const one = literalString(arg);
  if (one !== null) return { paths: [one] };
  if (ts.isArrayLiteralExpression(arg)) {
    const all = arg.elements.map(literalString);
    if (all.length > 0 && all.every((p): p is string => p !== null)) return { paths: all };
  }
  return { detail: `${what} path isn't written out as a string` };
}

function controllerPaths(call: ts.CallExpression): Paths {
  const [arg] = call.arguments;
  if (arg && ts.isObjectLiteralExpression(arg)) {
    let path: ts.Expression | undefined;
    for (const p of arg.properties) {
      const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
      if (key === null || !ts.isPropertyAssignment(p) || !URL_NEUTRAL_OPTIONS.has(key)) {
        return { detail: `@Controller sets ${key ?? "an option"} that changes where its routes answer` };
      }
      if (key === "path") path = p.initializer;
    }
    return pathsOf(path, "@Controller");
  }
  return pathsOf(arg, "@Controller");
}

/** Nest's own joining: one leading slash, no doubled or trailing ones. */
function joinPath(...parts: string[]): string {
  const inner = parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p !== "");
  return `/${inner.join("/")}`;
}

const decoratorCalls = (node: ts.Node): ts.CallExpression[] =>
  (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []).flatMap((d) =>
    ts.isCallExpression(d.expression) ? [d.expression] : [],
  );

interface AppSetup {
  prefix: string;
  /** Why no route in the repository can be stated exactly, or null. */
  blocker: string | null;
}

/**
 * What the bootstrap does to every URL. A single setGlobalPrefix with a
 * written-out string is a known prefix. Versioning, RouterModule, a prefix
 * with exclusions, or a prefix with more than one app to apply to make every
 * pattern uncertain.
 */
function appSetup(files: ReadonlyMap<string, ts.SourceFile>): AppSetup {
  const prefixes: { at: string; call: ts.CallExpression }[] = [];
  let apps = 0;
  for (const [file, sf] of files) {
    const nest = nestImports(sf);
    let blocker: string | null = null;
    const visit = (node: ts.Node) => {
      if (blocker || ts.isImportDeclaration(node)) return;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const on = node.expression.expression;
        if (method === "setGlobalPrefix") prefixes.push({ at: `${file}:${lineOf(sf, node)}`, call: node });
        else if (method === "enableVersioning") blocker = `${file}:${lineOf(sf, node)} enables versioning, which adds a version to URLs`;
        else if (method === "create" && nest.resolve(on) === "NestFactory") apps += 1;
      }
      if (ts.isIdentifier(node) && nest.resolve(node) === "RouterModule") {
        blocker = `${file}:${lineOf(sf, node)} uses RouterModule, which prefixes some modules' routes`;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (blocker) return { prefix: "", blocker };
  }

  if (prefixes.length === 0) return { prefix: "", blocker: null };
  const where = prefixes.map((p) => p.at).join(", ");
  if (prefixes.length > 1 || apps > 1) {
    return { prefix: "", blocker: `setGlobalPrefix (${where}) with more than one app or prefix, so which routes it applies to isn't known` };
  }
  const { call } = prefixes[0];
  const prefix = call.arguments.length === 1 ? literalString(call.arguments[0]) : null;
  if (prefix === null) {
    return { prefix: "", blocker: `setGlobalPrefix at ${where} isn't a single written-out string` };
  }
  return { prefix, blocker: null };
}

function nestRoutes(_root: string, files: ReadonlyMap<string, ts.SourceFile>): RouteScan {
  const setup = appSetup(files);
  const scan: RouteScan = { routes: [], unrecovered: [] };

  for (const [file, sf] of files) {
    const nest = nestImports(sf);
    const visit = (node: ts.Node) => {
      ts.forEachChild(node, visit);
      if (!ts.isClassDeclaration(node)) return;
      const classDecorators = decoratorCalls(node);
      const controller = classDecorators.find((c) => nest.resolve(c.expression) === "Controller");
      if (!controller) return;
      const classVersion = classDecorators.find((c) => nest.resolve(c.expression) === "Version");
      const base = controllerPaths(controller);

      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const calls = decoratorCalls(member);
        const versioned = classVersion ?? calls.find((c) => nest.resolve(c.expression) === "Version");
        for (const call of calls) {
          const name = nest.resolve(call.expression);
          const line = lineOf(sf, call);
          const skip = (detail: string) => scan.unrecovered.push({ file, line, detail });
          if (name === "RequestMapping") {
            skip("@RequestMapping takes its method as an option; it isn't read");
            continue;
          }
          const method = name === null ? undefined : METHOD_DECORATORS[name];
          if (!method) continue;
          if (setup.blocker) skip(setup.blocker);
          else if (versioned) skip(`@Version at line ${lineOf(sf, versioned)} adds a version to the URL`);
          else if ("detail" in base) skip(base.detail);
          else {
            const own = pathsOf(call.arguments[0], `@${name}`);
            if ("detail" in own) skip(own.detail);
            else {
              for (const b of base.paths) {
                for (const p of own.paths) scan.routes.push({ file, line, method, path: joinPath(setup.prefix, b, p) });
              }
            }
          }
        }
      }
    };
    visit(sf);
  }
  return scan;
}

export const nestAdapter: FrameworkAdapter = {
  name: "nestjs",
  detect: (root) => dependsOn(root, "@nestjs/core"),
  // Tooling first: users.controller.spec.ts is a test of a controller, not one.
  roleOf: (path) => toolingRole(path) ?? nestRole(path),
  routesOf: nestRoutes,
};

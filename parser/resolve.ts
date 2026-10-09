import { existsSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { ts } from "ts-morph";
import type { EdgeKind, ExcludedReason, UnresolvedReason } from "./types.ts";
import { isDeclarationPath, isExcludedDirName, isSourcePath } from "./walk.ts";

export type Resolution =
  | { outcome: "internal"; target: string }
  | { outcome: "external" }
  | { outcome: "excluded"; target: string; reason: ExcludedReason }
  | { outcome: "unresolved"; reason: UnresolvedReason; detail: string };

export interface ResolverInput {
  /** Absolute, forward slashes. */
  root: string;
  /** Repository-relative paths that are nodes. */
  nodes: ReadonlySet<string>;
  /** Repository-relative paths that were found but skipped. */
  skipped: ReadonlySet<string>;
  /** Package names declared by package.json files inside the repository. */
  workspacePackages: ReadonlySet<string>;
}

interface ConfigEntry {
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  /** Canonical absolute paths the config lists. Empty for the default config. */
  fileNames: ReadonlySet<string>;
  /** Absolute paths of referenced configs. */
  references: readonly string[];
  /** Where `paths` targets are anchored. */
  aliasBase: string;
}

const NODE_ESM_RESOLUTION = new Set([ts.ModuleResolutionKind.Node16, ts.ModuleResolutionKind.NodeNext]);

const posix = (p: string) => p.replace(/\\/g, "/");

/** foo.d.ts -> foo.js, foo.jsx; foo.d.mts -> foo.mjs; styles.d.css.ts -> styles.css */
function implementationsOf(declaration: string): string[] {
  const arbitrary = declaration.match(/^(.*)\.d\.([^/.]+)\.ts$/);
  if (arbitrary) return [`${arbitrary[1]}.${arbitrary[2]}`];
  const code = declaration.match(/^(.*)\.d\.([mc]?)ts$/);
  if (!code) return [];
  return code[2] ? [`${code[1]}.${code[2]}js`] : [`${code[1]}.js`, `${code[1]}.jsx`];
}

const isFile = (abs: string) => {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
};

// The repository's own settings decide resolution. Two are forced on, because
// the question here is "which file is this", not "does it type-check".
function normalizeOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  const resolution = options.moduleResolution;
  return {
    ...options,
    allowJs: true,
    resolveJsonModule: true,
    // Classic resolution never looks at index files or packages; nothing bundles
    // that way, so a repository without a setting gets what bundlers do.
    moduleResolution:
      resolution === undefined || resolution === ts.ModuleResolutionKind.Classic
        ? ts.ModuleResolutionKind.Bundler
        : resolution,
  };
}

/** The package a bare specifier names: "@a/b/c" -> "@a/b", "a/b" -> "a". */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function createResolver({ root, nodes, skipped, workspacePackages }: ResolverInput) {
  const warnings: string[] = [];
  const canonical = (p: string) => (ts.sys.useCaseSensitiveFileNames ? p : p.toLowerCase());
  const nodesByLowerCase = new Map([...nodes].map((n) => [n.toLowerCase(), n]));

  const relativeToRoot = (abs: string): string | null => {
    const p = posix(abs);
    return canonical(p).startsWith(canonical(`${root}/`)) ? p.slice(root.length + 1) : null;
  };

  const makeEntry = (
    parsed: Pick<ts.ParsedCommandLine, "options" | "fileNames" | "projectReferences">,
    configDir: string,
  ): ConfigEntry => {
    const options = normalizeOptions(parsed.options);
    // pathsBasePath is where TypeScript anchors `paths`: the config that
    // declared them, even through `extends`. It's set but not in the public type.
    const pathsBase = parsed.options.pathsBasePath;
    return {
      options,
      cache: ts.createModuleResolutionCache(root, canonical, options),
      fileNames: new Set(parsed.fileNames.map((f) => canonical(posix(f)))),
      references: (parsed.projectReferences ?? []).map((r) => posix(ts.resolveProjectReferencePath(r))),
      aliasBase: posix(typeof pathsBase === "string" ? pathsBase : (options.baseUrl ?? configDir)),
    };
  };
  const defaultEntry = makeEntry({ options: {}, fileNames: [] }, root);

  const configCache = new Map<string, ConfigEntry | null>();
  const loadConfig = (configPath: string): ConfigEntry | null => {
    const cached = configCache.get(configPath);
    if (cached !== undefined) return cached;
    const rel = relativeToRoot(configPath) ?? configPath;
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) =>
        warnings.push(`${rel}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`),
    });
    for (const d of parsed?.errors ?? []) {
      // 18003: "No inputs were found" — normal for a solution-style config.
      if (d.code !== 18003) warnings.push(`${rel}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
    const entry = parsed ? makeEntry(parsed, path.posix.dirname(configPath)) : null;
    configCache.set(configPath, entry);
    return entry;
  };

  // A solution-style tsconfig (files: [], references: [...]) keeps its aliases
  // in the referenced configs, so prefer whichever config actually lists the file.
  const configForFile = (fromAbs: string): ConfigEntry => {
    let dir = path.posix.dirname(fromAbs);
    while (dir.startsWith(root)) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const configPath = `${dir}/${name}`;
        if (!existsSync(configPath)) continue;
        const nearest = loadConfig(configPath);
        if (!nearest) continue;
        const key = canonical(fromAbs);
        if (nearest.fileNames.has(key)) return nearest;
        for (const refPath of nearest.references) {
          if (!existsSync(refPath)) continue;
          const referenced = loadConfig(refPath);
          if (referenced?.fileNames.has(key)) return referenced;
        }
        return nearest;
      }
      if (dir === root) break;
      dir = path.posix.dirname(dir);
    }
    return defaultEntry;
  };

  const inExcludedDirectory = (rel: string) => rel.split("/").slice(0, -1).some(isExcludedDirName);

  // A resolved path inside the repository either is a node, or is a real file
  // that deliberately isn't one. Anything else means the walk and the resolver
  // disagree, and that must not be papered over.
  // TypeScript flags anything found through node_modules as an external
  // library, but a linked workspace package resolves to its real path in the
  // repository, so where the file is decides, not the flag.
  const classifyPath = (abs: string): Resolution => {
    const rel = relativeToRoot(abs);
    if (rel === null || rel.split("/").includes("node_modules")) return { outcome: "external" };
    if (nodes.has(rel)) return { outcome: "internal", target: rel };
    const differentCase = nodesByLowerCase.get(rel.toLowerCase());
    if (differentCase) {
      return {
        outcome: "unresolved",
        reason: "case-mismatch",
        detail: `resolves to ${rel} only on a case-insensitive file system; the file is ${differentCase}`,
      };
    }
    // TypeScript prefers foo.d.ts over foo.js. What actually runs is the .js.
    if (isDeclarationPath(rel)) {
      const candidates = implementationsOf(rel);
      const implementation = candidates.find((c) => nodes.has(c));
      if (implementation) return { outcome: "internal", target: implementation };
      const asset = candidates.find((c) => !isSourcePath(c) && isFile(`${root}/${c}`));
      if (asset) return classifyPath(`${root}/${asset}`);
    }
    if (skipped.has(rel)) return { outcome: "excluded", target: rel, reason: "skipped-file" };
    if (inExcludedDirectory(rel)) return { outcome: "excluded", target: rel, reason: "excluded-directory" };
    if (!isSourcePath(rel)) return { outcome: "excluded", target: rel, reason: "non-source-file" };
    throw new Error(`Resolved ${rel}, which the walk neither kept nor skipped`);
  };

  /** Matching `paths` patterns, longest prefix first as TypeScript tries them, with what `*` captured. */
  const matchingAliases = (specifier: string, paths: ts.MapLike<string[]> | undefined) =>
    Object.entries(paths ?? {})
      .flatMap(([pattern, targets]) => {
        const star = pattern.indexOf("*");
        if (star === -1) return specifier === pattern ? [{ pattern, targets, prefix: pattern, captured: "" }] : [];
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        const fits =
          specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
        if (!fits) return [];
        return [{ pattern, targets, prefix, captured: specifier.slice(prefix.length, specifier.length - suffix.length) }];
      })
      .sort((a, b) => b.prefix.length - a.prefix.length);

  // Under Node16/NodeNext a package can resolve differently for import and
  // require, so the mode has to match how Node would load this file. Bundler
  // and Node10 resolution don't use a mode.
  const modeFor = (fromAbs: string, kind: EdgeKind, config: ConfigEntry): ts.ResolutionMode => {
    const resolution = config.options.moduleResolution;
    if (resolution === undefined || !NODE_ESM_RESOLUTION.has(resolution)) return undefined;
    if (kind === "dynamic-import") return ts.ModuleKind.ESNext;
    return ts.getImpliedNodeFormatForFile(fromAbs, config.cache.getPackageJsonInfoCache(), ts.sys, config.options);
  };

  const resolve = (fromRel: string, specifier: string, kind: EdgeKind, literal: boolean): Resolution => {
    if (!literal) {
      return {
        outcome: "unresolved",
        reason: "non-literal-dynamic",
        detail: "the specifier is computed at runtime, so the target can't be known from the source",
      };
    }
    if (isBuiltin(specifier)) return { outcome: "external" };

    const fromAbs = `${root}/${fromRel}`;
    const config = configForFile(fromAbs);
    const mode = modeFor(fromAbs, kind, config);
    const { resolvedModule } = ts.resolveModuleName(specifier, fromAbs, config.options, ts.sys, config.cache, undefined, mode);
    if (resolvedModule) return classifyPath(resolvedModule.resolvedFileName);

    const isPathSpecifier = specifier.startsWith(".") || specifier.startsWith("/");
    if (isPathSpecifier) {
      // TypeScript only resolves code and JSON. A stylesheet or image that
      // exists is a real file, just not a node.
      const withoutQuery = specifier.replace(/[?#].*$/, "");
      const abs = specifier.startsWith("/")
        ? `${root}${withoutQuery}`
        : path.posix.join(path.posix.dirname(fromAbs), withoutQuery);
      if (isFile(abs)) return classifyPath(abs);
      return {
        outcome: "unresolved",
        reason: "not-found",
        detail: `no file at ${relativeToRoot(abs) ?? abs} with any supported extension or index file`,
      };
    }

    const withoutQuery = specifier.replace(/[?#].*$/, "");

    // TypeScript won't resolve an alias to a stylesheet or image, so look on
    // disk: an existing file is excluded like any other non-code target.
    const aliases = matchingAliases(withoutQuery, config.options.paths);
    if (aliases.length > 0) {
      const tried: string[] = [];
      for (const { targets, captured } of aliases) {
        for (const target of targets) {
          const abs = posix(path.resolve(config.aliasBase, target.replace("*", captured)));
          if (isFile(abs)) return classifyPath(abs);
          tried.push(relativeToRoot(abs) ?? abs);
        }
      }
      return {
        outcome: "unresolved",
        reason: "alias-target-missing",
        detail: `matches path alias ${aliases.map((a) => `"${a.pattern}"`).join(", ")}, but nothing exists at ${tried.join(", ")}`,
      };
    }

    // In a fresh clone nothing is installed, so a sibling package can't
    // resolve. Calling it external would drop every edge between packages.
    const packageName = packageNameOf(specifier);
    if (workspacePackages.has(packageName)) {
      return {
        outcome: "unresolved",
        reason: "workspace-package-not-linked",
        detail: `${packageName} is a package in this repository, but it isn't linked into node_modules (dependencies not installed)`,
      };
    }

    const baseUrl = config.options.baseUrl;
    if (baseUrl) {
      const underBaseUrl = posix(path.resolve(baseUrl, withoutQuery));
      if (isFile(underBaseUrl)) return classifyPath(underBaseUrl);
      const firstSegment = specifier.split("/")[0];
      const underBase = `${posix(baseUrl)}/${firstSegment}`;
      if (existsSync(underBase) || existsSync(`${underBase}.ts`) || existsSync(`${underBase}.js`)) {
        return {
          outcome: "unresolved",
          reason: "base-url-target-missing",
          detail: `looks relative to baseUrl ${relativeToRoot(baseUrl) ?? "."}, but no file matches`,
        };
      }
    }

    // A bare name that isn't an alias is a package, installed or not.
    return { outcome: "external" };
  };

  return { resolve, warnings };
}

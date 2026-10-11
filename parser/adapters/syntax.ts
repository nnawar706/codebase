import { ts } from "ts-morph";

// Small readings of a parsed file that more than one adapter needs. Each one
// answers only from the syntax in front of it: a value that would have to be
// evaluated, imported or followed comes back as null, never as a best guess.

export const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** The text of a string written out in full, or null for anything computed. */
export function literalString(node: ts.Node): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/** Whether the file opens with this directive, as in "use server". */
export function hasDirective(sf: ts.SourceFile, directive: string): boolean {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

export interface ExportedName {
  name: string;
  line: number;
}

export interface Exports {
  names: ExportedName[];
  /** Where the file hands over a whole module or object whose names can't be listed from here. */
  starFrom: ExportedName[];
}

const isModuleExports = (node: ts.Expression) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === "module" &&
  node.name.text === "exports";

const isExportsObject = (node: ts.Expression) =>
  (ts.isIdentifier(node) && node.text === "exports") || isModuleExports(node);

/**
 * A write to one property of the exports object: its name, or null when the
 * key is computed. Undefined when the node isn't such a write.
 */
function exportsMember(node: ts.Expression, exportsIsLive: boolean): string | null | undefined {
  const isTarget = (e: ts.Expression) => isModuleExports(e) || (exportsIsLive && ts.isIdentifier(e) && e.text === "exports");
  if (ts.isPropertyAccessExpression(node) && isTarget(node.expression)) return node.name.text;
  if (ts.isElementAccessExpression(node) && isTarget(node.expression)) return literalString(node.argumentExpression);
  return undefined;
}

const requiredSpecifier = (node: ts.Expression): string | null =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1
    ? literalString(node.arguments[0])
    : null;

/**
 * What a CommonJS file puts on module.exports, read from its top-level
 * statements in order the way Node would run them. An assignment inside a
 * function or a branch may never run, so it isn't read.
 */
function commonjsExports(sf: ts.SourceFile): Exports {
  let names: ExportedName[] = [];
  let starFrom: ExportedName[] = [];
  // `exports` starts as an alias of module.exports. Replacing module.exports
  // detaches it, and writes to it after that export nothing.
  let exportsIsLive = true;

  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s)) continue;
    const e = s.expression;

    // Object.defineProperty(exports, "name", ...), as compilers write it.
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      ts.isIdentifier(e.expression.expression) &&
      e.expression.expression.text === "Object" &&
      e.expression.name.text === "defineProperty" &&
      e.arguments.length >= 2 &&
      (isModuleExports(e.arguments[0]) || (exportsIsLive && isExportsObject(e.arguments[0])))
    ) {
      const name = literalString(e.arguments[1]);
      if (name !== null) names.push({ name, line: lineOf(sf, s) });
      continue;
    }

    if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;

    // `exports = module.exports = x` assigns down a chain; every target gets x.
    const targets: ts.Expression[] = [];
    let value: ts.Expression = e;
    while (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      targets.push(value.left);
      value = value.right;
    }

    const member = targets.map((t) => exportsMember(t, exportsIsLive)).find((n) => n !== undefined);
    if (member !== undefined) {
      if (member === null) starFrom.push({ name: "", line: lineOf(sf, s) });
      else names.push({ name: member, line: lineOf(sf, s) });
      continue;
    }
    if (!targets.some(isModuleExports)) continue;

    // The whole of module.exports is replaced: what came before is gone.
    names = [];
    starFrom = [];
    exportsIsLive = targets.some((t) => ts.isIdentifier(t) && t.text === "exports");
    const required = requiredSpecifier(value);
    if (required !== null) {
      starFrom.push({ name: required, line: lineOf(sf, s) });
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const p of value.properties) {
        if (ts.isSpreadAssignment(p)) {
          starFrom.push({ name: requiredSpecifier(p.expression) ?? "", line: lineOf(sf, p) });
          continue;
        }
        const key = p.name;
        const name =
          key === undefined
            ? null
            : ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)
              ? key.text
              : ts.isComputedPropertyName(key)
                ? literalString(key.expression)
                : null;
        if (name !== null) names.push({ name, line: lineOf(sf, p) });
        else starFrom.push({ name: "", line: lineOf(sf, p) });
      }
    } else {
      // A function, class or other value is the module itself, which is what
      // an ES import of a CommonJS module receives as its default.
      names.push({ name: "default", line: lineOf(sf, s) });
    }
  }

  const seen = new Set<string>();
  return { names: names.filter((n) => !seen.has(n.name) && seen.add(n.name)), starFrom };
}

/**
 * Value exports by the name they're exported under, and whether the file
 * also re-exports everything from somewhere, which hides names from here.
 * CommonJS exports are kept apart: which of the two a loader honours depends
 * on the framework, so the reader decides.
 */
export function exportedNames(sf: ts.SourceFile): Exports & { commonjs: Exports } {
  const names: ExportedName[] = [];
  const starFrom: ExportedName[] = [];
  for (const s of sf.statements) {
    if (ts.isExportAssignment(s)) {
      if (!s.isExportEquals) names.push({ name: "default", line: lineOf(sf, s) });
      continue;
    }
    if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      const from = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : "";
      if (!s.exportClause) starFrom.push({ name: from, line: lineOf(sf, s) });
      else if (ts.isNamespaceExport(s.exportClause)) names.push({ name: s.exportClause.name.text, line: lineOf(sf, s) });
      else {
        for (const e of s.exportClause.elements) {
          if (!e.isTypeOnly) names.push({ name: e.name.text, line: lineOf(sf, e) });
        }
      }
      continue;
    }
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(s, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) {
      if (isDefault) names.push({ name: "default", line: lineOf(sf, s) });
      else if (s.name) names.push({ name: s.name.text, line: lineOf(sf, s.name) });
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        // A destructured export names its bindings; each is a real export.
        const bound = ts.isIdentifier(d.name)
          ? [d.name]
          : d.name.elements.flatMap((el) => (ts.isBindingElement(el) && ts.isIdentifier(el.name) ? [el.name] : []));
        for (const id of bound) names.push({ name: id.text, line: lineOf(sf, id) });
      }
    } else if (ts.isEnumDeclaration(s) || ts.isModuleDeclaration(s)) {
      if (ts.isIdentifier(s.name)) names.push({ name: s.name.text, line: lineOf(sf, s.name) });
    }
  }
  return { names, starFrom, commonjs: commonjsExports(sf) };
}

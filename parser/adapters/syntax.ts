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

/**
 * Value exports by the name they're exported under, and whether the file
 * also re-exports everything from somewhere, which hides names from here.
 */
export function exportedNames(sf: ts.SourceFile): { names: ExportedName[]; starFrom: ExportedName[] } {
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
  return { names, starFrom };
}

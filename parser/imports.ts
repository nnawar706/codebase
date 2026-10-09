import { ts } from "ts-morph";
import type { EdgeKind } from "./types.ts";

export interface FoundImport {
  kind: EdgeKind;
  line: number;
  /** The literal module specifier, or the expression's text when it isn't a literal. */
  specifier: string;
  literal: boolean;
}

/** Every import, re-export and dynamic import in a parsed file, in source order. */
export function findImports(sf: ts.SourceFile): FoundImport[] {
  const found: FoundImport[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ kind: "import", line: lineOf(node), specifier: node.moduleSpecifier.text, literal: true });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ kind: "re-export", line: lineOf(node), specifier: node.moduleSpecifier.text, literal: true });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        found.push({ kind: "dynamic-import", line: lineOf(node), specifier: arg.text, literal: true });
      } else {
        const text = arg ? arg.getText(sf) : "";
        found.push({ kind: "dynamic-import", line: lineOf(node), specifier: text, literal: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return found;
}

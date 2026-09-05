// Resolve a contract's `file:symbol` to the source position the injector edits.
// Pure: (relative path, source text, symbol) -> site | null. A null result is
// the `unresolved` state of `check` (spec/plan/2026-09-05-live-contract-testing.md §5.2).
//
// Only top-level declarations are resolvable. A contract names an exported unit
// of the module's public surface; nesting would make the anchor ambiguous and
// the `Class.method` form unreadable.

import ts from 'typescript';

export type SymbolForm =
  | 'const-initializer'
  | 'function-declaration'
  | 'prototype-method'
  | 'static-method';

export type SymbolSite = {
  readonly form: SymbolForm;
  /** 1-based line of the declaration, used for the fragment's `where`. */
  readonly line: number;
  readonly indent: string;
  /** const-initializer: source range of the initializer to wrap. */
  readonly wrapStart?: number;
  readonly wrapEnd?: number;
  /** statement forms: offset the replacement assignment goes after. */
  readonly insertPos?: number;
  /** Runtime expression naming the function to wrap (`f`, `C.prototype.m`, `C.m`). */
  readonly target: string;
};

export function parseContractSource(relPath: string, text: string): ts.SourceFile {
  const kind = relPath.endsWith('.ts') || relPath.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, kind);
}

export function resolveSymbol(relPath: string, text: string, symbol: string): SymbolSite | null {
  const sf = parseContractSource(relPath, text);
  const dot = symbol.indexOf('.');
  if (dot > 0) return resolveMethod(sf, text, symbol.slice(0, dot), symbol.slice(dot + 1));
  return resolveTopLevelFunction(sf, text, symbol);
}

function resolveTopLevelFunction(sf: ts.SourceFile, text: string, name: string): SymbolSite | null {
  for (const statement of sf.statements) {
    if (
      ts.isVariableStatement(statement)
      && isExported(statement)
      && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
        if (declaration.initializer === undefined || !isFunctionInitializer(declaration.initializer)) return null;
        return {
          form: 'const-initializer',
          line: lineOf(sf, statement.getStart(sf)),
          indent: indentOf(text, statement.getStart(sf)),
          wrapStart: declaration.initializer.getStart(sf),
          wrapEnd: declaration.initializer.end,
          target: name,
        };
      }
      continue;
    }
    // Skip overload signatures and place the assignment after the implementation,
    // keeping the overload set contiguous and valid TypeScript.
    if (
      ts.isFunctionDeclaration(statement)
      && isExported(statement)
      && statement.name?.text === name
      && statement.body !== undefined
    ) {
      return {
        form: 'function-declaration',
        line: lineOf(sf, statement.getStart(sf)),
        indent: indentOf(text, statement.getStart(sf)),
        insertPos: statement.end,
        target: name,
      };
    }
  }
  return null;
}

function resolveMethod(sf: ts.SourceFile, text: string, className: string, methodName: string): SymbolSite | null {
  for (const statement of sf.statements) {
    if (!ts.isClassDeclaration(statement) || !isExported(statement) || statement.name?.text !== className) continue;
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      // A private name (`#m`) has no expression form to replace; it is
      // deliberately out of reach (§5.1).
      if (!ts.isIdentifier(member.name)) continue;
      if (member.name.text !== methodName) continue;
      if (member.body === undefined) continue;
      const isStatic = (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
      return {
        form: isStatic ? 'static-method' : 'prototype-method',
        line: lineOf(sf, member.getStart(sf)),
        indent: indentOf(text, statement.getStart(sf)),
        insertPos: statement.end,
        target: isStatic ? `${className}.${methodName}` : `${className}.prototype.${methodName}`,
      };
    }
    return null;
  }
  return null;
}

function isExported(node: ts.VariableStatement | ts.FunctionDeclaration | ts.ClassDeclaration): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function isFunctionInitializer(initializer: ts.Expression): boolean {
  let expression = initializer;
  for (;;) {
    if (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    else if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
    else if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return true;
    else if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
      if (expression.expression.text !== 'contract') return false;
      const original = expression.arguments[0];
      if (original === undefined) return false;
      expression = original;
    } else return false;
  }
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function indentOf(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return match ? (match[0] as string) : '';
}

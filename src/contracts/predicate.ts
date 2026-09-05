// Shape check for a predicate module (spec/plan/2026-09-05-live-contract-testing.md §3.2):
// it must `export default` an object literal, so the injector can spread it into
// the generated spec. Pure: (relative path, source text) -> state.
//
// The check is syntactic on purpose. Type-checking the module would need the
// target repo's whole program (and its @ludiars/log-weaver install); the failure
// this state exists to catch — a renamed or emptied contract file — is visible
// from the syntax alone.

import ts from 'typescript';
import { parseContractSource } from './symbols.ts';

export type PredicateModuleState = 'ok' | 'missing' | 'invalid-default';

export function classifyPredicateSource(relPath: string, text: string): 'ok' | 'invalid-default' {
  const sf = parseContractSource(relPath, text);
  for (const statement of sf.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals === true) continue;
    const expression = unwrap(statement.expression);
    if (ts.isObjectLiteralExpression(expression)) return 'ok';
    if (ts.isIdentifier(expression) && bindsObjectLiteral(sf, expression.text)) return 'ok';
    return 'invalid-default';
  }
  return 'invalid-default';
}

/** Strip `satisfies X`, `as X`, and parentheses around the default export. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
    else return current;
  }
}

function bindsObjectLiteral(sf: ts.SourceFile, name: string): boolean {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      return declaration.initializer !== undefined && ts.isObjectLiteralExpression(unwrap(declaration.initializer));
    }
  }
  return false;
}

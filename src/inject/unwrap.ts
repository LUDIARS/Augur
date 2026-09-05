// Undo a wrap fragment: `<callee>(<original>, { … }) /* marker */` back to
// `<original>`. Shared by the guard rules and contract-wrap, which differ only
// in the callee they wrapped with.

import ts from 'typescript';
import { parseSource } from './scan.ts';
import type { MarkerHit } from './types.ts';

export function unwrapCall(relPath: string, text: string, hit: MarkerHit, callee: string): string | null {
  const sf = parseSource(relPath, text);
  let found: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === callee
      && node.end <= hit.start
      && text.slice(node.end, hit.start).trim() === ''
      && (found === null || node.end > found.end)
    ) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found === null) return null;
  const call = found as ts.CallExpression;
  const original = call.arguments[0];
  if (original === undefined) return null;
  return text.slice(0, call.getStart(sf)) + text.slice(original.getStart(sf), original.end) + text.slice(hit.end);
}

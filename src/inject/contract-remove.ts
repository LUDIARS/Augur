// Undo one contract-wrap fragment (spec/plan/2026-09-05-live-contract-testing.md §7).
// The wrap form is a plain unwrap; the two statement forms delete the whole
// insertion, including the `@ts-expect-error` line apply added above it, so the
// file returns to the exact bytes it had before.

import ts from 'typescript';
import { parseSource } from './scan.ts';
import { unwrapCall } from './unwrap.ts';
import type { MarkerHit } from './types.ts';

export const TS_EXPECT_ERROR_LINE = '// @ts-expect-error augur-inject';

export function removeContractWrap(relPath: string, text: string, hit: MarkerHit): string | null {
  const unwrapped = unwrapCall(relPath, text, hit, 'contract');
  if (unwrapped !== null) return unwrapped;
  return removeAssignment(relPath, text, hit);
}

function removeAssignment(relPath: string, text: string, hit: MarkerHit): string | null {
  const sf = parseSource(relPath, text);
  let statement: ts.ExpressionStatement | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isExpressionStatement(node)
      && node.end <= hit.start
      && text.slice(node.end, hit.start).trim() === ''
      && (statement === null || node.end > statement.end)
    ) {
      statement = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (statement === null) return null;

  let start = backOverNewline(text, backOverIndent(text, (statement as ts.Node).getStart(sf)));
  const guardStart = text.lastIndexOf('\n', start - 1) + 1;
  if (text.slice(guardStart, start).trim() === TS_EXPECT_ERROR_LINE) {
    start = backOverNewline(text, guardStart);
  }
  return text.slice(0, start) + text.slice(hit.end);
}

function backOverIndent(text: string, index: number): number {
  let at = index;
  while (at > 0 && (text[at - 1] === ' ' || text[at - 1] === '\t')) at -= 1;
  return at;
}

function backOverNewline(text: string, index: number): number {
  let at = index;
  if (at > 0 && text[at - 1] === '\n') {
    at -= 1;
    if (at > 0 && text[at - 1] === '\r') at -= 1;
  }
  return at;
}

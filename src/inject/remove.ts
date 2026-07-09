// Marker-driven removal (spec/feature/log-injection.md, "Markers").
// Strips every fragment the framework inserted, restoring the original text:
// statement inserts are deleted (with the whitespace apply added), guard
// wraps are unwrapped back to the bare callback, marker imports and
// entry-runtime imports are deleted line-wise.
//
// One marker is removed per parse pass (innermost fragments can sit inside a
// wrapped callback, so positions are recomputed after every removal).

import ts from 'typescript';
import { findMarkers } from './markers.ts';
import { parseSource } from './scan.ts';
import type { MarkerHit } from './types.ts';

export type RemoveResult = { text: string; removed: number; changed: boolean };

export function computeRemove(relPath: string, text: string): RemoveResult {
  let current = text;
  let removed = 0;
  for (;;) {
    const markers = findMarkers(current);
    if (markers.length === 0) break;
    const target = markers[markers.length - 1] as MarkerHit;
    const next = removeOne(relPath, current, target);
    if (next === null) {
      // Unrecognized fragment shape around the marker; drop just the marker
      // comment so the loop always terminates.
      current = current.slice(0, target.start) + current.slice(target.end);
    } else {
      current = next;
    }
    removed += 1;
  }
  return { text: current, removed, changed: removed > 0 };
}

function removeOne(relPath: string, text: string, hit: MarkerHit): string | null {
  if (hit.rule === 'import' || hit.rule === 'entry-runtime') {
    return removeLine(text, hit);
  }
  if (hit.rule === 'silent-catch' || hit.rule === 'spawn-watch') {
    return removeStatement(relPath, text, hit);
  }
  if (hit.rule === 'interval-guard' || hit.rule === 'listener-guard') {
    return unwrapGuard(relPath, text, hit);
  }
  return null;
}

/** Delete the whole line carrying the marker (imports live alone on a line). */
function removeLine(text: string, hit: MarkerHit): string {
  const lineStart = text.lastIndexOf('\n', hit.start - 1) + 1;
  let lineEnd = text.indexOf('\n', hit.end);
  lineEnd = lineEnd === -1 ? text.length : lineEnd + 1;
  return text.slice(0, lineStart) + text.slice(lineEnd);
}

/**
 * Delete the injected statement that ends immediately before the marker,
 * plus the whitespace apply inserted with it (spaces/tabs, then at most one
 * newline — silent-catch inserts ` stmt`, spawn-watch inserts `\n indent stmt`).
 */
function removeStatement(relPath: string, text: string, hit: MarkerHit): string | null {
  const sf = parseSource(relPath, text);
  let statement: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isExpressionStatement(node) &&
      node.end <= hit.start &&
      text.slice(node.end, hit.start).trim() === '' &&
      (statement === null || node.end > statement.end)
    ) {
      statement = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (statement === null) return null;

  let start = (statement as ts.Node).getStart(sf);
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1;
  if (start > 0 && text[start - 1] === '\n') {
    start -= 1;
    if (start > 0 && text[start - 1] === '\r') start -= 1;
  }
  return text.slice(0, start) + text.slice(hit.end);
}

/** Replace the marker-tagged guardAsync(<cb>, {...}) wrap with the original <cb>. */
function unwrapGuard(relPath: string, text: string, hit: MarkerHit): string | null {
  const sf = parseSource(relPath, text);
  let call: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'guardAsync' &&
      node.end <= hit.start &&
      text.slice(node.end, hit.start).trim() === '' &&
      (call === null || node.end > call.end)
    ) {
      call = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (call === null) return null;
  const callNode = call as ts.CallExpression;
  const cb = callNode.arguments[0];
  if (cb === undefined) return null;
  const cbText = text.slice(cb.getStart(sf), cb.end);
  return text.slice(0, callNode.getStart(sf)) + cbText + text.slice(hit.end);
}

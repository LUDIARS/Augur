// Marker-driven removal (spec/feature/log-injection.md, "Markers").
// Strips every fragment the framework inserted, restoring the original text:
// statement inserts are deleted (with the whitespace apply added), guard
// wraps are unwrapped back to the bare callback, marker imports and
// entry-runtime imports are deleted line-wise.
//
// One marker is removed per parse pass (innermost fragments can sit inside a
// wrapped callback, so positions are recomputed after every removal).

import ts from 'typescript';
import { CONTRACT_IMPORT_RULE, CONTRACT_RULE } from './contract-scan.ts';
import { removeContractWrap } from './contract-remove.ts';
import { findMarkers } from './markers.ts';
import { parseSource } from './scan.ts';
import { RUNTIME_SYMBOL_BY_RULE } from './runtime-symbols.ts';
import { unwrapCall } from './unwrap.ts';
import type { InjectRule, MarkerHit } from './types.ts';

export type RemoveResult = { text: string; removed: number; changed: boolean };

export function computeRemove(relPath: string, text: string, onlyRules?: readonly InjectRule[]): RemoveResult {
  let current = text;
  let removed = 0;
  const selected = onlyRules === undefined ? undefined : new Set<string>(onlyRules);
  for (;;) {
    const markers = findMarkers(current);
    let changedThisPass = false;
    for (const target of [...markers].reverse()) {
      if (!shouldRemove(target.rule, selected)) continue;
      const next = target.rule === 'import'
        ? selected === undefined ? removeLine(current, target) : reconcileRuntimeImport(relPath, current, target)
        : removeOne(relPath, current, target);
      if (next === current) continue;
      if (next === null) {
        // Unrecognized fragment shape around the marker; drop just the marker
        // comment so the loop always terminates.
        current = current.slice(0, target.start) + current.slice(target.end);
      } else {
        current = next;
      }
      removed += 1;
      changedThisPass = true;
      break;
    }
    if (!changedThisPass) break;
  }
  return { text: current, removed, changed: removed > 0 };
}

function shouldRemove(rule: string, selected: ReadonlySet<string> | undefined): boolean {
  if (selected === undefined) return true;
  if (rule === CONTRACT_IMPORT_RULE) return selected.has(CONTRACT_RULE);
  if (rule === 'import') {
    return [...selected].some((selectedRule) => RUNTIME_SYMBOL_BY_RULE[selectedRule as InjectRule] !== undefined);
  }
  return selected.has(rule);
}

function removeOne(relPath: string, text: string, hit: MarkerHit): string | null {
  if (hit.rule === 'import' || hit.rule === 'entry-runtime' || hit.rule === CONTRACT_IMPORT_RULE) {
    return removeLine(text, hit);
  }
  if (hit.rule === 'silent-catch' || hit.rule === 'spawn-watch') {
    return removeStatement(relPath, text, hit);
  }
  if (hit.rule === 'interval-guard' || hit.rule === 'listener-guard') {
    return unwrapCall(relPath, text, hit, 'guardAsync');
  }
  if (hit.rule === CONTRACT_RULE) {
    return removeContractWrap(relPath, text, hit);
  }
  return null;
}

/** Keep the managed runtime import in sync with fragments that remain after a selective removal. */
function reconcileRuntimeImport(relPath: string, text: string, hit: MarkerHit): string | null {
  const sf = parseSource(relPath, text);
  let declaration: ts.ImportDeclaration | null = null;
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement)
      && statement.end <= hit.start
      && text.slice(statement.end, hit.start).trim() === ''
      && (declaration === null || statement.end > declaration.end)
    ) {
      declaration = statement;
    }
  }
  if (declaration === null) return null;
  const bindings = declaration.importClause?.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) return null;

  const required = new Set<string>();
  for (const markerHit of findMarkers(text)) {
    if (markerHit.rule === 'import' || markerHit.rule === CONTRACT_IMPORT_RULE) continue;
    const symbol = RUNTIME_SYMBOL_BY_RULE[markerHit.rule as InjectRule];
    if (symbol !== undefined) required.add(symbol);
  }
  if (required.size === 0) return removeLine(text, hit);
  const knownSymbols = new Set(Object.values(RUNTIME_SYMBOL_BY_RULE).filter((value) => value !== undefined));
  const kept = bindings.elements.filter(
    (element) => !knownSymbols.has(element.name.text) || required.has(element.name.text),
  );
  if (kept.length === bindings.elements.length) return text;
  if (kept.length === 0) return removeLine(text, hit);
  const replacement = `{ ${kept.map((element) => text.slice(element.getStart(sf), element.end)).join(', ')} }`;
  return text.slice(0, bindings.getStart(sf)) + replacement + text.slice(bindings.end);
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

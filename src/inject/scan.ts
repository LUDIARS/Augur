// The detection algorithm (spec/feature/log-injection.md, "Detection Rules").
// Pure: (relative path, source text, manifest) -> Candidate[]. The scanner
// parses with the TypeScript compiler API, so TS and ESM JS both work.

import ts from 'typescript';
import { collectContractWrap } from './contract-scan.ts';
import type { InjectManifest } from './manifest.ts';
import { ruleEnabled } from './manifest.ts';
import { findMarkers } from './markers.ts';
import { pointId } from './markers.ts';
import type { Candidate, InjectContext, InjectRule, MarkerHit } from './types.ts';

export function parseSource(relPath: string, text: string): ts.SourceFile {
  const kind = relPath.endsWith('.ts') || relPath.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, kind);
}

export function scanSource(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  context?: InjectContext,
): Candidate[] {
  const sf = parseSource(relPath, text);
  const markers = findMarkers(text);
  const collected: Omit<Candidate, 'id'>[] = [];

  collectEntryRuntime(relPath, text, manifest, markers, collected);
  // contract-wrap is named by the contract file, not discovered in the AST, so
  // it is collected outside the walk (spec/plan/2026-09-05-live-contract-testing.md §2.3).
  if (context?.contractTargets !== undefined && ruleEnabled(manifest, 'contract-wrap')) {
    collectContractWrap(relPath, text, context.contractTargets, markers, collected);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && ruleEnabled(manifest, 'silent-catch')) {
      collectSilentCatch(node, sf, text, markers, collected);
    }
    if (ts.isVariableStatement(node) && ruleEnabled(manifest, 'spawn-watch')) {
      collectSpawnWatch(node, sf, text, markers, collected);
    }
    if (ts.isCallExpression(node)) {
      if (ruleEnabled(manifest, 'interval-guard')) collectIntervalGuard(node, sf, markers, collected);
      if (ruleEnabled(manifest, 'listener-guard')) collectListenerGuard(node, sf, markers, collected);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Assign deterministic ids per (rule, ordinal-in-document-order); an
  // applied candidate keeps the id its marker already carries.
  const ordinals = new Map<string, number>();
  return collected.map((c) => {
    const ordinal = ordinals.get(c.rule) ?? 0;
    ordinals.set(c.rule, ordinal + 1);
    const markerId = c.markerIndex === undefined
      ? undefined
      : markers.find((m) => m.start === c.markerIndex)?.id;
    return { ...c, id: c.presetId ?? markerId ?? pointId(c.rule, c.file, c.anchor, ordinal) };
  });
}

// ── helpers ────────────────────────────────────────────────────────────────

function line(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function lineIndent(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return match ? (match[0] as string) : '';
}

/** Chain of enclosing named functions/classes, for stable anchor labels. */
function enclosingName(node: ts.Node): string {
  const names: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isClassDeclaration(current)) &&
      current.name !== undefined
    ) {
      names.unshift(current.name.getText());
    } else if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      names.unshift(current.parent.name.text);
    }
    current = current.parent;
  }
  return names.length > 0 ? names.join('.') : '<top>';
}

function calleeName(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return null;
}

function markerIn(markers: MarkerHit[], rule: InjectRule, start: number, end: number): MarkerHit | undefined {
  return markers.find((m) => m.rule === rule && m.start >= start && m.end <= end);
}

function isAsyncFunctionLiteral(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (ts.getCombinedModifierFlags(node as unknown as ts.Declaration) & ts.ModifierFlags.Async) !== 0
  );
}

/** Body already is a single try/catch — the checklist pattern is satisfied. */
function fullyTryWrapped(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  if (!ts.isBlock(fn.body)) return false;
  const only = fn.body.statements.length === 1 ? fn.body.statements[0] : undefined;
  return only !== undefined && ts.isTryStatement(only) && only.catchClause !== undefined;
}

// ── entry-runtime ──────────────────────────────────────────────────────────

function collectEntryRuntime(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  markers: MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  if (!ruleEnabled(manifest, 'entry-runtime') || !manifest.runtime.autoImport) return;
  if (!manifest.runtime.entrypoints.includes(relPath)) return;

  const existingMarker = markers.find((m) => m.rule === 'entry-runtime');
  const autoSpecifier = `${manifest.importFrom}/auto`;
  if (existingMarker === undefined && (text.includes('unhandledRejection') || text.includes(autoSpecifier))) {
    return; // the host installs its own safety net (or imported /auto manually)
  }
  const shebangEnd = text.startsWith('#!') ? text.indexOf('\n') + 1 : 0;
  out.push({
    rule: 'entry-runtime',
    file: relPath,
    line: 1,
    anchor: 'entrypoint',
    applied: existingMarker !== undefined,
    ...(existingMarker !== undefined ? { markerIndex: existingMarker.start } : {}),
    insertPos: shebangEnd,
  });
}

// ── silent-catch ───────────────────────────────────────────────────────────

function collectSilentCatch(
  node: ts.CatchClause,
  sf: ts.SourceFile,
  text: string,
  markers: MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  const block = node.block;
  const relPath = sf.fileName;
  const openBrace = block.getStart(sf);
  const anchor = `catch in ${enclosingName(node)}`;

  if (block.statements.length === 0) {
    const inner = text.slice(openBrace + 1, block.end - 1);
    // A comment inside the catch is an explicit human decision — skip.
    if (inner.trim() !== '') return;
    out.push({
      rule: 'silent-catch',
      file: relPath,
      line: line(sf, node.getStart(sf)),
      anchor,
      applied: false,
      insertPos: openBrace + 1,
    });
    return;
  }

  // Already injected: exactly our weaverLog statement plus its marker.
  const hit = markerIn(markers, 'silent-catch', openBrace, block.end);
  if (hit !== undefined && block.statements.length === 1) {
    const only = block.statements[0] as ts.Statement;
    const isOurs =
      ts.isExpressionStatement(only) &&
      ts.isCallExpression(only.expression) &&
      calleeName(only.expression) === 'weaverLog';
    if (isOurs) {
      out.push({
        rule: 'silent-catch',
        file: relPath,
        line: line(sf, node.getStart(sf)),
        anchor,
        applied: true,
        markerIndex: hit.start,
      });
    }
  }
}

// ── spawn-watch ────────────────────────────────────────────────────────────

const CHILD_SPAWNERS = new Set(['spawn', 'execFile']);

function collectSpawnWatch(
  node: ts.VariableStatement,
  sf: ts.SourceFile,
  text: string,
  markers: MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
    if (!ts.isCallExpression(decl.initializer)) continue;
    const callee = calleeName(decl.initializer);
    if (callee === null || !CHILD_SPAWNERS.has(callee)) continue;

    const varName = decl.name.text;
    const scope = enclosingScope(node);
    if (scopeHandlesErrors(scope, varName)) continue;

    const watch = findWatchCall(scope, varName);
    const relPath = sf.fileName;
    const anchor = `${varName} ← ${callee}() in ${enclosingName(node)}`;
    if (watch !== undefined) {
      const hit = markerIn(markers, 'spawn-watch', watch.getStart(sf), watch.end + 80);
      out.push({
        rule: 'spawn-watch',
        file: relPath,
        line: line(sf, node.getStart(sf)),
        anchor,
        applied: true,
        ...(hit !== undefined ? { markerIndex: hit.start } : {}),
      });
    } else {
      out.push({
        rule: 'spawn-watch',
        file: relPath,
        line: line(sf, node.getStart(sf)),
        anchor,
        applied: false,
        insertPos: node.end,
        indent: lineIndent(text, node.getStart(sf)),
        varName,
      });
    }
  }
}

function enclosingScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isModuleBlock(current)) return current;
    current = current.parent;
  }
  return node.getSourceFile();
}

/** `<var>.on('error', …)` / `.once('error', …)` anywhere in the scope. */
function scopeHandlesErrors(scope: ts.Node, varName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'on' || node.expression.name.text === 'once') &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === varName &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0] as ts.Node) &&
      (node.arguments[0] as ts.StringLiteralLike).text === 'error'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

function findWatchCall(scope: ts.Node, varName: string): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      calleeName(node) === 'watchChild' &&
      node.arguments.length > 0 &&
      ts.isIdentifier(node.arguments[0] as ts.Node) &&
      (node.arguments[0] as ts.Identifier).text === varName
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

// ── interval-guard / listener-guard ────────────────────────────────────────

function collectIntervalGuard(
  node: ts.CallExpression,
  sf: ts.SourceFile,
  markers: MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'setInterval') return;
  const cb = node.arguments[0];
  if (cb === undefined) return;
  collectGuardWrap('interval-guard', node, cb, `setInterval in ${enclosingName(node)}`, sf, markers, out);
}

function collectListenerGuard(
  node: ts.CallExpression,
  sf: ts.SourceFile,
  markers: MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  if (!ts.isPropertyAccessExpression(node.expression)) return;
  const method = node.expression.name.text;
  if (method !== 'on' && method !== 'once') return;
  if (node.arguments.length < 2 || !ts.isStringLiteralLike(node.arguments[0] as ts.Node)) return;
  const event = (node.arguments[0] as ts.StringLiteralLike).text;
  const cb = node.arguments[1] as ts.Expression;
  const receiver = node.expression.expression.getText(sf);
  collectGuardWrap('listener-guard', node, cb, `${receiver}.${method}('${event}') in ${enclosingName(node)}`, sf, markers, out);
}

function collectGuardWrap(
  rule: 'interval-guard' | 'listener-guard',
  call: ts.CallExpression,
  cb: ts.Expression,
  anchor: string,
  sf: ts.SourceFile,
  markers: MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  const relPath = sf.fileName;
  if (ts.isCallExpression(cb) && calleeName(cb) === 'guardAsync') {
    const hit = markerIn(markers, rule, cb.end, call.end);
    out.push({
      rule,
      file: relPath,
      line: line(sf, call.getStart(sf)),
      anchor,
      applied: true,
      ...(hit !== undefined ? { markerIndex: hit.start } : {}),
    });
    return;
  }
  if (!isAsyncFunctionLiteral(cb) || fullyTryWrapped(cb)) return;
  out.push({
    rule,
    file: relPath,
    line: line(sf, call.getStart(sf)),
    anchor,
    applied: false,
    wrapStart: cb.getStart(sf),
    wrapEnd: cb.end,
  });
}

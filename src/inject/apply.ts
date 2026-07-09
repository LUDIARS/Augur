// Fragment insertion (spec/feature/log-injection.md, "Markers").
// Pure: computeApply(path, text, manifest) returns the new text plus the
// points it filled. Text splicing at AST-resolved positions — the file stays
// byte-identical outside the inserted fragments.

import ts from 'typescript';
import type { InjectManifest } from './manifest.ts';
import { marker, pointId } from './markers.ts';
import { parseSource, scanSource } from './scan.ts';
import type { Candidate, InjectRule } from './types.ts';

type TextEdit = { start: number; end: number; text: string };

export type ApplyResult = {
  text: string;
  /** Candidates that received a fragment in this run. */
  injected: Candidate[];
  changed: boolean;
};

const SYMBOL_BY_RULE: Partial<Record<InjectRule, string>> = {
  'silent-catch': 'weaverLog',
  'spawn-watch': 'watchChild',
  'interval-guard': 'guardAsync',
  'listener-guard': 'guardAsync',
};

export function computeApply(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  onlyRules?: InjectRule[],
): ApplyResult {
  const candidates = scanSource(relPath, text, manifest);
  const pending = candidates.filter(
    (c) => !c.applied && (onlyRules === undefined || onlyRules.includes(c.rule)),
  );
  if (pending.length === 0) return { text, injected: [], changed: false };

  const edits: TextEdit[] = [];
  const where = (c: Candidate): string => `{ where: '${c.file}:${c.line}', rule: '${c.rule}', id: '${c.id}' }`;

  for (const c of pending) {
    if (c.rule === 'entry-runtime' && c.insertPos !== undefined) {
      edits.push({
        start: c.insertPos,
        end: c.insertPos,
        text: `import '${manifest.importFrom}/auto'; ${marker(c.rule, c.id)}\n`,
      });
    } else if (c.rule === 'silent-catch' && c.insertPos !== undefined) {
      edits.push({
        start: c.insertPos,
        end: c.insertPos,
        text: ` weaverLog('warn', 'swallowed error', ${where(c)}); ${marker(c.rule, c.id)}`,
      });
    } else if (c.rule === 'spawn-watch' && c.insertPos !== undefined && c.varName !== undefined) {
      edits.push({
        start: c.insertPos,
        end: c.insertPos,
        text: `\n${c.indent ?? ''}watchChild(${c.varName}, ${where(c)}); ${marker(c.rule, c.id)}`,
      });
    } else if (c.wrapStart !== undefined && c.wrapEnd !== undefined) {
      edits.push({ start: c.wrapStart, end: c.wrapStart, text: 'guardAsync(' });
      edits.push({ start: c.wrapEnd, end: c.wrapEnd, text: `, ${where(c)}) ${marker(c.rule, c.id)}` });
    }
  }

  const importEdit = computeImportEdit(relPath, text, manifest, pending);
  if (importEdit !== null) edits.push(importEdit);

  return { text: splice(text, edits), injected: pending, changed: true };
}

/**
 * Ensure one marker-tagged import supplies exactly the runtime symbols the
 * file's fragments use. Symbols already imported from `importFrom` by the
 * host's own code are respected, not duplicated.
 */
function computeImportEdit(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  pending: Candidate[],
): TextEdit | null {
  const needed = new Set<string>();
  for (const c of pending) {
    const symbol = SYMBOL_BY_RULE[c.rule];
    if (symbol !== undefined) needed.add(symbol);
  }
  if (needed.size === 0) return null;

  const sf = parseSource(relPath, text);
  let lastImportEnd: number | null = null;
  let managedImport: ts.ImportDeclaration | null = null;
  const existingSymbols = new Set<string>();

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    lastImportEnd = statement.end;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== manifest.importFrom) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) existingSymbols.add(element.name.text);
    }
    if (text.slice(statement.end, statement.end + 40).includes('augur-inject:import:')) {
      managedImport = statement;
    }
  }

  const missing = [...needed].filter((s) => !existingSymbols.has(s));
  if (missing.length === 0) return null;

  const importId = pointId('import', relPath, '', 0);
  if (managedImport !== null) {
    // Rewrite the managed import line with the union of symbols.
    const union = [...new Set([...existingSymbols, ...missing])].sort();
    const markerEnd = text.indexOf('*/', managedImport.end) + 2;
    return {
      start: managedImport.getStart(sf),
      end: markerEnd,
      text: `import { ${union.join(', ')} } from '${manifest.importFrom}'; ${marker('import', importId)}`,
    };
  }

  const lineText = `import { ${missing.sort().join(', ')} } from '${manifest.importFrom}'; ${marker('import', importId)}`;
  if (lastImportEnd !== null) {
    return { start: lastImportEnd, end: lastImportEnd, text: `\n${lineText}` };
  }
  const shebangEnd = text.startsWith('#!') ? text.indexOf('\n') + 1 : 0;
  return { start: shebangEnd, end: shebangEnd, text: `${lineText}\n` };
}

export function splice(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

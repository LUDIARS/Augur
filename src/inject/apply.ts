// Fragment insertion (spec/feature/log-injection.md, "Markers").
// Pure: computeApply(path, text, manifest) returns the new text plus the
// points it filled. Text splicing at AST-resolved positions — the file stays
// byte-identical outside the inserted fragments.

import ts from 'typescript';
import { computePredicateImportEdit, contractEdits } from './contract-apply.ts';
import { importAnchor } from './import-position.ts';
import type { InjectManifest } from './manifest.ts';
import { marker, pointId } from './markers.ts';
import { parseSource, scanSource } from './scan.ts';
import { RUNTIME_SYMBOL_BY_RULE } from './runtime-symbols.ts';
import { sourceString } from './source-literal.ts';
import type { Candidate, InjectContext, InjectRule, TextEdit } from './types.ts';

export type ApplyResult = {
  text: string;
  /** Candidates that received a fragment in this run. */
  injected: Candidate[];
  changed: boolean;
};

export function computeApply(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  onlyRules?: InjectRule[],
  context?: InjectContext,
): ApplyResult {
  const candidates = scanSource(relPath, text, manifest, context);
  // `problem` candidates (contract-wrap's unresolved / stale-module) are
  // reportable but not injectable — they never become work for apply.
  const pending = candidates.filter(
    (c) => !c.applied && c.problem === undefined && (onlyRules === undefined || onlyRules.includes(c.rule)),
  );
  if (pending.length === 0) return { text, injected: [], changed: false };

  const edits: TextEdit[] = [];
  const where = (c: Candidate): string => (
    `{ where: ${sourceString(`${c.file}:${c.line}`)}, rule: ${sourceString(c.rule)}, id: ${sourceString(c.id)} }`
  );

  for (const c of pending) {
    if (c.rule === 'contract-wrap') {
      edits.push(...contractEdits(c));
    } else if (c.rule === 'entry-runtime' && c.insertPos !== undefined) {
      edits.push({
        start: c.insertPos,
        end: c.insertPos,
        text: `import ${sourceString(`${manifest.importFrom}/auto`)}; ${marker(c.rule, c.id)}\n`,
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

  // Pushed before the runtime import: splice applies equal-position edits in
  // array order, so the last one pushed ends up first in the text.
  const predicateEdit = computePredicateImportEdit(relPath, text, pending);
  if (predicateEdit !== null) edits.push(predicateEdit);
  edits.push(...computeImportEdits(relPath, text, manifest, pending));

  return { text: splice(text, edits), injected: pending, changed: true };
}

/**
 * Ensure one marker-tagged import supplies exactly the runtime symbols the
 * file's fragments use. Symbols already imported from `importFrom` by the
 * host's own code are respected, not duplicated.
 */
function computeImportEdits(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  pending: Candidate[],
): TextEdit[] {
  const bySource = new Map<string, Set<string>>();
  for (const c of pending) {
    const symbol = RUNTIME_SYMBOL_BY_RULE[c.rule];
    if (symbol === undefined) continue;
    const source = c.rule === 'contract-wrap' ? c.contract?.importFrom ?? manifest.importFrom : manifest.importFrom;
    const needed = bySource.get(source) ?? new Set<string>();
    needed.add(symbol);
    bySource.set(source, needed);
  }
  const edits: TextEdit[] = [];
  for (const [source, needed] of bySource) {
    const edit = computeImportEdit(relPath, text, manifest.importFrom, source, needed);
    if (edit !== null) edits.push(edit);
  }
  return edits;
}

function computeImportEdit(
  relPath: string,
  text: string,
  defaultImportFrom: string,
  importFrom: string,
  needed: ReadonlySet<string>,
): TextEdit | null {
  const sf = parseSource(relPath, text);
  const anchor = importAnchor(sf, text);
  let managedImport: ts.ImportDeclaration | null = null;
  const existingSymbols = new Set<string>();

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== importFrom) continue;
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

  const importId = pointId('import', relPath, importFrom === defaultImportFrom ? '' : `contract:${importFrom}`, 0);
  if (managedImport !== null) {
    // Rewrite the managed import line with the union of symbols.
    const union = [...new Set([...existingSymbols, ...missing])].sort();
    const markerEnd = text.indexOf('*/', managedImport.end) + 2;
    return {
      start: managedImport.getStart(sf),
      end: markerEnd,
      text: `import { ${union.join(', ')} } from ${sourceString(importFrom)}; ${marker('import', importId)}`,
    };
  }

  const lineText = `import { ${missing.sort().join(', ')} } from ${sourceString(importFrom)}; ${marker('import', importId)}`;
  if (anchor.lastImportEnd !== null) {
    return { start: anchor.lastImportEnd, end: anchor.lastImportEnd, text: `\n${lineText}` };
  }
  return { start: anchor.shebangEnd, end: anchor.shebangEnd, text: `${lineText}\n` };
}

export function splice(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

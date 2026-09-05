// contract-wrap fragment text (spec/plan/2026-09-05-live-contract-testing.md §5.1).
// Three declaration forms, three insertions; every one of them is an insert, so
// the bytes around the fragment stay exactly as they were.
//
//   export const f = <init>        ->  wrap the initializer
//   export function f() {}         ->  reassign after the declaration
//   class C { m() {} }             ->  replace C.prototype.m after the class
//
// Pure: candidates in, edits out.

import { marker, pointId } from './markers.ts';
import { importAnchor } from './import-position.ts';
import { CONTRACT_IMPORT_RULE, CONTRACT_RULE } from './contract-scan.ts';
import { parseSource } from './scan.ts';
import { sourceString } from './source-literal.ts';
import type { Candidate, TextEdit } from './types.ts';

/**
 * The spec object handed to `contract()`: the predicate module spread first,
 * then the manifest's execution settings and the marker's `Where` fields
 * (§4 keeps `contractId` and the marker `id` separate on purpose).
 */
export function contractSpec(candidate: Candidate): string {
  const binding = candidate.contract;
  if (binding === undefined) throw new Error(`contract-wrap candidate ${candidate.id} has no binding`);
  return (
    `{ ...${binding.local}, contractId: ${sourceString(binding.contractId)}, mode: ${sourceString(binding.mode)}, `
    + `sample: ${binding.sample}, where: ${sourceString(`${candidate.file}:${candidate.line}`)}, `
    + `rule: ${sourceString(CONTRACT_RULE)}, id: ${sourceString(candidate.id)} }`
  );
}

export function contractEdits(candidate: Candidate): TextEdit[] {
  const binding = candidate.contract;
  if (binding === undefined) return [];
  const tag = marker(CONTRACT_RULE, candidate.id);
  const spec = contractSpec(candidate);

  if (binding.form === 'const-initializer' && candidate.wrapStart !== undefined && candidate.wrapEnd !== undefined) {
    return [
      { start: candidate.wrapStart, end: candidate.wrapStart, text: 'contract(' },
      { start: candidate.wrapEnd, end: candidate.wrapEnd, text: `, ${spec}) ${tag}` },
    ];
  }
  if (candidate.insertPos === undefined) return [];

  const indent = candidate.indent ?? '';
  const assignment = `${indent}${binding.target} = contract(${binding.target}, ${spec}); ${tag}`;
  // TS2630 forbids assigning to a function declaration's binding. The
  // declaration is kept (hoisting and the exported name stay as they were) and
  // the reassignment is excused one line at a time.
  const guard = binding.form === 'function-declaration' ? `\n${indent}// @ts-expect-error augur-inject` : '';
  return [{ start: candidate.insertPos, end: candidate.insertPos, text: `${guard}\n${assignment}` }];
}

/** One marker-tagged default import per contract fragment added in this run. */
export function computePredicateImportEdit(
  relPath: string,
  text: string,
  pending: readonly Candidate[],
): TextEdit | null {
  const lines: string[] = [];
  for (const candidate of pending) {
    const binding = candidate.contract;
    if (binding === undefined) continue;
    const id = pointId(CONTRACT_IMPORT_RULE, relPath, binding.contractId, 0);
    lines.push(
      `import ${binding.local} from ${sourceString(binding.specifier)}; ${marker(CONTRACT_IMPORT_RULE, id)}`,
    );
  }
  if (lines.length === 0) return null;

  const anchor = importAnchor(parseSource(relPath, text), text);
  if (anchor.lastImportEnd !== null) {
    return { start: anchor.lastImportEnd, end: anchor.lastImportEnd, text: `\n${lines.join('\n')}` };
  }
  return { start: anchor.shebangEnd, end: anchor.shebangEnd, text: `${lines.join('\n')}\n` };
}

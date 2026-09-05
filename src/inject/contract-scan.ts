// contract-wrap detection (spec/plan/2026-09-05-live-contract-testing.md §2.3).
// The scanner interprets no code here: it looks up the function the contract
// file named and reports whether it can be wrapped, is already wrapped, or is
// out of reach (`unresolved` / `stale-module`).

import { resolveSymbol } from '../contracts/symbols.ts';
import { normalizeRepoPath } from '../contracts/paths.ts';
import { pointId } from './markers.ts';
import type { ContractTarget } from './contract-targets.ts';
import type { Candidate, InjectionPoint, MarkerHit } from './types.ts';

export const CONTRACT_RULE = 'contract-wrap';
export const CONTRACT_IMPORT_RULE = 'contract-predicate';

/**
 * Marker id of a contract's fragment. Keyed on the contract itself rather than
 * on a scan ordinal, so moving the function inside its file — or adding another
 * contract to the same file — never renames an existing marker.
 */
export function contractPointId(target: ContractTarget): string {
  return pointId(CONTRACT_RULE, target.file, `${target.symbol}\u0000${target.contractId}`, 0);
}

/** Local name for the predicate default import; unique per fragment. */
export function predicateLocal(markerId: string): string {
  return `augurContract_${markerId}`;
}

export function collectContractWrap(
  relPath: string,
  text: string,
  targets: readonly ContractTarget[],
  markers: readonly MarkerHit[],
  out: Omit<Candidate, 'id'>[],
): void {
  const file = normalizeRepoPath(relPath);
  for (const target of targets) {
    if (target.file !== file) continue;
    const id = contractPointId(target);
    const anchor = `${target.symbol} (${target.contractId})`;
    const base = { rule: CONTRACT_RULE, file: relPath, anchor, presetId: id } as const;

    if (target.moduleState !== 'ok') {
      out.push({ ...base, line: 1, applied: false, problem: 'stale-module' });
      continue;
    }
    const site = resolveSymbol(relPath, text, target.symbol);
    if (site === null) {
      out.push({ ...base, line: 1, applied: false, problem: 'unresolved' });
      continue;
    }
    const hit = markers.find((m) => m.rule === CONTRACT_RULE && m.id === id);
    if (hit !== undefined) {
      out.push({ ...base, line: site.line, applied: true, markerIndex: hit.start });
      continue;
    }
    out.push({
      ...base,
      line: site.line,
      applied: false,
      indent: site.indent,
      ...(site.wrapStart !== undefined && site.wrapEnd !== undefined
        ? { wrapStart: site.wrapStart, wrapEnd: site.wrapEnd }
        : {}),
      ...(site.insertPos !== undefined ? { insertPos: site.insertPos } : {}),
      contract: {
        contractId: target.contractId,
        importFrom: target.importFrom,
        mode: target.mode,
        sample: target.sample,
        specifier: target.specifier,
        local: predicateLocal(id),
        form: site.form,
        target: site.target,
      },
    });
  }
}

/** Findings for contract files the project walker cannot open and scan. */
export function missingContractPoints(
  targets: readonly ContractTarget[],
  existingFiles: ReadonlySet<string>,
): InjectionPoint[] {
  return targets
    .filter((target) => !existingFiles.has(target.file))
    .map((target): InjectionPoint => ({
      rule: CONTRACT_RULE,
      id: contractPointId(target),
      file: target.file,
      line: 1,
      anchor: `${target.symbol} (${target.contractId})`,
      state: 'unresolved',
    }));
}

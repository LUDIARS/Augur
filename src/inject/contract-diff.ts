// Anatomia diff matching for contract-wrap (spec/plan/2026-09-05-live-contract-testing.md §5.3).
// Delegation's default is "new functions only": a contract naming a function the
// PR did not add is skipped unless --include-existing is given. Pure — the caller
// obtains the analysis (via src/tests/anatomia.ts or --analysis) and passes it in.

import type { ContractsManifest } from '../contracts/manifest.ts';
import { normalizeRepoPath } from '../contracts/paths.ts';

export type AddedFunction = { readonly file: string; readonly name: string };

/** The slice of Anatomia's PrDiffReview this rule reads. */
export type DiffReviewLike = {
  readonly diff: {
    readonly files: readonly {
      readonly path: string;
      readonly added: readonly { readonly name: string }[];
    }[];
  };
};

export function addedFunctionsOf(analysis: DiffReviewLike): AddedFunction[] {
  const added: AddedFunction[] = [];
  for (const file of analysis.diff.files) {
    for (const fn of file.added) added.push({ file: normalizeRepoPath(file.path), name: fn.name });
  }
  return added;
}

/**
 * Contract ids whose `file:symbol` appears among the added functions. Anatomia
 * reports a method as its bare name, so `Class.method` matches on the trailing
 * segment as well as on the full symbol.
 */
export function selectAddedContracts(
  manifest: ContractsManifest,
  added: readonly AddedFunction[],
): Set<string> {
  const index = new Set(added.map((fn) => `${fn.file}\u0000${fn.name}`));
  const selected = new Set<string>();
  for (const entry of manifest.contracts) {
    const file = normalizeRepoPath(entry.file);
    const dot = entry.symbol.indexOf('.');
    const names = dot > 0 ? [entry.symbol, entry.symbol.slice(dot + 1)] : [entry.symbol];
    if (names.some((name) => index.has(`${file}\u0000${name}`))) selected.add(entry.id);
  }
  return selected;
}

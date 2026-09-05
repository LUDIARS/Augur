// Contract file -> injection targets (spec/plan/2026-09-05-live-contract-testing.md §2.3).
// Unlike the other four rules, contract-wrap does not discover anything: the
// contract file names the functions, and this module turns those names into the
// per-file work list the scanner consumes. Pure — the predicate module's state
// is supplied by the caller, which is the only layer allowed to read files.

import type { ContractMode, ContractsManifest } from '../contracts/manifest.ts';
import { normalizeRepoPath, relativeSpecifier } from '../contracts/paths.ts';
import type { PredicateModuleState } from '../contracts/predicate.ts';

export type ContractTarget = {
  readonly contractId: string;
  readonly criterion: string;
  readonly importFrom: string;
  /** Repository-relative path of the file to edit. */
  readonly file: string;
  readonly symbol: string;
  /** Repository-relative path of the predicate module. */
  readonly module: string;
  /** Predicate module specifier as imported from `file`. */
  readonly specifier: string;
  readonly mode: ContractMode;
  readonly sample: number;
  readonly moduleState: PredicateModuleState;
};

export function buildContractTargets(
  manifest: ContractsManifest,
  predicateState: (module: string) => PredicateModuleState,
  selected?: ReadonlySet<string>,
): ContractTarget[] {
  const targets: ContractTarget[] = [];
  for (const entry of manifest.contracts) {
    if (selected !== undefined && !selected.has(entry.id)) continue;
    const file = normalizeRepoPath(entry.file);
    const module = normalizeRepoPath(entry.module);
    targets.push({
      contractId: entry.id,
      criterion: entry.criterion,
      importFrom: manifest.importFrom,
      file,
      symbol: entry.symbol,
      module,
      specifier: relativeSpecifier(file, module),
      mode: entry.mode,
      sample: entry.sample,
      moduleState: predicateState(module),
    });
  }
  return targets;
}

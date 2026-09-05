// Anatomia + filesystem layer for contract-wrap. Everything the pure rule needs
// — the contract file, each predicate module's state, and (for --diff-base /
// --analysis) the set of functions this PR added — is resolved here, so
// contract-scan / contract-apply stay (path, text, targets) -> data.

import { readFileSync } from 'node:fs';
import type { ContractsManifest } from '../contracts/manifest.ts';
import { normalizeRepoPath } from '../contracts/paths.ts';
import { existingProjectPath, loadContractsManifest, predicateStateOf } from '../contracts/project.ts';
import { parsePrDiffReview, prReview } from '../tests/anatomia.ts';
import { addedFunctionsOf, selectAddedContracts } from './contract-diff.ts';
import { buildContractTargets, type ContractTarget } from './contract-targets.ts';

export type ContractSelection = {
  /** Compare against this git ref through Anatomia's pr-review. */
  readonly diffBase?: string | undefined;
  /** Reuse an already-produced PrDiffReview JSON instead of running Anatomia. */
  readonly analysisFile?: string | undefined;
  /** Inject contracts on pre-existing functions too, not just the added ones. */
  readonly includeExisting?: boolean | undefined;
};

export async function loadContractTargets(
  projectDir: string,
  selection: ContractSelection = {},
): Promise<ContractTarget[]> {
  const manifest = loadContractsManifest(projectDir);
  if (manifest === null) return [];
  const selected = await selectContractIds(projectDir, manifest, selection);
  return buildContractTargets(manifest, (module) => predicateStateOf(projectDir, module), selected);
}

/**
 * Delegation's default is "the functions this change added". Without a diff to
 * compare against — no Anatomia, no --diff-base — every named contract is a
 * target, which is what a repo that has not adopted Anatomia gets (§5.3).
 */
async function selectContractIds(
  projectDir: string,
  manifest: ContractsManifest,
  selection: ContractSelection,
): Promise<ReadonlySet<string> | undefined> {
  if (selection.includeExisting === true) return undefined;
  if (selection.analysisFile !== undefined) {
    const analysis = parsePrDiffReview(JSON.parse(readFileSync(selection.analysisFile, 'utf8')) as unknown);
    return selectAddedContracts(manifest, addedFunctionsOf(analysis));
  }
  if (selection.diffBase !== undefined) {
    const analysis = await prReview(projectDir, selection.diffBase);
    return selectAddedContracts(manifest, addedFunctionsOf(analysis));
  }
  return undefined;
}

/** Contract-named files that exist on disk, so the walker cannot miss one. */
export function existingTargetFiles(projectDir: string, targets: readonly ContractTarget[]): string[] {
  const files = new Set<string>();
  for (const target of targets) {
    const relative = normalizeRepoPath(target.file);
    if (existingProjectPath(projectDir, relative) !== null) files.add(relative);
  }
  return [...files].sort();
}

// `augur contracts lint` core (spec/plan/2026-09-05-live-contract-testing.md §6.1).
// Pure: the manifest plus a lookup of already-read sources in, findings out.
// Duplicate ids never reach here — parseContractsManifest rejects them.

import type { ContractsManifest } from './manifest.ts';
import { normalizeRepoPath } from './paths.ts';
import type { PredicateModuleState } from './predicate.ts';
import { resolveSymbol } from './symbols.ts';

export type ContractLintCode = 'unresolved' | 'stale-module';

export type ContractLintFinding = {
  readonly contractId: string;
  readonly code: ContractLintCode;
  readonly file: string;
  readonly symbol: string;
  readonly message: string;
};

export type ContractLintLookup = {
  /** Source text of a repository-relative path, or undefined when absent. */
  readonly source: (file: string) => string | undefined;
  readonly predicate: (module: string) => PredicateModuleState;
};

export function lintContracts(manifest: ContractsManifest, lookup: ContractLintLookup): ContractLintFinding[] {
  const findings: ContractLintFinding[] = [];
  for (const entry of manifest.contracts) {
    const file = normalizeRepoPath(entry.file);
    const text = lookup.source(file);
    if (text === undefined) {
      findings.push(finding(entry.id, 'unresolved', file, entry.symbol, `file not found: ${file}`));
    } else if (resolveSymbol(file, text, entry.symbol) === null) {
      findings.push(finding(entry.id, 'unresolved', file, entry.symbol, `${file} declares no top-level ${entry.symbol}`));
    }

    const module = normalizeRepoPath(entry.module);
    const state = lookup.predicate(module);
    if (state === 'missing') {
      findings.push(finding(entry.id, 'stale-module', module, entry.symbol, `predicate module not found: ${module}`));
    } else if (state === 'invalid-default') {
      findings.push(finding(entry.id, 'stale-module', module, entry.symbol, `${module} must export default an object literal`));
    }
  }
  return findings;
}

function finding(
  contractId: string,
  code: ContractLintCode,
  file: string,
  symbol: string,
  message: string,
): ContractLintFinding {
  return { contractId, code, file, symbol, message };
}

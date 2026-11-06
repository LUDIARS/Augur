// `augur contracts lint` core (spec/plan/2026-09-05-live-contract-testing.md §6.1).
// Pure: the manifest plus a lookup of already-read sources in, findings out.
// Duplicate ids never reach here — parseContractsManifest rejects them.

import type { ContractsManifest } from './manifest.ts';
import { normalizeRepoPath } from './paths.ts';
import type { PredicateModuleState } from './predicate.ts';
import { isCppPath, isHeaderPath } from './cpp/parser.ts';
import { resolveCppSymbol } from './cpp/symbols.ts';
import { resolveSymbol } from './symbols.ts';

export type ContractLintCode = 'unresolved' | 'stale-module' | 'runtime-include';

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
    } else if (isCppPath(file)) {
      lintCppSymbol(entry.id, file, text, entry.symbol, findings);
      if (!isHeaderPath(manifest.importFrom)) {
        findings.push(finding(entry.id, 'runtime-include', file, entry.symbol,
          `importFrom must name the C++ runtime header (e.g. "augur/contract_runtime.hpp") for a C++ contract, not ${manifest.importFrom}`));
      }
    } else if (resolveSymbol(file, text, entry.symbol) === null) {
      findings.push(finding(entry.id, 'unresolved', file, entry.symbol, `${file} declares no top-level ${entry.symbol}`));
    }

    const module = normalizeRepoPath(entry.module);
    const state = lookup.predicate(module);
    if (state === 'missing') {
      findings.push(finding(entry.id, 'stale-module', module, entry.symbol, `predicate module not found: ${module}`));
    } else if (state === 'invalid-default') {
      findings.push(finding(entry.id, 'stale-module', module, entry.symbol, isCppPath(module)
        ? `${module} must declare exactly one "inline const auto <name> = augur::predicates(pre, post);" (or pre_only / post_only) at namespace scope`
        : `${module} must export default an object literal`));
    }
  }
  return findings;
}

/** A C++ symbol either resolves to one wrappable definition or says why not. */
function lintCppSymbol(id: string, file: string, text: string, symbol: string, findings: ContractLintFinding[]): void {
  const resolved = resolveCppSymbol(text, symbol);
  if (resolved === null) {
    findings.push(finding(id, 'unresolved', file, symbol, `${file} defines no single function ${symbol} (missing or overloaded)`));
  } else if ('unsupported' in resolved) {
    findings.push(finding(id, 'unresolved', file, symbol, `${symbol} cannot be wrapped: ${resolved.unsupported}`));
  }
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

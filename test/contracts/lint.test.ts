import { describe, expect, it } from 'vitest';
import { lintContracts } from '../../src/contracts/lint.ts';
import { parseContractsManifest } from '../../src/contracts/manifest.ts';
import type { PredicateModuleState } from '../../src/contracts/predicate.ts';

const source = 'export function applyPlan(plan) {\n  return plan;\n}\n';

function manifestOf(overrides: Record<string, unknown> = {}) {
  return parseContractsManifest({
    version: 1,
    contracts: [{
      id: 'C-2',
      criterion: 'C-2 applyPlan(plan): registry never shrinks',
      symbol: 'applyPlan',
      file: 'src/engine/plan.ts',
      module: 'contracts/apply-plan.contract.ts',
      ...overrides,
    }],
  });
}

function lookup(options: { source?: string | undefined; predicate?: PredicateModuleState } = {}) {
  return {
    source: (file: string) => (file === 'src/engine/plan.ts' ? options.source ?? source : undefined),
    predicate: (): PredicateModuleState => options.predicate ?? 'ok',
  };
}

describe('lintContracts', () => {
  it('reports nothing when the symbol and predicate module both resolve', () => {
    expect(lintContracts(manifestOf(), lookup())).toEqual([]);
  });

  it('reports unresolved when the file is gone', () => {
    expect(lintContracts(manifestOf({ file: 'src/engine/missing.ts' }), lookup())).toMatchObject([
      { contractId: 'C-2', code: 'unresolved' },
    ]);
  });

  it('reports unresolved when the file no longer declares the symbol', () => {
    expect(lintContracts(manifestOf({ symbol: 'renamedPlan' }), lookup())).toMatchObject([
      { contractId: 'C-2', code: 'unresolved' },
    ]);
  });

  it('reports stale-module for a missing or malformed predicate module', () => {
    expect(lintContracts(manifestOf(), lookup({ predicate: 'missing' }))).toMatchObject([
      { contractId: 'C-2', code: 'stale-module' },
    ]);
    expect(lintContracts(manifestOf(), lookup({ predicate: 'invalid-default' }))).toMatchObject([
      { contractId: 'C-2', code: 'stale-module' },
    ]);
  });
});

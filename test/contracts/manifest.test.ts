import { describe, expect, it } from 'vitest';
import { parseContractsManifest } from '../../src/contracts/manifest.ts';

const entry = {
  id: 'C-1',
  criterion: 'C-1 resolveBudget(goal): budget.ms > 0',
  symbol: 'resolveBudget',
  file: 'src/engine/budget.ts',
  module: 'contracts/resolve-budget.contract.ts',
};

describe('parseContractsManifest', () => {
  it('defaults mode, sample, contractsDir and importFrom', () => {
    const manifest = parseContractsManifest({ version: 1, contracts: [entry] });
    expect(manifest.contractsDir).toBe('contracts');
    expect(manifest.importFrom).toBe('@ludiars/log-weaver');
    expect(manifest.contracts[0]).toMatchObject({ mode: 'observe', sample: 1 });
  });

  it('rejects duplicate contract ids', () => {
    expect(() => parseContractsManifest({ version: 1, contracts: [entry, { ...entry, symbol: 'other' }] }))
      .toThrow(/duplicate contract id 'C-1'/);
  });

  it('rejects unknown fields and out-of-range sample', () => {
    expect(() => parseContractsManifest({ version: 1, contracts: [{ ...entry, extra: 1 }] })).toThrow();
    expect(() => parseContractsManifest({ version: 1, contracts: [{ ...entry, sample: 2 }] })).toThrow();
    expect(() => parseContractsManifest({ version: 2, contracts: [] })).toThrow();
  });

  it('rejects paths that can leave the project', () => {
    for (const file of ['../outside.ts', '/outside.ts', 'C:\\outside.ts', 'src/bad\nname.ts']) {
      expect(() => parseContractsManifest({ version: 1, contracts: [{ ...entry, file }] })).toThrow(
        /repository-relative path contained by the project/,
      );
    }
    expect(() => parseContractsManifest({ version: 1, contractsDir: '..', contracts: [entry] })).toThrow();
  });

  it('accepts the enforce mode', () => {
    const manifest = parseContractsManifest({ version: 1, contracts: [{ ...entry, mode: 'enforce', sample: 0.5 }] });
    expect(manifest.contracts[0]).toMatchObject({ mode: 'enforce', sample: 0.5 });
  });
});

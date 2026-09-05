import { describe, expect, it } from 'vitest';
import { ContractAcceptanceError, toAcceptanceReport } from '../../src/contracts/acceptance.ts';
import { aggregateContracts } from '../../src/contracts/aggregate.ts';
import { normalizeContractEvents } from '../../src/contracts/events.ts';
import { parseContractsManifest } from '../../src/contracts/manifest.ts';

const CRITERIA = {
  one: 'C-1 alpha(x): returns a positive budget',
  two: 'C-2 beta(x): the registry never shrinks',
  three: 'C-3 gamma(x): throws when the run did not pass',
};

function manifestWith(sample = 1): ReturnType<typeof parseContractsManifest> {
  return parseContractsManifest({
    version: 1,
    contracts: [
      { id: 'C-1', criterion: CRITERIA.one, symbol: 'alpha', file: 'src/a.ts', module: 'contracts/a.contract.ts' },
      { id: 'C-2', criterion: CRITERIA.two, symbol: 'beta', file: 'src/b.ts', module: 'contracts/b.contract.ts' },
      { id: 'C-3', criterion: CRITERIA.three, symbol: 'gamma', file: 'src/c.ts', module: 'contracts/c.contract.ts', sample },
    ],
  });
}

const MARKERS = new Map([['C-1', 'm1'], ['C-2', 'm2'], ['C-3', 'm3']]);

const LINES = [
  JSON.stringify({ msg: 'contract observed', ctx: { contract: 'C-1', id: 'm1', observed_at: '2026-09-05T00:00:00.000Z' } }),
  JSON.stringify({ msg: 'contract observed', ctx: { contract: 'C-2', id: 'm2', observed_at: '2026-09-05T00:00:01.000Z' } }),
  JSON.stringify({ msg: 'contract violated', ctx: { contract: 'C-2', id: 'm2', phase: 'post', reason: 'registry shrank', where: 'src/b.ts:88', observed_at: '2026-09-05T00:00:02.000Z' } }),
];

function summaryOf(sample = 1): ReturnType<typeof aggregateContracts> {
  const manifest = manifestWith(sample);
  return aggregateContracts(normalizeContractEvents(LINES).events, manifest.contracts, MARKERS, { since: '2026-09-05T00:00:00.000Z' });
}

describe('toAcceptanceReport', () => {
  it('marks only covered contracts as met', () => {
    const report = toAcceptanceReport(summaryOf());
    expect(report.map((item) => item.met)).toEqual([true, false, false]);
  });

  it('reproduces the criterion byte-for-byte', () => {
    expect(toAcceptanceReport(summaryOf()).map((item) => item.criterion)).toEqual([CRITERIA.one, CRITERIA.two, CRITERIA.three]);
  });

  it('carries calls, violations and the latest reason in the note', () => {
    const [covered, violated, uncovered] = toAcceptanceReport(summaryOf());
    expect(covered?.note).toContain('calls 1');
    expect(violated?.note).toContain('post=1');
    expect(violated?.note).toContain('registry shrank');
    expect(uncovered?.note).toContain('not-called');
  });

  it('refuses to certify a sampled contract', () => {
    expect(() => toAcceptanceReport(summaryOf(0.5))).toThrow(ContractAcceptanceError);
    expect(() => toAcceptanceReport(summaryOf(0.5))).toThrow(/sample 1/);
  });
});

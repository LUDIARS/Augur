import { describe, expect, it } from 'vitest';
import { aggregateContracts } from '../../src/contracts/aggregate.ts';
import { normalizeContractEvents } from '../../src/contracts/events.ts';
import { parseContractsManifest } from '../../src/contracts/manifest.ts';
import { contractTotals } from '../../src/tests/contracts.ts';
import { createReport, formatReportMarkdown, formatReportText } from '../../src/tests/report.ts';
import { record, runRecord } from './fixtures.ts';

// §6.3: the judge reads test results and contract observations on one screen,
// and a repository with no augur.contracts.json shows no section at all.

const MANIFEST = parseContractsManifest({
  version: 1,
  contracts: [
    { id: 'C-1', criterion: 'C-1 alpha(x): stays positive', symbol: 'alpha', file: 'src/a.ts', module: 'contracts/a.contract.ts' },
    { id: 'C-2', criterion: 'C-2 beta(x): never shrinks', symbol: 'beta', file: 'src/b.ts', module: 'contracts/b.contract.ts' },
  ],
});

const RUN = runRecord();

function summaryInsideRun(): ReturnType<typeof aggregateContracts> {
  const lines = [
    JSON.stringify({ msg: 'contract observed', ctx: { contract: 'C-1', id: 'm1', observed_at: '2026-08-23T00:00:00.500Z' } }),
    JSON.stringify({ msg: 'contract violated', ctx: { contract: 'C-2', id: 'm2', phase: 'post', reason: 'registry shrank', observed_at: '2026-08-23T00:00:00.700Z' } }),
    JSON.stringify({ msg: 'contract observed', ctx: { contract: 'C-1', id: 'm1', observed_at: '2026-08-24T00:00:00.000Z' } }),
  ];
  return aggregateContracts(
    normalizeContractEvents(lines).events,
    MANIFEST.contracts,
    new Map([['C-1', 'm1'], ['C-2', 'm2']]),
    { since: RUN.startedAt, until: RUN.finishedAt },
  );
}

describe('tests report contracts section', () => {
  it('omits the section when the repository declares no contracts', () => {
    const report = createReport(RUN, [record()], undefined);
    expect(report.contracts).toBeUndefined();
    expect(formatReportText(report)).not.toContain('Contracts');
    expect(formatReportMarkdown(report)).not.toContain('Contracts');
  });

  it('aggregates only the events inside the run window', () => {
    const summary = summaryInsideRun();
    expect(summary.contracts[0]?.calls).toBe(1);
    expect(summary.diagnostics.outOfWindow).toBe(1);
  });

  it('renders one line per contract in text and markdown', () => {
    const report = createReport(RUN, [record()], summaryInsideRun());
    const text = formatReportText(report);
    expect(text).toContain('Contracts');
    expect(text).toMatch(/covered\s+C-1\s+alpha calls 1 violations 0/);
    expect(text).toContain('registry shrank');
    expect(formatReportMarkdown(report)).toContain('### Contracts');
  });

  it('reduces the summary to the three counts Revisor is sent', () => {
    expect(contractTotals(summaryInsideRun())).toEqual({ covered: 1, violated: 1, uncovered: 0 });
    expect(contractTotals(undefined)).toBeUndefined();
  });
});

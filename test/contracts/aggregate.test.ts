import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aggregateContracts } from '../../src/contracts/aggregate.ts';
import { normalizeContractEvents } from '../../src/contracts/events.ts';
import { parseContractsManifest, type ContractEntry } from '../../src/contracts/manifest.ts';

const MANIFEST = parseContractsManifest({
  version: 1,
  contracts: [
    { id: 'C-1', criterion: 'C-1 covered one', symbol: 'alpha', file: 'src/a.ts', module: 'contracts/a.contract.ts' },
    { id: 'C-2', criterion: 'C-2 violated one', symbol: 'beta', file: 'src/b.ts', module: 'contracts/b.contract.ts' },
    { id: 'C-3', criterion: 'C-3 uncovered one', symbol: 'gamma', file: 'src/c.ts', module: 'contracts/c.contract.ts' },
  ],
});

const CONTRACTS: readonly ContractEntry[] = MANIFEST.contracts;

const MARKERS = new Map([['C-1', 'm1'], ['C-2', 'm2'], ['C-3', 'm3']]);

const observed = (contract: string, id: string, at: string): string =>
  JSON.stringify({ msg: 'contract observed', ctx: { contract, id, phase: 'ok', observed_at: at } });

const violated = (contract: string, id: string, at: string, phase: string, reason: string): string =>
  JSON.stringify({ msg: 'contract violated', ctx: { contract, id, phase, reason, observed_at: at, where: 'src/b.ts:88' } });

function eventsOf(lines: readonly string[]): ReturnType<typeof normalizeContractEvents>['events'] {
  return normalizeContractEvents(lines).events;
}

const LINES = [
  observed('C-1', 'm1', '2026-09-05T00:00:00.000Z'),
  observed('C-1', 'm1', '2026-09-05T00:00:05.000Z'),
  observed('C-2', 'm2', '2026-09-05T00:00:01.000Z'),
  violated('C-2', 'm2', '2026-09-05T00:00:02.000Z', 'post', 'registry shrank'),
  violated('C-2', 'm2', '2026-09-05T00:00:03.000Z', 'pre', 'unknown kind'),
];

describe('aggregateContracts', () => {
  it('classifies covered, violated and uncovered', () => {
    const summary = aggregateContracts(eventsOf(LINES), CONTRACTS, MARKERS);
    expect(summary.contracts.map((entry) => entry.state)).toEqual(['covered', 'violated', 'uncovered']);
    expect(summary.totals).toEqual({ covered: 1, violated: 1, uncovered: 1 });
    expect(summary.contracts[0]).toMatchObject({ calls: 2, observed: 2, violationTotal: 0, firstSeen: '2026-09-05T00:00:00.000Z', lastSeen: '2026-09-05T00:00:05.000Z' });
    expect(summary.contracts[1]?.violations).toEqual({ pre: 1, post: 1, postThrow: 0, invariant: 0, predicate: 0 });
    expect(summary.contracts[2]?.uncoveredReason).toBe('not-called');
  });

  it('treats a predicate that threw as a violation, never as a pass', () => {
    const lines = [JSON.stringify({ msg: 'contract predicate threw', ctx: { contract: 'C-1', id: 'm1', observed_at: '2026-09-05T00:00:00.000Z' } })];
    const summary = aggregateContracts(eventsOf(lines), CONTRACTS, MARKERS);
    expect(summary.contracts[0]?.state).toBe('violated');
    expect(summary.contracts[0]?.violations.predicate).toBe(1);
  });

  it('drops events whose marker id the current source does not carry', () => {
    const lines = [observed('C-1', 'stale-marker', '2026-09-05T00:00:00.000Z'), observed('C-1', 'm1', '2026-09-05T00:00:01.000Z')];
    const summary = aggregateContracts(eventsOf(lines), CONTRACTS, MARKERS);
    expect(summary.contracts[0]?.observed).toBe(1);
    expect(summary.diagnostics).toMatchObject({ matched: 1, foreign: 1 });
  });

  it('reports not-injected when no marker claims the contract', () => {
    const summary = aggregateContracts(eventsOf([observed('C-1', 'm1', '2026-09-05T00:00:00.000Z')]), CONTRACTS, new Map());
    expect(summary.contracts[0]).toMatchObject({ state: 'uncovered', uncoveredReason: 'not-injected', markerId: null });
    expect(summary.diagnostics.foreign).toBe(1);
  });

  it('does not treat a missing event marker as evidence for an uninjected contract', () => {
    const line = JSON.stringify({
      msg: 'contract observed',
      ctx: { contract: 'C-1', observed_at: '2026-09-05T00:00:00.000Z' },
    });
    const summary = aggregateContracts(eventsOf([line]), CONTRACTS, new Map());
    expect(summary.contracts[0]).toMatchObject({ state: 'uncovered', uncoveredReason: 'not-injected' });
    expect(summary.diagnostics).toMatchObject({ matched: 0, foreign: 1 });
  });

  it('keeps only events inside the window', () => {
    const summary = aggregateContracts(eventsOf(LINES), CONTRACTS, MARKERS, {
      since: '2026-09-05T00:00:02.000Z',
      until: '2026-09-05T00:00:04.000Z',
    });
    expect(summary.contracts[0]?.state).toBe('uncovered');
    expect(summary.contracts[1]?.violationTotal).toBe(2);
    expect(summary.diagnostics.outOfWindow).toBe(3);
  });

  it('excludes undated events from a bounded window but keeps them under --all', () => {
    const undated = JSON.stringify({ msg: 'contract observed', ctx: { contract: 'C-1', id: 'm1' } });
    const bounded = aggregateContracts(eventsOf([undated]), CONTRACTS, MARKERS, { since: '2026-09-05T00:00:00.000Z' });
    const all = aggregateContracts(eventsOf([undated]), CONTRACTS, MARKERS);
    expect(bounded.contracts[0]?.state).toBe('uncovered');
    expect(bounded.diagnostics).toMatchObject({ undated: 1, matched: 0 });
    expect(all.contracts[0]?.state).toBe('covered');
    expect(all.diagnostics).toMatchObject({ undated: 1, matched: 1 });
  });

  it('keeps the newest three reasons, newest first', () => {
    const lines = [
      violated('C-2', 'm2', '2026-09-05T00:00:01.000Z', 'pre', 'first'),
      violated('C-2', 'm2', '2026-09-05T00:00:02.000Z', 'post', 'second'),
      violated('C-2', 'm2', '2026-09-05T00:00:03.000Z', 'post', 'third'),
      violated('C-2', 'm2', '2026-09-05T00:00:04.000Z', 'invariant', 'fourth'),
    ];
    const summary = aggregateContracts(eventsOf(lines), CONTRACTS, MARKERS);
    expect(summary.contracts[1]?.latestReasons.map((reason) => reason.reason)).toEqual(['fourth', 'third', 'second']);
    expect(summary.contracts[1]?.latestReasons[0]?.phase).toBe('invariant');
  });

  // The acceptance report is quoted into a delegation's completion report, so a
  // reordered key would show up as a spurious diff between two honest runs.
  it('is byte-identical for the same input, and matches the stored golden', () => {
    const render = (): string => `${JSON.stringify(
      aggregateContracts(eventsOf(LINES), CONTRACTS, MARKERS, { since: '2026-09-05T00:00:00.000Z' }),
      null,
      2,
    )}\n`;
    expect(render()).toBe(render());
    const goldenPath = fileURLToPath(new URL('./golden/aggregate.json', import.meta.url));
    // Revisor's scratch checkout may materialise the golden with CRLF (no .gitattributes),
    // so compare on LF-normalised text; the render itself stays byte-identical.
    expect(render()).toBe(readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n'));
  });
});

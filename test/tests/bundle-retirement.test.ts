import { describe, expect, it } from 'vitest';
import { selectBundle } from '../../src/tests/bundle.ts';
import { evaluateRetirement, reviveTest } from '../../src/tests/retirement.ts';
import { record, testsConfig } from './fixtures.ts';

describe('bundle selection', () => {
  const records = [
    record({ id: 't-b', anchors: ['changed'], always: false }),
    record({ id: 't-a', anchors: [], always: true }),
    record({ id: 't-c', anchors: ['other'], domains: { business: ['payments'], program: ['application/payments'] } }),
    record({ id: 't-d', status: 'retired', anchors: ['changed'] }),
  ];

  it('is deterministic, sorted, and records PR reasons', () => {
    const input = { kind: 'pr' as const, selector: 'main', changedAnchors: ['changed'], impactedAnchors: [] };
    const first = selectBundle(records, input);
    const second = selectBundle(records, input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.testIds).toEqual(['t-a', 't-b']);
    expect(first.reason).toEqual({ 't-a': 'always', 't-b': 'anchor:changed' });
  });

  it('selects both domain layers and explicit ids regardless of status', () => {
    expect(selectBundle(records, { kind: 'domain', selector: 'application/payments' }).testIds).toEqual(['t-c']);
    expect(selectBundle(records, { kind: 'ids', selector: 't-d,t-a' }).testIds).toEqual(['t-a', 't-d']);
  });
});

describe('retirement state machine', () => {
  const config = testsConfig({
    retirement: {
      probationAfterDays: 90,
      probationAfterPasses: 30,
      retireAfterDays: 180,
      incidentHorizonDays: 365,
      exemptKinds: ['guardrail'],
      exemptAlways: true,
    },
  });

  it('moves active to probation only when age and pass thresholds both hold', () => {
    const now = '2026-04-02T00:00:00.000Z';
    expect(evaluateRetirement([record({ passStreak: 30 })], config, now).records[0]!.status).toBe('probation');
    expect(evaluateRetirement([record({ passStreak: 29 })], config, now).records[0]!.status).toBe('active');
    expect(evaluateRetirement([record({ createdAt: '2026-02-01T00:00:00.000Z', passStreak: 30 })], config, now).records[0]!.status).toBe('active');
  });

  it('moves probation to retired after the retirement horizon', () => {
    const result = evaluateRetirement([record({ status: 'probation', passStreak: 40 })], config, '2026-07-01T00:00:00.000Z');
    expect(result.records[0]).toMatchObject({ status: 'retired', retiredReason: 'inactive', retiredAt: '2026-07-01T00:00:00.000Z' });
    expect(result.transitions[0]).toMatchObject({ from: 'probation', to: 'retired' });
  });

  it('returns a failed probation test to active and resets no other history', () => {
    const source = record({ status: 'probation', passStreak: 0, runs: 50 });
    const result = evaluateRetirement([source], config, '2026-07-01T00:00:00.000Z').records[0]!;
    expect(result).toMatchObject({ status: 'active', passStreak: 0, runs: 50 });
  });

  it('revives retired tests to active', () => {
    const result = reviveTest([record({ status: 'retired', retiredAt: '2026-01-01T00:00:00.000Z', retiredReason: 'inactive' })], 't-000000000001');
    expect(result.test.status).toBe('active');
    expect(result.test.retiredAt).toBeUndefined();
    expect(result.test.retiredReason).toBeUndefined();
  });

  it('honors incidentHorizonDays before probation', () => {
    const incident = record({ origin: { type: 'incident', ref: 'INC-1' }, passStreak: 100 });
    expect(evaluateRetirement([incident], config, '2026-10-01T00:00:00.000Z').records[0]!.status).toBe('active');
    expect(evaluateRetirement([incident], config, '2027-01-02T00:00:00.000Z').records[0]!.status).toBe('probation');
  });

  it('never time-retires exempt kinds or always tests', () => {
    const old = '2028-01-01T00:00:00.000Z';
    expect(evaluateRetirement([record({ kind: 'guardrail', passStreak: 500 })], config, old).records[0]!.status).toBe('active');
    expect(evaluateRetirement([record({ always: true, passStreak: 500 })], config, old).records[0]!.status).toBe('active');
  });
});

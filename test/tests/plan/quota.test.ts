import { describe, expect, it } from 'vitest';
import { applyQuota } from '../../../src/tests/plan/quota.ts';
import type { TestTarget } from '../../../src/tests/types.ts';
import { record, testsConfig } from '../fixtures.ts';

function target(key: string, incident = false): TestTarget {
  return {
    key,
    kind: incident ? 'regression' : 'assurance',
    priority: incident ? 'critical' : 'high',
    domains: { business: ['feature'], program: ['domain-logic:src'] },
    anchors: [key],
    impacted: [],
    file: `test/${key}.test.ts`,
    runner: 'vitest',
    runtime: false,
    brief: {
      title: key,
      purpose: key,
      subject: { symbol: key, file: 'src/example.ts', line: 1 },
      risks: ['contract'],
      exemplars: [],
      mustAssert: ['contract'],
      mustNot: ['network', 'real database', 'sleep'],
      ...(incident ? { incident: { log: 'log', failure: 'failed', expectedAfterFix: 'passes' } } : {}),
    },
  };
}

function withBusiness(targetValue: TestTarget, business: string[]): TestTarget {
  return { ...targetValue, domains: { ...targetValue.domains, business } };
}

describe('business-domain quota', () => {
  it('replaces the oldest probation test before dropping a planned target', () => {
    const older = record({
      id: 't-older', status: 'probation', createdAt: '2025-01-01T00:00:00.000Z',
      domains: { business: ['feature'], program: ['domain-logic:src'] },
    });
    const newer = record({
      id: 't-newer', status: 'probation', createdAt: '2026-01-01T00:00:00.000Z',
      domains: { business: ['feature'], program: ['domain-logic:src'] },
    });
    const result = applyQuota([target('one'), target('two')], [older, newer], testsConfig({
      quota: { default: { max: 2 }, byPriority: { critical: 2, high: 2, medium: 2, low: 2 }, domains: {} },
    }));
    expect(result.targets[0]?.replaces).toBe('t-older');
    expect(result.targets[1]?.replaces).toBe('t-newer');
    expect(result.dropped).toEqual([]);
  });

  it('admits a critical incident above quota and selects one probation retirement', () => {
    const probation = record({
      id: 't-probation', status: 'probation',
      domains: { business: ['feature'], program: ['domain-logic:src'] },
    });
    const result = applyQuota([target('incident', true)], [probation], testsConfig({
      quota: { default: { max: 1 }, byPriority: { critical: 1, high: 1, medium: 1, low: 1 }, domains: {} },
    }));
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.replaces).toBe('t-probation');
    expect(result.quota.feature).toEqual({ max: 1, active: 1, planned: 1 });
  });

  it('does not use a replacement that leaves another target domain above quota', () => {
    const featureOnly = record({
      id: 't-feature', status: 'probation',
      domains: { business: ['feature'], program: ['domain-logic:src'] },
    });
    const billing = record({
      id: 't-billing', status: 'active',
      domains: { business: ['billing'], program: ['domain-logic:src'] },
    });
    const planned = withBusiness(target('multi-domain'), ['feature', 'billing']);
    const result = applyQuota([planned], [featureOnly, billing], testsConfig({
      quota: { default: { max: 1 }, byPriority: { critical: 1, high: 1, medium: 1, low: 1 }, domains: {} },
    }));
    expect(result.targets).toEqual([]);
    expect(result.dropped).toMatchObject([{ target: { key: 'multi-domain' }, reason: 'quota' }]);
  });
});

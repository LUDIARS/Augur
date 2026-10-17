import { describe, expect, it } from 'vitest';
import { budgetKey, DEFAULT_LATENCY_BUDGET, mergeLatencyBudgets } from '../../../src/tests/latency/budgets.ts';

const latency = { metric: 'api_latency', threshold: 1000, unit: 'ms', percentile: 95, scope: '*' };

describe('mergeLatencyBudgets', () => {
  it('keeps the default EG-C01 budget when Elegantia is unreachable, with no refs', () => {
    const groups = mergeLatencyBudgets({ status: 'unreachable', detail: 'ECONNREFUSED' });
    expect(groups).toEqual([{ key: 'api_latency:p95:<=1000ms:*', budget: DEFAULT_LATENCY_BUDGET, elegantiaRefs: [], default: true }]);
  });

  it('links antipatterns with the default budget to the default group and skips review-only items', () => {
    const groups = mergeLatencyBudgets({
      status: 'ok',
      baseUrl: 'http://127.0.0.1:1',
      items: [
        { id: 'AP02', augur: latency },
        { id: 'AP01', augur: latency },
        { id: 'AP03', augur: null },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ default: true, elegantiaRefs: ['AP01', 'AP02'] });
  });

  it('gives a distinct budget its own group, after the default', () => {
    const groups = mergeLatencyBudgets({
      status: 'ok',
      baseUrl: 'http://127.0.0.1:1',
      items: [{ id: 'AP-G-abc', augur: { metric: 'api_latency', threshold: 300, unit: 'ms', percentile: 95, scope: '/search' } }],
    });
    expect(groups.map((group) => group.key)).toEqual(['api_latency:p95:<=1000ms:*', 'api_latency:p95:<=300ms:/search']);
    expect(groups[1]).toMatchObject({ default: false, elegantiaRefs: ['AP-G-abc'], budget: { threshold: 300, scope: '/search' } });
  });

  it('keys budgets by metric, percentile, threshold, unit and scope', () => {
    expect(budgetKey({ metric: 'api_latency', threshold: 1000, unit: 'ms' })).toBe('api_latency:any:<=1000ms:*');
  });
});

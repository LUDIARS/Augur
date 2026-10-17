import type { ExperienceTarget } from '../../schema/index.ts';
import type { ElegantiaSource } from './elegantia.ts';
import { contract } from '../../../templates/contract-runtime/contract-runtime.ts'; /* augur-inject:import:8bd65a8e */
import augurContract_05d4fc73 from '../../../contracts/latency-budgets.contract.ts'; /* augur-inject:contract-predicate:43346aad */

// Budget groups for latency guardrails: the always-on default (EG-C01
// api_latency p95 <= 1000ms, "a Web/API response over one second is a bug")
// plus every Elegantia antipattern that names an `augur` budget. Antipatterns
// with the same budget share one group, so AP01 and AP02 (both p95 <= 1000ms)
// link to the single default guardrail instead of producing duplicates.

export const DEFAULT_LATENCY_BUDGET: ExperienceTarget = { metric: 'api_latency', threshold: 1000, unit: 'ms', percentile: 95 };
export const DEFAULT_LATENCY_CATALOG_REF = { entryId: 'EG-C01', keyResultId: 'KR-C01a' } as const;

export interface LatencyBudgetGroup {
  key: string;
  budget: ExperienceTarget;
  elegantiaRefs: string[];
  default: boolean;
}

export function budgetKey(budget: ExperienceTarget): string {
  const percentile = budget.percentile === undefined ? 'any' : `p${budget.percentile}`;
  return `${budget.metric}:${percentile}:<=${budget.threshold}${budget.unit}:${budget.scope ?? '*'}`;
}

export function describeBudget(budget: ExperienceTarget): string {
  const percentile = budget.percentile === undefined ? '' : ` p${budget.percentile}`;
  const scope = budget.scope === undefined ? '' : ` on ${budget.scope}`;
  return `${budget.metric}${percentile} <= ${budget.threshold}${budget.unit}${scope}`;
}

export function mergeLatencyBudgets(source: ElegantiaSource): LatencyBudgetGroup[] {
  const groups = new Map<string, LatencyBudgetGroup>();
  groups.set(budgetKey(DEFAULT_LATENCY_BUDGET), {
    key: budgetKey(DEFAULT_LATENCY_BUDGET),
    budget: DEFAULT_LATENCY_BUDGET,
    elegantiaRefs: [],
    default: true,
  });
  if (source.status === 'ok') {
    for (const item of source.items) {
      if (item.augur === null || item.augur === undefined) continue;
      const budget = targetOf(item.augur);
      const key = budgetKey(budget);
      const group = groups.get(key) ?? { key, budget, elegantiaRefs: [], default: false };
      if (!group.elegantiaRefs.includes(item.id)) group.elegantiaRefs.push(item.id);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, elegantiaRefs: [...group.elegantiaRefs].sort() }))
    .sort((left, right) => Number(right.default) - Number(left.default) || left.key.localeCompare(right.key));
}
// @ts-expect-error augur-inject
mergeLatencyBudgets = contract(mergeLatencyBudgets, { ...augurContract_05d4fc73, contractId: 'C-LG-2', mode: 'observe', sample: 1, where: 'src/tests/latency/budgets.ts:31', rule: 'contract-wrap', id: '05d4fc73' }); /* augur-inject:contract-wrap:05d4fc73 */

function targetOf(augur: NonNullable<Extract<ElegantiaSource, { status: 'ok' }>['items'][number]['augur']>): ExperienceTarget {
  const scope = augur.scope === undefined || augur.scope.trim() === '' || augur.scope.trim() === '*' ? undefined : augur.scope.trim();
  return {
    metric: augur.metric,
    threshold: augur.threshold,
    unit: augur.unit,
    ...(augur.percentile === undefined ? {} : { percentile: augur.percentile }),
    ...(scope === undefined ? {} : { scope }),
  };
}

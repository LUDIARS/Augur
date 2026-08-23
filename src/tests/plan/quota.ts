import { quotaForDomain, type TestsConfig } from '../config.ts';
import type { TestPlan, TestRecord, TestTarget } from '../types.ts';
import { PRIORITY_ORDER } from './priority.ts';

export interface QuotaResult {
  targets: TestTarget[];
  dropped: TestPlan['dropped'];
  quota: TestPlan['quota'];
}

export function applyQuota(
  targets: readonly TestTarget[],
  registry: readonly TestRecord[],
  config: TestsConfig,
): QuotaResult {
  const relevant = registry.filter((test) => test.status === 'active' || test.status === 'probation');
  const domainNames = new Set<string>([
    ...relevant.flatMap(domainsOfRecord),
    ...targets.flatMap(domainsOfTarget),
  ]);
  const initial = new Map<string, number>();
  const used = new Map<string, number>();
  const planned = new Map<string, number>();
  for (const domain of domainNames) {
    const count = relevant.filter((test) => domainsOfRecord(test).includes(domain)).length;
    initial.set(domain, count);
    used.set(domain, count);
    planned.set(domain, 0);
  }

  const accepted: TestTarget[] = [];
  const dropped: TestPlan['dropped'] = [];
  const replaced = new Set<string>();
  const ordered = [...targets].sort((left, right) => (
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.key.localeCompare(right.key)
  ));

  for (const target of ordered) {
    const domains = domainsOfTarget(target);
    const overflowing = domains.filter((domain) => (used.get(domain) ?? 0) + 1 > quotaForDomain(config, domain));
    if (overflowing.length === 0) {
      accept(target, domains, used, planned, accepted);
      continue;
    }

    const incident = target.priority === 'critical' && target.kind === 'regression' && target.brief.incident !== undefined;
    const replacement = oldestProbation(relevant, overflowing, replaced, !incident);
    if (incident) {
      if (replacement !== undefined) {
        replaced.add(replacement.id);
        retireCapacity(replacement, used);
      }
      accept(replacement === undefined ? target : { ...target, replaces: replacement.id }, domains, used, planned, accepted);
      continue;
    }

    if (replacement !== undefined) {
      replaced.add(replacement.id);
      retireCapacity(replacement, used);
      accept({ ...target, replaces: replacement.id }, domains, used, planned, accepted);
    } else {
      dropped.push({ target, reason: 'quota' });
    }
  }

  const quota: TestPlan['quota'] = {};
  for (const domain of [...domainNames].sort()) {
    quota[domain] = {
      max: quotaForDomain(config, domain),
      active: initial.get(domain) ?? 0,
      planned: planned.get(domain) ?? 0,
    };
  }
  return {
    targets: accepted.sort((left, right) => left.key.localeCompare(right.key)),
    dropped: dropped.sort((left, right) => left.target.key.localeCompare(right.target.key)),
    quota,
  };
}

function accept(
  target: TestTarget,
  domains: readonly string[],
  used: Map<string, number>,
  planned: Map<string, number>,
  accepted: TestTarget[],
): void {
  accepted.push(target);
  for (const domain of domains) {
    used.set(domain, (used.get(domain) ?? 0) + 1);
    planned.set(domain, (planned.get(domain) ?? 0) + 1);
  }
}

function oldestProbation(
  registry: readonly TestRecord[],
  domains: readonly string[],
  replaced: ReadonlySet<string>,
  mustCoverAll: boolean,
): TestRecord | undefined {
  return registry.filter((test) => (
    test.status === 'probation'
    && !replaced.has(test.id)
    && (mustCoverAll
      ? domains.every((domain) => domainsOfRecord(test).includes(domain))
      : domainsOfRecord(test).some((domain) => domains.includes(domain)))
  )).sort((left, right) => (
    (left.lastFailedAt ?? left.createdAt).localeCompare(right.lastFailedAt ?? right.createdAt)
    || left.id.localeCompare(right.id)
  ))[0];
}

function retireCapacity(test: TestRecord, used: Map<string, number>): void {
  for (const domain of domainsOfRecord(test)) used.set(domain, Math.max(0, (used.get(domain) ?? 0) - 1));
}

function domainsOfTarget(target: TestTarget): string[] {
  return target.domains.business.length === 0 ? ['(unowned)'] : [...new Set(target.domains.business)].sort();
}

function domainsOfRecord(test: TestRecord): string[] {
  return test.domains.business.length === 0 ? ['(unowned)'] : [...new Set(test.domains.business)].sort();
}

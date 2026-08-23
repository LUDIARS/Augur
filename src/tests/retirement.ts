import type { TestsConfig } from './config.ts';
import type { TestRecord, TestStatus } from './types.ts';

export interface RetirementTransition {
  id: string;
  from: TestStatus;
  to: TestStatus;
  reason: string;
}

export function evaluateRetirement(
  records: readonly TestRecord[],
  config: TestsConfig,
  now: string,
): { records: TestRecord[]; transitions: RetirementTransition[] } {
  const nowMs = parseIso(now, 'now');
  const transitions: RetirementTransition[] = [];
  const policy = config.retirement;
  const updated = records.map((record): TestRecord => {
    if (record.status === 'candidate' || record.status === 'retired') return record;
    if ((record.always && policy.exemptAlways) || policy.exemptKinds.includes(record.kind)) return record;

    const failureFreeDays = daysBetween(parseIso(record.lastFailedAt ?? record.createdAt, record.id), nowMs);
    if (record.status === 'probation' && record.passStreak === 0) {
      transitions.push({ id: record.id, from: 'probation', to: 'active', reason: 'failed during probation' });
      return { ...record, status: 'active' };
    }

    if (record.status === 'active') {
      const incidentOldEnough = record.origin.type !== 'incident'
        || failureFreeDays >= policy.incidentHorizonDays;
      if (
        incidentOldEnough
        && failureFreeDays >= policy.probationAfterDays
        && record.passStreak >= policy.probationAfterPasses
      ) {
        transitions.push({ id: record.id, from: 'active', to: 'probation', reason: 'failure-free probation threshold' });
        return { ...record, status: 'probation' };
      }
    }

    if (record.status === 'probation' && failureFreeDays >= policy.retireAfterDays) {
      transitions.push({ id: record.id, from: 'probation', to: 'retired', reason: 'failure-free retirement threshold' });
      return { ...record, status: 'retired', retiredAt: now, retiredReason: 'inactive' };
    }
    return record;
  });
  return { records: updated, transitions };
}

export function reviveTest(records: readonly TestRecord[], testId: string): { records: TestRecord[]; test: TestRecord } {
  let revived: TestRecord | undefined;
  const updated = records.map((record): TestRecord => {
    if (record.id !== testId) return record;
    if (record.status !== 'retired') throw new Error(`${testId} is not retired`);
    revived = { ...record, status: 'active', passStreak: 0 };
    delete revived.retiredAt;
    delete revived.retiredReason;
    return revived;
  });
  if (revived === undefined) throw new Error(`test not found: ${testId}`);
  return { records: updated, test: revived };
}

function parseIso(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp`);
  return parsed;
}

function daysBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / 86_400_000;
}

import type { TestKind, TestPriority } from '../types.ts';

export interface PriorityFacts {
  incident: boolean;
  fanIn: number;
  nearestEntryDistance?: number;
  cyclomatic: number;
  touchesErrorViolation: boolean;
  domainPriority?: TestPriority;
  added: boolean;
  kind: TestKind;
}

export interface PriorityDecision {
  score: number;
  priority: TestPriority;
  runtime: boolean;
}

export function priorityFor(facts: PriorityFacts): PriorityDecision {
  let score = facts.incident ? 60 : 0;
  score += facts.fanIn >= 5 ? 25 : facts.fanIn >= 2 ? 10 : 0;
  score += facts.nearestEntryDistance !== undefined && facts.nearestEntryDistance <= 1 ? 20 : 0;
  score += facts.cyclomatic >= 10 ? 15 : facts.cyclomatic >= 5 ? 8 : 0;
  score += facts.touchesErrorViolation ? 15 : 0;
  score += facts.domainPriority === 'critical' ? 15 : facts.domainPriority === 'high' ? 8 : 0;
  score += facts.added ? 5 : 0;
  const priority: TestPriority = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
  return {
    score,
    priority,
    runtime: (facts.nearestEntryDistance !== undefined && facts.nearestEntryDistance <= 1)
      || (facts.kind === 'assurance' && facts.fanIn >= 5),
  };
}

export const PRIORITY_ORDER: Readonly<Record<TestPriority, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

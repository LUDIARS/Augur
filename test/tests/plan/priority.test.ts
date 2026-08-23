import { describe, expect, it } from 'vitest';
import { priorityFor, type PriorityFacts } from '../../../src/tests/plan/priority.ts';

const BASE: PriorityFacts = {
  incident: false,
  fanIn: 0,
  cyclomatic: 1,
  touchesErrorViolation: false,
  added: false,
  kind: 'assurance',
};

describe('test target priority table', () => {
  it.each([
    ['incident', { incident: true }, 60],
    ['fanIn >= 5', { fanIn: 5 }, 25],
    ['fanIn >= 2', { fanIn: 2 }, 10],
    ['entry distance <= 1', { nearestEntryDistance: 1 }, 20],
    ['cyclomatic >= 10', { cyclomatic: 10 }, 15],
    ['cyclomatic >= 5', { cyclomatic: 5 }, 8],
    ['error violation', { touchesErrorViolation: true }, 15],
    ['critical domain', { domainPriority: 'critical' as const }, 15],
    ['high domain', { domainPriority: 'high' as const }, 8],
    ['added', { added: true }, 5],
  ])('scores %s exactly', (_name, facts, score) => {
    expect(priorityFor({ ...BASE, ...facts }).score).toBe(score);
  });

  it.each([
    [{ incident: true }, 'critical'],
    [{ fanIn: 5, touchesErrorViolation: true }, 'high'],
    [{ nearestEntryDistance: 1 }, 'medium'],
    [{ fanIn: 2, cyclomatic: 5 }, 'low'],
  ] as const)('applies thresholds at 60/40/20', (facts, priority) => {
    expect(priorityFor({ ...BASE, ...facts }).priority).toBe(priority);
  });

  it('sets runtime only near an entry or for high-fan-in assurance', () => {
    expect(priorityFor({ ...BASE, nearestEntryDistance: 1, kind: 'regression' }).runtime).toBe(true);
    expect(priorityFor({ ...BASE, fanIn: 5, kind: 'assurance' }).runtime).toBe(true);
    expect(priorityFor({ ...BASE, fanIn: 5, kind: 'regression' }).runtime).toBe(false);
    expect(priorityFor({ ...BASE, nearestEntryDistance: 2 }).runtime).toBe(false);
  });
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrDiffReview, ProgramDomainDiagnosis } from '../../../src/tests/anatomia.ts';
import { FilePlanStore } from '../../../src/tests/plan-store.ts';
import { JsonlRunStore } from '../../../src/tests/run-store.ts';
import type { TestRecord } from '../../../src/tests/types.ts';
import { makeRepository } from '../fixtures.ts';

export const PLAN_ID = 'plan_00000000000000000000000000';

export function analysis(overrides: Record<string, unknown> = {}): PrDiffReview {
  return {
    temporary: true,
    diff: {
      available: true,
      head: 'a'.repeat(40),
      files: [{
        path: 'src/example.ts',
        status: 'modified',
        added: [],
        changed: [{ anchor: 'anchor-a', name: 'calculate', line: 10, signature: 'function calculate(value: number): number' }],
        removed: [],
      }],
      anchors: { added: [], changed: ['anchor-a'], all: ['anchor-a'] },
    },
    domain: {
      targetDomains: [{ name: 'feature', changedAnchors: ['anchor-a'] }],
      dualLayer: { unclassifiedAnchors: [] },
    },
    quality: { changedFunctions: [{ anchor: 'anchor-a', cyclomatic: 1, fanIn: 0, fanOut: 0 }] },
    architecture: { changedViolations: [] },
    ...overrides,
  } as PrDiffReview;
}

export function program(modules: ProgramDomainDiagnosis['modules'] = [{
  moduleId: 'src', layer: 'domain-logic', files: ['src/example.ts'],
}]): ProgramDomainDiagnosis {
  return { modules, totals: { unclassifiedModules: 0 } } as ProgramDomainDiagnosis;
}

export function repository(path: string, records: readonly TestRecord[] = []): void {
  makeRepository(path, records);
  mkdirSync(join(path, 'src'), { recursive: true });
  writeFileSync(join(path, 'src', 'example.ts'), 'export function calculate(value: number) { return value + 1; }\n', 'utf8');
}

export function stores(root: string) {
  return {
    planStore: new FilePlanStore(join(root, 'data'), () => new Date('2026-08-23T00:00:00.000Z'), () => PLAN_ID),
    runStore: new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 }),
  };
}

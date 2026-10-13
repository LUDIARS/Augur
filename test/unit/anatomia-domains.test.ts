import { describe, expect, it } from 'vitest';
import { parseArgv } from '../../src/cli/args.ts';
import { buildRequest } from '../../src/cli/plan.ts';
import { createPlan } from '../../src/engine/createPlan.ts';
import type { CreatePlanRequest } from '../../src/schema/index.ts';

// `anatomiaDomains`: Anatomia's landing domains (name, program/business layer,
// src/tests membership) fed into the plan as evidence and priority.

const base: CreatePlanRequest = {
  objective: { kind: 'new_feature', description: 'Add session export.' },
  change: { changedFiles: ['src/session/export.ts', 'src/storage/writer.ts'] },
};

function viaCli(request: unknown): CreatePlanRequest {
  return buildRequest(parseArgv(['plan', '--request', '-']), {
    cwd: '.',
    warn: () => undefined,
    readStdin: () => JSON.stringify(request),
  });
}

describe('plan request without anatomiaDomains', () => {
  it('stays identical to the plan produced before the field existed', () => {
    const plan = createPlan(viaCli(base));
    expect(plan.evidence.some((entry) => entry.type === 'anatomia_domain')).toBe(false);
    expect(plan).toEqual(createPlan(base));
  });
});

describe('plan request with anatomiaDomains', () => {
  it('records each landing domain as evidence', () => {
    const plan = createPlan(viaCli({
      ...base,
      anatomiaDomains: [
        { name: 'session', layer: 'program', files: ['src/session/export.ts'], membership: { src: true, tests: true } },
      ],
    }));
    const entries = plan.evidence.filter((entry) => entry.type === 'anatomia_domain');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toContain('program domain "session"');
    expect(entries[0]?.detail).toContain('tests membership yes');
  });

  it('asks for a paired test, at high priority, when the landing domain has no tests members', () => {
    const plan = createPlan({
      ...base,
      anatomiaDomains: [
        { name: 'storage', layer: 'program', files: ['src/storage/writer.ts'], membership: { src: true, tests: false } },
      ],
    });
    const evidenceId = plan.evidence.find((entry) => entry.type === 'anatomia_domain')?.id;
    const suggestion = plan.testPlan.suggestions.find((entry) => entry.title.startsWith('storage: pair the change'));
    expect(suggestion).toMatchObject({ kind: 'unit', priority: 'high', targetFiles: ['src/storage/writer.ts'] });
    expect(suggestion?.evidenceIds).toEqual([evidenceId]);
  });

  it('does not ask for a paired test when the domain already has tests members', () => {
    const plan = createPlan({
      ...base,
      anatomiaDomains: [{ name: 'session', layer: 'program', membership: { src: true, tests: true } }],
    });
    expect(plan.testPlan.suggestions.some((entry) => entry.title.includes('pair the change'))).toBe(false);
  });

  it('plans a cross-domain integration test when the change spans domains of one layer', () => {
    const plan = createPlan({
      ...base,
      anatomiaDomains: [
        { name: 'session', layer: 'program', membership: { src: true, tests: true } },
        { name: 'storage', layer: 'program', membership: { src: true, tests: true } },
        { name: 'export', layer: 'business', membership: { src: true, tests: true } },
      ],
    });
    const crossing = plan.testPlan.suggestions.filter((entry) => entry.title.startsWith('Cross-domain change'));
    expect(crossing).toHaveLength(1);
    expect(crossing[0]).toMatchObject({ kind: 'integration', priority: 'medium', title: 'Cross-domain change: session / storage' });
    expect(crossing[0]?.evidenceIds).toHaveLength(2);
  });

  it('raises the cross-domain priority when three or more domains are touched', () => {
    const plan = createPlan({
      ...base,
      anatomiaDomains: ['a', 'b', 'c'].map((name) => ({ name, layer: 'program' as const, membership: { src: true, tests: true } })),
    });
    expect(plan.testPlan.suggestions.find((entry) => entry.title.startsWith('Cross-domain change'))?.priority).toBe('high');
  });

  it('rejects a duplicated domain in the same layer', () => {
    expect(() => createPlan({
      ...base,
      anatomiaDomains: [
        { name: 'session', layer: 'program', membership: { src: true, tests: true } },
        { name: 'session', layer: 'program', membership: { src: true, tests: false } },
      ],
    })).toThrow(/duplicate Anatomia domain/);
  });
});

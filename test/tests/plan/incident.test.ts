import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { intakeIncident } from '../../../src/tests/plan/incident.ts';
import { JsonlRunStore } from '../../../src/tests/run-store.ts';
import { record, runRecord } from '../fixtures.ts';

function hit() {
  return {
    name: 'calculate',
    signature: 'function calculate(value: number): number',
    filePath: 'src/example.ts',
    startLine: 10,
    endLine: 12,
    anchor: 'anchor-a',
    fanIn: 1,
    fanOut: 0,
  };
}

describe('incident intake', () => {
  it('reads problem-log markdown frontmatter and resolves affected symbols', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-incident-md-'));
    const file = join(root, 'problem.md');
    writeFileSync(file, `---\nsymptoms:\n  - calculation returns stale value\naffected:\n  - src/example.ts#calculate\nroot_cause: stale cache\n---\nObserved twice in production.\n`, 'utf8');
    const result = await intakeIncident(file, root, {
      find: async () => [hit()],
      where: async () => ({ landings: [] }),
      runStore: new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 10 }),
      registry: [],
    });
    expect(result).toMatchObject([{ anchor: 'anchor-a', failure: 'calculation returns stale value', expectedAfterFix: expect.stringContaining('stale cache') }]);
  });

  it('reads Vestigium JSONL markers and collapses repeated sites', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-incident-jsonl-'));
    const file = join(root, 'vestigium.jsonl');
    const line = JSON.stringify({ marker: 'calculate', site: 'src/example.ts:10' });
    writeFileSync(file, `${line}\n${line}\n`, 'utf8');
    const result = await intakeIncident(file, root, {
      find: async () => [hit()],
      where: async () => ({ landings: [] }),
      runStore: new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 10 }),
      registry: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.failure).toContain('Vestigium marker calculate');
  });

  it('uses failed RunRecord tests and their registered anchors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-incident-run-'));
    const store = new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 10 });
    const failed = runRecord({
      results: [{ testId: 't-failed', status: 'failed', durationMs: 1, failureMessage: 'expected 2' }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, error: 0 },
      status: 'failed',
    });
    await store.put(failed);
    const result = await intakeIncident(`run:${failed.runId}`, root, {
      find: async () => [],
      where: async () => ({ landings: [] }),
      runStore: store,
      registry: [record({ id: 't-failed', anchors: ['anchor-a'], domains: { business: [], program: ['domain-logic:src'] } })],
    });
    expect(result).toMatchObject([{ anchor: 'anchor-a', failure: 'expected 2', domains: { business: [], program: ['domain-logic:src'] } }]);
  });
});

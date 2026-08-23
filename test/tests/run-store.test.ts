import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonlRunStore } from '../../src/tests/run-store.ts';
import { deriveRunStatus, type RunResult } from '../../src/tests/types.ts';
import { runRecord } from './fixtures.ts';

describe('run-store retention', () => {
  it('uses retentionDays and keeps verdict/flag evidence for 3x as long', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'augur-run-store-'));
    const store = new JsonlRunStore(join(directory, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 });
    await store.put(runRecord({ runId: 'r-expired', startedAt: '2026-07-20T00:00:00.000Z', finishedAt: '2026-07-20T00:00:01.000Z' }));
    await store.put(runRecord({
      runId: 'r-protected',
      startedAt: '2026-06-24T00:00:00.000Z',
      finishedAt: '2026-06-24T00:00:01.000Z',
      verdict: { decision: 'accept', by: 'session:test', at: '2026-06-24T00:01:00.000Z' },
    }));
    await store.put(runRecord({ runId: 'r-fresh' }));
    await store.sweep('2026-08-23T00:00:00.000Z');
    expect((await store.list()).map((run) => run.runId)).toEqual(['r-fresh', 'r-protected']);
  });

  it('caps ordinary runs at maxRunsPerRepository and evidence runs at 3x', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'augur-run-cap-'));
    const store = new JsonlRunStore(join(directory, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 2 });
    for (let index = 0; index < 5; index += 1) {
      await store.put(runRecord({
        runId: `r-normal-${index}`,
        startedAt: `2026-08-23T00:00:0${index}.000Z`,
        finishedAt: `2026-08-23T00:00:0${index}.500Z`,
      }));
    }
    for (let index = 0; index < 8; index += 1) {
      await store.put(runRecord({
        runId: `r-evidence-${index}`,
        startedAt: `2026-08-23T00:01:0${index}.000Z`,
        finishedAt: `2026-08-23T00:01:0${index}.500Z`,
        flag: { target: 'revisor', pullRequestId: 'pr', at: '2026-08-23T00:02:00.000Z', outcome: 'ok' },
      }));
    }
    const runs = await store.list();
    expect(runs.filter((run) => run.flag === undefined)).toHaveLength(2);
    expect(runs.filter((run) => run.flag !== undefined)).toHaveLength(6);
  });
});

describe('RunRecord status derivation', () => {
  const value = (status: RunResult['status']): RunResult => ({ testId: status, status, durationMs: 0 });

  it.each([
    ['failed wins over error and passed', [value('passed'), value('error'), value('failed')], 'failed'],
    ['error wins when no failed result exists', [value('passed'), value('error')], 'error'],
    ['passed wins when only passed/skipped exist', [value('skipped'), value('passed')], 'passed'],
    ['empty is error', [], 'error'],
    ['all skipped is error', [value('skipped')], 'error'],
  ] as const)('%s', (_name, results, expected) => {
    expect(deriveRunStatus(results)).toBe(expected);
  });
});

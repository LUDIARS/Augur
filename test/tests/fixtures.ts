import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AugurConfig } from '../../src/config/config.ts';
import { testsConfigSchema, type TestsConfig } from '../../src/tests/config.ts';
import type { RunRecord, TestRecord } from '../../src/tests/types.ts';

export function record(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 't-000000000001',
    repository: 'Example/Repo',
    name: 'suite works',
    file: 'test/example.test.ts',
    runner: 'vitest',
    kind: 'assurance',
    domains: { business: ['feature'], program: ['domain-logic/example'] },
    anchors: ['anchor-a'],
    origin: { type: 'manual', ref: '', authoredBy: 'human' },
    runtime: false,
    always: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    passStreak: 30,
    runs: 30,
    ...overrides,
  };
}

export function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'r-20260823000000000-00000001',
    repository: 'Example/Repo',
    repoPath: '/repo',
    headSha: 'a'.repeat(40),
    branch: 'main',
    bundle: { kind: 'all', selector: null, testIds: ['t-000000000001'], reason: { 't-000000000001': 'all' } },
    bus: 'local',
    startedAt: '2026-08-23T00:00:00.000Z',
    finishedAt: '2026-08-23T00:00:01.000Z',
    durationMs: 1000,
    results: [{ testId: 't-000000000001', status: 'passed', durationMs: 10 }],
    summary: { total: 1, passed: 1, failed: 0, skipped: 0, error: 0 },
    status: 'passed',
    ...overrides,
  };
}

export function testsConfig(overrides: Record<string, unknown> = {}): TestsConfig {
  return testsConfigSchema.parse({
    version: 1,
    repository: 'Example/Repo',
    defaultBus: 'local',
    runners: { vitest: { command: ['vitest'] }, command: {} },
    ...overrides,
  });
}

export function makeRepository(path: string, records: readonly TestRecord[] = [record()]): void {
  mkdirSync(join(path, '.augur'), { recursive: true });
  mkdirSync(join(path, 'test'), { recursive: true });
  writeFileSync(join(path, 'test', 'example.test.ts'), 'export {};\n', 'utf8');
  writeFileSync(join(path, '.augur', 'tests.config.json'), `${JSON.stringify({
    version: 1,
    repository: 'Example/Repo',
    defaultBus: 'local',
    runners: { vitest: { command: ['vitest'] }, command: {} },
    timeoutMs: 5000,
  })}\n`, 'utf8');
  writeFileSync(join(path, '.augur', 'tests.jsonl'), records.map((item) => JSON.stringify(item)).join('\n') + (records.length ? '\n' : ''), 'utf8');
}

export function augurConfig(root: string, repositoryPath: string): AugurConfig {
  return {
    port: 4210,
    logLevel: 'info',
    buses: { local: { type: 'local', env: [] } },
    repositories: { 'Example/Repo': repositoryPath },
    runCache: { retentionDays: 30, maxRunsPerRepository: 200 },
    authoring: { model: 'test-model' },
    augurFolder: root,
    dataDir: join(root, 'data'),
  };
}

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { runTestsCommand } from '../../src/cli/tests/index.ts';
import { createTestOperations } from '../../src/operations/tests.ts';
import { JsonlRunStore } from '../../src/tests/run-store.ts';
import { testId } from '../../src/tests/registry.ts';
import type { TestRecord } from '../../src/tests/types.ts';
import { augurConfig, makeRepository, record, runRecord } from './fixtures.ts';
import { analysis, program, stores } from './plan/fixtures.ts';

describe('operations adapter parity', () => {
  it('returns equal JSON through HTTP and CLI for list, runs, and report', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-operations-'));
    const repo = join(root, 'repo');
    makeRepository(repo);
    const store = new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 });
    const run = runRecord({ repoPath: repo });
    await store.put(run);
    const operations = createTestOperations({ config: augurConfig(root, repo), store, now: () => new Date('2026-08-23T00:00:02.000Z') });
    const app = createApp(undefined, operations);

    const cliList = await cliJson(['list', '--repo', repo, '--json'], operations);
    const httpList = await json(await app.request('/v1/tests?repository=Example%2FRepo'));
    expect(httpList).toEqual(cliList);

    const cliRuns = await cliJson(['runs', '--repo', 'Example/Repo', '--json'], operations);
    const httpRuns = await json(await app.request('/v1/tests/runs?repository=Example%2FRepo'));
    expect(httpRuns).toEqual(cliRuns);

    const cliReport = await cliJson(['report', run.runId, '--json'], operations);
    const httpReport = await json(await app.request(`/v1/tests/runs/${run.runId}/report?format=json`));
    expect(httpReport).toEqual(cliReport);
  });

  it('returns HTTP 409 while another synchronous run is in progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-concurrent-'));
    const repo = join(root, 'repo');
    const commandTest: TestRecord = record({
      id: testId('Example/Repo', 'test/example.test.ts', 'slow command'),
      runner: 'command',
      command: [process.execPath, '-e', 'setTimeout(() => process.exit(0), 300)'],
      name: 'slow command',
    });
    makeRepository(repo, [commandTest]);
    const store = new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 });
    const operations = createTestOperations({ config: augurConfig(root, repo), store });
    const app = createApp(undefined, operations);
    const body = JSON.stringify({ repoPath: repo, bundle: 'all' });
    const first = app.request('/v1/tests/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await app.request('/v1/tests/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: 'run_in_progress' } });
    expect((await first).status).toBe(201);
  });

  it('maps an empty bundle to exit 3 normally and exit 0 for Revisor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-empty-'));
    const repo = join(root, 'repo');
    makeRepository(repo, []);
    const store = new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 });
    const operations = createTestOperations({ config: augurConfig(root, repo), store });
    expect((await cliResult(['run', '--repo', repo, '--bundle', 'all', '--json'], operations)).exit).toBe(3);
    const revisor = await cliResult(['run', '--repo', repo, '--bundle', 'all', '--for-revisor', '--json'], operations);
    expect(revisor.exit).toBe(0);
    expect(JSON.parse(revisor.stdout)).toMatchObject({ empty: true });
    expect(await store.list()).toEqual([]);
  });

  it('returns equal plan and session-author JSON through HTTP and CLI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-phase2-'));
    const repo = join(root, 'repo');
    makeRepository(repo, []);
    const fixture = analysis();
    const analysisPath = join(root, 'analysis.json');
    writeFileSync(analysisPath, JSON.stringify(fixture), 'utf8');
    const state = stores(root);
    const operations = createTestOperations({
      config: augurConfig(root, repo),
      store: state.runStore,
      planStore: state.planStore,
      planDependencies: { domains: async () => program(), callers: async () => [] },
    });
    const app = createApp(undefined, operations);
    const cliPlan = await cliJson(['plan', '--repo', repo, '--analysis', analysisPath, '--json'], operations);
    const planResponse = await app.request('/v1/tests/plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: repo, source: { type: 'pr', analysis: fixture } }),
    });
    expect(planResponse.status).toBe(201);
    expect(await planResponse.json()).toEqual(cliPlan);
    const planId = (cliPlan as { planId: string }).planId;
    expect(await json(await app.request(`/v1/tests/plans/${planId}`))).toEqual(cliPlan);

    const cliAuthor = await cliJson(['author', '--repo', repo, '--plan', planId, '--author', 'session', '--json'], operations);
    const authorResponse = await app.request(`/v1/tests/plans/${planId}/author`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author: 'session' }),
    });
    expect(authorResponse.status).toBe(200);
    expect(await authorResponse.json()).toEqual(cliAuthor);
  });

  it('rejects a requested head that is not the checkout HEAD before execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-head-mismatch-'));
    const repo = join(root, 'repo');
    const name = 'head-bound command';
    const commandTest = record({
      id: testId('Example/Repo', 'test/example.test.ts', name),
      name,
      runner: 'command',
      command: [process.execPath, '-e', 'process.exit(0)'],
    });
    makeRepository(repo, [commandTest]);
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, '.git', 'HEAD'), `${'a'.repeat(40)}\n`, 'utf8');
    const store = new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 });
    const operations = createTestOperations({ config: augurConfig(root, repo), store });

    await expect(operations.run({ repoPath: repo, bundle: 'all', head: 'b'.repeat(40) }))
      .rejects.toThrow('does not match repository HEAD');
    expect(await store.list()).toEqual([]);
  });

  it('rejects invalid registry files before starting a runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-invalid-run-registry-'));
    const repo = join(root, 'repo');
    const file = 'test/missing.test.ts';
    const name = 'missing command file';
    makeRepository(repo, [record({
      id: testId('Example/Repo', file, name),
      file,
      name,
      runner: 'command',
      command: [process.execPath, '-e', 'process.exit(0)'],
    })]);
    const operations = createTestOperations({
      config: augurConfig(root, repo),
      store: new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 }),
    });

    await expect(operations.run({ repoPath: repo, bundle: 'all' })).rejects.toMatchObject({
      errors: [expect.stringContaining('file does not exist')],
    });
  });

  it('rejects traversal in stored plan identifiers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-plan-traversal-'));
    const repo = join(root, 'repo');
    makeRepository(repo);
    const operations = createTestOperations({
      config: augurConfig(root, repo),
      store: new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 }),
    });

    await expect(operations.registerFromPlan({ repoPath: repo, planId: '../../outside' }))
      .rejects.toThrow('must be a plan_ ULID');
  });
});

async function cliJson(argv: string[], operations: ReturnType<typeof createTestOperations>): Promise<unknown> {
  const result = await cliResult(argv, operations);
  expect(result.exit, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as unknown;
}

async function cliResult(argv: string[], operations: ReturnType<typeof createTestOperations>) {
  let stdout = '';
  let stderr = '';
  const exit = await runTestsCommand(argv, {
    cwd: process.cwd(),
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    readStdin: () => '',
  }, operations);
  return { exit, stdout, stderr };
}

async function json(response: Response): Promise<unknown> {
  expect(response.status).toBeLessThan(300);
  return await response.json() as unknown;
}

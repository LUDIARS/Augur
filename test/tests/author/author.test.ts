import { mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { author } from '../../../src/tests/author/author.ts';
import { validateBody } from '../../../src/tests/author/claude-cli.ts';
import { FilePlanStore } from '../../../src/tests/plan-store.ts';
import { loadRegistry, testId } from '../../../src/tests/registry.ts';
import type { RunInput, TestPlan, TestTarget } from '../../../src/tests/types.ts';
import { augurConfig, runRecord } from '../fixtures.ts';
import { PLAN_ID, repository } from '../plan/fixtures.ts';

const stub = join(process.cwd(), 'test', 'tests', 'fixtures', 'claude-stub.mjs');

afterEach(() => vi.unstubAllEnvs());

function target(): TestTarget {
  return {
    key: 'assurance:anchor-a',
    kind: 'assurance',
    priority: 'medium',
    domains: { business: ['feature'], program: ['domain-logic:src'] },
    anchors: ['anchor-a'],
    impacted: [],
    file: 'test/generated.test.ts',
    runner: 'vitest',
    runtime: false,
    brief: {
      title: 'Assurance: calculate',
      purpose: 'Prove calculate.',
      subject: { symbol: 'calculate', file: 'src/example.ts', line: 0 },
      risks: ['contract'],
      exemplars: [],
      mustAssert: ['return value'],
      mustNot: ['network', 'real database', 'sleep'],
    },
  };
}

function savePlan(root: string, repo: string): { store: FilePlanStore; plan: TestPlan } {
  const store = new FilePlanStore(join(root, 'data'), () => new Date('2026-08-23T00:00:00.000Z'), () => PLAN_ID);
  const plan = store.save({
    repository: 'Example/Repo',
    headSha: 'a'.repeat(40),
    source: { type: 'pr', ref: '1' },
    status: 'ready',
    blockers: [],
    targets: [target()],
    dropped: [],
    quota: { feature: { max: 12, active: 0, planned: 1 } },
  }, repo);
  return { store, plan };
}

describe.sequential('test authoring', () => {
  it('session author returns briefs and writes nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-author-session-'));
    const repo = join(root, 'repo');
    repository(repo);
    const { store } = savePlan(root, repo);
    const before = snapshot(repo);
    const result = await author({ planId: PLAN_ID, repoPath: repo, author: 'session' }, {
      config: augurConfig(root, repo),
      planStore: store,
      run: async () => { throw new Error('session must not run tests'); },
    });
    expect(result.briefs).toHaveLength(1);
    expect(result.authored).toEqual([]);
    expect(snapshot(repo)).toEqual(before);
  });

  it('rejects output naming other files or using a mustNot term', () => {
    const input = { file: 'test/generated.test.ts', runner: 'vitest' as const, brief: target().brief, existingFile: false };
    expect(() => validateBody('// file: test/other.test.ts\ndescribe("x", () => test("x", () => {}));', input)).toThrow('unplanned file');
    expect(() => validateBody('describe("x", () => test("uses network", () => {}));', input)).toThrow('forbidden term: network');
  });

  it('rejects a non-SHA before value before invoking Git', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-author-before-'));
    const repo = join(root, 'repo');
    repository(repo);
    const { store } = savePlan(root, repo);
    await expect(author({ planId: PLAN_ID, repoPath: repo, author: 'session', before: '--force' }, {
      config: augurConfig(root, repo),
      planStore: store,
      run: async () => { throw new Error('invalid before must not run'); },
    })).rejects.toThrow('before must be a 7-64 character hexadecimal SHA');
  });

  it.skipIf(process.platform === 'win32')('does not overwrite an existing test symlink that resolves outside the repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-author-symlink-'));
    const repo = join(root, 'repo');
    repository(repo);
    const { store } = savePlan(root, repo);
    const outside = join(root, 'outside.test.ts');
    writeFileSync(outside, 'outside\n', 'utf8');
    symlinkSync(outside, join(repo, target().file), 'file');
    const result = await author({ planId: PLAN_ID, repoPath: repo, author: 'claude-cli' }, {
      config: augurConfig(root, repo),
      planStore: store,
      claude: { command: process.execPath, prefixArgs: [stub] },
      run: async () => { throw new Error('unsafe authored target must not run'); },
    });
    expect(result.authored).toEqual([]);
    expect(result.failed[0]?.reason).toBe('unsafe repository path');
    expect(readFileSync(outside, 'utf8')).toBe('outside\n');
  });

  it('writes valid claude-cli output with a marker and promotes it on pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-author-pass-'));
    const repo = join(root, 'repo');
    repository(repo);
    const { store, plan } = savePlan(root, repo);
    const id = testId(plan.repository, target().file, target().brief.title);
    const result = await author({ planId: PLAN_ID, repoPath: repo, author: 'claude-cli' }, {
      config: augurConfig(root, repo),
      planStore: store,
      claude: { command: process.execPath, prefixArgs: [stub] },
      run: async (input) => fakeRun(repo, input, id, 'passed'),
    });
    expect(result.failed).toEqual([]);
    expect(result.authored[0]?.status).toBe('active');
    expect(readFileSync(join(repo, target().file), 'utf8')).toContain(`@augur test:${id} plan:${PLAN_ID}`);
  });

  it('keeps a generated test candidate when its first run fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-author-fail-'));
    const repo = join(root, 'repo');
    repository(repo);
    const { store, plan } = savePlan(root, repo);
    const id = testId(plan.repository, target().file, target().brief.title);
    const result = await author({ planId: PLAN_ID, repoPath: repo, author: 'claude-cli' }, {
      config: augurConfig(root, repo),
      planStore: store,
      claude: { command: process.execPath, prefixArgs: [stub] },
      run: async (input) => fakeRun(repo, input, id, 'failed'),
    });
    expect(result.failed).toMatchObject([{ key: 'assurance:anchor-a', reason: 'new test did not pass' }]);
    expect(loadRegistry(repo).find((test) => test.id === id)?.status).toBe('candidate');
  });

  it('does not write a target whose claude-cli body violates its brief', async () => {
    vi.stubEnv('AUGUR_CLAUDE_STUB_RESPONSE', JSON.stringify({
      file: 'test/generated.test.ts',
      body: 'describe("bad", () => test("network", () => {}));',
    }));
    const root = mkdtempSync(join(tmpdir(), 'augur-author-reject-'));
    const repo = join(root, 'repo');
    repository(repo);
    const { store } = savePlan(root, repo);
    const result = await author({ planId: PLAN_ID, repoPath: repo, author: 'claude-cli' }, {
      config: augurConfig(root, repo),
      planStore: store,
      claude: { command: process.execPath, prefixArgs: [stub] },
      run: async () => { throw new Error('rejected output must not run'); },
    });
    expect(result.authored).toEqual([]);
    expect(result.failed[0]?.reason).toContain('forbidden term');
    expect(() => readFileSync(join(repo, target().file), 'utf8')).toThrow();
  });
});

function fakeRun(repo: string, input: RunInput, id: string, status: 'passed' | 'failed') {
  return Promise.resolve(runRecord({
    repoPath: repo,
    bundle: { kind: 'ids', selector: typeof input.bundle === 'string' ? input.bundle.slice(4) : id, testIds: [id], reason: { [id]: 'explicit' } },
    results: [{ testId: id, status, durationMs: 1, ...(status === 'failed' ? { failureMessage: 'failed' } : {}) }],
    summary: { total: 1, passed: status === 'passed' ? 1 : 0, failed: status === 'failed' ? 1 : 0, skipped: 0, error: 0 },
    status,
  }));
}

function snapshot(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else output[path.slice(root.length + 1)] = readFileSync(path, 'utf8');
    }
  };
  visit(root);
  return output;
}

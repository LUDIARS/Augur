import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestOperations } from '../../../src/operations/tests.ts';
import { testId } from '../../../src/tests/registry.ts';
import type { TestTarget } from '../../../src/tests/types.ts';
import { augurConfig } from '../fixtures.ts';
import { PLAN_ID, repository, stores } from '../plan/fixtures.ts';

function target(key: string, file: string): TestTarget {
  return {
    key,
    kind: 'assurance',
    priority: 'medium',
    domains: { business: ['feature'], program: ['domain-logic:src'] },
    anchors: [key],
    impacted: [],
    file,
    runner: 'vitest',
    runtime: false,
    brief: {
      title: `Assurance: ${key}`,
      purpose: key,
      subject: { symbol: key, file: 'src/example.ts', line: 0 },
      risks: ['contract'],
      exemplars: [],
      mustAssert: ['contract'],
      mustNot: ['network', 'real database', 'sleep'],
    },
  };
}

describe('register --from-plan matching', () => {
  it('matches by exact @augur test header and by planned (file, title), reporting unmatched targets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-register-plan-'));
    const repo = join(root, 'repo');
    repository(repo);
    const state = stores(root);
    const targets = [
      target('header', 'test/header.test.ts'),
      target('title', 'test/title.test.ts'),
      target('missing', 'test/missing.test.ts'),
    ];
    state.planStore.save({
      repository: 'Example/Repo', headSha: 'a'.repeat(40), source: { type: 'pr', ref: '1' },
      status: 'ready', blockers: [], targets, dropped: [], quota: {},
    }, repo);
    mkdirSync(join(repo, 'test'), { recursive: true });
    const id = testId('Example/Repo', targets[0]!.file, targets[0]!.brief.title);
    writeFileSync(join(repo, targets[0]!.file), `// @augur test:${id} plan:${PLAN_ID}\ntest("hand title", () => {});\n`, 'utf8');
    writeFileSync(join(repo, targets[1]!.file), `describe(${JSON.stringify(targets[1]!.brief.title)}, () => {});\n`, 'utf8');
    const operations = createTestOperations({ config: augurConfig(root, repo), store: state.runStore, planStore: state.planStore });
    const result = await operations.registerFromPlan({ repoPath: repo, planId: PLAN_ID });
    expect(result.registered).toHaveLength(2);
    expect(result.registered.every((test) => test.status === 'candidate')).toBe(true);
    expect(result.unmatched).toMatchObject([{ key: 'missing', reason: 'planned file does not exist' }]);
  });

  it('rejects registering a stored plan against a different repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-register-wrong-repo-'));
    const plannedRepo = join(root, 'planned');
    const otherRepo = join(root, 'other');
    repository(plannedRepo);
    repository(otherRepo);
    const configPath = join(otherRepo, '.augur', 'tests.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(configPath, `${JSON.stringify({ ...config, repository: 'Other/Repo' })}\n`, 'utf8');
    const state = stores(root);
    state.planStore.save({
      repository: 'Example/Repo', headSha: 'a'.repeat(40), source: { type: 'pr', ref: '1' },
      status: 'ready', blockers: [], targets: [], dropped: [], quota: {},
    }, plannedRepo);
    const operations = createTestOperations({ config: augurConfig(root, plannedRepo), store: state.runStore, planStore: state.planStore });
    await expect(operations.registerFromPlan({ repoPath: otherRepo, planId: PLAN_ID }))
      .rejects.toThrow('test plan belongs to Example/Repo, not Other/Repo');
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTestsCommand } from '../../../src/cli/tests/index.ts';
import { createTestOperations } from '../../../src/operations/tests.ts';
import { plan } from '../../../src/tests/plan/plan.ts';
import { augurConfig, record } from '../fixtures.ts';
import { analysis, program, repository, stores } from './fixtures.ts';

describe('deterministic test planning', () => {
  it('blocks with no targets when Anatomia reports unclassified changed anchors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-plan-blocked-'));
    const repo = join(root, 'repo');
    repository(repo);
    const fixture = analysis();
    fixture.domain.dualLayer.unclassifiedAnchors = ['anchor-a'];
    const result = await plan({ repoPath: repo, source: { type: 'pr', analysis: fixture } }, {
      ...stores(root),
      domains: async () => program(),
      callers: async () => [],
    });
    expect(result.status).toBe('blocked_by_domain');
    expect(result.blockers).toEqual(['anchor-a']);
    expect(result.targets).toEqual([]);
  });

  it('maps blocked_by_domain to CLI exit 4 while still printing the TestPlan JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-plan-exit4-'));
    const repo = join(root, 'repo');
    repository(repo);
    const fixture = analysis();
    fixture.domain.dualLayer.unclassifiedAnchors = ['anchor-a'];
    const analysisPath = join(root, 'analysis.json');
    writeFileSync(analysisPath, JSON.stringify(fixture), 'utf8');
    const state = stores(root);
    const operations = createTestOperations({
      config: augurConfig(root, repo), store: state.runStore, planStore: state.planStore,
      planDependencies: { domains: async () => program(), callers: async () => [] },
    });
    let stdout = '';
    const exit = await runTestsCommand(['plan', '--repo', repo, '--analysis', analysisPath, '--json'], {
      cwd: repo,
      stdout: (text) => { stdout += text; },
      stderr: () => undefined,
      readStdin: () => '',
    }, operations);
    expect(exit).toBe(4);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'blocked_by_domain', targets: [] });
  });

  it('is identical for identical facts after removing planId', async () => {
    const create = async () => {
      const root = mkdtempSync(join(tmpdir(), 'augur-plan-deterministic-'));
      const repo = join(root, 'repo');
      repository(repo);
      const result = await plan({ repoPath: repo, source: { type: 'pr', analysis: analysis() } }, {
        ...stores(root),
        domains: async () => program(),
        callers: async () => [],
      });
      const stable: Partial<typeof result> = structuredClone(result);
      delete stable.planId;
      return stable;
    };
    expect(await create()).toEqual(await create());
  });

  it('drops assurance targets already covered by an active registered test', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-plan-covered-'));
    const repo = join(root, 'repo');
    repository(repo, [record({ anchors: ['anchor-a'], domains: { business: ['feature'], program: ['domain-logic:src'] } })]);
    const result = await plan({ repoPath: repo, source: { type: 'pr', analysis: analysis() } }, {
      ...stores(root), domains: async () => program(), callers: async () => [],
    });
    expect(result.targets).toEqual([]);
    expect(result.dropped.map((item) => item.reason)).toEqual(['covered']);
  });

  it('creates regression targets only when PR facts contain bug-fix evidence', async () => {
    const create = async (fixture: ReturnType<typeof analysis>) => {
      const root = mkdtempSync(join(tmpdir(), 'augur-plan-regression-'));
      const repo = join(root, 'repo');
      repository(repo);
      return await plan({ repoPath: repo, source: { type: 'pr', analysis: fixture } }, {
        ...stores(root), domains: async () => program(), callers: async () => [],
      });
    };
    expect((await create(analysis())).targets.map((target) => target.kind)).toEqual(['assurance']);
    expect((await create(analysis({ title: 'Fix calculation bug' }))).targets.map((target) => target.kind).sort()).toEqual(['assurance', 'regression']);
    expect((await create(analysis({ unrelated: { description: 'incident response documentation' } }))).targets.map((target) => target.kind))
      .toEqual(['assurance']);
  });

  it('routes experience goals through createPlan and emits guardrail targets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-plan-guardrail-'));
    const repo = join(root, 'repo');
    repository(repo);
    const fixture = analysis({
      experienceGoals: [{ quality: 'responsiveness', targets: [{ metric: 'api_latency', threshold: 20, unit: 'ms' }] }],
    });
    const result = await plan({ repoPath: repo, source: { type: 'pr', analysis: fixture } }, {
      ...stores(root), domains: async () => program(), callers: async () => [],
    });
    expect(result.targets.map((item) => item.kind)).toContain('guardrail');
    expect(result.targets.find((item) => item.kind === 'guardrail')?.brief.mustAssert.join(' ')).toContain('api_latency');
  });

  it('places a target in the nearest existing same-program-domain test and builds a complete brief', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-plan-placement-'));
    const repo = join(root, 'repo');
    const near = record({
      id: 't-near',
      file: 'src/example.test.ts',
      name: 'near exemplar',
      anchors: [],
      domains: { business: ['feature'], program: ['domain-logic:src'] },
    });
    const far = record({
      id: 't-far',
      file: 'test/example.test.ts',
      name: 'far exemplar',
      anchors: [],
      domains: { business: ['feature'], program: ['domain-logic:src'] },
    });
    repository(repo, [near, far]);
    writeFileSync(join(repo, 'src', 'example.test.ts'), 'describe("near", () => {});\n', 'utf8');
    const result = await plan({ repoPath: repo, source: { type: 'pr', analysis: analysis() } }, {
      ...stores(root),
      domains: async () => program([{ moduleId: 'src', layer: 'domain-logic', files: ['src/example.ts', 'src/example.test.ts', 'test/example.test.ts'] }]),
      callers: async () => [],
    });
    const target = result.targets[0]!;
    expect(target.file).toBe('src/example.test.ts');
    expect(target.domains.program).toEqual(['domain-logic:src']);
    expect(target.brief.exemplars).toEqual([
      { file: 'src/example.test.ts', name: 'near exemplar' },
      { file: 'test/example.test.ts', name: 'far exemplar' },
    ]);
    expect(target.brief.mustAssert.join(' ')).toContain('calculate');
    expect(target.brief.mustNot).toEqual(['network', 'real database', 'sleep']);
  });
});

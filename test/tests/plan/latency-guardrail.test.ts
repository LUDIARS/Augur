import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerTarget } from '../../../src/tests/author/write.ts';
import type { ElegantiaSource } from '../../../src/tests/latency/elegantia.ts';
import { plan } from '../../../src/tests/plan/plan.ts';
import { loadRegistry } from '../../../src/tests/registry.ts';
import { createReport, formatReportText } from '../../../src/tests/report.ts';
import type { TestPlan } from '../../../src/tests/types.ts';
import { record, runRecord } from '../fixtures.ts';
import { analysis, program, repository, stores } from './fixtures.ts';

const DEFAULT_KEY = 'guardrail:latency:api_latency:p95:<=1000ms:*';
const latency = { metric: 'api_latency', threshold: 1000, unit: 'ms', percentile: 95, scope: '*' };

const routeGraph = {
  entries: [{
    id: 'anchor-a',
    classes: ['http-route'],
    symbol: { anchor: 'anchor-a', name: 'calculate', path: 'src/example.ts', line: 1 },
    reasons: ['GET /v1/calc → calculate() in src/example.ts'],
  }],
};

const elegantiaOk: ElegantiaSource = {
  status: 'ok',
  baseUrl: 'http://127.0.0.1:17860',
  items: [
    { id: 'AP01', augur: latency },
    { id: 'AP02', augur: latency },
    { id: 'AP03', augur: null },
    { id: 'AP-G-0123456789ab', augur: { metric: 'api_latency', threshold: 300, unit: 'ms', percentile: 95, scope: '/v1/calc' } },
  ],
};

async function planFor(dependencies: Record<string, unknown>, records = [] as ReturnType<typeof record>[]) {
  const root = mkdtempSync(join(tmpdir(), 'augur-plan-latency-'));
  const repo = join(root, 'repo');
  repository(repo, records);
  const result = await plan({ repoPath: repo, source: { type: 'pr', analysis: analysis() } }, {
    ...stores(root),
    domains: async () => program(),
    callers: async () => [],
    ...dependencies,
  });
  return { repo, result };
}

function latencyTargets(result: TestPlan) {
  return result.targets.filter((target) => target.key.startsWith('guardrail:latency:'));
}

describe('default latency guardrail', () => {
  it('plans EG-C01 api_latency p95 <= 1000ms for a Web/API service without experienceGoals, linked to Elegantia ids', async () => {
    let queried = 0;
    const { result } = await planFor({
      entrypoints: async () => routeGraph,
      services: () => [{ code: 'example', port: 4000 }],
      antipatterns: async () => { queried += 1; return elegantiaOk; },
    });
    expect(queried).toBe(1);
    const targets = latencyTargets(result);
    expect(targets.map((target) => target.key)).toEqual([DEFAULT_KEY, 'guardrail:latency:api_latency:p95:<=300ms:/v1/calc']);
    expect(targets[0]).toMatchObject({
      kind: 'guardrail',
      anchors: ['anchor-a'],
      file: 'src/example.test.ts',
      budget: { metric: 'api_latency', threshold: 1000, unit: 'ms', percentile: 95 },
      elegantiaRefs: ['AP01', 'AP02'],
    });
    expect(targets[0]!.brief.title).toBe('Guardrail: calculate api_latency p95 <= 1000ms');
    expect(targets[0]!.brief.mustAssert.join('\n')).toContain('augur tests latency');
    expect(targets[1]).toMatchObject({ elegantiaRefs: ['AP-G-0123456789ab'], budget: { threshold: 300, scope: '/v1/calc' } });
    expect(result.guardrailSources).toEqual({
      webApi: true,
      reasons: ['Anatomia http-route entries: 1', 'Excubitor catalog service example declares port 4000'],
      diagnostics: [],
      elegantia: { status: 'ok', baseUrl: 'http://127.0.0.1:17860', refs: ['AP-G-0123456789ab', 'AP01', 'AP02'] },
    });
  });

  it('plans the default guardrail only and states it when Elegantia is unreachable', async () => {
    const { result } = await planFor({
      entrypoints: async () => routeGraph,
      services: () => [],
      antipatterns: async () => ({ status: 'unreachable', baseUrl: 'http://127.0.0.1:17860', detail: 'GET http://127.0.0.1:17860/api/antipatterns failed: ECONNREFUSED' }),
    });
    const targets = latencyTargets(result);
    expect(targets.map((target) => target.key)).toEqual([DEFAULT_KEY]);
    expect(targets[0]!.elegantiaRefs).toBeUndefined();
    expect(result.guardrailSources?.elegantia).toMatchObject({ status: 'unreachable', refs: [] });
    expect(result.guardrailSources?.diagnostics).toEqual([
      'Elegantia unreachable; planned with the default latency guardrail only: GET http://127.0.0.1:17860/api/antipatterns failed: ECONNREFUSED',
    ]);
  });

  it('emits no latency guardrail and does not query Elegantia for a service without a Web/API surface', async () => {
    let queried = 0;
    const { result } = await planFor({
      entrypoints: async () => ({ entries: [] }),
      services: () => [{ code: 'worker' }],
      antipatterns: async () => { queried += 1; return elegantiaOk; },
    });
    expect(queried).toBe(0);
    expect(latencyTargets(result)).toEqual([]);
    expect(result.guardrailSources).toMatchObject({ webApi: false, elegantia: { status: 'not_queried' } });
  });

  it('treats a catalog port as Web/API even when Anatomia entrypoints fail, and records the failure', async () => {
    const { result } = await planFor({
      entrypoints: async () => { throw new Error('Anatomia CLI not found'); },
      services: () => [{ code: 'example', port: 4000 }],
      antipatterns: async () => ({ status: 'unresolved', detail: 'no fragment declares elegantia' }),
    });
    const targets = latencyTargets(result);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.brief.subject).toMatchObject({ symbol: 'calculate', file: 'src/example.ts' });
    expect(result.guardrailSources?.diagnostics[0]).toBe('Anatomia entrypoints unavailable; HTTP routes not detected: Anatomia CLI not found');
  });

  it('drops the guardrail as covered when the registry already holds it for the same budget', async () => {
    const existing = record({
      kind: 'guardrail',
      status: 'active',
      domains: { business: [], program: ['domain-logic:src'] },
      tags: ['latency:api_latency:p95:<=1000ms:*'],
    });
    const { result } = await planFor({
      entrypoints: async () => routeGraph,
      services: () => [],
      antipatterns: async () => ({ status: 'unresolved', detail: 'test' }),
    }, [existing]);
    expect(latencyTargets(result)).toEqual([]);
    expect(result.dropped.find((item) => item.target.key === DEFAULT_KEY)?.reason).toBe('covered');
  });

  it('registers elegantiaRefs and the budget tag in the ledger, and reports the refs', async () => {
    const { repo, result } = await planFor({
      entrypoints: async () => routeGraph,
      services: () => [],
      antipatterns: async () => elegantiaOk,
    });
    const target = latencyTargets(result)[0]!;
    const saved = registerTarget({ repoPath: repo, plan: result, target, authoredBy: 'session', now: '2026-10-17T00:00:00.000Z' });
    expect(saved).toMatchObject({ elegantiaRefs: ['AP01', 'AP02'], tags: ['latency:api_latency:p95:<=1000ms:*'] });
    expect(loadRegistry(repo).find((item) => item.id === saved.id)?.elegantiaRefs).toEqual(['AP01', 'AP02']);

    const run = runRecord({
      bundle: { kind: 'ids', selector: saved.id, testIds: [saved.id], reason: {} },
      results: [{ testId: saved.id, status: 'failed', durationMs: 5, failureMessage: 'p95 1500ms exceeds 1000ms' }],
    });
    expect(formatReportText(createReport(run, [saved]))).toContain(`${saved.id} ${saved.name} [AP01, AP02] (5ms)`);
  });
});

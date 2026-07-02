import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app.ts';
import { planResponseSchema } from '../../src/schema/index.ts';

// API tests per spec/interface/http-api.md and the test strategy, using
// Fastify's inject() — in-process, no port.

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /v1/health', () => {
  it('returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /v1/plans', () => {
  it('returns a schema-valid plan for the documented example request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/plans',
      payload: {
        objective: {
          kind: 'bug_fix',
          description: 'Fix search returning stale results after clearing the query.',
          desiredOutcome: 'Search results should reset when query is empty.',
        },
        project: { name: 'example-web', domain: 'web', language: 'typescript', frameworks: ['react', 'vite'], testRunners: ['vitest', 'playwright'] },
        change: { changedFiles: ['src/search.ts', 'src/search.test.ts'] },
        failure: { command: 'npm run test', exitCode: 1, stderr: 'expected [] to equal [...]' },
      },
    });
    expect(response.statusCode).toBe(200);
    const plan = planResponseSchema.parse(response.json());
    expect(plan.testPlan.suggestions.length).toBeGreaterThan(0);
    expect(plan.fixPolicy.strategy).toBe('test_first');
  });

  it('returns the documented 400 envelope when objective.description is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/plans',
      payload: { objective: { kind: 'bug_fix' } },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('objective.description');
  });

  it('rejects an invalid objective kind with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/plans',
      payload: { objective: { kind: 'yolo', description: 'x' } },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('invalid_request');
  });

  it('rejects a missing body with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/plans',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

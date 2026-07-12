import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { planResponseSchema } from '../../src/schema/index.ts';

// API tests per spec/interface/http-api.md and the test strategy, using
// Hono's app.request() — in-process, no port.

const app = createApp();

async function postPlans(body: string): Promise<Response> {
  return await app.request('/v1/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('GET /v1/health', () => {
  it('returns ok', async () => {
    const response = await app.request('/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /v1/plans', () => {
  it('returns a schema-valid plan for the documented example request', async () => {
    const response = await postPlans(
      JSON.stringify({
        objective: {
          kind: 'bug_fix',
          description: 'Fix search returning stale results after clearing the query.',
          desiredOutcome: 'Search results should reset when query is empty.',
        },
        project: { name: 'example-web', domain: 'web', language: 'typescript', frameworks: ['react', 'vite'], testRunners: ['vitest', 'playwright'] },
        change: { changedFiles: ['src/search.ts', 'src/search.test.ts'] },
        failure: { command: 'npm run test', exitCode: 1, stderr: 'expected [] to equal [...]' },
      }),
    );
    expect(response.status).toBe(200);
    const plan = planResponseSchema.parse(await response.json());
    expect(plan.testPlan.suggestions.length).toBeGreaterThan(0);
    expect(plan.fixPolicy.strategy).toBe('test_first');
  });

  it('returns the documented 400 envelope when objective.description is missing', async () => {
    const response = await postPlans(JSON.stringify({ objective: { kind: 'bug_fix' } }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('objective.description');
  });

  it('rejects an invalid objective kind with 400', async () => {
    const response = await postPlans(JSON.stringify({ objective: { kind: 'yolo', description: 'x' } }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
  });

  it('rejects a missing body with 400', async () => {
    const response = await postPlans(JSON.stringify({}));
    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with the documented envelope', async () => {
    const response = await postPlans('{');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'Request body must be valid JSON' },
    });
  });
});

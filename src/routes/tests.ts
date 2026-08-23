import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createRunId } from '../tests/run.ts';
import { bundleKindSchema, verdictSchema } from '../tests/types.ts';
import {
  createTestOperations,
  NotImplementedOperationError,
  type DefaultTestOperations,
  type TestOperations,
} from '../operations/tests.ts';
import { formatReportMarkdown } from '../tests/report.ts';
import { invalidRequest, validationMessage } from './errors.ts';

const repositoryFields = {
  repository: z.string().optional(),
  repoPath: z.string().optional(),
};

const runInputSchema = z.object({
  ...repositoryFields,
  bundle: z.union([
    z.string(),
    z.object({ kind: bundleKindSchema, selector: z.string().nullable().optional() }).strict(),
  ]),
  head: z.string().optional(),
  bus: z.string().optional(),
  cached: z.boolean().optional(),
}).strict().refine((value) => value.repository !== undefined || value.repoPath !== undefined, {
  message: 'repository or repoPath is required',
});

interface ActiveRun { runId: string; promise: Promise<unknown> }

export function createTestsRoute(operations: TestOperations & Partial<Pick<DefaultTestOperations, 'resolveRepo'>> = createTestOperations()): Hono {
  const route = new Hono();
  let activeRun: ActiveRun | undefined;

  // Keep this registration order aligned with spec/interface/tests-api.md §2.
  // GET /v1/tests
  // GET /v1/tests/catalog
  // POST /v1/tests/plans
  // GET /v1/tests/plans/:planId
  // POST /v1/tests/plans/:planId/author
  // POST /v1/tests/runs
  // GET /v1/tests/runs
  // GET /v1/tests/runs/:runId
  // GET /v1/tests/runs/:runId/report
  // POST /v1/tests/runs/:runId/verdict
  // POST /v1/tests/runs/:runId/flag
  // GET /v1/tests/:testId (registered last)
  route.get('/tests', async (c) => {
    const repoPath = resolveQueryRepo(c, operations);
    return c.json(await operations.listTests({
      repoPath,
      ...(query(c, 'domain') === undefined ? {} : { domain: query(c, 'domain')! }),
      ...(query(c, 'kind') === undefined ? {} : { kind: query(c, 'kind')! }),
      ...(query(c, 'status') === undefined ? {} : { status: query(c, 'status')! }),
    }));
  });

  route.get('/tests/catalog', async (c) => c.json(await operations.catalog({ repoPath: resolveQueryRepo(c, operations) })));

  route.post('/tests/plans', async (c) => {
    if (!writeAllowed(c)) return forbidden(c);
    const body = await jsonBody(c);
    const parsed = z.object({ ...repositoryFields, source: z.unknown() }).strict().refine(
      (value) => value.repository !== undefined || value.repoPath !== undefined,
      { message: 'repository or repoPath is required' },
    ).safeParse(body);
    if (!parsed.success) return invalidRequest(c, validationMessage(parsed.error));
    return c.json(await operations.plan({
      ...(parsed.data.repository === undefined ? {} : { repository: parsed.data.repository }),
      ...(parsed.data.repoPath === undefined ? {} : { repoPath: parsed.data.repoPath }),
      source: parsed.data.source,
    }), 201);
  });

  route.get('/tests/plans/:planId', () => {
    throw new NotImplementedOperationError('not implemented in this build (Phase T2)');
  });

  route.post('/tests/plans/:planId/author', async (c) => {
    if (!writeAllowed(c)) return forbidden(c);
    const body = await jsonBody(c);
    const parsed = z.object({
      ...repositoryFields,
      author: z.enum(['session', 'claude-cli']),
      bus: z.string().optional(),
    }).strict().refine(
      (value) => value.repository !== undefined || value.repoPath !== undefined,
      { message: 'repository or repoPath is required' },
    ).safeParse(body);
    if (!parsed.success) return invalidRequest(c, validationMessage(parsed.error));
    return c.json(await operations.author({
      planId: c.req.param('planId'),
      repoPath: resolveOperationRepo(parsed.data, operations),
      author: parsed.data.author,
      ...(parsed.data.bus === undefined ? {} : { bus: parsed.data.bus }),
    }));
  });

  route.post('/tests/runs', async (c) => {
    if (!writeAllowed(c)) return forbidden(c);
    if (activeRun !== undefined) {
      return c.json({
        code: 'run_in_progress',
        runId: activeRun.runId,
        error: { code: 'run_in_progress', message: 'A test run is already in progress', details: { runId: activeRun.runId } },
      }, 409);
    }
    const body = await jsonBody(c);
    const parsed = runInputSchema.safeParse(body);
    if (!parsed.success) return invalidRequest(c, validationMessage(parsed.error));
    const runId = createRunId();
    const promise = operations.run({ ...parsed.data, runId });
    activeRun = { runId, promise };
    void promise.finally(() => {
      if (activeRun?.promise === promise) activeRun = undefined;
    }).catch(() => undefined);
    if (c.req.query('async') === '1') return c.json({ runId }, 202);
    return c.json(await promise, 201);
  });

  route.get('/tests/runs', async (c) => c.json(await operations.listRuns({
    ...(query(c, 'repository') === undefined ? {} : { repository: query(c, 'repository')! }),
    ...(query(c, 'head') === undefined ? {} : { headSha: query(c, 'head')! }),
    ...(query(c, 'since') === undefined ? {} : { since: query(c, 'since')! }),
    ...(query(c, 'status') === undefined ? {} : { status: query(c, 'status') as 'passed' }),
  })));

  route.get('/tests/runs/:runId', async (c) => {
    const runId = c.req.param('runId');
    if (activeRun?.runId === runId) return c.json({ runId, status: 'running' }, 202);
    const run = (await operations.listRuns({})).find((candidate) => candidate.runId === runId);
    if (run === undefined) return c.json({ error: { code: 'not_found', message: `run not found: ${runId}` } }, 404);
    return c.json(run);
  });

  route.get('/tests/runs/:runId/report', async (c) => {
    const report = await operations.report(c.req.param('runId'));
    return c.req.query('format') === 'markdown' ? c.text(formatReportMarkdown(report)) : c.json(report);
  });

  route.post('/tests/runs/:runId/verdict', async (c) => {
    if (!writeAllowed(c)) return forbidden(c);
    const parsed = verdictSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return invalidRequest(c, validationMessage(parsed.error));
    return c.json(await operations.verdict(c.req.param('runId'), parsed.data));
  });

  route.post('/tests/runs/:runId/flag', async (c) => {
    if (!writeAllowed(c)) return forbidden(c);
    const parsed = z.object({ pullRequestId: z.string().min(1) }).strict().safeParse(await jsonBody(c));
    if (!parsed.success) return invalidRequest(c, validationMessage(parsed.error));
    return c.json(await operations.flag(c.req.param('runId'), parsed.data));
  });

  // Dynamic test id route must remain last.
  route.get('/tests/:testId', async (c) => c.json(await operations.getTest({
    repoPath: resolveQueryRepo(c, operations),
    testId: c.req.param('testId'),
  })));

  return route;
}

function resolveQueryRepo(c: Context, operations: TestOperations & Partial<Pick<DefaultTestOperations, 'resolveRepo'>>): string {
  return resolveOperationRepo({
    ...(c.req.query('repository') === undefined ? {} : { repository: c.req.query('repository') }),
    ...(c.req.query('repoPath') === undefined ? {} : { repoPath: c.req.query('repoPath') }),
  }, operations);
}

function resolveOperationRepo(
  input: { repository?: string | undefined; repoPath?: string | undefined },
  operations: TestOperations & Partial<Pick<DefaultTestOperations, 'resolveRepo'>>,
): string {
  if (operations.resolveRepo !== undefined) return operations.resolveRepo(input);
  if (input.repoPath !== undefined) return input.repoPath;
  throw new Error('repository resolution is not available');
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function query(c: Context, name: string): string | undefined {
  const value = c.req.query(name);
  return value === '' || value === undefined ? undefined : value;
}

function writeAllowed(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
  return forwarded === undefined || isLoopback(forwarded);
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === 'localhost' || address.startsWith('127.');
}

function forbidden(c: Context): Response {
  return c.json({ error: { code: 'forbidden', message: 'Write operations are loopback-only' } }, 403);
}

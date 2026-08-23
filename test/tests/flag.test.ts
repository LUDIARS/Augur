import { createServer, type RequestListener } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { runTestsCommand } from '../../src/cli/tests/index.ts';
import { createTestOperations } from '../../src/operations/tests.ts';
import { JsonlRunStore } from '../../src/tests/run-store.ts';
import { augurConfig, makeRepository, runRecord } from './fixtures.ts';

const openServers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => await new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Revisor verification flag client', () => {
  it('maps a non-JSON route 404 to not_supported and exit 0', async () => {
    const result = await flagCase((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not Found');
    });
    expect(result.exit).toBe(0);
    expect(result.output).toMatchObject({ outcome: 'not_supported' });
  });

  it('maps JSON not_found 404 to rejected and exit 1', async () => {
    const result = await flagCase((_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'not_found', message: 'PR not found' } }));
    });
    expect(result.exit).toBe(1);
    expect(result.output).toMatchObject({ outcome: 'rejected' });
  });

  it('maps a head mismatch 409 to rejected and exit 1', async () => {
    const result = await flagCase((_request, response) => {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'head_mismatch' }, headSha: 'b'.repeat(40) }));
    });
    expect(result.exit).toBe(1);
    expect(result.output).toMatchObject({ outcome: 'rejected' });
  });

  it('exits 1 without sending when the verdict is missing', async () => {
    let requests = 0;
    const server = await listen((_request, response) => {
      requests += 1;
      response.end('{}');
    });
    const setup = await operationsFor(server.url, false);
    const result = await invokeFlag(setup.operations, setup.runId);
    expect(result.exit).toBe(1);
    expect(requests).toBe(0);
  });
});

async function flagCase(handler: RequestListener): Promise<{ exit: number; output: Record<string, unknown> }> {
  const server = await listen(handler);
  const setup = await operationsFor(server.url, true);
  return await invokeFlag(setup.operations, setup.runId);
}

async function operationsFor(baseUrl: string, withVerdict: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'augur-flag-'));
  const repo = join(root, 'repo');
  makeRepository(repo);
  const store = new JsonlRunStore(join(root, 'runs.jsonl'), { retentionDays: 30, maxRunsPerRepository: 20 });
  const run = runRecord({
    repoPath: repo,
    ...(withVerdict ? { verdict: { decision: 'accept' as const, by: 'session:test', at: '2026-08-23T00:01:00.000Z' } } : {}),
  });
  await store.put(run);
  return {
    runId: run.runId,
    operations: createTestOperations({ config: augurConfig(root, repo), store, flag: { baseUrl } }),
  };
}

async function invokeFlag(operations: ReturnType<typeof createTestOperations>, runId: string) {
  let stdout = '';
  let stderr = '';
  const exit = await runTestsCommand(['flag', runId, '--pr', 'local-pr-id', '--json'], {
    cwd: process.cwd(),
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    readStdin: () => '',
  }, operations);
  return { exit, output: stdout === '' ? { stderr } : JSON.parse(stdout) as Record<string, unknown> };
}

async function listen(handler: RequestListener): Promise<{ url: string }> {
  const server = createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}` };
}

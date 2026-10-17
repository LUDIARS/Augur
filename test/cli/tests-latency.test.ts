import { describe, expect, it } from 'vitest';
import { parseArgv } from '../../src/cli/args.ts';
import { createLatencyCommand } from '../../src/cli/tests/latency.ts';
import type { ProbeFetch } from '../../src/tests/latency/measure.ts';

const graph = {
  entries: [
    { id: 'a1', classes: ['http-route'], symbol: { anchor: 'a1', name: 'health', path: 'src/server.ts', line: 1 }, reasons: ['GET /v1/health → health() in src/server.ts'] },
    { id: 'a2', classes: ['http-route'], symbol: { anchor: 'a2', name: 'admin', path: 'src/server.ts', line: 2 }, reasons: ['GET /v1/admin → admin() in src/server.ts'] },
    { id: 'a3', classes: ['http-route'], symbol: { anchor: 'a3', name: 'create', path: 'src/server.ts', line: 3 }, reasons: ['POST /v1/items → create() in src/server.ts'] },
  ],
};

function harness(latencyMs: number) {
  let clock = 0;
  const urls: string[] = [];
  const fetch: ProbeFetch = async (url) => {
    urls.push(url);
    clock += latencyMs;
    return { status: url.endsWith('/v1/admin') ? 403 : 200, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, now: () => clock, urls };
}

async function run(argv: string[], latencyMs: number, services = [{ code: 'example', port: 4321 }]) {
  const probe = harness(latencyMs);
  let stdout = '';
  const command = createLatencyCommand({ entrypoints: async () => graph, services: () => services, fetch: probe.fetch, now: probe.now });
  const exit = await command({
    args: parseArgv(['latency', ...argv]),
    io: { cwd: '/repo', stdout: (text) => { stdout += text; }, stderr: () => undefined, readStdin: () => '' },
  });
  return { exit, stdout, urls: probe.urls };
}

describe('augur tests latency', () => {
  it('measures argument-free GET routes at the catalog port and exits 0 within budget', async () => {
    const { exit, stdout, urls } = await run(['--iterations', '5'], 30);
    expect(exit).toBe(0);
    expect(urls.filter((url) => url === 'http://127.0.0.1:4321/v1/health')).toHaveLength(5);
    expect(urls.some((url) => url.endsWith('/v1/items'))).toBe(false);
    expect(stdout).toContain('✔ GET /v1/health (health) p95 30ms');
    expect(stdout).toContain('– GET /v1/admin (admin) — requires authentication (HTTP 403)');
    expect(stdout).toContain('– POST /v1/items (create) — POST route; only GET routes are measured');
  });

  it('exits 1 with the failing route when p95 exceeds the threshold', async () => {
    const { exit, stdout } = await run(['--json'], 1200);
    expect(exit).toBe(1);
    const report = JSON.parse(stdout) as { status: string; service: string; iterations: number; routes: Array<{ path: string; status: string; reason?: string }> };
    expect(report).toMatchObject({ status: 'failed', service: 'example', iterations: 20 });
    expect(report.routes.find((route) => route.path === '/v1/health')).toMatchObject({ status: 'failed', reason: 'p95 1200ms exceeds 1000ms' });
  });

  it('honours --threshold', async () => {
    expect((await run(['--threshold', '10', '--iterations', '2'], 30)).exit).toBe(1);
  });

  it('refuses to guess a service when the fragment has none or several with ports', async () => {
    await expect(run([], 1, [])).rejects.toThrow('declares no service with a port');
    await expect(run([], 1, [{ code: 'a', port: 1 }, { code: 'b', port: 2 }])).rejects.toThrow('choose one with --service');
    expect((await run(['--service', 'b', '--iterations', '1'], 1, [{ code: 'a', port: 1 }, { code: 'b', port: 2 }])).exit).toBe(0);
  });
});

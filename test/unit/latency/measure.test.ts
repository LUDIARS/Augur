import { describe, expect, it } from 'vitest';
import { judgeProbe, measureLatency, percentile, type ProbeFetch } from '../../../src/tests/latency/measure.ts';
import type { HttpRoute } from '../../../src/tests/latency/routes.ts';

function route(path: string, symbol = path.replace(/\W/g, '') || 'root'): HttpRoute & { method: string; path: string } {
  return { anchor: `a-${symbol}`, symbol, file: 'src/server.ts', line: 1, method: 'GET', path };
}

/** A clock that advances by the per-path latency on every response. */
function scripted(latencyMs: Record<string, number>, status: Record<string, number> = {}) {
  let clock = 0;
  const calls: string[] = [];
  const fetch: ProbeFetch = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    clock += latencyMs[path] ?? 1;
    return { status: status[path] ?? 200, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, now: () => clock, calls };
}

describe('percentile', () => {
  it('uses nearest rank', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(samples, 95)).toBe(19);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });

  it('rejects empty samples', () => {
    expect(() => percentile([], 95)).toThrow('no samples');
  });
});

describe('judgeProbe', () => {
  it('passes at the threshold and fails above it', () => {
    expect(judgeProbe(Array(20).fill(1000), 1000)).toEqual({ status: 'passed', p95Ms: 1000 });
    expect(judgeProbe(Array(20).fill(1001), 1000)).toEqual({ status: 'failed', p95Ms: 1001 });
  });
});

describe('measureLatency', () => {
  it('requests each probe N times and fails a route whose p95 exceeds the budget', async () => {
    const clock = scripted({ '/fast': 20, '/slow': 1500 });
    const report = await measureLatency({
      baseUrl: 'http://127.0.0.1:4000/',
      selection: { probes: [route('/slow'), route('/fast')], skipped: [] },
      fetch: clock.fetch,
      now: clock.now,
    });
    expect(clock.calls.filter((path) => path === '/fast')).toHaveLength(20);
    expect(report.status).toBe('failed');
    expect(report.routes.map((item) => [item.path, item.status, item.p95Ms])).toEqual([
      ['/fast', 'passed', 20],
      ['/slow', 'failed', 1500],
    ]);
    expect(report.routes[1]!.reason).toBe('p95 1500ms exceeds 1000ms');
    expect(report.summary).toEqual({ measured: 2, passed: 1, failed: 1, skipped: 0, error: 0 });
  });

  it('skips routes that require authentication and records the reason', async () => {
    const clock = scripted({}, { '/admin': 401 });
    const report = await measureLatency({
      baseUrl: 'http://127.0.0.1:4000',
      selection: { probes: [route('/admin'), route('/health')], skipped: [] },
      iterations: 3,
      fetch: clock.fetch,
      now: clock.now,
    });
    expect(clock.calls.filter((path) => path === '/admin')).toHaveLength(1);
    expect(report.routes.find((item) => item.path === '/admin')).toMatchObject({ status: 'skipped', reason: 'requires authentication (HTTP 401)' });
    expect(report.status).toBe('passed');
  });

  it('carries planned skips (non-GET, arguments) into the report', async () => {
    const clock = scripted({});
    const report = await measureLatency({
      baseUrl: 'http://127.0.0.1:4000',
      selection: { probes: [], skipped: [{ route: { ...route('/items'), method: 'POST' }, reason: 'POST route; only GET routes are measured' }] },
      fetch: clock.fetch,
      now: clock.now,
    });
    expect(report.status).toBe('empty');
    expect(report.routes).toEqual([
      expect.objectContaining({ method: 'POST', path: '/items', status: 'skipped', reason: 'POST route; only GET routes are measured' }),
    ]);
  });

  it('reports server errors and network failures as errors, not passes', async () => {
    const clock = scripted({}, { '/boom': 503 });
    const report = await measureLatency({
      baseUrl: 'http://127.0.0.1:4000',
      selection: { probes: [route('/boom')], skipped: [] },
      fetch: clock.fetch,
      now: clock.now,
    });
    expect(report.status).toBe('error');
    expect(report.routes[0]).toMatchObject({ status: 'error', reason: 'GET /boom returned HTTP 503' });

    const offline = await measureLatency({
      baseUrl: 'http://127.0.0.1:4000',
      selection: { probes: [route('/x')], skipped: [] },
      fetch: async () => { throw new Error('ECONNREFUSED'); },
    });
    expect(offline.routes[0]).toMatchObject({ status: 'error', reason: 'GET /x failed: ECONNREFUSED' });
  });
});

import type { RouteSelection, RouteSkip } from './routes.ts';
import { contract } from '../../../templates/contract-runtime/contract-runtime.ts'; /* augur-inject:import:571ed6f9 */
import augurContract_9e486962 from '../../../contracts/latency-percentile.contract.ts'; /* augur-inject:contract-predicate:3757d930 */
import augurContract_0b2da856 from '../../../contracts/latency-judge.contract.ts'; /* augur-inject:contract-predicate:2bc00819 */

// The latency runner's measurement core. Each argument-free GET route is
// requested N times in sequence against the catalog-resolved base URL; the
// nearest-rank p95 is compared with the threshold. A route answering 401/403
// is skipped as "requires authentication" (Augur holds no credentials), and a
// route that cannot be measured is an error, never a silent pass.

export const DEFAULT_ITERATIONS = 20;
export const DEFAULT_THRESHOLD_MS = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export type ProbeFetch = (url: string, init: { method: 'GET'; signal: AbortSignal }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface LatencyRouteResult {
  method: string;
  path: string;
  symbol: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  samples: number;
  p95Ms?: number;
  maxMs?: number;
  reason?: string;
}

export interface LatencyReport {
  baseUrl: string;
  iterations: number;
  thresholdMs: number;
  percentile: 95;
  status: 'passed' | 'failed' | 'error' | 'empty';
  routes: LatencyRouteResult[];
  summary: { measured: number; passed: number; failed: number; skipped: number; error: number };
}

export interface MeasureInput {
  baseUrl: string;
  selection: RouteSelection;
  iterations?: number;
  thresholdMs?: number;
  requestTimeoutMs?: number;
  fetch?: ProbeFetch;
  now?: () => number;
}

/** Nearest-rank percentile: the smallest observed sample with at least p% of samples at or below it. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('percentile of no samples');
  if (!(p > 0 && p <= 100)) throw new Error(`percentile out of range: ${p}`);
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
// @ts-expect-error augur-inject
percentile = contract(percentile, { ...augurContract_9e486962, contractId: 'C-LG-3', mode: 'observe', sample: 1, where: 'src/tests/latency/measure.ts:48', rule: 'contract-wrap', id: '9e486962' }); /* augur-inject:contract-wrap:9e486962 */

export function judgeProbe(samples: readonly number[], thresholdMs: number): { status: 'passed' | 'failed'; p95Ms: number } {
  const p95Ms = percentile(samples, 95);
  return { status: p95Ms > thresholdMs ? 'failed' : 'passed', p95Ms };
}
// @ts-expect-error augur-inject
judgeProbe = contract(judgeProbe, { ...augurContract_0b2da856, contractId: 'C-LG-4', mode: 'observe', sample: 1, where: 'src/tests/latency/measure.ts:55', rule: 'contract-wrap', id: '0b2da856' }); /* augur-inject:contract-wrap:0b2da856 */

export async function measureLatency(input: MeasureInput): Promise<LatencyReport> {
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const thresholdMs = input.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error(`iterations must be a positive integer: ${iterations}`);
  const fetchImpl = input.fetch ?? (fetch as unknown as ProbeFetch);
  const now = input.now ?? (() => performance.now());
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const routes: LatencyRouteResult[] = input.selection.skipped.map(skippedResult);

  for (const probe of input.selection.probes) {
    const base = { method: probe.method, path: probe.path, symbol: probe.symbol, file: probe.file };
    const samples: number[] = [];
    let outcome: Pick<LatencyRouteResult, 'status' | 'reason'> | undefined;
    for (let index = 0; index < iterations && outcome === undefined; index += 1) {
      const started = now();
      let status: number;
      try {
        status = await request(fetchImpl, `${baseUrl}${probe.path}`, input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      } catch (error) {
        outcome = { status: 'error', reason: `GET ${probe.path} failed: ${error instanceof Error ? error.message : String(error)}` };
        break;
      }
      const elapsed = now() - started;
      if (status === 401 || status === 403) outcome = { status: 'skipped', reason: `requires authentication (HTTP ${status})` };
      else if (status >= 500) outcome = { status: 'error', reason: `GET ${probe.path} returned HTTP ${status}` };
      else samples.push(elapsed);
    }
    if (outcome !== undefined) {
      routes.push({ ...base, ...outcome, samples: samples.length });
      continue;
    }
    const verdict = judgeProbe(samples, thresholdMs);
    routes.push({
      ...base,
      status: verdict.status,
      samples: samples.length,
      p95Ms: round(verdict.p95Ms),
      maxMs: round(Math.max(...samples)),
      ...(verdict.status === 'failed' ? { reason: `p95 ${round(verdict.p95Ms)}ms exceeds ${thresholdMs}ms` } : {}),
    });
  }

  routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.symbol.localeCompare(right.symbol));
  const summary = {
    measured: routes.filter((route) => route.status === 'passed' || route.status === 'failed').length,
    passed: routes.filter((route) => route.status === 'passed').length,
    failed: routes.filter((route) => route.status === 'failed').length,
    skipped: routes.filter((route) => route.status === 'skipped').length,
    error: routes.filter((route) => route.status === 'error').length,
  };
  const status = summary.failed > 0 ? 'failed' : summary.error > 0 ? 'error' : summary.measured === 0 ? 'empty' : 'passed';
  return { baseUrl, iterations, thresholdMs, percentile: 95, status, routes, summary };
}

async function request(fetchImpl: ProbeFetch, url: string, timeoutMs: number): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    // Latency is time to the full body, as a caller experiences it.
    await response.arrayBuffer();
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

function skippedResult(skip: RouteSkip): LatencyRouteResult {
  return {
    method: skip.route.method ?? '?',
    path: skip.route.path ?? `(${skip.route.symbol})`,
    symbol: skip.route.symbol,
    file: skip.route.file,
    status: 'skipped',
    samples: 0,
    reason: skip.reason,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

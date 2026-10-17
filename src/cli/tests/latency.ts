import { runLatencyCheck, type LatencyCheckDependencies, type LatencyCheckResult } from '../../tests/latency/runner.ts';
import { flagValue, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

// Exit: 0 every measured route within budget, 1 a route over budget (or a
// usage error), 2 a route could not be measured, 3 nothing measurable.
const EXIT: Record<LatencyCheckResult['status'], number> = { passed: 0, failed: 1, error: 2, empty: 3 };

export function createLatencyCommand(dependencies: Partial<LatencyCheckDependencies> = {}) {
  // The verb table also passes operations; measuring a running service needs none.
  return async (context: TestCliContext): Promise<number> => {
    rejectUnknownFlags(context.args, ['--repo', '--service', '--iterations', '--threshold', '--timeout', '--json']);
    const service = flagValue(context.args, '--service');
    const iterations = positiveInteger(context, '--iterations');
    const thresholdMs = positiveInteger(context, '--threshold');
    const requestTimeoutMs = positiveInteger(context, '--timeout');
    const result = await runLatencyCheck({
      repoPath: repoPath(context),
      ...(service === undefined ? {} : { service }),
      ...(iterations === undefined ? {} : { iterations }),
      ...(thresholdMs === undefined ? {} : { thresholdMs }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    }, dependencies);
    emitJsonOrText(context, result, formatLatencyText(result));
    return EXIT[result.status];
  };
}

export const latencyCommand = createLatencyCommand();

export function formatLatencyText(result: LatencyCheckResult): string {
  const lines = [
    `Augur latency — ${result.service} ${result.baseUrl}`,
    `Budget: p${result.percentile} <= ${result.thresholdMs}ms over ${result.iterations} requests per route`,
    '',
  ];
  const mark = { passed: '✔', failed: '✘', skipped: '–', error: '!' } as const;
  for (const route of result.routes) {
    const timing = route.p95Ms === undefined ? '' : ` p95 ${route.p95Ms}ms max ${route.maxMs}ms`;
    const reason = route.reason === undefined ? '' : ` — ${route.reason}`;
    lines.push(`  ${mark[route.status]} ${route.method} ${route.path} (${route.symbol})${timing}${reason}`);
  }
  const { summary } = result;
  lines.push('', `Status: ${result.status} — ${summary.passed} passed, ${summary.failed} failed, ${summary.error} error, ${summary.skipped} skipped`);
  return `${lines.join('\n')}\n`;
}

function positiveInteger(context: TestCliContext, name: string): number | undefined {
  const raw = flagValue(context.args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new UsageError(`${name} must be a positive integer`);
  return value;
}

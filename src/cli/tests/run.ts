import type { TestOperations } from '../../operations/tests.ts';
import { parseBundle } from '../../tests/bundle.ts';
import { EmptyBundleError } from '../../tests/run.ts';
import { flagValue, hasFlag, rejectUnknownFlags, UsageError } from '../args.ts';
import { repoPath, type TestCliContext } from './common.ts';

export async function runCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--bundle', '--head', '--bus', '--cached', '--no-promote', '--for-revisor', '--json']);
  const bundle = flagValue(context.args, '--bundle');
  if (bundle === undefined) throw new UsageError('--bundle is required');
  try {
    parseBundle(bundle);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const forRevisor = hasFlag(context.args, '--for-revisor');
  try {
    const run = await operations.run({
      repoPath: repoPath(context),
      bundle,
      ...(flagValue(context.args, '--head') === undefined ? {} : { head: flagValue(context.args, '--head')! }),
      ...(flagValue(context.args, '--bus') === undefined ? {} : { bus: flagValue(context.args, '--bus')! }),
      cached: hasFlag(context.args, '--cached'),
      promote: !hasFlag(context.args, '--no-promote'),
      forRevisor,
    });
    context.io.stdout(hasFlag(context.args, '--json') ? `${JSON.stringify(run, null, 2)}\n` : formatRun(run));
    if (run.status === 'error') return 2;
    return forRevisor && run.status === 'failed' ? 1 : 0;
  } catch (error) {
    if (!(error instanceof EmptyBundleError)) throw error;
    const value = { empty: true, message: error.message };
    context.io.stdout(hasFlag(context.args, '--json') ? `${JSON.stringify(value)}\n` : 'No registered tests selected.\n');
    return forRevisor ? 0 : 3;
  }
}

function formatRun(run: Awaited<ReturnType<TestOperations['run']>>): string {
  const lines = [`Augur test run — ${run.status}`];
  for (const result of run.results) lines.push(`  ${{ passed: '✔', failed: '✘', skipped: '–', error: '!' }[result.status]} ${result.testId} ${result.durationMs}ms`);
  lines.push(`run: ${run.runId}`);
  return `${lines.join('\n')}\n`;
}

import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, requirePositional, type TestCliContext } from './common.ts';

export async function flagCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--pr', '--revisor-url', '--json']);
  const pullRequestId = flagValue(context.args, '--pr');
  if (pullRequestId === undefined) throw new UsageError('--pr is required');
  const result = await operations.flag(requirePositional(context, 0, 'runId'), { pullRequestId });
  emitJsonOrText(context, result, `revisor flag: ${result.outcome}${result.detail === undefined ? '' : ` — ${result.detail}`}\n`);
  if (result.outcome === 'ok' || result.outcome === 'not_supported') return 0;
  return result.outcome === 'rejected' ? 1 : 2;
}

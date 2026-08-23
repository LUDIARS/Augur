import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, hasFlag, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, requirePositional, type TestCliContext } from './common.ts';

export async function verdictCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--accept', '--reject', '--by', '--note', '--json']);
  const accept = hasFlag(context.args, '--accept');
  const reject = hasFlag(context.args, '--reject');
  if (accept === reject) throw new UsageError('exactly one of --accept or --reject is required');
  const by = flagValue(context.args, '--by');
  if (by === undefined) throw new UsageError('--by is required');
  const run = await operations.verdict(requirePositional(context, 0, 'runId'), {
    decision: accept ? 'accept' : 'reject',
    by,
    at: new Date().toISOString(),
    ...(flagValue(context.args, '--note') === undefined ? {} : { note: flagValue(context.args, '--note')! }),
  });
  emitJsonOrText(context, run, `verdict: ${run.verdict!.decision} by ${run.verdict!.by}\n`);
  return 0;
}

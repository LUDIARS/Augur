import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, type TestCliContext } from './common.ts';

export async function runsCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--head', '--since', '--status', '--json']);
  const status = flagValue(context.args, '--status');
  if (status !== undefined && !['passed', 'failed', 'error'].includes(status)) throw new UsageError(`invalid run status: ${status}`);
  const runs = await operations.listRuns({
    ...(flagValue(context.args, '--repo') === undefined ? {} : { repository: flagValue(context.args, '--repo')! }),
    ...(flagValue(context.args, '--head') === undefined ? {} : { headSha: flagValue(context.args, '--head')! }),
    ...(flagValue(context.args, '--since') === undefined ? {} : { since: flagValue(context.args, '--since')! }),
    ...(status === undefined ? {} : { status: status as 'passed' }),
  });
  const text = runs.map((run) => `${run.runId} ${run.status.padEnd(6)} ${run.repository} ${run.headSha}`).join('\n');
  emitJsonOrText(context, runs, text === '' ? '' : `${text}\n`);
  return 0;
}

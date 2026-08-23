import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, rejectUnknownFlags, UsageError } from '../args.ts';
import { repoPath, type TestCliContext } from './common.ts';

export async function authorCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--plan', '--author', '--before', '--bus', '--json']);
  const planId = flagValue(context.args, '--plan');
  if (planId === undefined) throw new UsageError('--plan is required');
  await operations.author({
    planId,
    repoPath: repoPath(context),
    author: (flagValue(context.args, '--author') ?? 'session') as 'session' | 'claude-cli',
    ...(flagValue(context.args, '--bus') === undefined ? {} : { bus: flagValue(context.args, '--bus')! }),
  });
  return 0;
}

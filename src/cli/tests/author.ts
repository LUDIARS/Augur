import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function authorCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--plan', '--author', '--before', '--bus', '--json']);
  const planId = flagValue(context.args, '--plan');
  if (planId === undefined) throw new UsageError('--plan is required');
  const result = await operations.author({
    planId,
    repoPath: repoPath(context),
    author: (flagValue(context.args, '--author') ?? 'session') as 'session' | 'claude-cli',
    ...(flagValue(context.args, '--bus') === undefined ? {} : { bus: flagValue(context.args, '--bus')! }),
    ...(flagValue(context.args, '--before') === undefined ? {} : { before: flagValue(context.args, '--before')! }),
  });
  emitJsonOrText(
    context,
    result,
    `author ${result.author}: ${result.authored.length} authored, ${result.failed.length} failed, ${result.briefs.length} briefs\n`,
  );
  return 0;
}

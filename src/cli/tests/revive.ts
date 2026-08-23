import type { TestOperations } from '../../operations/tests.ts';
import { rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, requirePositional, type TestCliContext } from './common.ts';

export async function reviveCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--json']);
  const test = await operations.revive({ repoPath: repoPath(context), testId: requirePositional(context, 0, 'testId') });
  emitJsonOrText(context, test, `revived ${test.id}\n`);
  return 0;
}

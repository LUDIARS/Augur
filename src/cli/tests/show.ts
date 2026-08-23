import type { TestOperations } from '../../operations/tests.ts';
import { rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, requirePositional, type TestCliContext } from './common.ts';

export async function showCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--json']);
  const result = await operations.getTest({ repoPath: repoPath(context), testId: requirePositional(context, 0, 'testId') });
  emitJsonOrText(context, result, `${result.test.id} ${result.test.name}\n${result.test.file}\nrecent runs: ${result.recentRuns.length}\n`);
  return 0;
}

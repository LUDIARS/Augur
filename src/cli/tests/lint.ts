import type { TestOperations } from '../../operations/tests.ts';
import { rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function lintCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--json']);
  const result = await operations.lint({ repoPath: repoPath(context) });
  emitJsonOrText(context, result, result.valid ? 'test registry is valid\n' : `${result.errors.join('\n')}\n`);
  return result.valid ? 0 : 1;
}

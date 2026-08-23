import type { TestOperations } from '../../operations/tests.ts';
import { hasFlag, rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function pruneCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--apply', '--json']);
  const result = await operations.prune({ repoPath: repoPath(context), apply: hasFlag(context.args, '--apply') });
  emitJsonOrText(context, result, `${result.applied ? 'Deleted' : 'Would delete'} ${result.files.length} file(s)${result.files.length ? `:\n${result.files.join('\n')}` : ''}\n`);
  return 0;
}

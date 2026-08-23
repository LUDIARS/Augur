import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, rejectUnknownFlags } from '../args.ts';
import { repoPath, type TestCliContext } from './common.ts';

export async function planCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--analyze', '--base', '--analysis', '--pr', '--incident', '--no-impact', '--json']);
  await operations.plan({
    repoPath: repoPath(context),
    source: flagValue(context.args, '--incident') === undefined
      ? { type: 'pr', base: flagValue(context.args, '--base') }
      : { type: 'incident', file: flagValue(context.args, '--incident') },
  });
  return 0;
}

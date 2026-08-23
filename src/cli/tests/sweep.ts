import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, hasFlag, rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function sweepCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--now', '--apply', '--json']);
  const result = await operations.sweep({
    repoPath: repoPath(context),
    ...(flagValue(context.args, '--now') === undefined ? {} : { now: flagValue(context.args, '--now')! }),
    apply: hasFlag(context.args, '--apply'),
  });
  const text = result.changes.map((change) => `${change.id}: ${change.from} -> ${change.to} (${change.reason})`).join('\n');
  emitJsonOrText(context, result, `${result.applied ? 'Applied' : 'Proposed'} ${result.changes.length} transition(s).${text ? `\n${text}` : ''}\n`);
  return 0;
}

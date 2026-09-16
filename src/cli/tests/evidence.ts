import type { TestOperations } from '../../operations/tests.ts';
import { hasFlag, rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, requirePositional, type TestCliContext } from './common.ts';

export async function evidenceCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--dry-run', '--json']);
  const result = await operations.evidence({
    runId: requirePositional(context, 0, 'runId'),
    repoPath: repoPath(context),
    dryRun: hasFlag(context.args, '--dry-run'),
  });
  const planned = result.dryRun ? `\n${result.planned.map((item) => JSON.stringify(item.body)).join('\n')}\n` : '';
  const unresolved = result.unresolvedUxRefs.length === 0 ? '' : ` (${result.unresolvedUxRefs.join(', ')})`;
  emitJsonOrText(context, result, `evidence: ${result.registered} registered, ${result.skipped} already registered, ${result.unresolvedUxRefs.length} unresolved${unresolved}, ${result.failed.length} failed${planned}`);
  return result.failed.length === 0 ? 0 : 1;
}

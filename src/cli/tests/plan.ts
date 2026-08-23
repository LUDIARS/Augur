import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, hasFlag, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function planCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--analyze', '--base', '--analysis', '--pr', '--incident', '--no-impact', '--json']);
  const incident = flagValue(context.args, '--incident');
  const analysisFile = flagValue(context.args, '--analysis');
  const analyze = hasFlag(context.args, '--analyze');
  if (incident !== undefined && (analysisFile !== undefined || analyze)) {
    throw new UsageError('--incident cannot be combined with --analyze or --analysis');
  }
  if (incident === undefined && analyze === (analysisFile !== undefined)) {
    throw new UsageError('choose exactly one of --analyze or --analysis');
  }
  const result = await operations.plan({
    repoPath: repoPath(context),
    source: incident === undefined
      ? {
        type: 'pr',
        analyze,
        ...(analysisFile === undefined ? {} : { analysisFile }),
        ...(flagValue(context.args, '--base') === undefined ? {} : { base: flagValue(context.args, '--base')! }),
        ...(flagValue(context.args, '--pr') === undefined ? {} : { pr: flagValue(context.args, '--pr')! }),
        noImpact: hasFlag(context.args, '--no-impact'),
      }
      : { type: 'incident', file: incident, noImpact: hasFlag(context.args, '--no-impact') },
  });
  emitJsonOrText(
    context,
    result,
    `test plan ${result.planId}: ${result.status}\ntargets: ${result.targets.length}\ndropped: ${result.dropped.length}\n`,
  );
  return result.status === 'blocked_by_domain' ? 4 : 0;
}

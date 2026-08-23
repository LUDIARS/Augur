import type { TestOperations } from '../../operations/tests.ts';
import { formatReportMarkdown, formatReportText } from '../../tests/report.ts';
import { hasFlag, rejectUnknownFlags, UsageError } from '../args.ts';
import { requirePositional, type TestCliContext } from './common.ts';

export async function reportCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--json', '--markdown']);
  if (hasFlag(context.args, '--json') && hasFlag(context.args, '--markdown')) throw new UsageError('--json and --markdown are mutually exclusive');
  const report = await operations.report(requirePositional(context, 0, 'runId'));
  context.io.stdout(hasFlag(context.args, '--json')
    ? `${JSON.stringify(report, null, 2)}\n`
    : hasFlag(context.args, '--markdown') ? formatReportMarkdown(report) : formatReportText(report));
  return 0;
}

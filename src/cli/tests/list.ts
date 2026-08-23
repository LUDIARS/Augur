import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, hasFlag, rejectUnknownFlags } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function listCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, ['--repo', '--domain', '--kind', '--status', '--business', '--program', '--json']);
  const domain = flagValue(context.args, '--domain');
  let tests = await operations.listTests({
    repoPath: repoPath(context),
    ...(domain === undefined ? {} : { domain }),
    ...(flagValue(context.args, '--kind') === undefined ? {} : { kind: flagValue(context.args, '--kind')! }),
    ...(flagValue(context.args, '--status') === undefined ? {} : { status: flagValue(context.args, '--status')! }),
  });
  if (domain !== undefined && hasFlag(context.args, '--business')) tests = tests.filter((test) => test.domains.business.includes(domain));
  if (domain !== undefined && hasFlag(context.args, '--program')) tests = tests.filter((test) => test.domains.program.includes(domain));
  const text = tests.map((test) => `${test.id} ${test.status.padEnd(9)} ${test.kind.padEnd(10)} ${test.name}`).join('\n');
  emitJsonOrText(context, tests, text === '' ? '' : `${text}\n`);
  return 0;
}

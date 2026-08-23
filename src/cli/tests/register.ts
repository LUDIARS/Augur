import type { TestOperations } from '../../operations/tests.ts';
import { flagValue, flagValues, hasFlag, rejectUnknownFlags, UsageError } from '../args.ts';
import { emitJsonOrText, repoPath, type TestCliContext } from './common.ts';

export async function registerCommand(context: TestCliContext, operations: TestOperations): Promise<number> {
  rejectUnknownFlags(context.args, [
    '--repo', '--from-plan', '--file', '--name', '--runner', '--selector', '--kind',
    '--program', '--business', '--anchor', '--runtime', '--always', '--json',
  ]);
  const fromPlan = flagValue(context.args, '--from-plan');
  if (fromPlan !== undefined) {
    const tests = await operations.registerFromPlan({ repoPath: repoPath(context), planId: fromPlan });
    emitJsonOrText(context, tests, `${tests.map((test) => `registered ${test.id} ${test.name}`).join('\n')}\n`);
    return 0;
  }
  const test = await operations.register({
    repoPath: repoPath(context),
    file: requiredFlag(context, '--file'),
    name: requiredFlag(context, '--name'),
    runner: requiredFlag(context, '--runner') as 'vitest',
    ...(flagValue(context.args, '--selector') === undefined ? {} : { selector: flagValue(context.args, '--selector')! }),
    ...(flagValue(context.args, '--kind') === undefined ? {} : { kind: flagValue(context.args, '--kind') as 'assurance' }),
    program: [...flagValues(context.args, '--program')],
    business: [...flagValues(context.args, '--business')],
    anchors: [...flagValues(context.args, '--anchor')],
    runtime: hasFlag(context.args, '--runtime'),
    always: hasFlag(context.args, '--always'),
  });
  emitJsonOrText(context, test, `registered ${test.id} ${test.name}\n`);
  return 0;
}

function requiredFlag(context: TestCliContext, name: string): string {
  const value = flagValue(context.args, name);
  if (value === undefined) throw new UsageError(`${name} is required`);
  return value;
}

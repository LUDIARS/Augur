import { flagValue, hasFlag, UsageError, type ParsedArgs } from '../args.ts';
import type { CliIo } from '../main.ts';

export interface TestCliContext { args: ParsedArgs; io: CliIo }

export function repoPath(context: TestCliContext): string {
  return flagValue(context.args, '--repo') ?? context.io.cwd;
}

export function emitJsonOrText(context: TestCliContext, value: unknown, text: string): void {
  context.io.stdout(hasFlag(context.args, '--json') ? `${JSON.stringify(value, null, 2)}\n` : text);
}

export function requirePositional(context: TestCliContext, index: number, label: string): string {
  const value = context.args.positionals[index];
  if (value === undefined) throw new UsageError(`${label} is required`);
  return value;
}

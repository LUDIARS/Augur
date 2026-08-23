import { createTestOperations, type TestOperations } from '../../operations/tests.ts';
import { flagValue, parseArgv, UsageError } from '../args.ts';
import type { CliIo } from '../main.ts';
import { authorCommand } from './author.ts';
import { flagCommand } from './flag.ts';
import { lintCommand } from './lint.ts';
import { listCommand } from './list.ts';
import { planCommand } from './plan.ts';
import { pruneCommand } from './prune.ts';
import { registerCommand } from './register.ts';
import { reportCommand } from './report.ts';
import { reviveCommand } from './revive.ts';
import { runCommand } from './run.ts';
import { runsCommand } from './runs.ts';
import { showCommand } from './show.ts';
import { sweepCommand } from './sweep.ts';
import { verdictCommand } from './verdict.ts';

const COMMANDS = {
  list: listCommand,
  show: showCommand,
  register: registerCommand,
  lint: lintCommand,
  plan: planCommand,
  author: authorCommand,
  run: runCommand,
  report: reportCommand,
  verdict: verdictCommand,
  flag: flagCommand,
  runs: runsCommand,
  sweep: sweepCommand,
  revive: reviveCommand,
  prune: pruneCommand,
} as const;

export async function runTestsCommand(argv: readonly string[], io: CliIo, supplied?: TestOperations): Promise<number> {
  const args = parseArgv(argv);
  const verb = args.command;
  if (verb === undefined || !(verb in COMMANDS)) throw new UsageError(`unknown tests verb '${verb ?? ''}'`);
  const operations = supplied ?? createTestOperations({
    flag: flagValue(args, '--revisor-url') === undefined ? {} : { baseUrl: flagValue(args, '--revisor-url')! },
  });
  try {
    return await COMMANDS[verb as keyof typeof COMMANDS]({ args, io }, operations);
  } catch (error) {
    if (hasExitCode(error)) {
      io.stderr(`error: ${messageOf(error)}\n`);
      return error.exitCode;
    }
    throw error;
  }
}

function hasExitCode(error: unknown): error is { exitCode: number } {
  return error !== null && typeof error === 'object' && typeof (error as { exitCode?: unknown }).exitCode === 'number';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

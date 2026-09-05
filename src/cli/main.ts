import { readFileSync, writeFileSync } from 'node:fs';
import { createPlan } from '../engine/createPlan.ts';
import {
  flagValue,
  hasFlag,
  parseArgv,
  rejectUnknownFlags,
  UsageError,
  type ParsedArgs,
} from './args.ts';
import { formatPlanText } from './format.ts';
import { runContractsCommand } from './contracts.ts';
import { messageOf, type GatherIo } from './gather.ts';
import { buildRequest } from './plan.ts';
import { reviewPlan } from './reviewPlan.ts';
import { runTestsCommand } from './tests/index.ts';

// Argv dispatch only. Each subcommand assembles a request and calls the engine;
// no planning logic lives in this layer (spec/interface/cli.md).

export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readStdin: () => string;
}

const USAGE = `Usage:
  augur plan [options] [description]     Plan tests and a fix policy for local changes
  augur review-plan --json               Decide which review checks one change needs (stdin JSON)
  augur inject <scan|apply|check|remove> Log injection (see spec/interface/inject-cli.md)
  augur contracts lint                   Check augur.contracts.json against the sources
  augur contracts report                 Aggregate weaver contract events (--since <iso> | --all)
  augur tests <verb>                     Manage registered tests
  augur serve                            Start the optional loopback HTTP API
  augur mcp                              Start the stdio MCP server

Common options:
  --json                 print the response JSON verbatim
  --out <file>           write the output to a file instead of stdout
  --request <file|->     plan from a complete CreatePlanRequest and skip signal gathering
  --help                 show this message
`;

// Memoized because stdin can only be drained once: `--coverage -` after
// `--failure-log -` would otherwise read an empty second document and plan from a
// signal that silently vanished.
let stdinText: string | undefined;

export function readStdinSync(): string {
  if (stdinText !== undefined) return stdinText;
  try {
    stdinText = readFileSync(0, 'utf8');
  } catch {
    stdinText = '';
  }
  return stdinText;
}

// 0 plan produced, 1 usage or validation error, 2 unexpected internal error
// (spec/interface/cli.md, "Exit Codes"). A caller distinguishes "you asked wrong"
// from "Augur broke" by that number alone, so the mapping is never widened.
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  let args;
  try {
    args = parseArgv(argv);
  } catch (error) {
    io.stderr(`error: ${messageOf(error)}\n\n${USAGE}`);
    return 1;
  }

  if (args.command === undefined || args.command === 'help' || hasFlag(args, '--help')) {
    io.stdout(USAGE);
    return 0;
  }

  try {
    if (args.command === 'plan') return runPlan(args, io);
    if (args.command === 'review-plan') return runReviewPlan(args, io);
    // Awaited rather than returned: a bare `return promise` settles outside this
    // try, so a rejection would escape the exit-code mapping below.
    if (args.command === 'inject') return await runInject(argv.slice(1), io);
    if (args.command === 'contracts') return await runContractsCommand(argv.slice(1), io);
    if (args.command === 'tests') return await runTestsCommand(argv.slice(1), io);
    if (args.command === 'serve') {
      const { startServer } = await import('../server.ts');
      startServer();
      return 0;
    }
    if (args.command === 'mcp') {
      const { startMcpServer } = await import('../mcp/server.ts');
      await startMcpServer();
      return 0;
    }
    io.stderr(`error: unknown command '${args.command}'\n\n${USAGE}`);
    return 1;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`error: ${messageOf(error)}\n`);
      return 1;
    }
    if (isValidationError(error)) {
      io.stderr(`error: ${validationMessage(error)}\n`);
      return 1;
    }
    io.stderr(`error: ${messageOf(error)}\n`);
    return 2;
  }
}

function gatherIo(io: CliIo): GatherIo {
  return {
    cwd: io.cwd,
    warn: (message) => io.stderr(`warning: ${message}\n`),
    readStdin: io.readStdin,
  };
}

function runPlan(args: ParsedArgs, io: CliIo): number {
  const request = buildRequest(args, gatherIo(io));
  const plan = createPlan(request);
  const text = hasFlag(args, '--json')
    ? `${JSON.stringify(plan, null, 2)}\n`
    : formatPlanText(plan, request.objective.kind);
  return emit(args, io, text);
}

// The response is JSON regardless of `--json`: the caller reads stdout as one
// document, and a human running this by hand still wants the thing Revisor sees.
// No flag gathers local signals here — the caller already produced the change
// profile (spec/interface/review-plan-cli.md, "Command").
function runReviewPlan(args: ParsedArgs, io: CliIo): number {
  rejectUnknownFlags(args, ['--json', '--help']);
  const response = reviewPlan(io.readStdin());
  io.stdout(`${JSON.stringify(response, null, 2)}\n`);
  return 0;
}

async function runInject(argv: readonly string[], io: CliIo): Promise<number> {
  // The log-injection tool owns its own argv surface and exits on its own; it is
  // reached as a subcommand rather than a second entry point.
  process.argv = [process.argv[0]!, 'inject', ...argv];
  try {
    await import('../../scripts/inject-logs.ts');
    return 0;
  } catch (error) {
    io.stderr(`error: ${messageOf(error)}\n`);
    return 2;
  }
}

function emit(args: ParsedArgs, io: CliIo, text: string): number {
  const out = flagValue(args, '--out');
  if (out === undefined) {
    io.stdout(text);
    return 0;
  }
  // Written here rather than by the caller redirecting stdout, so `--out` leaves
  // stdout empty for a pipeline that should consume nothing.
  writeFileSync(out, text, 'utf8');
  return 0;
}

interface ValidationLike {
  readonly issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;
}

function isValidationError(error: unknown): error is ValidationLike {
  return (
    error !== null
    && typeof error === 'object'
    && Array.isArray((error as { issues?: unknown }).issues)
  );
}

// Mirrors the message the HTTP 400 envelope carried, so a caller migrating from
// the API reads the same text on stderr.
function validationMessage(error: ValidationLike): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'request is invalid';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

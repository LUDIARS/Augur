// Argv parsing only. Flags assemble a request; they never plan anything, so this
// module knows nothing about the engine (spec/interface/cli.md, "Relationship to
// the engine").

export class UsageError extends Error {}

export interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, readonly string[]>;
}

// Flags that may appear more than once; every other repeat is an error, because
// a silently discarded second `--base` is worse than a message. `--rule` belongs
// to `augur inject`, whose argv passes through this parser unchanged.
const REPEATABLE = new Set(['--quality', '--rule', '--program', '--business', '--anchor']);

// Flags that take no value. `--dry-run` and `--strict` are `augur inject`'s
// (spec/interface/inject-cli.md); they are listed so its argv survives parsing.
const BOOLEAN = new Set([
  '--no-git', '--json', '--dry-run', '--strict', '--help',
  '--business-only', '--program-only', '--runtime', '--always', '--cached', '--no-promote',
  '--for-revisor', '--markdown', '--accept', '--reject', '--apply', '--analyze', '--no-impact',
]);

export function parseArgv(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) {
      if (command === undefined && positionals.length === 0) command = token;
      else positionals.push(token);
      continue;
    }
    const commandBoolean = (command === 'list' || (command === 'tests' && positionals[0] === 'list'))
      && (token === '--business' || token === '--program');
    if (BOOLEAN.has(token) || commandBoolean) {
      flags.set(token, ['true']);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${token} requires a value`);
    }
    index += 1;
    const existing = flags.get(token);
    if (existing === undefined) {
      flags.set(token, [value]);
      continue;
    }
    if (!REPEATABLE.has(token)) throw new UsageError(`${token} was given more than once`);
    existing.push(value);
  }

  return { command, positionals, flags };
}

export function flagValue(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.[0];
}

export function flagValues(args: ParsedArgs, name: string): readonly string[] {
  return args.flags.get(name) ?? [];
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

// Parsing stays permissive because `augur inject` forwards its own flag surface
// (spec/interface/inject-cli.md) through the same argv. Commands Augur itself
// implements declare what they accept and reject the rest here, so a mistyped
// `--kidn bug_fix` is a usage error instead of a plan silently built from the
// default kind.
export function rejectUnknownFlags(args: ParsedArgs, allowed: readonly string[]): void {
  const known = new Set(allowed);
  const unknown = [...args.flags.keys()].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new UsageError(`unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  }
}

export function rejectFlags(args: ParsedArgs, names: readonly string[], because: string): void {
  const present = names.filter((name) => args.flags.has(name));
  if (present.length > 0) {
    throw new UsageError(`${present.join(', ')} cannot be combined with ${because}`);
  }
}

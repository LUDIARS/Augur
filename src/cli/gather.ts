import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageSignal, ProjectContext } from '../schema/index.ts';

// The only place in Augur that shells out, and only to `git`
// (spec/implementation-design.md). Gathering failures degrade to a warning and a
// plan without that signal, mirroring the engine's graceful-degradation rule: a
// missing coverage file is worse as a hard stop than as a thinner plan.

export interface GatherIo {
  readonly cwd: string;
  readonly warn: (message: string) => void;
  readonly readStdin: () => string;
  readonly runGit?: (args: readonly string[], cwd: string) => GitResult;
}

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export function runGit(args: readonly string[], cwd: string): GitResult {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? result.error.message : ''),
  };
}

export interface ChangeSignals {
  readonly diff?: string;
  readonly changedFiles?: readonly string[];
}

export function gatherChange(io: GatherIo, base: string): ChangeSignals {
  const git = io.runGit ?? runGit;
  const diff = git(['diff', '--no-ext-diff', base], io.cwd);
  if (!diff.ok) {
    io.warn(`git diff ${base} failed; planning without change signals: ${diff.stderr.trim()}`);
    return {};
  }
  const names = git(['diff', '--name-only', base], io.cwd);
  const changedFiles = names.ok
    ? names.stdout.split(/\r?\n/).filter((line) => line.length > 0)
    : [];
  if (!names.ok) io.warn(`git diff --name-only ${base} failed; changed file list is empty`);
  const signals: { diff?: string; changedFiles?: readonly string[] } = {};
  if (diff.stdout.trim().length > 0) signals.diff = diff.stdout;
  if (changedFiles.length > 0) signals.changedFiles = changedFiles;
  return signals;
}

// `-` reads stdin so `npm test 2>&1 | augur plan --failure-log -` works.
export function readSignalFile(io: GatherIo, path: string): string | undefined {
  if (path === '-') return io.readStdin();
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    io.warn(`could not read ${path}; planning without it: ${messageOf(error)}`);
    return undefined;
  }
}

export function readJsonFile<T>(io: GatherIo, path: string, label: string): T | undefined {
  const text = readSignalFile(io, path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    io.warn(`${label} at ${path} is not valid JSON; planning without it: ${messageOf(error)}`);
    return undefined;
  }
}

export function coverageFrom(path: string, text: string): CoverageSignal {
  const format = path.endsWith('.info') ? 'lcov' : path.endsWith('.json') ? 'json' : 'text';
  return { format, content: text };
}

// Known dev dependencies imply a runner. Inference is best-effort by design and
// always overridable with `--project`, so a repository that names its runner
// unusually loses nothing a caller cannot supply.
const RUNNER_DEPENDENCIES: ReadonlyArray<readonly [string, string]> = [
  ['vitest', 'vitest'],
  ['jest', 'jest'],
  ['@playwright/test', 'playwright'],
  ['playwright', 'playwright'],
  ['cypress', 'cypress'],
];

export function inferProject(io: GatherIo): ProjectContext | undefined {
  const manifestPath = join(io.cwd, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    io.warn(`package.json is not valid JSON; project context is empty: ${messageOf(error)}`);
    return undefined;
  }
  const dependencies = {
    ...asRecord(manifest['devDependencies']),
    ...asRecord(manifest['dependencies']),
  };
  const testRunners = [
    ...new Set(
      RUNNER_DEPENDENCIES.filter(([dependency]) => dependency in dependencies).map(
        ([, runner]) => runner,
      ),
    ),
  ];
  const context: { name?: string; packageManager?: string; testRunners?: string[] } = {};
  if (typeof manifest['name'] === 'string') context.name = manifest['name'];
  if (typeof manifest['packageManager'] === 'string') {
    // `npm@10.2.0` names the manager; the version is the caller's business.
    const [manager] = manifest['packageManager'].split('@');
    if (manager !== undefined && manager.length > 0) context.packageManager = manager;
  }
  if (testRunners.length > 0) context.testRunners = testRunners;
  return Object.keys(context).length > 0 ? context : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

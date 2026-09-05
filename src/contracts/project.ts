// The filesystem half of contract-observation: read the contract file and the
// predicate modules it names. Everything above this line in src/contracts/ is
// pure, so both the lint CLI and the injector reach the disk through here and
// nowhere else.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ContractsManifest } from './manifest.ts';
import { CONTRACTS_MANIFEST_NAME, parseContractsManifest } from './manifest.ts';
import type { PredicateModuleState } from './predicate.ts';
import { classifyPredicateSource } from './predicate.ts';

export function contractsManifestPath(projectDir: string): string {
  return join(projectDir, CONTRACTS_MANIFEST_NAME);
}

/** null when the project has no contract file — not every project has one. */
export function loadContractsManifest(projectDir: string): ContractsManifest | null {
  const path = existingProjectPath(projectDir, CONTRACTS_MANIFEST_NAME);
  if (path === null) return null;
  return parseContractsManifest(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function predicateStateOf(projectDir: string, module: string): PredicateModuleState {
  const path = existingProjectPath(projectDir, module);
  if (path === null) return 'missing';
  return classifyPredicateSource(module, readFileSync(path, 'utf8'));
}

export function readSourceIfPresent(projectDir: string, file: string): string | undefined {
  const path = existingProjectPath(projectDir, file);
  return path === null ? undefined : readFileSync(path, 'utf8');
}

/**
 * Where the weaver sink writes, resolved the way the runtime resolves it
 * (spec/plan/2026-09-05-live-contract-testing.md §6.1): an explicit `--logs`
 * first, then `VESTIGIUM_LOGS_DIR`, then `<project>/logs`.
 * @implements SPEC-CONTRACTS-REPORT-AGGREGATION
 */
export function resolveLogsDir(
  projectDir: string,
  explicit?: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicit !== undefined) return resolve(explicit);
  const configured = env.VESTIGIUM_LOGS_DIR;
  if (configured !== undefined && configured !== '') return resolve(configured);
  return resolve(projectDir, 'logs');
}

/**
 * Every line of every `*.jsonl` in `logsDir`, in filename order so two runs over
 * an unchanged directory read the same sequence. A missing directory is not an
 * error: a project that has never run under the weaver simply has no evidence.
 * @implements SPEC-CONTRACTS-REPORT-AGGREGATION
 */
export function readWeaverLogLines(logsDir: string): string[] {
  if (!existsSync(logsDir) || !statSync(logsDir).isDirectory()) return [];
  const files = readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
  const lines: string[] = [];
  for (const name of files) {
    for (const line of readFileSync(join(logsDir, name), 'utf8').split('\n')) {
      if (line.trim() !== '') lines.push(line);
    }
  }
  return lines;
}

/** Resolve an existing manifest path and reject symlinks that leave the project. */
export function existingProjectPath(projectDir: string, repoPath: string): string | null {
  const root = realpathSync(resolve(projectDir));
  const candidate = resolve(root, repoPath);
  assertContained(root, candidate, repoPath);
  if (!existsSync(candidate)) return null;
  const actual = realpathSync(candidate);
  assertContained(root, actual, repoPath);
  return statSync(actual).isFile() ? actual : null;
}

function assertContained(root: string, candidate: string, repoPath: string): void {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`contract path leaves project: ${repoPath}`);
  }
}

// The filesystem half of contract-observation: read the contract file and the
// predicate modules it names. Everything above this line in src/contracts/ is
// pure, so both the lint CLI and the injector reach the disk through here and
// nowhere else.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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

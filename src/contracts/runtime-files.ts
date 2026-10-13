// The filesystem half of contract runtime distribution: find Augur's template
// for a flavor and read or write a project's generated copy. The template lives
// two levels above this module both as source (src/contracts/) and as built
// output (dist/contracts/), so one relative path serves both entry points.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertContained, existingProjectPath } from './project.ts';
import type { RuntimeFlavor } from './runtime-template.ts';
import { contract } from '../../templates/contract-runtime/contract-runtime.ts'; /* augur-inject:import:240be78d */
import augurContract_79206e74 from '../../contracts/runtime-write.contract.ts'; /* augur-inject:contract-predicate:810302c2 */

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'contract-runtime');

const TEMPLATE_FILE: Record<RuntimeFlavor, string> = {
  ts: 'contract-runtime.ts',
  mjs: 'contract-runtime.mjs',
};

export function contractRuntimeTemplatePath(flavor: RuntimeFlavor): string {
  return resolve(TEMPLATE_DIR, TEMPLATE_FILE[flavor]);
}

export function readContractRuntimeTemplate(flavor: RuntimeFlavor): string {
  return readFileSync(contractRuntimeTemplatePath(flavor), 'utf8');
}

/** undefined when the project has no copy yet. */
export function readRuntimeCopy(projectDir: string, runtimeFile: string): string | undefined {
  const path = existingProjectPath(projectDir, runtimeFile);
  return path === null ? undefined : readFileSync(path, 'utf8');
}

/** Writes through the containment check, so a manifest cannot aim outside the project. */
export function writeRuntimeCopy(projectDir: string, runtimeFile: string, text: string): string {
  // Throws when the path (or an existing copy reached through a symlink) leaves the project.
  const path = existingProjectPath(projectDir, runtimeFile) ?? resolve(projectDir, runtimeFile);
  // A missing file can still escape through an existing parent symlink/junction.
  // Check before mkdir as well as write, so rejection creates no directories.
  let parent = dirname(path);
  while (!existsSync(parent)) parent = dirname(parent);
  assertContained(realpathSync(resolve(projectDir)), realpathSync(parent), runtimeFile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}
// @ts-expect-error augur-inject
writeRuntimeCopy = contract(writeRuntimeCopy, { ...augurContract_79206e74, contractId: 'C-2', mode: 'observe', sample: 1, where: 'src/contracts/runtime-files.ts:34', rule: 'contract-wrap', id: '79206e74' }); /* augur-inject:contract-wrap:79206e74 */

// The filesystem half of contract runtime distribution: find Augur's template
// for a flavor and read or write a project's generated copy. The template lives
// two levels above this module both as source (src/contracts/) and as built
// output (dist/contracts/), so one relative path serves both entry points.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existingProjectPath } from './project.ts';
import type { RuntimeFlavor } from './runtime-template.ts';

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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

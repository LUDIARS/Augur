// Filesystem layer for the injection tool: manifest loading, file walking,
// and running scan/apply/check/remove over one project directory. Everything
// under here does IO; the rule logic it calls stays pure.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { computeApply } from './apply.ts';
import { checkSource } from './check.ts';
import { matchesAny } from './glob.ts';
import type { InjectManifest } from './manifest.ts';
import { parseManifest } from './manifest.ts';
import { computeRemove } from './remove.ts';
import type { InjectRule, InjectionPoint } from './types.ts';

export const MANIFEST_NAME = 'augur.inject.json';

const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

export function loadManifest(projectDir: string): InjectManifest {
  const raw = readFileSync(join(projectDir, MANIFEST_NAME), 'utf8');
  return parseManifest(JSON.parse(raw));
}

export function listTargetFiles(projectDir: string, manifest: InjectManifest): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ALWAYS_SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      const rel = relative(projectDir, full).split(sep).join('/');
      if (matchesAny(rel, manifest.include) && !matchesAny(rel, manifest.exclude)) {
        files.push(rel);
      }
    }
  };
  walk(resolve(projectDir));
  return files.sort();
}

export type ProjectRunResult = {
  project: string;
  service: string;
  points: InjectionPoint[];
  filesChanged: string[];
  summary: { applied: number; pending: number; orphaned: number };
};

export function runOnProject(
  projectDir: string,
  command: 'scan' | 'apply' | 'check' | 'remove',
  options: { write: boolean; rules?: InjectRule[] | undefined },
): ProjectRunResult {
  const manifest = loadManifest(projectDir);
  const files = listTargetFiles(projectDir, manifest);
  const points: InjectionPoint[] = [];
  const filesChanged: string[] = [];

  for (const rel of files) {
    const full = join(projectDir, rel);
    const text = readFileSync(full, 'utf8');

    if (command === 'apply') {
      const result = computeApply(rel, text, manifest, options.rules);
      if (result.changed) {
        if (options.write) writeFileSync(full, result.text);
        filesChanged.push(rel);
      }
      const after = checkSource(rel, result.text, manifest);
      points.push(...after);
      continue;
    }
    if (command === 'remove') {
      const result = computeRemove(rel, text);
      if (result.changed) {
        if (options.write) writeFileSync(full, result.text);
        filesChanged.push(rel);
      }
      continue;
    }
    points.push(...checkSource(rel, text, manifest));
  }

  const filtered = options.rules === undefined
    ? points
    : points.filter((p) => (options.rules as string[]).includes(p.rule));
  return {
    project: resolve(projectDir),
    service: manifest.service,
    points: filtered,
    filesChanged,
    summary: {
      applied: filtered.filter((p) => p.state === 'applied').length,
      pending: filtered.filter((p) => p.state === 'pending').length,
      orphaned: filtered.filter((p) => p.state === 'orphaned').length,
    },
  };
}

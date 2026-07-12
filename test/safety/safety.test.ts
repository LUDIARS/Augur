import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Safety guarantees from spec/test/service-test-strategy.md: Augur never
// invokes test runner commands and never mutates application code while
// creating a plan. The engine is pure by construction — enforced here by
// asserting its module graph never touches Node's process/fs/network APIs.

const PURE_DIRS = ['src/engine', 'src/catalog', 'src/schema'];
const FORBIDDEN = [
  /from\s+['"]node:/,
  /from\s+['"](child_process|fs|net|http|https|os|process)['"]/,
  /require\s*\(/,
  /\bprocess\.env\b/,
  /\bfetch\s*\(/,
];

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) results.push(...walk(path));
    else if (path.endsWith('.ts')) results.push(path);
  }
  return results;
}

// fileURLToPath, not URL#pathname: pathname yields "/E:/..." on Windows and
// doubles the drive letter when joined.
const root = fileURLToPath(new URL('../..', import.meta.url));

describe('engine purity', () => {
  for (const dir of PURE_DIRS) {
    it(`${dir} never imports process, filesystem, or network APIs`, () => {
      const files = walk(join(root, dir));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of FORBIDDEN) {
          expect(source, `${file} matches forbidden pattern ${pattern}`).not.toMatch(pattern);
        }
      }
    });
  }
});

// The HTTP shell legitimately reads config and binds a socket, but it must
// never launch test runners or any other process on the caller's behalf
// (spec/test/service-test-strategy.md ST-001).
const SHELL_TARGETS = ['src/routes', 'src/config', 'src/app.ts', 'src/server.ts'];
const NO_EXEC = [/child_process/, /\bworker_threads\b/, /\bexecSync\s*\(/, /\bspawnSync\s*\(/];

describe('http shell never executes processes', () => {
  for (const target of SHELL_TARGETS) {
    it(`${target} never references process-spawning APIs`, () => {
      const path = join(root, target);
      const files = statSync(path).isDirectory() ? walk(path) : [path];
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of NO_EXEC) {
          expect(source, `${file} matches forbidden pattern ${pattern}`).not.toMatch(pattern);
        }
      }
    });
  }
});

// Path normalization for contract manifests. Manifest paths are repository
// relative and posix-shaped; the injector needs them as ESM specifiers
// relative to the file being edited (spec/plan/2026-09-05-live-contract-testing.md §5.1).

import { posix } from 'node:path';

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** True only for a path that cannot resolve outside a repository root. */
export function isRepoRelativePath(path: string): boolean {
  const slashes = path.replace(/\\/g, '/');
  if (CONTROL_CHARACTER.test(slashes) || posix.isAbsolute(slashes) || WINDOWS_DRIVE_PATH.test(path)) return false;
  const normalized = posix.normalize(slashes.replace(/^\.\//, ''));
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

/** Repository-relative, posix-separated, no leading `./`. */
export function normalizeRepoPath(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/').replace(/^\.\//, ''));
}

/** Specifier for `moduleFile` as imported from `fromFile` (both repo-relative). */
export function relativeSpecifier(fromFile: string, moduleFile: string): string {
  const from = normalizeRepoPath(fromFile);
  const target = normalizeRepoPath(moduleFile);
  const relative = posix.relative(posix.dirname(from), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

// Minimal glob matching for manifest include/exclude patterns.
// Supports '**' (any path segments), '*' (within a segment), literal rest.
// Paths are matched as posix-style relative paths. No dependency needed for
// the handful of patterns manifests use.

export function globToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '*') {
      if (pattern.startsWith('**/', i)) {
        out += '(?:.*/)?';
        i += 3;
      } else if (pattern.startsWith('**', i)) {
        out += '.*';
        i += 2;
      } else {
        out += '[^/]*';
        i += 1;
      }
      continue;
    }
    out += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}

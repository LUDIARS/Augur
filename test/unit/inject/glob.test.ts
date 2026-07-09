import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAny } from '../../../src/inject/glob.ts';

describe('globToRegExp', () => {
  it('handles ** across segments and * within a segment', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/db/repo.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('tools/a.ts')).toBe(false);
    expect(globToRegExp('*.ts').test('a/b.ts')).toBe(false);
    expect(globToRegExp('**/*.test.ts').test('deep/nested/x.test.ts')).toBe(true);
    expect(globToRegExp('dist/**').test('dist/x/y.js')).toBe(true);
  });

  it('escapes regex specials in literals', () => {
    expect(globToRegExp('a.b/c.ts').test('a.b/c.ts')).toBe(true);
    expect(globToRegExp('a.b/c.ts').test('axb/c.ts')).toBe(false);
  });
});

describe('matchesAny', () => {
  it('matches against any pattern in the list', () => {
    expect(matchesAny('src/x.ts', ['tools/**', 'src/**/*.ts'])).toBe(true);
    expect(matchesAny('web/x.ts', ['tools/**', 'src/**/*.ts'])).toBe(false);
  });
});

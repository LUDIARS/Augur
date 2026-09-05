import { describe, expect, it } from 'vitest';
import { relativeSpecifier, normalizeRepoPath } from '../../src/contracts/paths.ts';
import { classifyPredicateSource } from '../../src/contracts/predicate.ts';
import { resolveSymbol } from '../../src/contracts/symbols.ts';

const source = [
  'export const resolveBudget = (goal) => ({ ms: 1 });',
  '',
  'export function applyPlan(plan) {',
  '  return plan;',
  '}',
  '',
  'export class Registry {',
  '  register(name) { return name; }',
  '  static reset() {}',
  '  #hidden() {}',
  '}',
  '',
].join('\n');

describe('resolveSymbol', () => {
  it('finds a const initializer to wrap', () => {
    expect(resolveSymbol('src/a.ts', source, 'resolveBudget')).toMatchObject({
      form: 'const-initializer',
      line: 1,
      target: 'resolveBudget',
    });
  });

  it('finds a function declaration and points after it', () => {
    const site = resolveSymbol('src/a.ts', source, 'applyPlan');
    expect(site).toMatchObject({ form: 'function-declaration', line: 3, target: 'applyPlan' });
    expect(site?.insertPos).toBeGreaterThan(0);
  });

  it('routes instance methods through the prototype and statics through the class', () => {
    expect(resolveSymbol('src/a.ts', source, 'Registry.register')).toMatchObject({
      form: 'prototype-method',
      target: 'Registry.prototype.register',
    });
    expect(resolveSymbol('src/a.ts', source, 'Registry.reset')).toMatchObject({
      form: 'static-method',
      target: 'Registry.reset',
    });
  });

  it('leaves private methods and unknown names unresolved', () => {
    expect(resolveSymbol('src/a.ts', source, 'Registry.hidden')).toBeNull();
    expect(resolveSymbol('src/a.ts', source, 'missing')).toBeNull();
    expect(resolveSymbol('src/a.ts', source, 'Missing.register')).toBeNull();
  });

  it('rejects non-callable variable initializers', () => {
    expect(resolveSymbol('src/a.ts', 'export const value = 1;\n', 'value')).toBeNull();
    expect(resolveSymbol('src/a.ts', 'export let value = () => 1;\n', 'value')).toBeNull();
    expect(resolveSymbol('src/a.ts', 'const local = () => 1;\n', 'local')).toBeNull();
  });

  it('resolves an overloaded function to its implementation', () => {
    const overloaded = [
      'export function parse(value: string): string;',
      'export function parse(value: number): number;',
      'export function parse(value: string | number) { return value; }',
      '',
    ].join('\n');
    const site = resolveSymbol('src/a.ts', overloaded, 'parse');
    expect(site).toMatchObject({ form: 'function-declaration', line: 3 });
    expect(site?.insertPos).toBe(overloaded.indexOf('\n', overloaded.indexOf('return value')));
  });
});

describe('classifyPredicateSource', () => {
  it('accepts an object literal default export, with or without satisfies', () => {
    expect(classifyPredicateSource('c.ts', 'export default { pre: () => true };')).toBe('ok');
    expect(classifyPredicateSource('c.ts', 'export default { pre: () => true } satisfies Contract;')).toBe('ok');
    expect(classifyPredicateSource('c.ts', 'const spec = { pre: () => true };\nexport default spec;')).toBe('ok');
  });

  it('rejects a missing or non-object default export', () => {
    expect(classifyPredicateSource('c.ts', 'export const pre = () => true;')).toBe('invalid-default');
    expect(classifyPredicateSource('c.ts', 'export default () => true;')).toBe('invalid-default');
  });
});

describe('path normalization', () => {
  it('rewrites a repo-relative module into a specifier from the injected file', () => {
    expect(relativeSpecifier('src/engine/budget.ts', './contracts/budget.contract.ts'))
      .toBe('../../contracts/budget.contract.ts');
    expect(relativeSpecifier('src/a.ts', 'src/contracts/a.contract.ts')).toBe('./contracts/a.contract.ts');
  });

  it('normalizes windows separators and leading dot-slash', () => {
    expect(normalizeRepoPath('.\\src\\a.ts')).toBe('src/a.ts');
  });
});

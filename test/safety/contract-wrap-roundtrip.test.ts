import { describe, expect, it } from 'vitest';
import { parseContractsManifest } from '../../src/contracts/manifest.ts';
import { computeApply } from '../../src/inject/apply.ts';
import { buildContractTargets } from '../../src/inject/contract-targets.ts';
import { parseManifest } from '../../src/inject/manifest.ts';
import { computeRemove } from '../../src/inject/remove.ts';
import type { InjectContext } from '../../src/inject/types.ts';

// C2-2 of spec/plan/2026-09-05-live-contract-testing.md §12: removing the
// contract fragments must restore the file byte for byte. The three declaration
// forms splice differently (wrap, reassignment behind a ts-expect-error line,
// prototype replacement), so each one is round-tripped on its own as well as
// together, and the crlf case is checked because removal eats the newline the
// insertion added.

const manifest = parseManifest({ service: 'fixture' });
const FILE = 'src/engine/budget.ts';

function contextFor(entries: { id: string; symbol: string }[]): InjectContext {
  const contracts = parseContractsManifest({
    version: 1,
    contracts: entries.map(({ id, symbol }) => ({
      id,
      criterion: `${id} ${symbol}`,
      symbol,
      file: FILE,
      module: `contracts/${id}.contract.ts`,
    })),
  });
  return { contractTargets: buildContractTargets(contracts, () => 'ok') };
}

function roundTrip(original: string, entries: { id: string; symbol: string }[]): void {
  const applied = computeApply(FILE, original, manifest, ['contract-wrap'], contextFor(entries));
  expect(applied.changed).toBe(true);
  expect(applied.injected).toHaveLength(entries.length);
  const removed = computeRemove(FILE, applied.text);
  expect(removed.changed).toBe(true);
  expect(removed.text).toBe(original);
}

const CONST_FORM = [
  "import { helper } from './helper.ts';",
  '',
  'export const resolveBudget = (goal) => ({ ms: helper(goal) });',
  '',
].join('\n');

const FUNCTION_FORM = [
  'export function applyPlan(plan, registry) {',
  '  registry.set(plan.id, plan);',
  '  return registry;',
  '}',
  '',
].join('\n');

const CLASS_FORM = [
  'export class Registry {',
  '  register(name) {',
  '    return name;',
  '  }',
  '',
  '  static reset() {}',
  '}',
  '',
].join('\n');

describe('contract-wrap round trip', () => {
  it('restores a wrapped const initializer', () => {
    roundTrip(CONST_FORM, [{ id: 'C-1', symbol: 'resolveBudget' }]);
  });

  it('restores a reassigned function declaration', () => {
    roundTrip(FUNCTION_FORM, [{ id: 'C-2', symbol: 'applyPlan' }]);
  });

  it('restores a replaced instance method', () => {
    roundTrip(CLASS_FORM, [{ id: 'C-3', symbol: 'Registry.register' }]);
  });

  it('restores a replaced static method', () => {
    roundTrip(CLASS_FORM, [{ id: 'C-4', symbol: 'Registry.reset' }]);
  });

  it('restores all three forms injected into one file at once', () => {
    roundTrip(`${CONST_FORM}\n${FUNCTION_FORM}\n${CLASS_FORM}`, [
      { id: 'C-1', symbol: 'resolveBudget' },
      { id: 'C-2', symbol: 'applyPlan' },
      { id: 'C-3', symbol: 'Registry.register' },
      { id: 'C-4', symbol: 'Registry.reset' },
    ]);
  });

  it('restores a crlf file', () => {
    roundTrip(FUNCTION_FORM.split('\n').join('\r\n'), [{ id: 'C-2', symbol: 'applyPlan' }]);
  });

  it('restores a file that also carries the existing rules', () => {
    const original = [
      "import { spawn } from 'node:child_process';",
      '',
      'export function launch() {',
      "  const child = spawn('wt.exe', ['-w']);",
      '  try { child.unref(); } catch {}',
      '  return child;',
      '}',
      '',
      'setInterval(async () => { await tick(); }, 5000);',
      '',
    ].join('\n');
    const context = contextFor([{ id: 'C-5', symbol: 'launch' }]);
    const applied = computeApply(FILE, original, manifest, undefined, context);
    expect(applied.injected.map((c) => c.rule)).toContain('contract-wrap');
    expect(computeRemove(FILE, applied.text).text).toBe(original);
  });

  it('removes only contract-wrap when another injected rule remains', () => {
    const original = 'export function tick() {}\nsetInterval(async () => { tick(); }, 5000);\n';
    const context = contextFor([{ id: 'C-6', symbol: 'tick' }]);
    const applied = computeApply(FILE, original, manifest, undefined, context).text;
    const contractRemoved = computeRemove(FILE, applied, ['contract-wrap']).text;
    expect(contractRemoved).not.toContain('augur-inject:contract-wrap');
    expect(contractRemoved).not.toContain('augur-inject:contract-predicate');
    expect(contractRemoved).not.toMatch(/\{[^}]*contract[^}]*\} from '@ludiars\/log-weaver'/);
    expect(contractRemoved).toContain('augur-inject:interval-guard');
    expect(contractRemoved).toContain('guardAsync');
    expect(computeRemove(FILE, contractRemoved).text).toBe(original);
  });
});

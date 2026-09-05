import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseContractsManifest } from '../../../src/contracts/manifest.ts';
import type { PredicateModuleState } from '../../../src/contracts/predicate.ts';
import { computeApply } from '../../../src/inject/apply.ts';
import { checkSource } from '../../../src/inject/check.ts';
import { addedFunctionsOf, selectAddedContracts } from '../../../src/inject/contract-diff.ts';
import { buildContractTargets, type ContractTarget } from '../../../src/inject/contract-targets.ts';
import { parseManifest } from '../../../src/inject/manifest.ts';
import type { InjectContext } from '../../../src/inject/types.ts';

const manifest = parseManifest({ service: 'fixture' });
const FILE = 'src/engine/budget.ts';

const SOURCE = [
  "import { helper } from './helper.ts';",
  '',
  'export const resolveBudget = (goal) => ({ ms: helper(goal) });',
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

type EntryOverrides = Record<string, unknown>;

function entry(id: string, symbol: string, overrides: EntryOverrides = {}) {
  return {
    id,
    criterion: `${id} ${symbol}`,
    symbol,
    file: FILE,
    module: `contracts/${id}.contract.ts`,
    ...overrides,
  };
}

function contextOf(entries: EntryOverrides[], state: PredicateModuleState = 'ok'): InjectContext {
  const contracts = parseContractsManifest({ version: 1, contracts: entries });
  return { contractTargets: buildContractTargets(contracts, () => state) };
}

function targetsOf(context: InjectContext): readonly ContractTarget[] {
  return context.contractTargets ?? [];
}

describe('contract-wrap apply', () => {
  it('wraps a const initializer in place', () => {
    const context = contextOf([entry('C-1', 'resolveBudget')]);
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    expect(applied).toMatch(
      /export const resolveBudget = contract\(\(goal\) => \(\{ ms: helper\(goal\) \}\), \{ \.\.\.augurContract_[0-9a-f]{8}, contractId: 'C-1', mode: 'observe', sample: 1, where: 'src\/engine\/budget\.ts:3', rule: 'contract-wrap', id: '[0-9a-f]{8}' \}\) \/\* augur-inject:contract-wrap:[0-9a-f]{8} \*\/;/,
    );
  });

  it('reassigns a function declaration behind a ts-expect-error line', () => {
    const context = contextOf([entry('C-2', 'applyPlan')]);
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    expect(applied).toContain('// @ts-expect-error augur-inject');
    expect(applied).toMatch(/^applyPlan = contract\(applyPlan, \{ \.\.\.augurContract_/m);
    // The declaration itself is untouched, so hoisting and the export stay.
    expect(applied).toContain('export function applyPlan(plan) {');
  });

  it('replaces an instance method on the prototype and a static on the class', () => {
    const context = contextOf([entry('C-3', 'Registry.register'), entry('C-4', 'Registry.reset')]);
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    expect(applied).toMatch(/^Registry\.prototype\.register = contract\(Registry\.prototype\.register, /m);
    expect(applied).toMatch(/^Registry\.reset = contract\(Registry\.reset, /m);
  });

  it('imports contract and each predicate module on marker-tagged lines', () => {
    const context = contextOf([entry('C-1', 'resolveBudget')]);
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    expect(applied).toMatch(
      /import \{ contract \} from '@ludiars\/log-weaver'; \/\* augur-inject:import:[0-9a-f]{8} \*\//,
    );
    expect(applied).toMatch(
      /import augurContract_[0-9a-f]{8} from '\.\.\/\.\.\/contracts\/C-1\.contract\.ts'; \/\* augur-inject:contract-predicate:[0-9a-f]{8} \*\//,
    );
  });

  it('takes the contract runtime import from the contract manifest', () => {
    const injectManifest = parseManifest({ service: 'fixture', importFrom: '@fixture/inject-runtime' });
    const contracts = parseContractsManifest({
      version: 1,
      importFrom: '@fixture/contract-runtime',
      contracts: [entry('C-1', 'resolveBudget')],
    });
    const context = { contractTargets: buildContractTargets(contracts, () => 'ok') };
    const applied = computeApply(FILE, SOURCE, injectManifest, ['contract-wrap'], context).text;
    expect(applied).toContain("import { contract } from '@fixture/contract-runtime';");
    expect(applied).not.toContain('@fixture/inject-runtime');
  });

  it('escapes manifest strings before emitting TypeScript', () => {
    const contracts = parseContractsManifest({
      version: 1,
      importFrom: "@fixture/contract'\\runtime\nnext",
      contracts: [entry("C-'\\\n1", 'resolveBudget', { module: "contracts/odd'name.contract.ts" })],
    });
    const context = { contractTargets: buildContractTargets(contracts, () => 'ok') };
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    const diagnostics = ts.transpileModule(applied, { reportDiagnostics: true }).diagnostics ?? [];
    expect(diagnostics).toEqual([]);
    expect(applied).not.toContain("contractId: 'C-'\\\n");
  });

  it('is idempotent — a second apply changes nothing', () => {
    const context = contextOf([entry('C-1', 'resolveBudget'), entry('C-2', 'applyPlan')]);
    const once = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    const twice = computeApply(FILE, once, manifest, ['contract-wrap'], context);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });

  it('keeps multiple contracts on one function independent', () => {
    const context = contextOf([entry('C-1', 'resolveBudget'), entry('C-2', 'resolveBudget')]);
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    const ids = [...applied.matchAll(/augur-inject:contract-wrap:([0-9a-f]{8})/g)].map((match) => match[1]);
    const locals = [...applied.matchAll(/import (augurContract_[0-9a-f]{8})/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
    expect(new Set(locals).size).toBe(2);
    expect(checkSource(FILE, applied, manifest, context).map((point) => point.state)).toEqual([
      'applied',
      'applied',
    ]);
  });

  it('leaves the other rules alone when no contract file names the file', () => {
    const result = computeApply(FILE, SOURCE, manifest, undefined, { contractTargets: [] });
    expect(result.changed).toBe(false);
  });
});

describe('contract-wrap check', () => {
  it('reports pending before apply and applied afterwards', () => {
    const context = contextOf([entry('C-1', 'resolveBudget')]);
    expect(checkSource(FILE, SOURCE, manifest, context)).toMatchObject([
      { rule: 'contract-wrap', state: 'pending', anchor: 'resolveBudget (C-1)' },
    ]);
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context).text;
    expect(checkSource(FILE, applied, manifest, context)).toMatchObject([
      { rule: 'contract-wrap', state: 'applied' },
    ]);
  });

  it('reports unresolved when the contract names a symbol the source lost', () => {
    const context = contextOf([entry('C-9', 'renamedBudget'), entry('C-8', 'Registry.hidden')]);
    expect(checkSource(FILE, SOURCE, manifest, context).map((p) => p.state)).toEqual([
      'unresolved',
      'unresolved',
    ]);
  });

  it('reports stale-module when the predicate module is gone', () => {
    const context = contextOf([entry('C-1', 'resolveBudget')], 'missing');
    expect(checkSource(FILE, SOURCE, manifest, context)).toMatchObject([
      { rule: 'contract-wrap', state: 'stale-module' },
    ]);
  });

  it('reports orphaned for a contract-wrap marker no contract claims', () => {
    const text = 'const x = 1; /* augur-inject:contract-wrap:deadbeef */\n';
    expect(checkSource('a.ts', text, manifest, { contractTargets: [] })).toMatchObject([
      { rule: 'contract-wrap', id: 'deadbeef', state: 'orphaned' },
    ]);
  });

  it('treats a leftover predicate import as bookkeeping, orphaned only when alone', () => {
    const text = "import spec from './c.contract.ts'; /* augur-inject:contract-predicate:0a0a0a0a */\n";
    expect(checkSource('a.ts', text, manifest, { contractTargets: [] })).toMatchObject([
      { rule: 'contract-predicate', state: 'orphaned' },
    ]);
  });

  it('keeps the marker id stable across a file edit above the anchor', () => {
    const context = contextOf([entry('C-1', 'resolveBudget')]);
    const shifted = `// a new banner comment\n${SOURCE}`;
    const before = checkSource(FILE, SOURCE, manifest, context)[0];
    const after = checkSource(FILE, shifted, manifest, context)[0];
    expect(after?.id).toBe(before?.id);
    expect(after?.line).toBe((before?.line ?? 0) + 1);
  });
});

describe('contract selection against an Anatomia diff', () => {
  const analysis = {
    diff: {
      files: [
        { path: 'src/engine/budget.ts', added: [{ name: 'applyPlan' }, { name: 'register' }] },
        { path: 'src/other.ts', added: [{ name: 'resolveBudget' }] },
      ],
    },
  };

  it('keeps only contracts whose file:symbol the diff added', () => {
    const contracts = parseContractsManifest({
      version: 1,
      contracts: [entry('C-1', 'resolveBudget'), entry('C-2', 'applyPlan'), entry('C-3', 'Registry.register')],
    });
    const selected = selectAddedContracts(contracts, addedFunctionsOf(analysis));
    expect([...selected].sort()).toEqual(['C-2', 'C-3']);
  });

  it('builds targets for the selected ids only', () => {
    const contracts = parseContractsManifest({
      version: 1,
      contracts: [entry('C-1', 'resolveBudget'), entry('C-2', 'applyPlan')],
    });
    const selected = selectAddedContracts(contracts, addedFunctionsOf(analysis));
    const targets = buildContractTargets(contracts, () => 'ok', selected);
    expect(targets.map((t) => t.contractId)).toEqual(['C-2']);
    expect(targets[0]?.specifier).toBe('../../contracts/C-2.contract.ts');
  });

  it('targets every named contract when no diff narrows them', () => {
    const context = contextOf([entry('C-1', 'resolveBudget'), entry('C-2', 'applyPlan')]);
    expect(targetsOf(context)).toHaveLength(2);
  });
});

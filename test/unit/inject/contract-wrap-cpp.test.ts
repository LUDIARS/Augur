// contract-wrap on C++ sources (SPEC-CONTRACT-CPP-INJECT): symbol resolution,
// predicate headers, lint reasons, and the apply -> check -> remove round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareCppParser } from '../../../src/contracts/cpp/parser.ts';
import { classifyCppPredicate } from '../../../src/contracts/cpp/predicate.ts';
import { resolveCppSymbol } from '../../../src/contracts/cpp/symbols.ts';
import { lintContracts } from '../../../src/contracts/lint.ts';
import { parseContractsManifest } from '../../../src/contracts/manifest.ts';
import { computeApply } from '../../../src/inject/apply.ts';
import { checkSource } from '../../../src/inject/check.ts';
import { buildContractTargets } from '../../../src/inject/contract-targets.ts';
import { parseManifest } from '../../../src/inject/manifest.ts';
import { computeRemove } from '../../../src/inject/remove.ts';
import type { InjectContext } from '../../../src/inject/types.ts';

beforeAll(async () => {
  await prepareCppParser();
});

const manifest = parseManifest({ service: 'fixture' });
const FILE = 'src/geo/shape.cpp';
const HEADER = 'contracts/shape.contract.hpp';
const RUNTIME = 'augur/contract_runtime.hpp';

const SOURCE = [
  '#include "geo/shape.hpp"',
  '#include <string>',
  '',
  'namespace geo {',
  '',
  'int area(int width, int height) {',
  '  return width * height;',
  '}',
  '',
  'const std::string& Shape::name() const {',
  '  return name_;',
  '}',
  '',
  'void Shape::rename(std::string next) { name_ = next; }',
  '',
  'auto later(int x) -> long { return x; }',
  'auto deduced(int x) { return x; }',
  'int overloaded(int x) { return x; }',
  'int overloaded(double x) { return 1; }',
  'int unnamed(int) { return 0; }',
  '',
  '}  // namespace geo',
  '',
].join('\n');

const PREDICATES = [
  '#pragma once',
  '#include "augur/contract_runtime.hpp"',
  'namespace contracts {',
  'inline const auto area_checks = augur::predicates(',
  '    [](int w, int h) { return w >= 0 && h >= 0; },',
  '    [](int result, int, int) { return result >= 0 ? augur::pass() : augur::fail("negative area"); });',
  '}',
  '',
].join('\n');

function context(symbol: string, overrides: { importFrom?: string; predicateName?: string | undefined; sample?: number } = {}): InjectContext {
  const contracts = parseContractsManifest({
    version: 1,
    importFrom: overrides.importFrom ?? RUNTIME,
    contracts: [{ id: 'C-1', criterion: `C-1 ${symbol}`, symbol, file: FILE, module: HEADER, sample: overrides.sample }],
  });
  const name = 'predicateName' in overrides ? overrides.predicateName : 'contracts::area_checks';
  return { contractTargets: buildContractTargets(contracts, () => 'ok', undefined, () => name) };
}

describe('C++ symbol resolution', () => {
  it('resolves free, namespaced and member definitions with their return type and parameters', () => {
    expect(resolveCppSymbol(SOURCE, 'area')).toMatchObject({ line: 6, returnType: 'int', parameters: ['width', 'height'] });
    expect(resolveCppSymbol(SOURCE, 'geo::area')).toMatchObject({ line: 6 });
    expect(resolveCppSymbol(SOURCE, 'Shape.name')).toMatchObject({ line: 10, returnType: 'const std::string&', parameters: [] });
    expect(resolveCppSymbol(SOURCE, 'Shape.rename')).toMatchObject({ returnType: 'void', parameters: ['next'] });
    expect(resolveCppSymbol(SOURCE, 'later')).toMatchObject({ returnType: 'long', parameters: ['x'] });
  });

  it('resolves members defined inside the class body', () => {
    const inline = 'struct Box {\n  int area(int w) { return w; }\n};\n';
    expect(resolveCppSymbol(inline, 'Box.area')).toMatchObject({ line: 2, parameters: ['w'] });
    expect(resolveCppSymbol(inline, 'area')).toBeNull();
  });

  it('refuses ambiguous, missing and unwrappable functions, saying why', () => {
    expect(resolveCppSymbol(SOURCE, 'overloaded')).toBeNull();
    expect(resolveCppSymbol(SOURCE, 'missing')).toBeNull();
    expect(resolveCppSymbol(SOURCE, 'deduced')).toMatchObject({ unsupported: expect.stringMatching(/trailing return type/) });
    expect(resolveCppSymbol(SOURCE, 'unnamed')).toMatchObject({ unsupported: expect.stringMatching(/unnamed parameter/) });
    expect(resolveCppSymbol('int sum(int n, ...) { return n; }', 'sum')).toMatchObject({ unsupported: expect.stringMatching(/variadic/) });
    expect(resolveCppSymbol('task run(int n) { co_return n; }', 'run')).toMatchObject({ unsupported: expect.stringMatching(/coroutine/) });
    expect(resolveCppSymbol('constexpr int sq(int n) { return n * n; }', 'sq')).toMatchObject({ unsupported: expect.stringMatching(/constexpr/) });
    expect(resolveCppSymbol('struct S { S(int v) { (void)v; } };', 'S.S')).toMatchObject({ unsupported: expect.stringMatching(/constructors/) });
  });
});

describe('C++ predicate headers', () => {
  it('names the single predicate set and rejects headers without exactly one', () => {
    expect(classifyCppPredicate(PREDICATES)).toEqual({ state: 'ok', name: 'contracts::area_checks' });
    expect(classifyCppPredicate('inline const auto only = ::augur::post_only([](int r) { return r > 0; });')).toEqual({ state: 'ok', name: 'only' });
    expect(classifyCppPredicate('namespace c { int x = 1; }')).toEqual({ state: 'invalid-default' });
    expect(classifyCppPredicate(`${PREDICATES}namespace contracts { inline const auto again = augur::pre_only([] { return true; }); }`))
      .toEqual({ state: 'invalid-default' });
  });
});

describe('contracts lint on C++', () => {
  it('explains unwrappable symbols, malformed headers and a non-header runtime', () => {
    const contracts = parseContractsManifest({
      version: 1,
      importFrom: '@ludiars/log-weaver',
      contracts: [
        { id: 'C-1', criterion: 'C-1', symbol: 'deduced', file: FILE, module: HEADER },
        { id: 'C-2', criterion: 'C-2', symbol: 'area', file: FILE, module: 'contracts/bad.hpp' },
      ],
    });
    const findings = lintContracts(contracts, {
      source: (file) => (file === FILE ? SOURCE : undefined),
      predicate: (module) => (module === HEADER ? 'ok' : 'invalid-default'),
    });
    expect(findings.map((f) => [f.contractId, f.code])).toEqual([
      ['C-1', 'unresolved'],
      ['C-1', 'runtime-include'],
      ['C-2', 'runtime-include'],
      ['C-2', 'stale-module'],
    ]);
    expect(findings[0]!.message).toMatch(/trailing return type/);
    expect(findings[3]!.message).toMatch(/augur::predicates/);
  });
});

describe('contract-wrap apply / check / remove on C++', () => {
  it('passes an explicit sampling rate to the C++ runtime and removes the wrap cleanly', () => {
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context('area', { sample: 0.25 })).text;
    expect(applied).toMatch(/::augur::ContractSpec\{"C-1", "[0-9a-f]{8}", "src\/geo\/shape\.cpp:6", 0\.25\}/);
    expect(computeRemove(FILE, applied, ['contract-wrap']).text).toBe(SOURCE);
  });

  it('wraps the body in place with inserts only and adds the includes after the last directive', () => {
    const applied = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], context('area')).text;
    const lines = applied.split('\n');
    expect(lines[0]).toBe('#include "geo/shape.hpp"');
    expect(lines[1]).toBe('#include <string>');
    expect(lines[2]).toMatch(/^#include "augur\/contract_runtime\.hpp" \/\* augur-inject:import:[0-9a-f]{8} \*\/$/);
    expect(lines[3]).toMatch(/^#include "\.\.\/\.\.\/contracts\/shape\.contract\.hpp" \/\* augur-inject:contract-predicate:[0-9a-f]{8} \*\/$/);
    expect(applied).toMatch(
      /int area\(int width, int height\) \{ return ::augur::invoke_observed\(::augur::ContractSpec\{"C-1", "([0-9a-f]{8})", "src\/geo\/shape\.cpp:6"\}, contracts::area_checks, \[&\]\(\) -> int \{ \/\* augur-inject:contract-wrap:\1 \*\/\n  return width \* height;\n\}, width, height\); \/\* augur-inject:contract-end:\1 \*\/ \}/,
    );
    // Removing every inserted fragment gives the original bytes back.
    const stripped = applied
      .replace(/^#include "[^"]+" \/\* augur-inject:[a-z-]+:[0-9a-f]{8} \*\/\n/gm, '')
      .replace(/ return ::augur::invoke_observed\(.*?\/\* augur-inject:contract-wrap:[0-9a-f]{8} \*\//, '')
      .replace(/\}, width, height\); \/\* augur-inject:contract-end:[0-9a-f]{8} \*\/ /, '');
    expect(stripped).toBe(SOURCE);
  });

  it('reports applied after apply, adds nothing on a second apply, and remove restores the exact bytes', () => {
    const ctx = context('Shape.name');
    const once = computeApply(FILE, SOURCE, manifest, ['contract-wrap'], ctx);
    expect(once.changed).toBe(true);
    expect(once.text).toContain('[&]() -> const std::string& {');
    expect(once.text).toMatch(/\}\); \/\* augur-inject:contract-end:[0-9a-f]{8} \*\/ \}/);
    const points = checkSource(FILE, once.text, manifest, ctx);
    expect(points.map((p) => [p.rule, p.state])).toEqual([['contract-wrap', 'applied']]);
    expect(computeApply(FILE, once.text, manifest, ['contract-wrap'], ctx).changed).toBe(false);
    const removed = computeRemove(FILE, once.text, ['contract-wrap']);
    expect(removed.changed).toBe(true);
    expect(removed.text).toBe(SOURCE);
  });

  it('keeps CRLF files CRLF and restores them exactly', () => {
    const crlf = SOURCE.replace(/\n/g, '\r\n');
    const applied = computeApply(FILE, crlf, manifest, ['contract-wrap'], context('area')).text;
    expect(applied.replace(/\r\n/g, '')).not.toContain('\n');
    expect(computeRemove(FILE, applied).text).toBe(crlf);
  });

  it('reports a pending wrap before apply and the problem states that block it', () => {
    expect(checkSource(FILE, SOURCE, manifest, context('area')).map((p) => p.state)).toEqual(['pending']);
    expect(checkSource(FILE, SOURCE, manifest, context('deduced')).map((p) => p.state)).toEqual(['unresolved']);
    expect(checkSource(FILE, SOURCE, manifest, context('area', { importFrom: '@ludiars/log-weaver' })).map((p) => p.state)).toEqual(['unresolved']);
    expect(checkSource(FILE, SOURCE, manifest, context('area', { predicateName: undefined })).map((p) => p.state)).toEqual(['stale-module']);
  });

  it('never offers the JavaScript log rules on C++ text', () => {
    const points = checkSource(FILE, 'void f() { try { g(); } catch (...) {} }\n', manifest);
    expect(points).toEqual([]);
  });
});

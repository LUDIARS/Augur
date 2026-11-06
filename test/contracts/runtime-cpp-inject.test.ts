// End to end for C++ contract injection (SPEC-CONTRACT-CPP-INJECT): inject a
// contract into a real C++ file, compile it against the synced runtime header,
// run it, and read the observations back from contracts.jsonl. Then remove the
// injection and confirm the original file compiles unchanged.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareCppParser } from '../../src/contracts/cpp/parser.ts';
import { classifyCppPredicate } from '../../src/contracts/cpp/predicate.ts';
import { parseContractsManifest } from '../../src/contracts/manifest.ts';
import { readContractRuntimeTemplate } from '../../src/contracts/runtime-files.ts';
import { renderContractRuntime } from '../../src/contracts/runtime-template.ts';
import { computeApply } from '../../src/inject/apply.ts';
import { buildContractTargets } from '../../src/inject/contract-targets.ts';
import { parseManifest } from '../../src/inject/manifest.ts';
import { computeRemove } from '../../src/inject/remove.ts';
import { buildProgram, type CppBuild } from './cpp-runtime/compiler.ts';

const SHAPE = [
  '#include "geo/shape.hpp"',
  '',
  'namespace geo {',
  'int area(int width, int height) {',
  '  return width * height;',
  '}',
  '}  // namespace geo',
  '',
].join('\n');

const SHAPE_HEADER = '#pragma once\nnamespace geo { int area(int width, int height); }\n';

const PREDICATES = [
  '#pragma once',
  '#include "augur/contract_runtime.hpp"',
  'namespace contracts {',
  'inline const auto area_checks = augur::predicates(',
  '    [](int width, int height) { return width >= 0 && height >= 0; },',
  '    [](int result, int, int) { return result >= 0 ? augur::pass() : augur::fail("negative area"); });',
  '}  // namespace contracts',
  '',
].join('\n');

const MAIN = [
  '#include <iostream>',
  '#include "geo/shape.hpp"',
  'int main() {',
  '  std::cout << geo::area(2, 3) << " " << geo::area(-1, 2) << "\\n";',
  '  return 0;',
  '}',
  '',
].join('\n');

/** Compiling and linking a C++ program under a loaded test run takes seconds, not milliseconds. */
const COMPILE_TIMEOUT_MS = 180_000;

const root = mkdtempSync(join(tmpdir(), 'augur-cpp-inject-'));
let injected = '';

function write(relative: string, text: string): string {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

function build(name: string): CppBuild {
  return buildProgram({
    sources: [join(root, 'src', 'geo', 'shape.cpp'), join(root, 'src', 'main.cpp')],
    includeDirs: [join(root, 'include')],
    outDir: root,
    name,
  });
}

beforeAll(async () => {
  await prepareCppParser();
  write('include/augur/contract_runtime.hpp', renderContractRuntime(readContractRuntimeTemplate('hpp')));
  write('include/geo/shape.hpp', SHAPE_HEADER);
  write('contracts/shape.contract.hpp', PREDICATES);
  write('src/main.cpp', MAIN);
  const shape = classifyCppPredicate(PREDICATES);
  const contracts = parseContractsManifest({
    version: 1,
    importFrom: 'augur/contract_runtime.hpp',
    contracts: [{ id: 'C-AREA', criterion: 'C-AREA area', symbol: 'geo::area', file: 'src/geo/shape.cpp', module: 'contracts/shape.contract.hpp' }],
  });
  const context = {
    contractTargets: buildContractTargets(contracts, () => 'ok', undefined, () => (shape.state === 'ok' ? shape.name : undefined)),
  };
  injected = computeApply('src/geo/shape.cpp', SHAPE, parseManifest({ service: 'fixture' }), ['contract-wrap'], context).text;
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('C++ contract injection end to end', () => {
  it('compiles the injected file, keeps results, and records the observations', (context) => {
    write('src/geo/shape.cpp', injected);
    const program = build('injected');
    if (!('executable' in program)) return context.skip();
    const logs = join(root, 'logs');
    const run = spawnSync(program.executable, [], { encoding: 'utf8', env: { ...process.env, VESTIGIUM_LOGS_DIR: logs } });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('6 -2');
    const events = readFileSync(join(logs, 'contracts.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { msg: string; ctx: Record<string, string> });
    expect(events.map((event) => [event.msg, event.ctx.phase, event.ctx.reason])).toEqual([
      ['contract observed', 'ok', undefined],
      ['contract violated', 'pre', 'predicate failed'],
      ['contract violated', 'post', 'negative area'],
    ]);
    expect(events[0]!.ctx).toMatchObject({ contract: 'C-AREA', where: 'src/geo/shape.cpp:4' });
    expect(JSON.stringify(events)).not.toContain('"6"');
  }, COMPILE_TIMEOUT_MS);

  it('removes back to a file that is byte-identical to the original and still compiles', (context) => {
    const restored = computeRemove('src/geo/shape.cpp', injected).text;
    expect(restored).toBe(SHAPE);
    write('src/geo/shape.cpp', restored);
    const program = build('restored');
    if (!('executable' in program)) return context.skip();
    expect(spawnSync(program.executable, [], { encoding: 'utf8' }).stdout.trim()).toBe('6 -2');
  }, COMPILE_TIMEOUT_MS);
});

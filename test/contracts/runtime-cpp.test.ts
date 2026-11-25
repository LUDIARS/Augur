// Behaviour of the C++ contract runtime template (SPEC-CONTRACT-RUNTIME-TEMPLATE).
// The same rules runtime-rotation.test.ts holds the .ts/.mjs flavors to, run
// against contract-runtime.hpp through a compiled driver. Each driver run is a
// separate process — the C++ equivalent of a fresh module instance.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDriver, type CppBuild } from './cpp-runtime/compiler.ts';

const DRIVER_SOURCE = resolve(import.meta.dirname, 'cpp-runtime', 'driver.cpp');
const buildDir = mkdtempSync(join(tmpdir(), 'augur-cpp-runtime-build-'));
const directories: string[] = [];
let build: CppBuild = { unavailable: 'not built yet' };

beforeAll(() => {
  build = buildDriver(DRIVER_SOURCE, buildDir);
}, 180_000);

afterAll(() => rmSync(buildDir, { recursive: true, force: true }));
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function logsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'augur-cpp-runtime-'));
  directories.push(dir);
  return dir;
}

function drive(dir: string, iso: string, scenario: string, retention = ''): string {
  if (!('executable' in build)) throw new Error(build.unavailable);
  const env: NodeJS.ProcessEnv = { ...process.env, VESTIGIUM_LOGS_DIR: dir, AUGUR_CONTRACT_LOG_RETENTION_DAYS: retention };
  const result = spawnSync(build.executable, [String(Date.parse(iso)), scenario], { encoding: 'utf8', env });
  if (result.status !== 0) throw new Error(`driver ${scenario} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}

function linesOf(path: string): Array<{ time: string; msg: string; ctx: Record<string, string> }> {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as never);
}

function ageActive(dir: string, iso: string): void {
  const seconds = Date.parse(iso) / 1000;
  utimesSync(join(dir, 'contracts.jsonl'), seconds, seconds);
}

const compiled = (): boolean => 'executable' in build;

describe('contract runtime template (contract-runtime.hpp)', () => {
  it('compiles with a C++17 compiler or states why it cannot', () => {
    if (!compiled()) console.warn(`C++ contract runtime suite skipped: ${(build as { unavailable: string }).unavailable}`);
    expect(build).toBeDefined();
  });

  it('records the verdict without changing results or exceptions', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    expect(drive(dir, '2026-10-14T03:00:00.000Z', 'verdicts')).toBe('4 -2 boom');
    const events = linesOf(join(dir, 'contracts.jsonl'));
    expect(events.map((event) => event.msg)).toEqual([
      'contract observed', 'contract violated', 'contract predicate threw',
      'contract violated', 'contract violated', 'contract observed',
    ]);
    expect(events[1]!.ctx).toEqual({
      contract: 'C-1', id: 'marker', where: 'src/a.cpp:1', observed_at: '2026-10-14T03:00:00.000Z', phase: 'post', reason: 'not positive',
    });
    expect(events[2]!.ctx).toMatchObject({ phase: 'pre', reason: 'pre predicate threw' });
    // bool false is "predicate failed"; a non-empty string is the reason; an empty one passes.
    expect(events[3]!.ctx).toMatchObject({ phase: 'pre', reason: 'predicate failed' });
    expect(events[4]!.ctx).toMatchObject({ phase: 'post', reason: 'small' });
    expect(events[5]!.ctx).toMatchObject({ phase: 'ok' });
    expect(events[0]!.time).toBe('2026-10-14T03:00:00.000Z');
    expect(Object.keys(events[0]!)).toEqual(['time', 'msg', 'ctx']);
    expect(JSON.stringify(events)).not.toContain('"2"');
  });

  it('samples successful observations but always records predicate failures', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    drive(dir, '2026-10-14T03:00:00.000Z', 'sampling');
    expect(linesOf(join(dir, 'contracts.jsonl')).map(({ msg, ctx }) => [msg, ctx.phase])).toEqual([
      ['contract violated', 'pre'], ['contract violated', 'post'],
      ['contract predicate threw', 'pre'], ['contract predicate threw', 'post'],
      ['contract observed', 'ok'],
    ]);
  });

  it('records all successful observations for the default, 1 and invalid sample rates', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    drive(dir, '2026-10-14T03:00:00.000Z', 'full-sampling');
    expect(linesOf(join(dir, 'contracts.jsonl')).map(({ ctx }) => ctx.phase)).toEqual(Array<string>(7).fill('ok'));
  });

  it('escapes context strings as JSON', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    drive(dir, '2026-10-14T03:00:00.000Z', 'escaped');
    expect(linesOf(join(dir, 'contracts.jsonl'))[0]!.ctx).toMatchObject({ contract: 'C-"2"', id: 'line\nbreak', where: 'C:\\src\\a.cpp:3' });
  });

  it('never fails the caller when the log directory is unusable', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    const blocked = join(dir, 'not-a-directory');
    writeFileSync(blocked, '', 'utf8');
    expect(drive(blocked, '2026-10-14T03:00:00.000Z', 'ok')).toBe('ok');
  });

  it('moves the previous JST day to archive/contracts-YYYY-MM-DD.jsonl on the first write of a new day', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    drive(dir, '2026-10-13T14:59:59.000Z', 'ok');
    ageActive(dir, '2026-10-13T14:59:59.000Z');
    drive(dir, '2026-10-13T15:00:00.000Z', 'ok');
    const archived = join(dir, 'archive', 'contracts-2026-10-13.jsonl');
    expect(linesOf(archived).map((event) => event.ctx.observed_at)).toEqual(['2026-10-13T14:59:59.000Z']);
    expect(linesOf(join(dir, 'contracts.jsonl')).map((event) => event.ctx.observed_at)).toEqual(['2026-10-13T15:00:00.000Z']);
    expect(readdirSync(join(dir, 'archive'))).toEqual(['contracts-2026-10-13.jsonl']);
  });

  it('keeps writing to the active file within the same JST day', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    drive(dir, '2026-10-14T00:00:00.000Z', 'ok');
    ageActive(dir, '2026-10-14T00:00:00.000Z');
    drive(dir, '2026-10-14T14:00:00.000Z', 'ok');
    expect(existsSync(join(dir, 'archive'))).toBe(false);
    expect(linesOf(join(dir, 'contracts.jsonl'))).toHaveLength(2);
  });

  it('appends to an existing archive of the same day instead of overwriting it', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    mkdirSync(join(dir, 'archive'));
    writeFileSync(join(dir, 'archive', 'contracts-2026-10-12.jsonl'), '{"msg":"earlier"}\n', 'utf8');
    writeFileSync(join(dir, 'contracts.jsonl'), '{"msg":"later"}\n', 'utf8');
    ageActive(dir, '2026-10-12T03:00:00.000Z');
    drive(dir, '2026-10-13T03:00:00.000Z', 'ok');
    expect(linesOf(join(dir, 'archive', 'contracts-2026-10-12.jsonl')).map((event) => event.msg)).toEqual(['earlier', 'later']);
  });

  it('lets exactly one of several processes rotate, losing no line', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    writeFileSync(join(dir, 'contracts.jsonl'), '{"msg":"yesterday"}\n', 'utf8');
    ageActive(dir, '2026-10-12T03:00:00.000Z');
    drive(dir, '2026-10-13T03:00:00.000Z', 'ok');
    drive(dir, '2026-10-13T03:00:00.000Z', 'ok');
    expect(linesOf(join(dir, 'archive', 'contracts-2026-10-12.jsonl')).map((event) => event.msg)).toEqual(['yesterday']);
    expect(linesOf(join(dir, 'contracts.jsonl'))).toHaveLength(2);
    expect(readdirSync(join(dir, 'archive'))).toEqual(['contracts-2026-10-12.jsonl']);
  });

  it('deletes archives older than 7 days by default, and honours the retention override', (context) => {
    if (!compiled()) return context.skip();
    const dir = logsDir();
    mkdirSync(join(dir, 'archive'));
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      writeFileSync(join(dir, 'archive', `contracts-${day}.jsonl`), '{}\n', 'utf8');
    }
    writeFileSync(join(dir, 'archive', '.contracts-2026-10-01.9.9.part'), '{}\n', 'utf8');
    writeFileSync(join(dir, 'archive', 'unrelated.txt'), 'keep\n', 'utf8');
    writeFileSync(join(dir, 'contracts.jsonl'), '{}\n', 'utf8');
    ageActive(dir, '2026-10-12T03:00:00.000Z');
    drive(dir, '2026-10-13T03:00:00.000Z', 'ok');
    expect(readdirSync(join(dir, 'archive')).sort()).toEqual([
      'contracts-2026-10-06.jsonl', 'contracts-2026-10-07.jsonl', 'contracts-2026-10-12.jsonl', 'unrelated.txt',
    ]);

    ageActive(dir, '2026-10-13T03:00:00.000Z');
    drive(dir, '2026-10-14T03:00:00.000Z', 'ok', '1');
    expect(readdirSync(join(dir, 'archive')).sort()).toEqual(['contracts-2026-10-13.jsonl', 'unrelated.txt']);
  });
});

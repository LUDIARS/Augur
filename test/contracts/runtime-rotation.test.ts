// Behaviour of the contract runtime template (SPEC-CONTRACT-RUNTIME-TEMPLATE).
// Both flavors run the same suite: the .mjs copy must keep every rule of the .ts one.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Contract = (fn: (...args: never[]) => unknown, spec: Record<string, unknown>) => (...args: unknown[]) => unknown;

const FLAVORS = {
  'contract-runtime.ts': () => import('../../templates/contract-runtime/contract-runtime.ts'),
  // @ts-expect-error -- the plain template ships no declaration file; the suite treats both as `Contract`.
  'contract-runtime.mjs': () => import('../../templates/contract-runtime/contract-runtime.mjs'),
} as const;
type Flavor = keyof typeof FLAVORS;
const SPEC = { contractId: 'C-1', id: 'marker', where: 'src/a.ts:1' };
const directories: string[] = [];

/** A fresh module instance, so the per-process "day already checked" cache starts empty. */
async function loadRuntime(file: Flavor): Promise<Contract> {
  vi.resetModules();
  const module = await FLAVORS[file]() as unknown as { contract: Contract };
  return module.contract;
}

function logsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'augur-runtime-'));
  directories.push(dir);
  vi.stubEnv('VESTIGIUM_LOGS_DIR', dir);
  return dir;
}

function linesOf(path: string): Array<{ msg: string; ctx: Record<string, string> }> {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { msg: string; ctx: Record<string, string> });
}

function at(iso: string): number {
  const time = Date.parse(iso);
  vi.setSystemTime(time);
  return time;
}

/** The runtime reads the file's mtime as "the day it holds"; tests place it on the fake clock. */
function ageActive(dir: string, epochMs: number): void {
  utimesSync(join(dir, 'contracts.jsonl'), epochMs / 1000, epochMs / 1000);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.stubEnv('AUGUR_CONTRACT_LOG_RETENTION_DAYS', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.each(Object.keys(FLAVORS) as Flavor[])('contract runtime template (%s)', (file) => {
  it('records the verdict without changing results, exceptions or rejections', async () => {
    const dir = logsDir();
    const contract = await loadRuntime(file);
    const double = contract((value: never) => (value as number) * 2, { ...SPEC, post: (result: number) => result > 0 || 'not positive' });
    expect(double(2)).toBe(4);
    expect(double(-1)).toBe(-2);
    const boom = contract(() => { throw new Error('boom'); }, { ...SPEC, pre: () => { throw new Error('predicate'); } });
    expect(() => boom()).toThrow('boom');
    const rejected = contract(async () => { throw new Error('async'); }, SPEC);
    await expect(rejected()).rejects.toThrow('async');
    const resolved = contract(async () => 7, SPEC);
    await expect(resolved()).resolves.toBe(7);

    const events = linesOf(join(dir, 'contracts.jsonl'));
    expect(events.map((event) => event.msg)).toEqual([
      'contract observed', 'contract violated', 'contract predicate threw', 'contract observed',
    ]);
    expect(events[1]!.ctx).toMatchObject({ contract: 'C-1', id: 'marker', phase: 'post', reason: 'not positive' });
    expect(JSON.stringify(events)).not.toContain('"2"');
  });

  it('never throws into the caller when the log directory is unusable', async () => {
    const dir = logsDir();
    const blocked = join(dir, 'not-a-directory');
    writeFileSync(blocked, '', 'utf8');
    vi.stubEnv('VESTIGIUM_LOGS_DIR', blocked);
    const contract = await loadRuntime(file);
    expect(contract(() => 'ok', SPEC)()).toBe('ok');
  });

  it('moves the previous JST day to archive/contracts-YYYY-MM-DD.jsonl on the first write of a new day', async () => {
    const dir = logsDir();
    const contract = await loadRuntime(file);
    const wrapped = contract(() => 'ok', SPEC);
    // 23:59:59 JST on 10-13 is 14:59:59Z; the next second is 10-14 in Japan.
    const lateEvening = at('2026-10-13T14:59:59.000Z');
    wrapped();
    ageActive(dir, lateEvening);
    at('2026-10-13T15:00:00.000Z');
    wrapped();

    const archived = join(dir, 'archive', 'contracts-2026-10-13.jsonl');
    expect(linesOf(archived).map((event) => event.ctx.observed_at)).toEqual(['2026-10-13T14:59:59.000Z']);
    expect(linesOf(join(dir, 'contracts.jsonl')).map((event) => event.ctx.observed_at)).toEqual(['2026-10-13T15:00:00.000Z']);
    expect(readdirSync(join(dir, 'archive'))).toEqual(['contracts-2026-10-13.jsonl']);
  });

  it('keeps writing to the active file within the same JST day', async () => {
    const dir = logsDir();
    const contract = await loadRuntime(file);
    // 09:00 JST and 23:00 JST on 10-14 straddle midnight UTC but not midnight JST.
    const morning = at('2026-10-14T00:00:00.000Z');
    contract(() => 'ok', SPEC)();
    ageActive(dir, morning);
    const fresh = await loadRuntime(file);
    at('2026-10-14T14:00:00.000Z');
    fresh(() => 'ok', SPEC)();
    expect(existsSync(join(dir, 'archive'))).toBe(false);
    expect(linesOf(join(dir, 'contracts.jsonl'))).toHaveLength(2);
  });

  it('appends to an existing archive of the same day instead of overwriting it', async () => {
    const dir = logsDir();
    mkdirSync(join(dir, 'archive'));
    writeFileSync(join(dir, 'archive', 'contracts-2026-10-12.jsonl'), '{"msg":"earlier"}\n', 'utf8');
    writeFileSync(join(dir, 'contracts.jsonl'), '{"msg":"later"}\n', 'utf8');
    ageActive(dir, Date.parse('2026-10-12T03:00:00.000Z'));
    at('2026-10-13T03:00:00.000Z');
    (await loadRuntime(file))(() => 'ok', SPEC)();
    expect(linesOf(join(dir, 'archive', 'contracts-2026-10-12.jsonl')).map((event) => event.msg)).toEqual(['earlier', 'later']);
  });

  it('lets exactly one of several processes rotate, losing no line', async () => {
    const dir = logsDir();
    writeFileSync(join(dir, 'contracts.jsonl'), '{"msg":"yesterday"}\n', 'utf8');
    ageActive(dir, Date.parse('2026-10-12T03:00:00.000Z'));
    at('2026-10-13T03:00:00.000Z');
    // Separate module instances stand in for separate processes sharing VESTIGIUM_LOGS_DIR.
    const first = await loadRuntime(file);
    const second = await loadRuntime(file);
    first(() => 'ok', SPEC)();
    second(() => 'ok', SPEC)();
    expect(linesOf(join(dir, 'archive', 'contracts-2026-10-12.jsonl')).map((event) => event.msg)).toEqual(['yesterday']);
    expect(linesOf(join(dir, 'contracts.jsonl'))).toHaveLength(2);
    expect(readdirSync(join(dir, 'archive'))).toEqual(['contracts-2026-10-12.jsonl']);
  });

  it('deletes archives older than 7 days by default, and honours the retention override', async () => {
    const dir = logsDir();
    mkdirSync(join(dir, 'archive'));
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      writeFileSync(join(dir, 'archive', `contracts-${day}.jsonl`), '{}\n', 'utf8');
    }
    writeFileSync(join(dir, 'archive', '.contracts-2026-10-01.9.9.part'), '{}\n', 'utf8');
    writeFileSync(join(dir, 'archive', 'unrelated.txt'), 'keep\n', 'utf8');
    writeFileSync(join(dir, 'contracts.jsonl'), '{}\n', 'utf8');
    ageActive(dir, Date.parse('2026-10-12T03:00:00.000Z'));
    at('2026-10-13T03:00:00.000Z');
    (await loadRuntime(file))(() => 'ok', SPEC)();
    expect(readdirSync(join(dir, 'archive')).sort()).toEqual([
      'contracts-2026-10-06.jsonl', 'contracts-2026-10-07.jsonl', 'contracts-2026-10-12.jsonl', 'unrelated.txt',
    ]);

    vi.stubEnv('AUGUR_CONTRACT_LOG_RETENTION_DAYS', '1');
    ageActive(dir, Date.parse('2026-10-13T03:00:00.000Z'));
    at('2026-10-14T03:00:00.000Z');
    (await loadRuntime(file))(() => 'ok', SPEC)();
    expect(readdirSync(join(dir, 'archive')).sort()).toEqual(['contracts-2026-10-13.jsonl', 'unrelated.txt']);
  });
});

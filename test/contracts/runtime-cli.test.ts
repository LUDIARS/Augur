import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageError } from '../../src/cli/args.ts';
import { runContractsCommand } from '../../src/cli/contracts.ts';
import type { CliIo } from '../../src/cli/main.ts';
import { readContractRuntimeTemplate } from '../../src/contracts/runtime-files.ts';

const directories: string[] = [];

function project(manifest: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'augur-runtime-cli-'));
  directories.push(dir);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'augur.contracts.json'), JSON.stringify({ version: 1, contracts: [], ...manifest }), 'utf8');
  return dir;
}

async function run(dir: string, argv: readonly string[]): Promise<{ exit: number; stdout: string }> {
  let stdout = '';
  const io: CliIo = { cwd: dir, stdout: (text) => { stdout += text; }, stderr: () => {}, readStdin: () => '' };
  const exit = await runContractsCommand(['runtime', ...argv, '--project', dir], io);
  return { exit, stdout };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('augur contracts runtime', () => {
  it('syncs the typed template to runtimeFile and then reports it current', async () => {
    const dir = project({ runtimeFile: 'src/contract-runtime.ts' });
    expect((await run(dir, ['check'])).exit).toBe(1);
    const synced = await run(dir, ['sync', '--json']);
    expect(JSON.parse(synced.stdout)).toMatchObject({ runtimeFile: 'src/contract-runtime.ts', previous: 'missing', written: true });
    const written = readFileSync(join(dir, 'src', 'contract-runtime.ts'), 'utf8');
    expect(written).toMatch(/^\/\/ augur-contract-runtime version=\d+ sha256=/);
    expect(written.endsWith(readContractRuntimeTemplate('ts').replace(/\r\n/g, '\n'))).toBe(true);
    expect(await run(dir, ['check'])).toMatchObject({ exit: 0 });
    expect(JSON.parse((await run(dir, ['sync', '--json'])).stdout)).toMatchObject({ previous: 'current', written: false });
  });

  it('writes the plain template for an .mjs path given on the command line', async () => {
    const dir = project();
    await run(dir, ['sync', '--path', 'src/contract-runtime.mjs']);
    expect(readFileSync(join(dir, 'src', 'contract-runtime.mjs'), 'utf8')).not.toContain('export interface');
    expect((await run(dir, ['check', '--path', 'src/contract-runtime.mjs'])).exit).toBe(0);
  });

  it('flags a hand-edited copy and replaces it on sync', async () => {
    const dir = project({ runtimeFile: 'src/contract-runtime.mjs' });
    await run(dir, ['sync']);
    const path = join(dir, 'src', 'contract-runtime.mjs');
    writeFileSync(path, `${readFileSync(path, 'utf8')}// local tweak\n`, 'utf8');
    const checked = await run(dir, ['check', '--json']);
    expect(checked.exit).toBe(1);
    expect(JSON.parse(checked.stdout)).toMatchObject({ state: 'modified' });
    expect(JSON.parse((await run(dir, ['sync', '--json'])).stdout)).toMatchObject({ previous: 'modified', written: true });
    expect((await run(dir, ['check'])).exit).toBe(0);
  });

  it('refuses a missing target, a path outside the project and an unknown extension', async () => {
    const dir = project();
    await expect(run(dir, ['check'])).rejects.toThrow(/runtimeFile/);
    await expect(run(dir, ['sync', '--path', '../escape.mjs'])).rejects.toThrow(UsageError);
    await expect(run(dir, ['sync', '--path', 'src/runtime.cjs'])).rejects.toThrow(/must end in/);
    await expect(run(dir, ['publish'])).rejects.toThrow(/unknown contracts runtime verb/);
  });
});

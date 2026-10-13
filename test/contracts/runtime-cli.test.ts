import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// Only capability/permission failures skip link cases; other setup errors fail.
function directoryLink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

describe('runtime sync path containment', () => {
  it.for(['manifest', 'override'] as const)('rejects external parents via %s before creating files or directories', async (source, context) => {
    const outside = project();
    const dir = project();
    if (!directoryLink(outside, join(dir, 'linked'))) {
      context.skip();
      return;
    }
    for (const runtimeFile of ['linked/runtime.mjs', 'linked/missing/deeper/runtime.mjs']) {
      const argv = source === 'override' ? ['sync', '--path', runtimeFile] : ['sync'];
      if (source === 'manifest') {
        writeFileSync(join(dir, 'augur.contracts.json'), JSON.stringify({ version: 1, contracts: [], runtimeFile }), 'utf8');
      }
      await expect(run(dir, argv)).rejects.toThrow(new Error('contract path leaves project: ' + runtimeFile));
      expect(existsSync(join(outside, 'runtime.mjs'))).toBe(false);
      expect(existsSync(join(outside, 'missing'))).toBe(false);
    }
  });

  it('preserves rejection of an existing external copy', async (context) => {
    const dir = project({ runtimeFile: 'linked/runtime.mjs' });
    const outside = project();
    const copy = join(outside, 'runtime.mjs');
    writeFileSync(copy, 'untouched', 'utf8');
    if (!directoryLink(outside, join(dir, 'linked'))) {
      context.skip();
      return;
    }
    await expect(run(dir, ['sync'])).rejects.toThrow(new Error('contract path leaves project: linked/runtime.mjs'));
    expect(readFileSync(copy, 'utf8')).toBe('untouched');
  });

  it('creates ordinary missing parent directories recursively', async () => {
    const dir = project({ runtimeFile: 'new/deeper/runtime.mjs' });
    expect(await run(dir, ['sync'])).toMatchObject({ exit: 0 });
    expect(readFileSync(join(dir, 'new/deeper/runtime.mjs'), 'utf8')).toContain('augur-contract-runtime');
    expect(await run(dir, ['check'])).toMatchObject({ exit: 0 });
  });

  it('allows missing directories under a link that stays inside the project', async (context) => {
    const dir = project({ runtimeFile: 'linked/new/runtime.mjs' });
    if (!directoryLink(join(dir, 'src'), join(dir, 'linked'))) {
      context.skip();
      return;
    }
    expect(await run(dir, ['sync'])).toMatchObject({ exit: 0 });
    expect(readFileSync(join(dir, 'src/new/runtime.mjs'), 'utf8')).toContain('augur-contract-runtime');
    expect(await run(dir, ['check'])).toMatchObject({ exit: 0 });
  });
});

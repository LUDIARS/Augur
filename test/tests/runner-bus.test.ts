import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { LocalBus } from '../../src/bus/local.ts';
import { expandWrapper, posixQuote } from '../../src/bus/wrapper.ts';
import { vitestRunner } from '../../src/tests/runners/vitest.ts';
import { record } from './fixtures.ts';

describe('vitest JSON runner', () => {
  const invocation = {
    runner: 'vitest' as const,
    argv: ['npx', 'vitest', 'run', 'test/example.test.ts', '--reporter=json'],
    tests: [record()],
  };

  it('builds shell-free invocations: repo-local vitest by default and npx rewritten to it', () => {
    const tests = [record()];
    const byDefault = vitestRunner.buildInvocations(tests, {});
    expect(byDefault[0]?.argv.slice(0, 3)).toEqual(['node', 'node_modules/vitest/vitest.mjs', 'run']);
    const fromNpx = vitestRunner.buildInvocations(tests, { command: ['npx', 'vitest', 'run'] });
    expect(fromNpx[0]?.argv.slice(0, 3)).toEqual(['node', 'node_modules/vitest/vitest.mjs', 'run']);
    const explicit = vitestRunner.buildInvocations(tests, { command: ['node', 'tools/vitest.mjs', 'run'] });
    expect(explicit[0]?.argv.slice(0, 3)).toEqual(['node', 'tools/vitest.mjs', 'run']);
  });

  it('matches reporter assertions by file and fullName', () => {
    const report = {
      testResults: [{
        name: '/work/test/example.test.ts',
        assertionResults: [{
          ancestorTitles: ['suite'],
          title: 'works',
          fullName: 'suite works',
          status: 'passed',
          duration: 12,
        }],
      }],
    };
    expect(vitestRunner.parse(invocation, { exitCode: 0, stdout: JSON.stringify(report), stderr: '', timedOut: false })).toEqual([
      { testId: 't-000000000001', status: 'passed', durationMs: 12 },
    ]);
  });

  it('marks a registered test missing from reporter output as error', () => {
    const results = vitestRunner.parse(invocation, {
      exitCode: 0,
      stdout: JSON.stringify({ testResults: [{ name: '/work/test/example.test.ts', assertionResults: [] }] }),
      stderr: '',
      timedOut: false,
    });
    expect(results[0]).toMatchObject({ status: 'error', failureMessage: 'not found in reporter output' });
  });

  it('matches a selector when the registry display name differs', () => {
    const selected = { ...invocation, tests: [record({ name: 'human label', selector: 'suite works' })] };
    const report = {
      testResults: [{
        name: '/work/test/example.test.ts',
        assertionResults: [{ fullName: 'suite works', status: 'passed', duration: 8 }],
      }],
    };
    expect(vitestRunner.parse(selected, {
      exitCode: 0,
      stdout: JSON.stringify(report),
      stderr: '',
      timedOut: false,
    })).toEqual([{ testId: 't-000000000001', status: 'passed', durationMs: 8 }]);
  });

  it('does not certify passing assertions when the Vitest process exits non-zero', () => {
    const report = {
      testResults: [{
        name: '/work/test/example.test.ts',
        assertionResults: [{ fullName: 'suite works', status: 'passed', duration: 12 }],
      }],
    };
    expect(vitestRunner.parse(invocation, {
      exitCode: 1,
      stdout: JSON.stringify(report),
      stderr: 'unhandled teardown failure',
      timedOut: false,
    })[0]).toMatchObject({ status: 'error', failureMessage: expect.stringContaining('exited 1') });
  });
});

describe('execution buses', () => {
  it('local bus spawns the runner binary directly and never a shell', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid: number;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 123;
    child.kill = vi.fn();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    const bus = new LocalBus('local', spawn as never);
    await bus.exec({ cwd: '/work', argv: ['vitest', 'run', 'file with spaces.test.ts'], env: { PATH: '/bin' }, timeoutMs: 1000 });
    expect(spawn).toHaveBeenCalledOnce();
    const call = (spawn.mock.calls as unknown[][])[0]!;
    expect(call[0]).toBe('vitest');
    expect(call[1]).toEqual(['run', 'file with spaces.test.ts']);
    expect(call[2]).toMatchObject({ shell: false, cwd: '/work' });
  });

  it('POSIX-quotes wrapper argv containing spaces and quotes', () => {
    expect(posixQuote("it's spaced")).toBe("'it'\\''s spaced'");
    expect(expandWrapper(
      ['docker', 'sh', '-lc', '{cmd}', '{cwd}', '{cwd_posix}'],
      { argv: ['node', 'a b', "it's"], cwd: 'E:\\Work Tree; touch escaped' },
    )).toEqual([
      'docker',
      'sh',
      '-lc',
      "'node' 'a b' 'it'\\''s'",
      'E:\\Work Tree; touch escaped',
      "'/mnt/e/Work Tree; touch escaped'",
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { vitestRunner } from '../../src/tests/runners/vitest.ts';
import { isFileLevelTest } from '../../src/tests/runners/vitest-file-result.ts';
import { record } from './fixtures.ts';

const FILE = 'src/delegation/commit-request.test.ts';
const fileLevel = record({ name: FILE, file: FILE });
const invocation = { runner: 'vitest' as const, argv: [], tests: [fileLevel] };

function parse(assertions: unknown[], options: { exitCode?: number; message?: string } = {}) {
  const report = {
    testResults: [{
      // The reporter names files by absolute worktree path with forward slashes.
      name: `E:/tmp/revisor-scratch/revisor-local-pr-x/head/${FILE}`,
      assertionResults: assertions,
      ...(options.message === undefined ? {} : { message: options.message }),
    }],
  };
  return vitestRunner.parse(invocation, {
    exitCode: options.exitCode ?? 0, stdout: JSON.stringify(report), stderr: '', timedOut: false,
  })[0];
}

describe('file-level vitest registrations', () => {
  it('treats an entry named after its own file (without selector) as the whole file', () => {
    expect(isFileLevelTest(fileLevel)).toBe(true);
    expect(isFileLevelTest(record({ name: 'src\\delegation\\commit-request.test.ts', file: FILE }))).toBe(true);
    expect(isFileLevelTest(record({ name: FILE, file: FILE, selector: 'suite works' }))).toBe(false);
    expect(isFileLevelTest(record({ name: 'suite works', file: FILE }))).toBe(false);
  });

  it('passes when every assertion in the file passed', () => {
    expect(parse([
      { fullName: 'parse ok', status: 'passed', duration: 2 },
      { fullName: 'parse rejects', status: 'passed', duration: 3 },
    ])).toEqual({ testId: fileLevel.id, status: 'passed', durationMs: 5 });
  });

  it('fails with the failing assertion messages when any assertion failed', () => {
    const result = parse([
      { fullName: 'parse ok', status: 'passed', duration: 2 },
      { fullName: 'parse rejects', status: 'failed', duration: 1, failureMessages: ['expected ok'] },
    ], { exitCode: 1 });
    expect(result).toMatchObject({ status: 'failed', failureMessage: 'expected ok' });
  });

  it('fails a file that could not be collected and reports skipped for an all-skipped file', () => {
    expect(parse([], { exitCode: 1, message: 'Failed to load module' })).toMatchObject({
      status: 'failed', failureMessage: 'Failed to load module',
    });
    expect(parse([{ fullName: 'later', status: 'skipped' }])).toMatchObject({ status: 'skipped' });
  });

  it('keeps an empty file without a message as an error', () => {
    expect(parse([])).toMatchObject({ status: 'error', failureMessage: 'no assertions in reporter output for this file' });
  });
});

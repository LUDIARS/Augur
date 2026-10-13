import { describe, expect, it } from 'vitest';
import { sameFile, vitestRunner } from '../../src/tests/runners/vitest.ts';
import { record } from './fixtures.ts';

const FILE = 'tests/blocks/session/end.block.test.ts';
const WORKTREE = 'E:/Document/Ars/.wt-concordia-augur-test-blocks';

function parse(test: ReturnType<typeof record>, testResults: unknown[]) {
  return vitestRunner.parse({ runner: 'vitest', argv: [], tests: [test] }, {
    exitCode: 0, stdout: JSON.stringify({ testResults }), stderr: '', timedOut: false,
  })[0];
}

describe('vitest reporter file matching', () => {
  it('matches a Windows worktree absolute path to the repo-relative ledger file', () => {
    expect(sameFile(`${WORKTREE}/${FILE}`, FILE, 'win32')).toBe(true);
    expect(sameFile(`${WORKTREE.replaceAll('/', '\\')}\\${FILE.replaceAll('/', '\\')}`, FILE, 'win32')).toBe(true);
    expect(sameFile(`${WORKTREE}/${FILE}`, `./${FILE}`, 'win32')).toBe(true);
  });

  it('ignores case on Windows only', () => {
    const upper = `e:/document/ars/.wt-x/${FILE.toUpperCase()}`;
    expect(sameFile(upper, FILE, 'win32')).toBe(true);
    expect(sameFile(upper, FILE, 'linux')).toBe(false);
  });

  it('does not match a different file sharing a suffix', () => {
    expect(sameFile(`${WORKTREE}/other-${FILE}`, FILE, 'win32')).toBe(false);
  });

  it('reports a passed assertion found under the absolute worktree path as passed', () => {
    const test = record({ name: 'session end saves the log', file: FILE });
    const result = parse(test, [{
      name: `${WORKTREE}/${FILE}`,
      assertionResults: [{ fullName: 'session end saves the log', status: 'passed', duration: 4 }],
    }]);
    expect(result).toEqual({ testId: test.id, status: 'passed', durationMs: 4 });
  });

  it('lists the reporter files when the registered file is missing', () => {
    const test = record({ name: 'session end saves the log', file: FILE });
    const result = parse(test, [{ name: `${WORKTREE}/tests/blocks/other.block.test.ts`, assertionResults: [] }]);
    expect(result?.status).toBe('error');
    expect(result?.failureMessage).toContain(`file ${FILE} not found in reporter output`);
    expect(result?.failureMessage).toContain(`${WORKTREE}/tests/blocks/other.block.test.ts`);
  });

  it('lists the reporter tests of the matched file when the test name is missing', () => {
    const test = record({ name: 'session end saves the log', file: FILE });
    const result = parse(test, [{
      name: `${WORKTREE}/${FILE}`,
      assertionResults: [{ ancestorTitles: ['session end'], title: 'keeps the log', status: 'passed' }],
    }]);
    expect(result?.status).toBe('error');
    expect(result?.failureMessage).toContain('test "session end saves the log" not found');
    expect(result?.failureMessage).toContain('- session end keeps the log');
  });
});

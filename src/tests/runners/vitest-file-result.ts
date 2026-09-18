import type { RunResult, TestRecord } from '../types.ts';

export interface FileAssertion {
  status: RunResult['status'];
  durationMs: number;
  failureMessages: string[];
}

/**
 * A ledger entry whose name is its own file (and which has no selector) stands
 * for the whole test file, not for one assertion: `augur tests register` of a
 * file records it that way, and no reporter assertion carries a file path as
 * its fullName. Matching it by name would always report "not found".
 */
export function isFileLevelTest(test: TestRecord): boolean {
  return test.selector === undefined
    && test.name.replaceAll('\\', '/') === test.file.replaceAll('\\', '/');
}

/**
 * The verdict for a whole file: any failed assertion fails it, a file with no
 * assertions but a failure message (collection/import error) fails it, all
 * skipped is skipped, otherwise it passed. An empty, message-less file is an
 * error because nothing was actually executed.
 */
export function fileLevelResult(
  test: TestRecord,
  assertions: readonly FileAssertion[],
  fileMessage: string,
): Omit<RunResult, 'outputTail'> {
  const durationMs = assertions.reduce((sum, item) => sum + item.durationMs, 0);
  if (assertions.length === 0) {
    return fileMessage
      ? { testId: test.id, status: 'failed', durationMs, failureMessage: fileMessage.slice(0, 2000) }
      : { testId: test.id, status: 'error', durationMs, failureMessage: 'no assertions in reporter output for this file' };
  }
  const failed = assertions.filter((item) => item.status === 'failed' || item.status === 'error');
  if (failed.length > 0) {
    const status = failed.some((item) => item.status === 'failed') ? 'failed' : 'error';
    const message = failed.flatMap((item) => item.failureMessages).join('\n') || `${failed.length} assertion(s) ${status}`;
    return { testId: test.id, status, durationMs, failureMessage: message.slice(0, 2000) };
  }
  const status = assertions.every((item) => item.status === 'skipped') ? 'skipped' : 'passed';
  return { testId: test.id, status, durationMs };
}

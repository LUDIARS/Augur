import { isAbsolute, relative, resolve } from 'node:path';
import type { BusOutput } from '../../bus/types.ts';
import type { RunnerConfig } from '../config.ts';
import type { RunResult, TestRecord } from '../types.ts';
import { outputTail, type Invocation, type Runner } from './types.ts';
import { fileLevelResult, isFileLevelTest, type FileAssertion } from './vitest-file-result.ts';
import { parseJsonReport, type VitestReport } from './vitest-json-report.ts';

interface VitestAssertion {
  ancestorTitles?: unknown;
  title?: unknown;
  fullName?: unknown;
  status?: unknown;
  duration?: unknown;
  failureMessages?: unknown;
}

interface VitestFileResult {
  name?: unknown;
  status?: unknown;
  assertionResults?: unknown;
  message?: unknown;
}

/**
 * The bus spawns without a shell (spec feature/test-lifecycle.md §3.1), and on
 * Windows `npx` is a `.cmd` shim that only a shell can execute — `spawn('npx')`
 * fails with ENOENT. The repository-local vitest entry run through `node`
 * (a real executable on every platform) needs no shell, so it is the default,
 * and a configured `npx vitest` prefix is rewritten to it rather than left to
 * fail on Windows only.
 */
function normalizeVitestCommand(command: readonly string[]): string[] {
  if (command[0] === 'npx' && command[1] === 'vitest') {
    return ['node', 'node_modules/vitest/vitest.mjs', ...command.slice(2)];
  }
  return [...command];
}

export const vitestRunner: Runner = {
  id: 'vitest',
  /** @implements SPEC-TEST-LIFECYCLE-VITEST-RUNNER */
  buildInvocations(tests: readonly TestRecord[], config: RunnerConfig): Invocation[] {
    const base = normalizeVitestCommand(config.command ?? ['node', 'node_modules/vitest/vitest.mjs', 'run']);
    const selectorFlag = config.selectorFlag ?? '-t';
    const invocations: Invocation[] = [];
    const unselected = tests.filter((test) => test.selector === undefined);
    if (unselected.length > 0) {
      invocations.push({
        runner: 'vitest',
        argv: withReporter([...base, ...uniqueFiles(unselected)]),
        tests: [...unselected],
      });
    }
    for (const test of tests.filter((candidate) => candidate.selector !== undefined)) {
      invocations.push({
        runner: 'vitest',
        argv: withReporter([...base, test.file, selectorFlag, test.selector!]),
        tests: [test],
      });
    }
    return invocations;
  },
  parse(invocation: Invocation, output: BusOutput): RunResult[] {
    if (output.timedOut || output.exitCode === null) {
      return invocation.tests.map((test) => errorResult(test, output, output.timedOut ? 'runner timed out' : 'runner failed to start'));
    }
    let report: VitestReport;
    try {
      report = parseJsonReport(output.stdout);
    } catch (error) {
      return invocation.tests.map((test) => errorResult(test, output, `invalid vitest JSON reporter output: ${messageOf(error)}`));
    }
    const files = Array.isArray(report.testResults) ? report.testResults as VitestFileResult[] : [];
    return invocation.tests.map((test) => accountForProcessExit(parseTest(test, files, output), output));
  },
};

function withReporter(argv: string[]): string[] {
  return argv.some((part) => part === '--reporter=json' || part === '--reporter')
    ? argv
    : [...argv, '--reporter=json'];
}

function uniqueFiles(tests: readonly TestRecord[]): string[] {
  return [...new Set(tests.map((test) => test.file))].sort();
}


function parseTest(test: TestRecord, files: readonly VitestFileResult[], output: BusOutput): RunResult {
  const file = files.find((candidate) => sameFile(candidate.name, test.file));
  const assertions = Array.isArray(file?.assertionResults) ? file.assertionResults as VitestAssertion[] : [];
  if (file !== undefined && isFileLevelTest(test)) {
    const result = fileLevelResult(test, assertions.map(fileAssertion), typeof file.message === 'string' ? file.message : '');
    return result.status === 'passed' || result.status === 'skipped' ? result : { ...result, outputTail: outputTail(output) };
  }
  const assertion =assertions.find((candidate) => assertionName(candidate) === test.name)
    ?? (test.selector !== undefined ? assertions.find((candidate) => assertionName(candidate) === test.selector) : undefined)
    ?? assertions.find((candidate) => assertionName(candidate).startsWith(`${test.name} `));
  if (assertion === undefined) {
    if (file === undefined) {
      const reported = files.map((candidate) => candidate.name).filter((name): name is string => typeof name === 'string');
      return errorResult(test, output, `file ${test.file} not found in reporter output; reporter files:\n${candidateList(reported)}`);
    }
    return errorResult(test, output,
      `test "${test.name}" not found in reporter output for ${test.file}; reporter tests:\n${candidateList(assertions.map(assertionName))}`);
  }

  const status = assertionStatus(assertion.status);
  const messages = Array.isArray(assertion.failureMessages)
    ? assertion.failureMessages.filter((value): value is string => typeof value === 'string').join('\n')
    : typeof file?.message === 'string' ? file.message : '';
  return {
    testId: test.id,
    status,
    durationMs: typeof assertion.duration === 'number' ? assertion.duration : 0,
    ...(status === 'failed' || status === 'error'
      ? { failureMessage: (messages || `vitest assertion ${status}`).slice(0, 2000), outputTail: outputTail(output) }
      : {}),
  };
}

function accountForProcessExit(result: RunResult, output: BusOutput): RunResult {
  if (output.exitCode === 0 || result.status === 'failed' || result.status === 'error') return result;
  return {
    ...result,
    status: 'error',
    failureMessage: `vitest exited ${output.exitCode} despite reporting the selected assertion as ${result.status}`,
    outputTail: outputTail(output),
  };
}

function assertionName(assertion: VitestAssertion): string {
  if (typeof assertion.fullName === 'string') return assertion.fullName;
  const ancestors = Array.isArray(assertion.ancestorTitles)
    ? assertion.ancestorTitles.filter((value): value is string => typeof value === 'string')
    : [];
  return [...ancestors, typeof assertion.title === 'string' ? assertion.title : ''].filter(Boolean).join(' ');
}

function fileAssertion(assertion: VitestAssertion): FileAssertion {
  return {
    status: assertionStatus(assertion.status),
    durationMs: typeof assertion.duration === 'number' ? assertion.duration : 0,
    failureMessages: Array.isArray(assertion.failureMessages)
      ? assertion.failureMessages.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function assertionStatus(value: unknown): RunResult['status'] {
  if (value === 'passed') return 'passed';
  if (value === 'failed') return 'failed';
  if (value === 'skipped' || value === 'pending' || value === 'todo' || value === 'disabled') return 'skipped';
  return 'error';
}

/**
 * Reporter file names are absolute worktree paths while the ledger keeps
 * repo-relative ones. Separators are unified, and on Windows the comparison
 * ignores case because drive letters and directory names arrive in either case.
 */
export function sameFile(reporterName: unknown, registeredFile: string, platform: NodeJS.Platform = process.platform): boolean {
  if (typeof reporterName !== 'string') return false;
  const fold = (value: string) => {
    const unified = value.replaceAll('\\', '/');
    return platform === 'win32' ? unified.toLowerCase() : unified;
  };
  const normalized = fold(reporterName);
  const expected = fold(registeredFile).replace(/^\.\//, '');
  if (normalized === expected || normalized.endsWith(`/${expected}`)) return true;
  if (isAbsolute(reporterName)) return fold(relative(resolve(reporterName), resolve(registeredFile))) === '';
  return false;
}

/** Up to `limit` names the reporter did produce, so a mismatch can be diagnosed from the run record. */
function candidateList(names: readonly string[], limit = 10): string {
  if (names.length === 0) return '(none)';
  const shown = names.slice(0, limit).map((name) => `  - ${name}`).join('\n');
  return names.length > limit ? `${shown}\n  … ${names.length - limit} more` : shown;
}

function errorResult(test: TestRecord, output: BusOutput, message: string): RunResult {
  return { testId: test.id, status: 'error', durationMs: 0, failureMessage: message.slice(0, 2000), outputTail: outputTail(output) };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

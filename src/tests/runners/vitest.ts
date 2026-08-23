import { isAbsolute, relative, resolve } from 'node:path';
import type { BusOutput } from '../../bus/types.ts';
import type { RunnerConfig } from '../config.ts';
import type { RunResult, TestRecord } from '../types.ts';
import { outputTail, type Invocation, type Runner } from './types.ts';

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

interface VitestReport { testResults?: unknown }

export const vitestRunner: Runner = {
  id: 'vitest',
  buildInvocations(tests: readonly TestRecord[], config: RunnerConfig): Invocation[] {
    const base = config.command ?? ['npx', 'vitest', 'run'];
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

function parseJsonReport(stdout: string): VitestReport {
  try {
    return JSON.parse(stdout) as VitestReport;
  } catch {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('JSON document not found');
    return JSON.parse(stdout.slice(start, end + 1)) as VitestReport;
  }
}

function parseTest(test: TestRecord, files: readonly VitestFileResult[], output: BusOutput): RunResult {
  const file = files.find((candidate) => sameFile(candidate.name, test.file));
  const assertions = Array.isArray(file?.assertionResults) ? file.assertionResults as VitestAssertion[] : [];
  const assertion = assertions.find((candidate) => assertionName(candidate) === test.name)
    ?? (test.selector !== undefined ? assertions.find((candidate) => assertionName(candidate) === test.selector) : undefined);
  if (assertion === undefined) return errorResult(test, output, 'not found in reporter output');

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

function assertionStatus(value: unknown): RunResult['status'] {
  if (value === 'passed') return 'passed';
  if (value === 'failed') return 'failed';
  if (value === 'skipped' || value === 'pending' || value === 'todo' || value === 'disabled') return 'skipped';
  return 'error';
}

function sameFile(reporterName: unknown, registeredFile: string): boolean {
  if (typeof reporterName !== 'string') return false;
  const normalized = reporterName.replaceAll('\\', '/');
  const expected = registeredFile.replaceAll('\\', '/');
  if (normalized === expected || normalized.endsWith(`/${expected}`)) return true;
  if (isAbsolute(reporterName)) return relative(resolve(reporterName), resolve(registeredFile)) === '';
  return false;
}

function errorResult(test: TestRecord, output: BusOutput, message: string): RunResult {
  return { testId: test.id, status: 'error', durationMs: 0, failureMessage: message.slice(0, 2000), outputTail: outputTail(output) };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

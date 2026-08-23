import type { BusOutput } from '../../bus/types.ts';
import type { RunnerConfig } from '../config.ts';
import type { RunResult, RunnerId, TestRecord } from '../types.ts';

export interface Invocation {
  runner: RunnerId;
  argv: string[];
  tests: TestRecord[];
}

export interface Runner {
  id: RunnerId;
  buildInvocations(tests: readonly TestRecord[], config: RunnerConfig): Invocation[];
  parse(invocation: Invocation, output: BusOutput): RunResult[];
}

export function outputTail(output: BusOutput): string {
  return `${output.stdout}${output.stderr}`.slice(-4000);
}

export function exitCodeResults(invocation: Invocation, output: BusOutput): RunResult[] {
  const status: RunResult['status'] = output.timedOut || output.exitCode === null
    ? 'error'
    : output.exitCode === 0 ? 'passed' : 'failed';
  const tail = outputTail(output);
  return invocation.tests.map((test) => ({
    testId: test.id,
    status,
    durationMs: 0,
    ...(status === 'passed' ? {} : { failureMessage: failureMessage(output), outputTail: tail }),
  }));
}

function failureMessage(output: BusOutput): string {
  if (output.timedOut) return 'runner timed out';
  if (output.exitCode === null) return (output.stderr || 'runner failed to start').slice(0, 2000);
  return (output.stderr || output.stdout || `runner exited ${output.exitCode}`).slice(-2000);
}

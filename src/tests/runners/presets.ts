import type { RunnerConfig } from '../config.ts';
import type { RunResult, RunnerId, TestRecord } from '../types.ts';
import { exitCodeResults, type Invocation, type Runner } from './types.ts';

export function presetRunner(id: Exclude<RunnerId, 'vitest' | 'command'>): Runner {
  return {
    id,
    buildInvocations(tests: readonly TestRecord[], config: RunnerConfig): Invocation[] {
      return tests.map((test) => ({
        runner: id,
        argv: buildPreset(id, test, config),
        tests: [test],
      }));
    },
    parse(invocation, output): RunResult[] {
      return exitCodeResults(invocation, output);
    },
  };
}

function buildPreset(id: 'cargo' | 'gtest' | 'unity', test: TestRecord, config: RunnerConfig): string[] {
  const selector = test.selector ?? test.name;
  if (id === 'cargo') return [...(config.command ?? ['cargo', 'test']), selector];
  if (id === 'gtest') return [...(config.command ?? ['ctest', '--output-on-failure']), `--gtest_filter=${selector}`];
  return [...(config.command ?? ['unity', '-batchmode', '-runTests']), '-testFilter', selector];
}

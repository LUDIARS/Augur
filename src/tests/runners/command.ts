import type { TestRecord } from '../types.ts';
import { exitCodeResults, type Invocation, type Runner } from './types.ts';

export const commandRunner: Runner = {
  id: 'command',
  buildInvocations(tests: readonly TestRecord[]): Invocation[] {
    return tests.map((test) => {
      if (test.command === undefined || test.command.length === 0) {
        throw new Error(`${test.id}: command runner requires command argv`);
      }
      return { runner: 'command', argv: [...test.command], tests: [test] };
    });
  },
  parse: exitCodeResults,
};

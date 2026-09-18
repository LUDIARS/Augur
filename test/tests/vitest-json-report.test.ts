import { describe, expect, it } from 'vitest';
import { parseJsonReport } from '../../src/tests/runners/vitest-json-report.ts';

const report = { numTotalTests: 1, testResults: [{ name: 'a.test.ts', message: 'has } and { in "text"', assertionResults: [] }] };

describe('vitest JSON report extraction', () => {
  it('parses a clean report directly', () => {
    expect(parseJsonReport(JSON.stringify(report))).toEqual(report);
  });

  it('finds the report among logged lines with their own braces, before and after it', () => {
    const stdout = [
      'booting {mode: test}',
      '{"level":"info","msg":"server listening"}',
      JSON.stringify(report, null, 2),
      'teardown {done}',
    ].join('\n');
    expect(parseJsonReport(stdout)).toEqual(report);
  });

  it('reports missing documents distinctly', () => {
    expect(() => parseJsonReport('no json here')).toThrow('JSON document not found');
    expect(() => parseJsonReport('{"level":"info"}')).toThrow('no JSON document with testResults found');
  });
});

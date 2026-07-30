import { describe, expect, it } from 'vitest';
import { main, type CliIo } from '../../src/cli/main.ts';
import { CONTRACT_VERSION } from '../../src/cli/reviewPlan.ts';

// The exit-code mapping is the whole contract for a caller that only sees a
// number: 1 is "you asked wrong", 2 is "Augur broke"
// (spec/interface/cli.md and spec/interface/review-plan-cli.md, "Exit Codes").
// A validation failure reported as 2 would read as a broken planner.

interface Captured {
  readonly io: CliIo;
  readonly out: string[];
  readonly err: string[];
}

function capture(stdin = ''): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      cwd: process.cwd(),
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      readStdin: () => stdin,
    },
    out,
    err,
  };
}

const REVIEW_REQUEST = {
  version: CONTRACT_VERSION,
  repository: 'LUDIARS/Revisor',
  pullRequest: { number: 2, title: null },
  changeProfile: {
    kinds: ['docs'],
    changedFiles: 1,
    changedLines: 4,
    docsOnly: true,
    touchesSpec: false,
    runtimeSurfaces: [],
  },
  stages: [{ id: 'security_review', run: true, reason: 'deterministic' }],
  testCases: [{ name: 'check', kinds: null, runtime: false, always: true }],
  stageIds: ['leakage_scan', 'security_review', 'reviewer_autofix'],
};

describe('main', () => {
  it('prints usage and exits 0 with no command', async () => {
    const { io, out } = capture();
    expect(await main([], io)).toBe(0);
    expect(out.join('')).toContain('augur plan');
  });

  it('exits 1 on an unknown command', async () => {
    const { io, err } = capture();
    expect(await main(['prophesy'], io)).toBe(1);
    expect(err.join('')).toContain("unknown command 'prophesy'");
  });

  it('exits 1 on a mistyped option instead of planning from the default', async () => {
    const { io, err } = capture();
    expect(await main(['plan', 'x', '--no-git', '--kidn', 'bug_fix'], io)).toBe(1);
    expect(err.join('')).toContain('unknown option: --kidn');
  });

  it('plans and exits 0', async () => {
    const { io, out } = capture();
    expect(await main(['plan', 'Fix the empty-query regression', '--no-git', '--json'], io)).toBe(0);
    expect(() => JSON.parse(out.join('')) as unknown).not.toThrow();
  });
});

describe('main review-plan', () => {
  it('exits 0 and writes one JSON document', async () => {
    const { io, out } = capture(JSON.stringify(REVIEW_REQUEST));
    expect(await main(['review-plan', '--json'], io)).toBe(0);
    expect(() => JSON.parse(out.join('')) as unknown).not.toThrow();
  });

  it('exits 1 — not 2 — when stdin is not JSON', async () => {
    const { io, err } = capture('not json');
    expect(await main(['review-plan'], io)).toBe(1);
    expect(err.join('')).toContain('one JSON object');
  });

  it('exits 1 on an unknown contract version', async () => {
    const { io, err } = capture(JSON.stringify({ ...REVIEW_REQUEST, version: 99 }));
    expect(await main(['review-plan'], io)).toBe(1);
    expect(err.join('')).toContain('unsupported request version 99');
  });

  it('exits 1 on a malformed change profile', async () => {
    const { io, err } = capture(JSON.stringify({ ...REVIEW_REQUEST, changeProfile: {} }));
    expect(await main(['review-plan'], io)).toBe(1);
    expect(err.join('')).toContain('changeProfile.');
  });

  it('exits 1 rather than silently ignoring a gathering flag it does not honour', async () => {
    const { io, err } = capture(JSON.stringify(REVIEW_REQUEST));
    expect(await main(['review-plan', '--base', 'main'], io)).toBe(1);
    expect(err.join('')).toContain('unknown option: --base');
  });
});

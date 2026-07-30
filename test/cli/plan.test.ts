import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgv, UsageError } from '../../src/cli/args.ts';
import { buildRequest } from '../../src/cli/plan.ts';
import type { GatherIo, GitResult } from '../../src/cli/gather.ts';

// Flags only assemble the request; the engine is not involved here
// (spec/interface/cli.md, "Relationship to the engine").

let scratch: string;
let warnings: string[];

function io(overrides: Partial<GatherIo> = {}): GatherIo {
  return {
    cwd: scratch,
    warn: (message) => warnings.push(message),
    readStdin: () => '',
    ...overrides,
  };
}

function gitStub(files: string, diff = 'diff --git a/x b/x\n+added\n') {
  return (args: readonly string[]): GitResult => {
    if (args.includes('--name-only')) return { ok: true, stdout: files, stderr: '' };
    return { ok: true, stdout: diff, stderr: '' };
  };
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'augur-cli-'));
  warnings = [];
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('buildRequest', () => {
  it('requires a description', () => {
    expect(() => buildRequest(parseArgv(['plan', '--no-git']), io())).toThrow(UsageError);
  });

  it('accepts the description as a positional argument', () => {
    const request = buildRequest(parseArgv(['plan', 'Fix the thing', '--no-git']), io());
    expect(request.objective.description).toBe('Fix the thing');
    expect(request.objective.kind).toBe('unknown');
  });

  it('rejects an unknown objective kind and an unknown domain', () => {
    expect(() =>
      buildRequest(parseArgv(['plan', 'x', '--kind', 'nonsense', '--no-git']), io()),
    ).toThrow(/--kind must be one of/);
    expect(() =>
      buildRequest(parseArgv(['plan', 'x', '--domain', 'nonsense', '--no-git']), io()),
    ).toThrow(/--domain must be one of/);
  });

  it('gathers the diff and changed files from git', () => {
    const request = buildRequest(
      parseArgv(['plan', 'x', '--base', 'main']),
      io({ runGit: gitStub('src/a.ts\nsrc/b.ts\n') }),
    );
    expect(request.change?.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(request.change?.diff).toContain('+added');
  });

  it('skips git entirely with --no-git', () => {
    let called = false;
    const request = buildRequest(
      parseArgv(['plan', 'x', '--no-git']),
      io({
        runGit: () => {
          called = true;
          return { ok: true, stdout: '', stderr: '' };
        },
      }),
    );
    expect(called).toBe(false);
    expect(request.change).toBeUndefined();
  });

  it('degrades to a warning when git fails rather than stopping', () => {
    const request = buildRequest(
      parseArgv(['plan', 'x']),
      io({ runGit: () => ({ ok: false, stdout: '', stderr: 'not a repository' }) }),
    );
    expect(request.change).toBeUndefined();
    expect(warnings.join(' ')).toContain('not a repository');
  });

  it('degrades to a warning when a coverage file is unreadable', () => {
    const request = buildRequest(
      parseArgv(['plan', 'x', '--no-git', '--coverage', join(scratch, 'missing.info')]),
      io(),
    );
    expect(request.coverage).toBeUndefined();
    expect(warnings.join(' ')).toContain('missing.info');
  });

  it('infers the test runner and package manager from package.json', () => {
    writeFileSync(
      join(scratch, 'package.json'),
      JSON.stringify({
        name: 'demo',
        packageManager: 'npm@10.2.0',
        devDependencies: { vitest: '^3.0.0' },
      }),
      'utf8',
    );
    const request = buildRequest(parseArgv(['plan', 'x', '--no-git']), io());
    expect(request.project?.name).toBe('demo');
    expect(request.project?.packageManager).toBe('npm');
    expect(request.project?.testRunners).toEqual(['vitest']);
  });

  it('reads the failure log from stdin when the path is -', () => {
    const request = buildRequest(
      parseArgv(['plan', 'x', '--no-git', '--failure-log', '-', '--failure-exit', '1']),
      io({ readStdin: () => 'expected [] to equal [1]' }),
    );
    expect(request.failure?.stdout).toContain('expected []');
    expect(request.failure?.exitCode).toBe(1);
  });

  it('rejects a --failure-exit that is not an integer', () => {
    for (const value of ['', ' 1 ', '0x10', '1e3', 'nope']) {
      expect(() =>
        buildRequest(parseArgv(['plan', 'x', '--no-git', '--failure-exit', value]), io()),
      ).toThrow(/--failure-exit must be an integer/);
    }
  });

  it('rejects a mistyped option rather than ignoring it', () => {
    expect(() =>
      buildRequest(parseArgv(['plan', 'x', '--no-git', '--kidn', 'bug_fix']), io()),
    ).toThrow(/unknown option: --kidn/);
  });

  // The quality names are the schema's, not invented ones: a request the engine
  // would reject proves nothing about the flag that built it.
  it('merges --quality shorthand with a goals file', () => {
    const goals = join(scratch, 'goals.json');
    writeFileSync(goals, JSON.stringify([{ quality: 'responsiveness' }]), 'utf8');
    const request = buildRequest(
      parseArgv(['plan', 'x', '--no-git', '--goals', goals, '--quality', 'stability_feel']),
      io(),
    );
    expect(request.experienceGoals?.map((goal) => goal.quality)).toEqual([
      'responsiveness',
      'stability_feel',
    ]);
  });

  it('rejects a --quality the schema does not define', () => {
    expect(() =>
      buildRequest(parseArgv(['plan', 'x', '--no-git', '--quality', 'reliable']), io()),
    ).toThrow(/--quality must be one of/);
  });

  it('rejects two descriptions rather than silently choosing one', () => {
    expect(() =>
      buildRequest(parseArgv(['plan', 'first', 'second', '--no-git']), io()),
    ).toThrow(/only one positional description/);
    expect(() =>
      buildRequest(parseArgv(['plan', 'positional', '--no-git', '--description', 'flag']), io()),
    ).toThrow(/cannot both be given/);
  });

  it('rejects a --base that git would read as an option', () => {
    expect(() => buildRequest(parseArgv(['plan', 'x', '--base', '-o']), io())).toThrow(
      /--base must name a git ref/,
    );
  });
});

describe('buildRequest with --request', () => {
  it('reads a complete CreatePlanRequest from stdin', () => {
    const request = buildRequest(
      parseArgv(['plan', '--request', '-']),
      io({ readStdin: () => '{"objective":{"kind":"security","description":"Harden it"}}' }),
    );
    expect(request.objective.kind).toBe('security');
  });

  it('refuses to also gather signals, so two answers cannot be mixed', () => {
    expect(() =>
      buildRequest(
        parseArgv(['plan', '--request', '-', '--base', 'main']),
        io({ readStdin: () => '{"objective":{"kind":"unknown","description":"x"}}' }),
      ),
    ).toThrow(/--base cannot be combined with --request/);
  });

  it('fails loudly when the supplied request is unreadable', () => {
    expect(() =>
      buildRequest(parseArgv(['plan', '--request', join(scratch, 'nope.json')]), io()),
    ).toThrow(/could not read a request/);
  });
});

describe('parseArgv', () => {
  it('rejects a flag without a value', () => {
    expect(() => parseArgv(['plan', '--base'])).toThrow(/--base requires a value/);
  });

  it('rejects a repeated flag that is not repeatable', () => {
    expect(() => parseArgv(['plan', '--base', 'a', '--base', 'b'])).toThrow(/more than once/);
  });

  it('allows --quality more than once', () => {
    expect(parseArgv(['plan', '--quality', 'a', '--quality', 'b']).flags.get('--quality')).toEqual([
      'a',
      'b',
    ]);
  });
});

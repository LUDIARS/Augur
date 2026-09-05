import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWeaverLogLines, resolveLogsDir } from '../../src/contracts/project.ts';

describe('resolveLogsDir', () => {
  it('prefers --logs, then VESTIGIUM_LOGS_DIR, then <project>/logs', () => {
    const env = { VESTIGIUM_LOGS_DIR: resolve('/from-env') };
    expect(resolveLogsDir('/project', resolve('/explicit'), env)).toBe(resolve('/explicit'));
    expect(resolveLogsDir('/project', undefined, env)).toBe(resolve('/from-env'));
    expect(resolveLogsDir('/project', undefined, {})).toBe(resolve('/project', 'logs'));
    expect(resolveLogsDir('/project', undefined, { VESTIGIUM_LOGS_DIR: '' })).toBe(resolve('/project', 'logs'));
  });
});

describe('readWeaverLogLines', () => {
  it('reads every .jsonl in filename order and drops blank lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'augur-logs-'));
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'b.jsonl'), '{"msg":"second"}\n\n', 'utf8');
    writeFileSync(join(dir, 'logs', 'a.jsonl'), '{"msg":"first"}\n', 'utf8');
    writeFileSync(join(dir, 'logs', 'ignored.log'), '{"msg":"never"}\n', 'utf8');
    expect(readWeaverLogLines(join(dir, 'logs'))).toEqual(['{"msg":"first"}', '{"msg":"second"}']);
  });

  it('treats a missing directory as no evidence rather than an error', () => {
    expect(readWeaverLogLines(join(tmpdir(), 'augur-logs-that-do-not-exist'))).toEqual([]);
  });
});

import { execFile } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { collectContractSummary } from '../../src/contracts/collect.ts';
import { MAX_LOG_LINE_LENGTH } from '../../src/contracts/log-lines.ts';

const exec = promisify(execFile);
const directories: string[] = [];
const at = '2026-10-11T00:00:00.000Z';

function fixture(): { dir: string; logsDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'augur-collect-'));
  directories.push(dir);
  const logsDir = join(dir, 'logs');
  mkdirSync(logsDir);
  writeFileSync(join(dir, 'augur.contracts.json'), JSON.stringify({
    version: 1,
    contracts: [{ id: 'C-1', criterion: 'evidence retained', symbol: 'alpha', file: 'src/a.ts', module: 'contracts/a.ts' }],
  }));
  return { dir, logsDir };
}

const markers = async (): Promise<ReadonlyMap<string, string>> => new Map([['C-1', 'm1']]);
function event(id: string, time?: string): string {
  return JSON.stringify({ msg: 'contract observed', ctx: { contract: 'C-1', id, observed_at: time } });
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('incremental contract collection', () => {
  it('preserves normalization, marker matching, time windows and diagnostics', async () => {
    const { dir, logsDir } = fixture();
    writeFileSync(join(logsDir, 'records.jsonl'), [
      '', 'invalid json', '{"msg":"other"}', event('m1', at), event('foreign', at),
      event('m1'), event('m1', '2026-10-10T23:59:59.999Z'), event('m1', '2026-10-11T00:00:00.001Z'),
    ].join('\r\n'));
    const result = await collectContractSummary(dir, { logsDir, markers, window: { since: at, until: at } });
    expect(result?.summary.diagnostics).toEqual({ events: 5, matched: 1, foreign: 1, outOfWindow: 2, undated: 1 });
    expect(result?.summary.contracts[0]).toMatchObject({ state: 'covered', calls: 1 });
  });

  it('rejects the entire report if an oversized record follows valid evidence', async () => {
    const { dir, logsDir } = fixture();
    writeFileSync(join(logsDir, 'records.jsonl'), event('m1', at) + '\n' + 'x'.repeat(MAX_LOG_LINE_LENGTH + 1));
    await expect(collectContractSummary(dir, { logsDir, markers })).rejects.toThrow(/contract log line exceeds/);
  });

  it('aggregates a log larger than the child heap without retaining lines, events or old reasons', async () => {
    const { dir, logsDir } = fixture();
    const count = 100_000;
    const line = JSON.stringify({ msg: 'contract violated', ctx: {
      contract: 'C-1', id: 'm1', phase: 'post', observed_at: at, reason: 'x'.repeat(2048),
    } }) + '\n';
    const descriptor = openSync(join(logsDir, 'large.jsonl'), 'w');
    try {
      // Bounded fixture creation too; do not build the 200+ MiB file as a string.
      const block = Buffer.from(line.repeat(100));
      for (let index = 0; index < count / 100; index++) {
        let offset = 0;
        while (offset < block.length) offset += writeSync(descriptor, block, offset, block.length - offset);
      }
    } finally {
      closeSync(descriptor);
    }
    const source = new URL('../../src/contracts/collect.ts', import.meta.url).href;
    // The source CLI already requires Node's type-stripping support when unbuilt.
    const program = `
      import { collectContractSummary } from ${JSON.stringify(source)};
      const result = await collectContractSummary(${JSON.stringify(dir)}, {
        logsDir: ${JSON.stringify(logsDir)}, markers: async () => new Map([['C-1', 'm1']])
      });
      const entry = result.summary.contracts[0];
      process.stdout.write(JSON.stringify({ calls: entry.calls, violations: entry.violationTotal,
        reasons: entry.latestReasons.length, diagnostics: result.summary.diagnostics }));
    `;
    const { stdout } = await exec(process.execPath, [
      '--max-old-space-size=128', '--experimental-strip-types', '--input-type=module', '-e', program,
    ], { cwd: dir, windowsHide: true, timeout: 90_000, maxBuffer: 16 * 1024 });
    expect(JSON.parse(stdout)).toEqual({ calls: count, violations: count, reasons: 3,
      diagnostics: { events: count, matched: count, foreign: 0, outOfWindow: 0, undated: 0 } });
  }, 100_000);
});

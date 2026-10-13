import { ReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOG_LINE_LENGTH, readWeaverLogLines } from '../../src/contracts/log-lines.ts';

const directories: string[] = [];
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'augur-stream-'));
  directories.push(dir);
  return dir;
}

async function lines(dir: string): Promise<string[]> {
  const result: string[] = [];
  for await (const line of readWeaverLogLines(dir)) result.push(line);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('streamed contract log lines', () => {
  it('preserves sorted file order, CRLF and final lines while ignoring blank lines and other files', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'b.jsonl'), 'second\r\n \t\r\nlast', 'utf8');
    writeFileSync(join(dir, 'a.jsonl'), 'first\n\n', 'utf8');
    writeFileSync(join(dir, 'ignored.log'), 'never\n', 'utf8');
    mkdirSync(join(dir, 'directory.jsonl'));
    expect(await lines(dir)).toEqual(['first', 'second\r', 'last']);
    expect(await lines(join(dir, 'missing'))).toEqual([]);
    expect(await lines(join(dir, 'a.jsonl'))).toEqual([]);
  });

  it('never descends into subfolders, so rotated archives stay out of the report', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'contracts.jsonl'), 'today\n', 'utf8');
    mkdirSync(join(dir, 'archive'));
    writeFileSync(join(dir, 'archive', 'contracts-2026-10-12.jsonl'), 'yesterday\n', 'utf8');
    writeFileSync(join(dir, 'archive', '.contracts-2026-10-12.1.2.part'), 'claimed\n', 'utf8');
    expect(await lines(dir)).toEqual(['today']);
  });

  it('preserves multi-byte UTF-8 and CRLF split across 64 KiB byte boundaries', async () => {
    const dir = fixture();
    const first = 'a'.repeat(65535) + '猫🐈';
    // First UTF-8 character starts in the final byte of a chunk.
    const second = 'b'.repeat(65528) + '\r';
    writeFileSync(join(dir, 'utf8.jsonl'), first + '\n' + second + '\n末尾', 'utf8');
    expect(await lines(dir)).toEqual([first, second, '末尾']);
  });

  it('accepts the line limit and rejects oversized terminated or unterminated lines', async () => {
    const dir = fixture();
    const path = join(dir, 'bounded.jsonl');
    const limit = 'x'.repeat(MAX_LOG_LINE_LENGTH);
    writeFileSync(path, limit + '\n', 'utf8');
    expect((await lines(dir))[0]?.length).toBe(MAX_LOG_LINE_LENGTH);
    for (const ending of ['', '\n']) {
      writeFileSync(path, 'valid\n' + limit + 'x' + ending, 'utf8');
      await expect(lines(dir)).rejects.toThrow(/contract log line exceeds/);
    }
  });

  it('closes the owned stream when the consumer stops early', async () => {
    const dir = fixture();
    const path = join(dir, 'events.jsonl');
    writeFileSync(path, 'first\nsecond\n');
    // ESM namespace exports are read-only. Observe the real stream lifecycle
    // instead of replacing the filesystem factory exported by node:fs.
    const destroy = vi.spyOn(ReadStream.prototype, 'destroy');
    for await (const line of readWeaverLogLines(dir)) {
      expect(line).toBe('first');
      break;
    }
    expect(destroy.mock.contexts.some((stream) =>
      stream instanceof ReadStream && stream.path === path && stream.destroyed)).toBe(true);
  });

  it('propagates a later file read failure instead of returning partial evidence', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'a.jsonl'), 'first\n');
    writeFileSync(join(dir, 'b.jsonl'), 'second\n');
    const iterator = readWeaverLogLines(dir);
    expect(await iterator.next()).toEqual({ value: 'first', done: false });
    rmSync(join(dir, 'b.jsonl'));
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

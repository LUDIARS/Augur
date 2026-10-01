import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteRunStore } from '../../src/tests/run-store.ts';
import { configureConcurrentWrites, isBusyError } from '../../src/tests/sqlite-concurrency.ts';
import { runRecord } from './fixtures.ts';

const policy = { retentionDays: 30, maxRunsPerRepository: 20 };

/** 別プロセスで書き込みロックを holdMs だけ握る。ロックを取った時点で resolve する。 */
function holdWriteLock(path: string, holdMs: number): Promise<{ done: Promise<number | null> }> {
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path)});
    db.exec('BEGIN IMMEDIATE');
    db.exec("INSERT OR REPLACE INTO runs(run_id, repository, started_at, data) VALUES ('holder', 'x', 'x', '{}')");
    process.stdout.write('locked\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs});
    db.exec('ROLLBACK');
  `;
  const child = spawn(process.execPath, ['--no-warnings', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const done = new Promise<number | null>((resolve) => child.on('close', resolve));
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('locked')) resolve({ done });
    });
    child.on('error', reject);
  });
}

describe('run-store concurrent writes', () => {
  it('waits for another process holding the write lock instead of failing with database is locked', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'augur-run-lock-')), 'runs.sqlite');
    // 表を作っておく (別プロセスがその表に書いてロックを握る)
    new SqliteRunStore(path, policy, DatabaseSync);
    const holder = await holdWriteLock(path, 500);

    const store = new SqliteRunStore(path, policy, DatabaseSync);
    // put は保持期限で古い記録を消すので、今の時刻で書く
    const now = new Date().toISOString();
    await store.put(runRecord({ runId: 'r-after-lock', startedAt: now, finishedAt: now }));

    expect(await holder.done).toBe(0);
    expect((await store.get('r-after-lock'))?.runId).toBe('r-after-lock');
  });

  it('switches the database to WAL', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'augur-run-wal-')), 'runs.sqlite');
    new SqliteRunStore(path, policy, DatabaseSync);
    const mode = new DatabaseSync(path).prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
  });

  it('retries the WAL switch while another process briefly holds it', () => {
    const calls: string[] = [];
    let walAttempts = 0;
    const database = {
      exec(sql: string) {
        calls.push(sql);
        if (sql.includes('journal_mode') && ++walAttempts < 3) throw new Error('database is locked');
      },
    };

    configureConcurrentWrites(database, () => undefined);

    expect(calls[0]).toMatch(/busy_timeout/);
    expect(walAttempts).toBe(3);
  });

  it('does not retry errors other than a busy database', () => {
    const database = { exec(sql: string) { if (sql.includes('journal_mode')) throw new Error('disk I/O error'); } };
    expect(() => configureConcurrentWrites(database, () => undefined)).toThrow('disk I/O error');
    expect(isBusyError(new Error('disk I/O error'))).toBe(false);
    expect(isBusyError({ errcode: 5 })).toBe(true);
  });
});

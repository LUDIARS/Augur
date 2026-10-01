/**
 * 実行記録 (runs.sqlite) を複数プロセスが同時に書いても `database is locked` で落ちないための設定。
 *
 * Revisor は 1 つの PR の動作ブロックをドメインごとに並列で走らせ、 それぞれの Augur が同じ
 * runs.sqlite に記録を書く。 既定の SQLite は書き込み中の相手を待たずに即 SQLITE_BUSY を返すため、
 * 待ち時間 (busy_timeout) を入れ、 読み書きが互いを止めない WAL に切り替える。
 */

export interface PragmaTarget {
  exec(sql: string): void;
}

export const RUN_STORE_BUSY_TIMEOUT_MS = 30_000;

/**
 * journal_mode の切り替えは一瞬だけ排他を要し、 そこは busy_timeout の待ちを通らない。
 * 併走プロセスが開いているだけで即座に失敗するので、 短い待ちを挟んで繰り返す。
 * 一度 WAL になれば以後は no-op。
 */
const WAL_SWITCH_ATTEMPTS = 50;
const WAL_SWITCH_DELAY_MS = 20;

export function configureConcurrentWrites(database: PragmaTarget, sleep: (ms: number) => void = sleepSync): void {
  // busy_timeout を先に入れないと、 WAL 切り替え以外の文も併走時に即失敗する
  database.exec(`PRAGMA busy_timeout = ${RUN_STORE_BUSY_TIMEOUT_MS}`);
  for (let attempt = 1; ; attempt += 1) {
    try {
      database.exec('PRAGMA journal_mode = WAL');
      return;
    } catch (error) {
      if (attempt >= WAL_SWITCH_ATTEMPTS || !isBusyError(error)) throw error;
      sleep(WAL_SWITCH_DELAY_MS);
    }
  }
}

export function isBusyError(error: unknown): boolean {
  const record = error as { errcode?: unknown; code?: unknown; message?: unknown } | null;
  return record?.errcode === 5
    || record?.code === 'SQLITE_BUSY'
    || /database is locked|SQLITE_BUSY/i.test(String(record?.message ?? ''));
}

/** コンストラクタは同期なので Atomics で待つ。 */
function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runRecordSchema, type RunQuery, type RunRecord } from './types.ts';

export interface RunCachePolicy {
  retentionDays: number;
  maxRunsPerRepository: number;
}

export interface RunStore {
  put(run: RunRecord): Promise<void>;
  get(runId: string): Promise<RunRecord | undefined>;
  list(query?: RunQuery): Promise<RunRecord[]>;
  sweep(now?: string): Promise<number>;
}

interface StatementLike {
  run(...values: unknown[]): unknown;
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
}

interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
}

interface SqliteModuleLike {
  DatabaseSync: new (path: string) => DatabaseLike;
}

export async function createRunStore(dataDir: string, policy: RunCachePolicy): Promise<RunStore> {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true });
  let sqlite: SqliteModuleLike;
  try {
    sqlite = await import('node:sqlite') as unknown as SqliteModuleLike;
  } catch (error) {
    if (isMissingSqlite(error)) return new JsonlRunStore(join(directory, 'runs.jsonl'), policy);
    throw error;
  }
  return new SqliteRunStore(join(directory, 'runs.sqlite'), policy, sqlite.DatabaseSync);
}

export class JsonlRunStore implements RunStore {
  readonly path: string;
  readonly policy: RunCachePolicy;

  constructor(path: string, policy: RunCachePolicy) {
    this.path = path;
    this.policy = policy;
    mkdirSync(resolve(path, '..'), { recursive: true });
  }

  async put(run: RunRecord): Promise<void> {
    const parsed = runRecordSchema.parse(run);
    const runs = this.read().filter((record) => record.runId !== parsed.runId);
    runs.push(parsed);
    this.write(runs);
    await this.sweep();
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    return this.read().find((run) => run.runId === runId);
  }

  async list(query: RunQuery = {}): Promise<RunRecord[]> {
    return filterRuns(this.read(), query);
  }

  async sweep(now = new Date().toISOString()): Promise<number> {
    const runs = this.read();
    const retained = retainRuns(runs, this.policy, now);
    this.write(retained);
    return runs.length - retained.length;
  }

  private read(): RunRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return runRecordSchema.parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(`invalid run store line ${index + 1}: ${messageOf(error)}`);
      }
    });
  }

  private write(runs: readonly RunRecord[]): void {
    mkdirSync(resolve(this.path, '..'), { recursive: true });
    const body = [...runs].sort(compareRunsOldest).map((run) => JSON.stringify(run)).join('\n');
    writeFileSync(this.path, body === '' ? '' : `${body}\n`, 'utf8');
  }
}

export class SqliteRunStore implements RunStore {
  private readonly database: DatabaseLike;
  readonly path: string;
  readonly policy: RunCachePolicy;

  constructor(
    path: string,
    policy: RunCachePolicy,
    Database: new (path: string) => DatabaseLike,
  ) {
    this.path = path;
    this.policy = policy;
    mkdirSync(resolve(path, '..'), { recursive: true });
    this.database = new Database(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        started_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_repository_started ON runs(repository, started_at DESC);
    `);
  }

  async put(run: RunRecord): Promise<void> {
    const parsed = runRecordSchema.parse(run);
    this.database.prepare(`
      INSERT INTO runs(run_id, repository, started_at, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        repository = excluded.repository,
        started_at = excluded.started_at,
        data = excluded.data
    `).run(parsed.runId, parsed.repository, parsed.startedAt, JSON.stringify(parsed));
    await this.sweep();
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const row = this.database.prepare('SELECT data FROM runs WHERE run_id = ?').get(runId) as { data?: unknown } | undefined;
    return typeof row?.data === 'string' ? runRecordSchema.parse(JSON.parse(row.data) as unknown) : undefined;
  }

  async list(query: RunQuery = {}): Promise<RunRecord[]> {
    const rows = this.database.prepare('SELECT data FROM runs').all() as Array<{ data?: unknown }>;
    const runs = rows.flatMap((row) => typeof row.data === 'string'
      ? [runRecordSchema.parse(JSON.parse(row.data) as unknown)]
      : []);
    return filterRuns(runs, query);
  }

  async sweep(now = new Date().toISOString()): Promise<number> {
    const runs = await this.list();
    const retainedIds = new Set(retainRuns(runs, this.policy, now).map((run) => run.runId));
    let deleted = 0;
    for (const run of runs) {
      if (!retainedIds.has(run.runId)) {
        this.database.prepare('DELETE FROM runs WHERE run_id = ?').run(run.runId);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export function retainRuns(runs: readonly RunRecord[], policy: RunCachePolicy, now: string): RunRecord[] {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('run-store sweep now must be an ISO timestamp');
  const byRepository = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const ageDays = (nowMs - Date.parse(run.finishedAt)) / 86_400_000;
    const protectedRun = run.verdict !== undefined || run.flag !== undefined;
    const limit = policy.retentionDays * (protectedRun ? 3 : 1);
    if (ageDays > limit) continue;
    const group = byRepository.get(run.repository) ?? [];
    group.push(run);
    byRepository.set(run.repository, group);
  }

  const retained: RunRecord[] = [];
  for (const group of byRepository.values()) {
    const ordered = [...group].sort(compareRunsNewest);
    let normal = 0;
    let protectedCount = 0;
    for (const run of ordered) {
      if (run.verdict !== undefined || run.flag !== undefined) {
        protectedCount += 1;
        if (protectedCount <= policy.maxRunsPerRepository * 3) retained.push(run);
      } else {
        normal += 1;
        if (normal <= policy.maxRunsPerRepository) retained.push(run);
      }
    }
  }
  return retained.sort(compareRunsOldest);
}

function filterRuns(runs: readonly RunRecord[], query: RunQuery): RunRecord[] {
  const since = query.since === undefined ? undefined : Date.parse(query.since);
  if (query.since !== undefined && !Number.isFinite(since)) throw new Error('since must be an ISO timestamp');
  return runs.filter((run) => (
    (query.repository === undefined || run.repository === query.repository)
    && (query.headSha === undefined || run.headSha === query.headSha)
    && (query.bundleKind === undefined || run.bundle.kind === query.bundleKind)
    && (query.status === undefined || run.status === query.status)
    && (since === undefined || Date.parse(run.startedAt) >= since)
  )).sort(compareRunsNewest);
}

function compareRunsNewest(left: RunRecord, right: RunRecord): number {
  return right.startedAt.localeCompare(left.startedAt) || right.runId.localeCompare(left.runId);
}

function compareRunsOldest(left: RunRecord, right: RunRecord): number {
  return left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingSqlite(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return (error.code === 'ERR_UNKNOWN_BUILTIN_MODULE' || error.code === 'ERR_MODULE_NOT_FOUND')
    && error.message.includes('node:sqlite');
}

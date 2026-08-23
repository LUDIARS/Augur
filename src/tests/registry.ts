import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ZodError } from 'zod';
import { testRecordSchema, type TestRecord } from './types.ts';

const HISTORY_FIELDS = [
  'createdAt',
  'lastRunAt',
  'lastFailedAt',
  'passStreak',
  'runs',
  'status',
  'retiredAt',
  'retiredReason',
] as const;

const REGISTRY_LOCK_TIMEOUT_MS = 2_000;
const STALE_REGISTRY_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 10;
const LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

export class RegistryValidationError extends Error {
  readonly errors: string[];

  constructor(message: string, errors: string[]) {
    super(message);
    this.name = 'RegistryValidationError';
    this.errors = errors;
  }
}

export function registryPath(repoPath: string): string {
  return join(resolve(repoPath), '.augur', 'tests.jsonl');
}

export function testId(repository: string, file: string, name: string): string {
  const digest = createHash('sha1').update(`${repository}\n${file}\n${name}`).digest('hex').slice(0, 12);
  return `t-${digest}`;
}

export function loadRegistry(repoPath: string): TestRecord[] {
  const path = registryPath(repoPath);
  if (!existsSync(path)) return [];
  const records: TestRecord[] = [];
  const errors: string[] = [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const result = testRecordSchema.safeParse(parsed);
      if (!result.success) errors.push(...formatZodErrors(index + 1, result.error));
      else records.push(result.data);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${messageOf(error)}`);
    }
  }
  if (errors.length > 0) throw new RegistryValidationError('test registry is invalid', errors);
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

export function saveRegistry(repoPath: string, records: readonly TestRecord[]): void {
  withRegistryLock(repoPath, () => writeRegistry(repoPath, records));
}

export function updateRegistry<T>(
  repoPath: string,
  update: (records: TestRecord[]) => { records: readonly TestRecord[]; value: T },
): T {
  return withRegistryLock(repoPath, () => {
    const result = update(loadRegistry(repoPath));
    writeRegistry(repoPath, result.records);
    return result.value;
  });
}

function writeRegistry(repoPath: string, records: readonly TestRecord[]): void {
  const parsed = records.map((record) => testRecordSchema.parse(record));
  const path = registryPath(repoPath);
  mkdirSync(dirname(path), { recursive: true });
  const body = parsed
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => JSON.stringify(record))
    .join('\n');
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, body === '' ? '' : `${body}\n`, 'utf8');
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function upsertTest(repoPath: string, input: TestRecord): TestRecord {
  return updateRegistry(repoPath, (records) => {
    const index = records.findIndex((record) => record.id === input.id);
    let saved = testRecordSchema.parse(input);
    if (index >= 0) {
      const existing = records[index]!;
      const protectedHistory: Partial<TestRecord> = {};
      for (const field of HISTORY_FIELDS) {
        const value = existing[field];
        if (value !== undefined) Object.assign(protectedHistory, { [field]: value });
      }
      saved = testRecordSchema.parse({ ...input, ...protectedHistory });
      records[index] = saved;
    } else {
      records.push(saved);
    }
    return { records, value: saved };
  });
}

export function lintRegistry(repoPath: string): string[] {
  let records: TestRecord[];
  try {
    records = loadRegistry(repoPath);
  } catch (error) {
    if (error instanceof RegistryValidationError) return error.errors;
    return [messageOf(error)];
  }

  return validateRegistry(repoPath, records);
}

export function loadValidatedRegistry(repoPath: string): TestRecord[] {
  const records = loadRegistry(repoPath);
  const errors = validateRegistry(repoPath, records);
  if (errors.length > 0) throw new RegistryValidationError('test registry is invalid', errors);
  return records;
}

function validateRegistry(repoPath: string, records: readonly TestRecord[]): string[] {
  const errors: string[] = [];
  const duplicates = new Map<string, string>();
  const ids = new Set<string>();
  for (const record of records) {
    errors.push(...validateRepositoryFile(repoPath, record.file).map((error) => `${record.id}: ${error}`));
    if (record.id !== testId(record.repository, record.file, record.name)) errors.push(`${record.id}: id does not match repository, file, and name`);
    if (ids.has(record.id)) errors.push(`${record.id}: duplicate id`);
    ids.add(record.id);
    const key = `${record.file}\n${record.name}`;
    const prior = duplicates.get(key);
    if (prior !== undefined) errors.push(`${record.id}: duplicates (file, name) from ${prior}`);
    else duplicates.set(key, record.id);
  }
  return errors.sort();
}

export function resolveRepositoryFile(repoPath: string, file: string, requireExisting = true): string {
  const errors = validateRepositoryFile(repoPath, file, requireExisting);
  if (errors.length > 0) throw new RegistryValidationError('unsafe repository path', errors);
  return resolve(repoPath, file);
}

export function validateRepositoryFile(repoPath: string, file: string, requireExisting = true): string[] {
  const errors: string[] = [];
  if (isAbsolute(file) || /^(?:[A-Za-z]:[\\/]|[/\\])/.test(file)) errors.push('file must be repo-relative');
  if (file.includes('\\')) errors.push('file must use POSIX separators');
  if (file.split('/').includes('..')) errors.push('file must not contain ..');
  if (errors.length > 0) return errors;

  const root = realpathSync(resolve(repoPath));
  const target = resolve(root, file);
  if (!inside(root, target)) errors.push('file escapes repository');
  if (!existsSync(target)) {
    if (requireExisting) errors.push('file does not exist');
    else {
      let ancestor = dirname(target);
      while (!existsSync(ancestor)) {
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      try {
        if (!inside(root, realpathSync(ancestor))) errors.push('file resolves outside repository through a symlink');
      } catch (error) {
        errors.push(`file parent cannot be inspected: ${messageOf(error)}`);
      }
    }
    return errors;
  }
  try {
    const real = realpathSync(target);
    if (!inside(root, real)) errors.push('file resolves outside repository through a symlink');
    if (!lstatSync(target).isFile()) errors.push('file is not a regular file');
  } catch (error) {
    errors.push(`file cannot be inspected: ${messageOf(error)}`);
  }
  return errors;
}

function inside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

function withRegistryLock<T>(repoPath: string, operation: () => T): T {
  const path = registryPath(repoPath);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + REGISTRY_LOCK_TIMEOUT_MS;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx');
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      removeStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new RegistryValidationError('test registry is busy', ['another process is updating the test registry']);
      }
      Atomics.wait(LOCK_WAIT, 0, 0, LOCK_RETRY_MS);
    }
  }

  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function removeStaleLock(path: string): void {
  try {
    if (Date.now() - statSync(path).mtimeMs > STALE_REGISTRY_LOCK_MS) unlinkSync(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function formatZodErrors(line: number, error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? ` ${issue.path.join('.')}` : '';
    return `line ${line}:${path} ${issue.message}`;
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadRegistry, resolveRepositoryFile, saveRegistry, testId, upsertTest } from '../registry.ts';
import type { TestPlan, TestRecord, TestTarget } from '../types.ts';

export function writeAuthoredTarget(input: {
  repoPath: string;
  plan: TestPlan;
  target: TestTarget;
  body: string;
  authoredBy: 'claude-cli';
  now: string;
  note?: string;
}): TestRecord {
  const id = testId(input.plan.repository, input.target.file, input.target.brief.title);
  const path = safeWritablePath(input.repoPath, input.target.file);
  const header = `// @augur test:${id} plan:${input.plan.planId}`;
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8');
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${current}${separator}\n${header}\n${input.body.trim()}\n`, 'utf8');
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${header}\n${input.body.trim()}\n`, 'utf8');
  }
  return registerTarget({
    repoPath: input.repoPath,
    plan: input.plan,
    target: input.target,
    authoredBy: input.authoredBy,
    now: input.now,
    ...(input.note === undefined ? {} : { note: input.note }),
  });
}

export function registerTarget(input: {
  repoPath: string;
  plan: TestPlan;
  target: TestTarget;
  authoredBy: 'session' | 'claude-cli';
  now: string;
  note?: string;
}): TestRecord {
  const record: TestRecord = {
    id: testId(input.plan.repository, input.target.file, input.target.brief.title),
    repository: input.plan.repository,
    name: input.target.brief.title,
    file: input.target.file,
    runner: input.target.runner,
    kind: input.target.kind,
    domains: input.target.domains,
    anchors: input.target.anchors,
    origin: {
      type: input.plan.source.type,
      ref: input.plan.source.ref,
      planId: input.plan.planId,
      authoredBy: input.authoredBy,
    },
    runtime: input.target.runtime,
    always: false,
    status: 'candidate',
    createdAt: input.now,
    passStreak: 0,
    runs: 0,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
  const saved = upsertTest(input.repoPath, record);
  if (input.target.replaces !== undefined) retireReplacement(input.repoPath, input.target.replaces, input.now);
  return saved;
}

export function promotePassingCandidates(repoPath: string, passingIds: ReadonlySet<string>): TestRecord[] {
  const records = loadRegistry(repoPath).map((record): TestRecord => (
    passingIds.has(record.id) && record.status === 'candidate' ? { ...record, status: 'active' } : record
  ));
  saveRegistry(repoPath, records);
  return records.filter((record) => passingIds.has(record.id));
}

function retireReplacement(repoPath: string, testIdToRetire: string, now: string): void {
  const records = loadRegistry(repoPath).map((record): TestRecord => record.id === testIdToRetire ? {
    ...record,
    status: 'retired',
    retiredAt: now,
    retiredReason: 'quota',
  } : record);
  saveRegistry(repoPath, records);
}

function safeWritablePath(repoPath: string, file: string): string {
  return resolveRepositoryFile(repoPath, file, false);
}

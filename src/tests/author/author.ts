import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { AugurConfig } from '../../config/config.ts';
import { loadTestsConfig } from '../config.ts';
import type { PlanStore } from '../plan-store.ts';
import { loadRegistry, resolveRepositoryFile, testId } from '../registry.ts';
import type { AuthorResult, RunInput, RunRecord, TestPlan, TestRecord, TestTarget } from '../types.ts';
import { ClaudeCliUnavailableError, generateWithClaude, type ClaudeCliOptions } from './claude-cli.ts';
import { sessionAuthor } from './session.ts';
import { withDetachedWorktree } from './worktree.ts';
import { promotePassingCandidates, writeAuthoredTarget } from './write.ts';

export class AuthoringConfigurationError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = 'AuthoringConfigurationError';
  }
}

const authorInputSchema = z.object({
  planId: z.string(),
  repoPath: z.string(),
  author: z.enum(['session', 'claude-cli']),
  bus: z.string().optional(),
  before: z.string().optional(),
}).strict();

export interface AuthorDependencies {
  config: AugurConfig;
  planStore: PlanStore;
  run: (input: RunInput) => Promise<RunRecord>;
  now?: () => Date;
  claude?: ClaudeCliOptions;
}

export async function author(
  rawInput: z.input<typeof authorInputSchema>,
  dependencies: AuthorDependencies,
): Promise<AuthorResult> {
  const input = authorInputSchema.parse(rawInput);
  if (input.before !== undefined && !/^[0-9a-f]{7,64}$/i.test(input.before)) {
    throw new AuthoringConfigurationError('before must be a 7-64 character hexadecimal SHA');
  }
  const record = dependencies.planStore.get(input.planId);
  if (record === undefined) throw new Error(`test plan not found: ${input.planId}`);
  const plan = record.plan;
  const repoPath = resolve(input.repoPath);
  const repository = loadTestsConfig(repoPath).repository;
  if (repository !== plan.repository) {
    throw new AuthoringConfigurationError(`test plan belongs to ${plan.repository}, not ${repository}`);
  }
  if (input.author === 'session') return sessionAuthor(plan);
  const model = dependencies.config.authoring?.model;
  if (model === undefined || model.trim() === '') {
    throw new AuthoringConfigurationError('augur.config.json authoring.model is required for --author claude-cli');
  }

  const clock = dependencies.now ?? (() => new Date());
  const authored: TestRecord[] = [];
  const failed: AuthorResult['failed'] = [];
  const dropped: AuthorResult['dropped'] = [];
  for (const target of plan.targets) {
    try {
      const targetExemplar = exemplar(repoPath, target);
      const body = await generateWithClaude({
        model,
        file: target.file,
        runner: target.runner,
        brief: target.brief,
        sourceExcerpt: sourceExcerpt(repoPath, target),
        ...(targetExemplar === undefined ? {} : { exemplar: targetExemplar }),
        existingFile: repositoryFileExists(repoPath, target.file),
      }, dependencies.claude);
      authored.push(writeAuthoredTarget({
        repoPath,
        plan,
        target,
        body,
        authoredBy: 'claude-cli',
        now: clock().toISOString(),
        ...(target.kind === 'regression' && input.before === undefined
          ? { note: 'pre-fix failure unverified' }
          : {}),
      }));
    } catch (error) {
      if (error instanceof ClaudeCliUnavailableError) throw error;
      failed.push({ key: target.key, reason: messageOf(error) });
      dropped.push({ target, reason: 'author_failed' });
    }
  }

  if (authored.length === 0) {
    return {
      planId: plan.planId,
      author: 'claude-cli',
      briefs: [],
      authored: [],
      failed,
      dropped,
    };
  }

  const regressionIds = new Set(authored.filter((test) => test.kind === 'regression').map((test) => test.id));
  let beforeRun: RunRecord | undefined;
  let beforeFailedIds = new Set<string>();
  if (input.before !== undefined && regressionIds.size > 0) {
    try {
      beforeRun = await withDetachedWorktree(repoPath, input.before, async (worktreePath) => {
        copyAuthoredState(repoPath, worktreePath, authored);
        return await dependencies.run({
          repoPath: worktreePath,
          bundle: `ids:${[...regressionIds].sort().join(',')}`,
          ...(input.bus === undefined ? {} : { bus: input.bus }),
          promote: false,
        });
      });
      beforeFailedIds = new Set(beforeRun.results.filter((result) => result.status === 'failed').map((result) => result.testId));
      for (const test of authored.filter((item) => regressionIds.has(item.id) && !beforeFailedIds.has(item.id))) {
        failed.push({ key: targetKey(plan, test.id), reason: 'pre-fix run did not fail' });
      }
    } catch (error) {
      for (const test of authored.filter((item) => regressionIds.has(item.id))) {
        failed.push({ key: targetKey(plan, test.id), reason: `pre-fix verification failed: ${messageOf(error)}` });
      }
    }
  }

  const currentRun = await dependencies.run({
    repoPath,
    bundle: `ids:${authored.map((test) => test.id).sort().join(',')}`,
    ...(input.bus === undefined ? {} : { bus: input.bus }),
    promote: false,
  });
  const passing = new Set(currentRun.results.filter((result) => result.status === 'passed').map((result) => result.testId));
  const promotable = new Set(authored.filter((test) => (
    passing.has(test.id)
    && (test.kind !== 'regression' || input.before === undefined || beforeFailedIds.has(test.id))
  )).map((test) => test.id));
  promotePassingCandidates(repoPath, promotable);
  for (const test of authored.filter((item) => !passing.has(item.id))) {
    if (!failed.some((item) => item.key === targetKey(plan, test.id))) {
      failed.push({ key: targetKey(plan, test.id), reason: 'new test did not pass' });
    }
  }
  const authoredIds = new Set(authored.map((test) => test.id));
  const finalRecords = loadRegistry(repoPath).filter((test) => authoredIds.has(test.id));
  return {
    planId: plan.planId,
    author: 'claude-cli',
    briefs: [],
    authored: finalRecords,
    failed: failed.sort((left, right) => left.key.localeCompare(right.key)),
    dropped: dropped.sort((left, right) => left.target.key.localeCompare(right.target.key)),
    runId: currentRun.runId,
    ...(beforeRun === undefined ? {} : { beforeRunId: beforeRun.runId }),
  };
}

function sourceExcerpt(repoPath: string, target: TestTarget): string {
  const path = repositoryFile(repoPath, target.brief.subject.file);
  if (path === undefined) return '';
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const start = Math.max(0, target.brief.subject.line - 10);
  return lines.slice(start, start + 40).join('\n');
}

function exemplar(repoPath: string, target: TestTarget): { file: string; source: string } | undefined {
  const example = target.brief.exemplars[0];
  if (example === undefined) return undefined;
  const path = repositoryFile(repoPath, example.file);
  return path === undefined ? undefined : { file: example.file, source: readFileSync(path, 'utf8').slice(0, 8000) };
}

function repositoryFile(repoPath: string, file: string): string | undefined {
  const candidate = join(repoPath, file);
  return existsSync(candidate) ? resolveRepositoryFile(repoPath, file) : undefined;
}

function repositoryFileExists(repoPath: string, file: string): boolean {
  return repositoryFile(repoPath, file) !== undefined;
}

function copyAuthoredState(repoPath: string, worktreePath: string, authored: readonly TestRecord[]): void {
  const files = new Set(authored.map((test) => test.file));
  files.add('.augur/tests.jsonl');
  files.add('.augur/tests.config.json');
  for (const file of files) {
    const source = repositoryFile(repoPath, file);
    if (source === undefined) continue;
    const destination = resolveRepositoryFile(worktreePath, file, false);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function targetKey(plan: TestPlan, id: string): string {
  return plan.targets.find((target) => testId(plan.repository, target.file, target.brief.title) === id)?.key ?? id;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

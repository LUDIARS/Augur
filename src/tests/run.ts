import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { allowedEnvironment, createBus, type Bus } from '../bus/index.ts';
import { resolveBusConfig, type AugurConfig } from '../config/config.ts';
import { analyzePr, type PrImpact } from './anatomia.ts';
import { parseBundle, selectBundle } from './bundle.ts';
import { loadTestsConfig } from './config.ts';
import { readGitMetadata } from './git.ts';
import { loadValidatedRegistry, updateRegistry } from './registry.ts';
import type { RunStore } from './run-store.ts';
import { getRunner } from './runners/index.ts';
import { evaluateRetirement } from './retirement.ts';
import {
  deriveRunStatus,
  runRecordSchema,
  type RunInput,
  type RunRecord,
  type RunResult,
  type TestRecord,
} from './types.ts';

export class EmptyBundleError extends Error {
  readonly exitCode = 3;
  readonly forRevisor: boolean;

  constructor(forRevisor: boolean) {
    super('test bundle is empty');
    this.name = 'EmptyBundleError';
    this.forRevisor = forRevisor;
  }
}

export class RunHeadMismatchError extends Error {
  readonly exitCode = 1;

  constructor(expected: string, actual: string) {
    super(`requested head ${expected} does not match repository HEAD ${actual}`);
    this.name = 'RunHeadMismatchError';
  }
}

export interface RunDependencies {
  config: AugurConfig;
  store: RunStore;
  now?: () => Date;
  busFactory?: (name: string, config: ReturnType<typeof resolveBusConfig>) => Bus;
  prAnalyzer?: (repoPath: string, base: string | undefined, depth: number) => Promise<PrImpact>;
}

export async function executeRun(input: RunInput & { repoPath: string }, dependencies: RunDependencies): Promise<RunRecord> {
  const repoPath = resolve(input.repoPath);
  const testsConfig = loadTestsConfig(repoPath);
  const registry = loadValidatedRegistry(repoPath);
  const parsedBundle = typeof input.bundle === 'string'
    ? parseBundle(input.bundle)
    : { kind: input.bundle.kind, selector: input.bundle.selector ?? null };
  let changedAnchors: string[] = [];
  let impactedAnchors: string[] = [];
  if (parsedBundle.kind === 'pr') {
    const analyze = dependencies.prAnalyzer ?? analyzePr;
    const impact = await analyze(repoPath, parsedBundle.selector ?? undefined, testsConfig.impact.callerDepth);
    changedAnchors = impact.changedAnchors;
    impactedAnchors = impact.impactedAnchors;
  }
  const bundle = selectBundle(registry, { ...parsedBundle, changedAnchors, impactedAnchors });
  if (bundle.tests.length === 0) throw new EmptyBundleError(input.forRevisor === true);

  const metadata = readGitMetadata(repoPath);
  const headSha = validatedHeadSha(input.head, metadata.headSha);
  const busName = input.bus ?? testsConfig.defaultBus;
  const busConfig = resolveBusConfig(dependencies.config, busName, testsConfig.buses);
  const bus = (dependencies.busFactory ?? createBus)(busName, busConfig);
  if (input.cached === true) {
    const cached = await findCachedRun(dependencies.store, testsConfig.repository, headSha, bundle.testIds, busName);
    if (cached !== undefined) return cached;
  }

  const clock = dependencies.now ?? (() => new Date());
  const started = clock();
  const results: RunResult[] = [];
  const grouped = groupByRunner(bundle.tests);
  for (const [runnerId, tests] of grouped) {
    const runner = getRunner(runnerId);
    const runnerConfig = testsConfig.runners[runnerId] ?? {};
    for (const invocation of runner.buildInvocations(tests, runnerConfig)) {
      const invocationStart = clock().getTime();
      const output = await bus.exec({
        cwd: repoPath,
        argv: invocation.argv,
        env: allowedEnvironment(busConfig.env),
        timeoutMs: testsConfig.timeoutMs,
      });
      const invocationDuration = Math.max(0, clock().getTime() - invocationStart);
      results.push(...runner.parse(invocation, output).map((result) => (
        result.durationMs === 0 ? { ...result, durationMs: invocationDuration } : result
      )));
    }
  }
  results.sort((left, right) => bundle.testIds.indexOf(left.testId) - bundle.testIds.indexOf(right.testId));

  const finished = clock();
  const summary = summarize(results);
  const record = runRecordSchema.parse({
    runId: input.runId ?? createRunId(started),
    repository: testsConfig.repository,
    repoPath,
    headSha,
    branch: metadata.branch,
    bundle: {
      kind: bundle.kind,
      selector: bundle.selector,
      testIds: bundle.testIds,
      reason: bundle.reason,
    },
    bus: busName,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    results,
    summary,
    status: deriveRunStatus(results),
  });

  if (input.forRevisor !== true) {
    updateRegistry(repoPath, (current) => {
      const updated = updateRegistryAfterRun(current, results, record.finishedAt, input.promote !== false);
      const retired = evaluateRetirement(updated, testsConfig, record.finishedAt).records;
      return { records: retired, value: undefined };
    });
  }
  await dependencies.store.put(record);
  return record;
}

export function createRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `r-${timestamp}-${randomBytes(4).toString('hex')}`;
}

export function summarize(results: readonly RunResult[]): RunRecord['summary'] {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    error: results.filter((result) => result.status === 'error').length,
  };
}

function validatedHeadSha(requested: string | undefined, actual: string): string {
  if (requested !== undefined && requested.toLowerCase() !== actual.toLowerCase()) {
    throw new RunHeadMismatchError(requested, actual);
  }
  return actual;
}

function groupByRunner(tests: readonly TestRecord[]): Array<[TestRecord['runner'], TestRecord[]]> {
  const groups = new Map<TestRecord['runner'], TestRecord[]>();
  for (const test of tests) {
    const group = groups.get(test.runner) ?? [];
    group.push(test);
    groups.set(test.runner, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function updateRegistryAfterRun(
  records: readonly TestRecord[],
  results: readonly RunResult[],
  at: string,
  promote: boolean,
): TestRecord[] {
  const byId = new Map(results.map((result) => [result.testId, result]));
  return records.map((record): TestRecord => {
    const result = byId.get(record.id);
    if (result === undefined) return record;
    const passed = result.status === 'passed';
    const failed = result.status === 'failed' || result.status === 'error';
    return {
      ...record,
      lastRunAt: at,
      ...(failed ? { lastFailedAt: at } : {}),
      passStreak: passed ? record.passStreak + 1 : failed ? 0 : record.passStreak,
      runs: record.runs + 1,
      status: promote && passed && record.status === 'candidate' ? 'active' : record.status,
    };
  });
}

async function findCachedRun(
  store: RunStore,
  repository: string,
  headSha: string,
  testIds: readonly string[],
  bus: string,
): Promise<RunRecord | undefined> {
  const candidates = await store.list({ repository, headSha });
  return candidates.find((run) => (
    run.bus === bus
    && run.bundle.testIds.length === testIds.length
    && run.bundle.testIds.every((id, index) => id === testIds[index])
  ));
}

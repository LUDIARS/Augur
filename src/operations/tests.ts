import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig, type AugurConfig } from '../config/config.ts';
import { loadTestsConfig, quotaForDomain } from '../tests/config.ts';
import { parseBundle } from '../tests/bundle.ts';
import { flagRun, type FlagClientOptions } from '../tests/flag.ts';
import { createReport, type Report } from '../tests/report.ts';
import {
  lintRegistry,
  loadRegistry,
  resolveRepositoryFile,
  testId,
  updateRegistry,
  upsertTest,
} from '../tests/registry.ts';
import { executeRun, type RunDependencies } from '../tests/run.ts';
import { createRunStore, type RunStore } from '../tests/run-store.ts';
import { evaluateRetirement, reviveTest } from '../tests/retirement.ts';
import {
  runnerIdSchema,
  testKindSchema,
  testStatusSchema,
  verdictSchema,
  type FlagResult,
  type LintResult,
  type PruneResult,
  type RegisterInput,
  type RunInput,
  type RunQuery,
  type RunRecord,
  type SweepResult,
  type TestRecord,
  type Verdict,
} from '../tests/types.ts';

export interface ServiceCatalog {
  repository: string;
  generatedAt: string;
  domains: Array<{
    business: string | '(unowned)';
    description?: string;
    quota: { max: number; active: number; probation: number; retired: number };
    programDomains: string[];
    tests: Array<Pick<TestRecord, 'id' | 'name' | 'kind' | 'status' | 'runtime' | 'always' | 'file' | 'lastRunAt' | 'lastFailedAt' | 'passStreak'>>;
    lastRun?: { runId: string; at: string; status: RunRecord['status'] };
  }>;
}

export interface PlanInput { repository?: string | undefined; repoPath?: string | undefined; source: unknown }
export type TestPlan = unknown;
export type AuthorResult = unknown;

export interface TestOperations {
  listTests(q: { repoPath: string; domain?: string; kind?: string; status?: string }): Promise<TestRecord[]>;
  getTest(q: { repoPath: string; testId: string }): Promise<{ test: TestRecord; recentRuns: RunRecord[] }>;
  catalog(q: { repoPath: string }): Promise<ServiceCatalog>;
  register(q: RegisterInput): Promise<TestRecord>;
  registerFromPlan(q: { repoPath: string; planId: string }): Promise<TestRecord[]>;
  lint(q: { repoPath: string }): Promise<LintResult>;
  plan(q: PlanInput): Promise<TestPlan>;
  author(q: { planId: string; repoPath: string; author: 'session' | 'claude-cli'; bus?: string | undefined }): Promise<AuthorResult>;
  run(q: RunInput): Promise<RunRecord>;
  report(runId: string): Promise<Report>;
  verdict(runId: string, verdict: Verdict): Promise<RunRecord>;
  flag(runId: string, target: { pullRequestId: string }): Promise<FlagResult>;
  listRuns(q: RunQuery): Promise<RunRecord[]>;
  sweep(q: { repoPath: string; now?: string; apply?: boolean }): Promise<SweepResult>;
  revive(q: { repoPath: string; testId: string }): Promise<TestRecord>;
  prune(q: { repoPath: string; apply?: boolean }): Promise<PruneResult>;
}

export class NotFoundError extends Error { readonly status = 404; readonly code = 'not_found' }
export class NotImplementedOperationError extends Error { readonly status = 501; readonly code = 'not_implemented' }
export class OperationConflictError extends Error { readonly status = 409; readonly code = 'conflict' }
export class InvalidOperationInputError extends Error { readonly status = 400; readonly code = 'invalid_request'; readonly exitCode = 1 }

export interface TestOperationsOptions {
  config?: AugurConfig;
  store?: RunStore | Promise<RunStore>;
  now?: () => Date;
  flag?: FlagClientOptions;
  runDependencies?: Partial<Omit<RunDependencies, 'config' | 'store'>>;
}

const registerSchema = z.object({
  repoPath: z.string(),
  file: z.string(),
  name: z.string().min(1),
  runner: runnerIdSchema,
  selector: z.string().optional(),
  command: z.array(z.string()).min(1).optional(),
  kind: testKindSchema.default('assurance'),
  program: z.array(z.string()).min(1),
  business: z.array(z.string()).default([]),
  anchors: z.array(z.string()).default([]),
  runtime: z.boolean().default(false),
  always: z.boolean().default(false),
}).strict();

const planIdSchema = z.string().regex(/^plan_[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a plan_ ULID');

export class DefaultTestOperations implements TestOperations {
  readonly config: AugurConfig;
  private storePromise: Promise<RunStore> | undefined;
  private readonly clock: () => Date;
  private readonly flagOptions: FlagClientOptions;
  private readonly runOverrides: Partial<Omit<RunDependencies, 'config' | 'store'>>;

  constructor(options: TestOperationsOptions = {}) {
    this.config = options.config ?? loadConfig();
    if (options.store !== undefined) this.storePromise = Promise.resolve(options.store);
    this.clock = options.now ?? (() => new Date());
    this.flagOptions = options.flag ?? {};
    this.runOverrides = options.runDependencies ?? {};
  }

  resolveRepo(input: { repository?: string | undefined; repoPath?: string | undefined }): string {
    if (input.repoPath !== undefined) return resolve(input.repoPath);
    if (input.repository !== undefined) {
      const path = this.config.repositories[input.repository];
      if (path !== undefined) return resolve(path);
      throw new NotFoundError(`repository is not configured: ${input.repository}`);
    }
    throw new Error('repository or repoPath is required');
  }

  async listTests(q: { repoPath: string; domain?: string; kind?: string; status?: string }): Promise<TestRecord[]> {
    if (q.kind !== undefined) testKindSchema.parse(q.kind);
    if (q.status !== undefined) testStatusSchema.parse(q.status);
    return loadRegistry(resolve(q.repoPath)).filter((test) => (
      (q.domain === undefined || [...test.domains.business, ...test.domains.program].includes(q.domain))
      && (q.kind === undefined || test.kind === q.kind)
      && (q.status === undefined || test.status === q.status)
    ));
  }

  async getTest(q: { repoPath: string; testId: string }): Promise<{ test: TestRecord; recentRuns: RunRecord[] }> {
    const test = loadRegistry(resolve(q.repoPath)).find((candidate) => candidate.id === q.testId);
    if (test === undefined) throw new NotFoundError(`test not found: ${q.testId}`);
    const runs = await (await this.store()).list({ repository: test.repository });
    return { test, recentRuns: runs.filter((run) => run.bundle.testIds.includes(test.id)).slice(0, 10) };
  }

  async catalog(q: { repoPath: string }): Promise<ServiceCatalog> {
    const repoPath = resolve(q.repoPath);
    const tests = loadRegistry(repoPath);
    const testsConfig = loadTestsConfig(repoPath);
    const runs = await (await this.store()).list({ repository: testsConfig.repository });
    const descriptions = readDomainDescriptions(repoPath);
    const domainNames = new Set<string>();
    for (const test of tests) {
      if (test.domains.business.length === 0) domainNames.add('(unowned)');
      else for (const domain of test.domains.business) domainNames.add(domain);
    }
    return {
      repository: testsConfig.repository,
      generatedAt: this.clock().toISOString(),
      domains: [...domainNames].sort().map((business) => {
        const domainTests = tests.filter((test) => business === '(unowned)'
          ? test.domains.business.length === 0
          : test.domains.business.includes(business));
        const ids = new Set(domainTests.map((test) => test.id));
        const lastRun = runs.find((run) => run.bundle.testIds.some((id) => ids.has(id)));
        return {
          business,
          ...(descriptions[business] === undefined ? {} : { description: descriptions[business] }),
          quota: {
            max: quotaForDomain(testsConfig, business),
            active: domainTests.filter((test) => test.status === 'active').length,
            probation: domainTests.filter((test) => test.status === 'probation').length,
            retired: domainTests.filter((test) => test.status === 'retired').length,
          },
          programDomains: [...new Set(domainTests.flatMap((test) => test.domains.program))].sort(),
          tests: domainTests.sort((left, right) => left.id.localeCompare(right.id)).map(catalogTest),
          ...(lastRun === undefined ? {} : { lastRun: { runId: lastRun.runId, at: lastRun.finishedAt, status: lastRun.status } }),
        };
      }),
    };
  }

  async register(q: RegisterInput): Promise<TestRecord> {
    const input = registerSchema.parse(q);
    const repoPath = resolve(input.repoPath);
    resolveRepositoryFile(repoPath, input.file);
    const config = loadTestsConfig(repoPath);
    const record: TestRecord = {
      id: testId(config.repository, input.file, input.name),
      repository: config.repository,
      name: input.name,
      file: input.file,
      ...(input.selector === undefined ? {} : { selector: input.selector }),
      runner: input.runner,
      ...(input.command === undefined ? {} : { command: input.command }),
      kind: input.kind,
      domains: { business: input.business, program: input.program },
      anchors: input.anchors,
      origin: { type: 'manual', ref: '', authoredBy: 'human' },
      runtime: input.runtime,
      always: input.always,
      status: 'active',
      createdAt: this.clock().toISOString(),
      passStreak: 0,
      runs: 0,
    };
    return upsertTest(repoPath, record);
  }

  async registerFromPlan(q: { repoPath: string; planId: string }): Promise<TestRecord[]> {
    const repoPath = resolve(q.repoPath);
    const plan = loadStoredTestPlan(this.config.dataDir, q.planId);
    const config = loadTestsConfig(repoPath);
    const registered: TestRecord[] = [];
    for (const target of parseTargets(plan)) {
      const path = resolveRepositoryFile(repoPath, target.file);
      const source = readFileSync(path, 'utf8');
      if (!source.includes(`plan:${q.planId}`) && !source.includes(target.title)) {
        throw new Error(`${target.file}: does not contain plan marker or target title ${target.title}`);
      }
      registered.push(upsertTest(repoPath, {
        id: testId(config.repository, target.file, target.title),
        repository: config.repository,
        name: target.title,
        file: target.file,
        runner: target.runner,
        kind: target.kind,
        domains: target.domains,
        anchors: target.anchors,
        origin: { type: 'pr', ref: '', planId: q.planId, authoredBy: 'session' },
        runtime: target.runtime,
        always: false,
        status: 'candidate',
        createdAt: this.clock().toISOString(),
        passStreak: 0,
        runs: 0,
      }));
    }
    return registered;
  }

  async lint(q: { repoPath: string }): Promise<LintResult> {
    const errors = lintRegistry(resolve(q.repoPath));
    return { valid: errors.length === 0, errors };
  }

  async plan(): Promise<TestPlan> {
    throw new NotImplementedOperationError('not implemented in this build (Phase T2)');
  }

  async author(): Promise<AuthorResult> {
    throw new NotImplementedOperationError('not implemented in this build (Phase T2)');
  }

  async run(q: RunInput): Promise<RunRecord> {
    if (typeof q.bundle === 'string') {
      try {
        parseBundle(q.bundle);
      } catch (error) {
        throw new InvalidOperationInputError(error instanceof Error ? error.message : String(error));
      }
    }
    const repoPath = this.resolveRepo(q);
    const store = await this.store();
    return await executeRun({ ...q, repoPath }, {
      config: this.config,
      store,
      now: this.clock,
      ...this.runOverrides,
    });
  }

  async report(runId: string): Promise<Report> {
    const run = await this.requireRun(runId);
    return createReport(run, loadRegistry(run.repoPath));
  }

  async verdict(runId: string, verdict: Verdict): Promise<RunRecord> {
    const run = await this.requireRun(runId);
    const updated = { ...run, verdict: verdictSchema.parse(verdict) };
    await (await this.store()).put(updated);
    return updated;
  }

  async flag(runId: string, target: { pullRequestId: string }): Promise<FlagResult> {
    const run = await this.requireRun(runId);
    const flag = await flagRun(run, target.pullRequestId, this.flagOptions);
    await (await this.store()).put({ ...run, flag });
    return flag;
  }

  async listRuns(q: RunQuery): Promise<RunRecord[]> {
    if (q.status !== undefined) z.enum(['passed', 'failed', 'error']).parse(q.status);
    if (q.since !== undefined) z.string().datetime().parse(q.since);
    return await (await this.store()).list(q);
  }

  async sweep(q: { repoPath: string; now?: string; apply?: boolean }): Promise<SweepResult> {
    const repoPath = resolve(q.repoPath);
    const now = q.now === undefined ? this.clock().toISOString() : z.string().datetime().parse(q.now);
    if (q.apply === true) {
      return updateRegistry(repoPath, (records) => {
        const evaluation = evaluateRetirement(records, loadTestsConfig(repoPath), now);
        return {
          records: evaluation.records,
          value: { changes: retirementChanges(evaluation.transitions), applied: true },
        };
      });
    }
    const records = loadRegistry(repoPath);
    const evaluation = evaluateRetirement(records, loadTestsConfig(repoPath), now);
    return { changes: retirementChanges(evaluation.transitions), applied: false };
  }

  async revive(q: { repoPath: string; testId: string }): Promise<TestRecord> {
    const repoPath = resolve(q.repoPath);
    return updateRegistry(repoPath, (records) => {
      const current = records.find((record) => record.id === q.testId);
      if (current === undefined) throw new NotFoundError(`test not found: ${q.testId}`);
      if (current.status !== 'retired') throw new OperationConflictError(`${q.testId} is not retired`);
      const revived = reviveTest(records, q.testId);
      return { records: revived.records, value: revived.test };
    });
  }

  async prune(q: { repoPath: string; apply?: boolean }): Promise<PruneResult> {
    const repoPath = resolve(q.repoPath);
    if (q.apply !== true) {
      const files = prunableFiles(loadRegistry(repoPath));
      for (const file of files) resolveRepositoryFile(repoPath, file);
      return { files, applied: false };
    }
    return updateRegistry(repoPath, (records) => {
      const files = prunableFiles(records);
      for (const file of files) unlinkSync(resolveRepositoryFile(repoPath, file));
      return {
        records: records.filter((record) => !files.includes(record.file) || record.status !== 'retired'),
        value: { files, applied: true },
      };
    });
  }

  private async store(): Promise<RunStore> {
    this.storePromise ??= createRunStore(this.config.dataDir, this.config.runCache);
    return await this.storePromise;
  }

  private async requireRun(runId: string): Promise<RunRecord> {
    const run = await (await this.store()).get(runId);
    if (run === undefined) throw new NotFoundError(`run not found: ${runId}`);
    return run;
  }
}

export function createTestOperations(options: TestOperationsOptions = {}): DefaultTestOperations {
  return new DefaultTestOperations(options);
}

function catalogTest(test: TestRecord): ServiceCatalog['domains'][number]['tests'][number] {
  return {
    id: test.id,
    name: test.name,
    kind: test.kind,
    status: test.status,
    runtime: test.runtime,
    always: test.always,
    file: test.file,
    ...(test.lastRunAt === undefined ? {} : { lastRunAt: test.lastRunAt }),
    ...(test.lastFailedAt === undefined ? {} : { lastFailedAt: test.lastFailedAt }),
    passStreak: test.passStreak,
  };
}

function readDomainDescriptions(repoPath: string): Record<string, string> {
  const directory = join(repoPath, 'spec', 'domains');
  if (!existsSync(directory)) return {};
  const output: Record<string, string> = {};
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.domain.json')).sort()) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      if (isRecord(parsed) && typeof parsed.name === 'string' && typeof parsed.description === 'string') {
        output[parsed.name] = parsed.description;
      }
    } catch {
      // A malformed domain document is not a registry error; catalog omits its description.
    }
  }
  return output;
}

function loadStoredTestPlan(dataDir: string, planId: string): unknown {
  const safePlanId = planIdSchema.parse(planId);
  for (const path of [join(dataDir, 'test-plans', `${safePlanId}.json`), join(dataDir, 'plans', `${safePlanId}.json`)]) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  }
  throw new NotFoundError(`test plan not found: ${safePlanId}`);
}

function retirementChanges(
  transitions: ReturnType<typeof evaluateRetirement>['transitions'],
): SweepResult['changes'] {
  return transitions.map((item) => ({ id: item.id, from: item.from, to: item.to, reason: item.reason }));
}

function prunableFiles(records: readonly TestRecord[]): string[] {
  const activeFiles = new Set(records.filter((record) => record.status !== 'retired').map((record) => record.file));
  return [...new Set(records
    .filter((record) => record.status === 'retired' && !activeFiles.has(record.file))
    .map((record) => record.file))].sort();
}

interface RegistrationTarget {
  file: string;
  title: string;
  runner: TestRecord['runner'];
  kind: TestRecord['kind'];
  domains: TestRecord['domains'];
  anchors: string[];
  runtime: boolean;
}

function parseTargets(plan: unknown): RegistrationTarget[] {
  const root = isRecord(plan) && isRecord(plan.response) ? plan.response : plan;
  if (!isRecord(root) || !Array.isArray(root.targets)) throw new Error('stored test plan has no targets');
  return root.targets.map((value, index) => {
    if (!isRecord(value) || !isRecord(value.domains) || !isRecord(value.brief)) throw new Error(`target ${index} is invalid`);
    return {
      file: z.string().parse(value.file),
      title: z.string().parse(value.brief.title),
      runner: runnerIdSchema.parse(value.runner),
      kind: testKindSchema.parse(value.kind),
      domains: {
        business: z.array(z.string()).parse(value.domains.business),
        program: z.array(z.string()).min(1).parse(value.domains.program),
      },
      anchors: z.array(z.string()).parse(value.anchors),
      runtime: typeof value.runtime === 'boolean' ? value.runtime : false,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

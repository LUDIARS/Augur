import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createPlan } from '../../engine/createPlan.ts';
import { createPlanRequestSchema, type CreatePlanRequest } from '../../schema/index.ts';
import {
  callers as anatomiaCallers,
  domainsProgram,
  find as anatomiaFind,
  parsePrDiffReview,
  prReview,
  where as anatomiaWhere,
  type AnatomiaSymbolHit,
  type PrDiffReview,
  type ProgramDomainDiagnosis,
} from '../anatomia.ts';
import { loadTestsConfig, type TestsConfig } from '../config.ts';
import { readGitMetadata } from '../git.ts';
import { FilePlanStore, type PlanStore } from '../plan-store.ts';
import { loadRegistry } from '../registry.ts';
import type { RunStore } from '../run-store.ts';
import type { TestPlan, TestRecord } from '../types.ts';
import { materializeTarget } from './briefs.ts';
import { intakeIncident } from './incident.ts';
import { applyQuota } from './quota.ts';
import { derivePrTargets, domainsFor, type TargetCandidate } from './targets.ts';

export class TestPlanInputError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = 'TestPlanInputError';
  }
}

const prSourceSchema = z.object({
  type: z.literal('pr'),
  analysis: z.unknown().optional(),
  analysisFile: z.string().optional(),
  analyze: z.boolean().optional(),
  noImpact: z.boolean().optional(),
  base: z.string().optional(),
  ref: z.string().optional(),
  pr: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  request: z.unknown().optional(),
}).passthrough();

const incidentSourceSchema = z.object({
  type: z.literal('incident'),
  file: z.string().min(1),
  noImpact: z.boolean().optional(),
}).passthrough();

const experienceSourceSchema = z.object({
  type: z.literal('experience'),
  ref: z.string(),
  request: z.unknown(),
  analysis: z.unknown().optional(),
  noImpact: z.boolean().optional(),
}).passthrough();

export const testPlanInputSchema = z.object({
  repository: z.string().optional(),
  repoPath: z.string(),
  source: z.discriminatedUnion('type', [prSourceSchema, incidentSourceSchema, experienceSourceSchema]),
}).strict();

export type TestPlanInput = z.infer<typeof testPlanInputSchema>;

export interface TestPlanDependencies {
  planStore: PlanStore;
  runStore: RunStore;
  analyze: (repoPath: string, base?: string) => Promise<PrDiffReview>;
  domains: (repoPath: string) => Promise<ProgramDomainDiagnosis>;
  callers: (name: string, repoPath: string, depth: number) => Promise<AnatomiaSymbolHit[]>;
  find: (name: string, repoPath: string) => Promise<AnatomiaSymbolHit[]>;
  where: (task: string, repoPath: string) => Promise<unknown>;
}

export async function plan(
  rawInput: TestPlanInput,
  dependencies: Partial<TestPlanDependencies> & Pick<TestPlanDependencies, 'runStore'>,
): Promise<TestPlan> {
  const input = parseInput(rawInput);
  const repoPath = resolve(input.repoPath);
  const config = loadTestsConfig(repoPath);
  const registry = loadRegistry(repoPath);
  const planStore = dependencies.planStore ?? new FilePlanStore(resolve('.augur-data'));
  const loadDomains = dependencies.domains ?? domainsProgram;
  const call = dependencies.callers ?? anatomiaCallers;
  const program = await loadDomains(repoPath);

  if (input.source.type === 'incident') {
    return await planIncident(input.source.file, repoPath, config, registry, program, planStore, {
      runStore: dependencies.runStore,
      callers: call,
      find: dependencies.find ?? anatomiaFind,
      where: dependencies.where ?? anatomiaWhere,
    });
  }

  const analysis = input.source.type === 'experience'
    ? parseAnalysis(input.source.analysis)
    : await analysisFor(input.source, repoPath, dependencies.analyze ?? prReview);
  if (analysis === undefined) throw new TestPlanInputError('experience planning requires analysis for program-domain placement');
  assertAnalysisContract(analysis);
  const sourceType = input.source.type;
  const sourceRef = sourceType === 'experience' ? input.source.ref : input.source.pr ?? input.source.ref ?? input.source.base ?? '';
  const sourceAnalysis = input.source.type === 'experience'
    || (input.source.type === 'pr' && (input.source.analysis !== undefined || input.source.analysisFile !== undefined))
    ? `sha256:${createHash('sha256').update(JSON.stringify(analysis)).digest('hex')}`
    : undefined;
  const basePlan = {
    repository: config.repository,
    headSha: analysis.diff.head ?? readGitMetadata(repoPath).headSha,
    source: {
      type: sourceType,
      ref: sourceRef,
      ...(sourceAnalysis === undefined ? {} : { analysis: sourceAnalysis }),
    },
  } as const;
  const blockers = [...analysis.domain.dualLayer.unclassifiedAnchors].sort();
  if (blockers.length > 0) {
    const quota = applyQuota([], registry, config).quota;
    return planStore.save({
      ...basePlan,
      status: 'blocked_by_domain',
      blockers,
      targets: [],
      dropped: [],
      quota,
    }, repoPath);
  }

  const impacted = await impactByAnchor(
    [...analysis.diff.anchors.added, ...analysis.diff.anchors.changed],
    new Map(analysis.quality.changedFunctions.map((metric) => [metric.anchor, metric.fanIn])),
    repoPath,
    config,
    input.source.noImpact === true,
    call,
  );
  const bugEvidence = input.source.type === 'pr' ? `${input.source.title ?? ''}\n${input.source.body ?? ''}` : '';
  const candidates = derivePrTargets({ analysis, program, impacted, registry, config, bugFixEvidence: bugEvidence });
  candidates.push(...guardrailCandidates(input.source.request, analysis, program, config));
  const materialized = candidates.map((candidate) => ({
    candidate,
    target: materializeTarget({ candidate, registry, config, program }),
  }));
  const preDropped: TestPlan['dropped'] = materialized.flatMap(({ candidate, target }) => (
    candidate.dropReason === undefined ? [] : [{ target, reason: candidate.dropReason }]
  ));
  const quota = applyQuota(
    materialized.filter(({ candidate }) => candidate.dropReason === undefined).map(({ target }) => target),
    registry,
    config,
  );
  const targets = quota.targets;
  return planStore.save({
    ...basePlan,
    status: targets.length === 0 ? 'empty' : 'ready',
    blockers: [],
    targets,
    dropped: [...preDropped, ...quota.dropped].sort((left, right) => left.target.key.localeCompare(right.target.key)),
    quota: quota.quota,
  }, repoPath);
}

async function planIncident(
  reference: string,
  repoPath: string,
  config: TestsConfig,
  registry: readonly TestRecord[],
  program: ProgramDomainDiagnosis,
  store: PlanStore,
  dependencies: Pick<TestPlanDependencies, 'runStore' | 'callers' | 'find' | 'where'>,
): Promise<TestPlan> {
  const anchors = await intakeIncident(reference, repoPath, {
    find: dependencies.find,
    where: dependencies.where,
    runStore: dependencies.runStore,
    registry,
  });
  const candidates: TargetCandidate[] = [];
  for (const incident of anchors) {
    const impacted = await dependencies.callers(incident.anchor, repoPath, config.impact.callerDepth);
    candidates.push({
      key: `regression:${incident.anchor}`,
      kind: 'regression',
      domains: incident.domains ?? domainsFor(incident.anchor, incident.subject.file, undefined, program),
      anchors: [incident.anchor],
      impacted: impacted.flatMap((hit) => hit.anchor === null ? [] : [hit.anchor]).sort(),
      subject: incident.subject,
      risks: ['boundary', 'state_transition'],
      priorityFacts: {
        incident: true,
        fanIn: 0,
        cyclomatic: 0,
        touchesErrorViolation: false,
        added: false,
      },
      incident: {
        log: incident.log,
        failure: incident.failure,
        expectedAfterFix: incident.expectedAfterFix,
      },
    });
  }
  const targets = candidates.map((candidate) => materializeTarget({ candidate, registry, config, program }));
  const quota = applyQuota(targets, registry, config);
  return store.save({
    repository: config.repository,
    headSha: readGitMetadata(repoPath).headSha,
    source: { type: 'incident', ref: reference },
    status: quota.targets.length === 0 ? 'empty' : 'ready',
    blockers: [],
    targets: quota.targets,
    dropped: quota.dropped,
    quota: quota.quota,
  }, repoPath);
}

async function analysisFor(
  source: z.infer<typeof prSourceSchema>,
  repoPath: string,
  analyze: (repoPath: string, base?: string) => Promise<PrDiffReview>,
): Promise<PrDiffReview> {
  if (source.analysis !== undefined) return parseAnalysis(source.analysis)!;
  if (source.analysisFile !== undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(resolve(source.analysisFile), 'utf8')) as unknown;
    } catch (error) {
      throw new TestPlanInputError(`analysis file is not valid JSON: ${messageOf(error)}`);
    }
    return parseAnalysis(raw)!;
  }
  return await analyze(repoPath, source.base);
}

function parseAnalysis(raw: unknown): PrDiffReview | undefined {
  if (raw === undefined) return undefined;
  try {
    return parsePrDiffReview(raw);
  } catch (error) {
    throw new TestPlanInputError(`analysis does not satisfy the PrDiffReview contract: ${messageOf(error)}`);
  }
}

function assertAnalysisContract(analysis: PrDiffReview): void {
  if (analysis.temporary !== true) throw new TestPlanInputError('analysis.temporary must be true');
  if (!analysis.diff.available) throw new TestPlanInputError('analysis.diff.available must be true');
}

async function impactByAnchor(
  anchors: readonly string[],
  fanInByAnchor: ReadonlyMap<string, number>,
  repoPath: string,
  config: TestsConfig,
  noImpact: boolean,
  call: TestPlanDependencies['callers'],
): Promise<Record<string, string[]>> {
  const output: Record<string, string[]> = {};
  const pending = [...new Set(anchors)].sort();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const anchor = pending[cursor++]!;
      output[anchor] = noImpact || fanInByAnchor.get(anchor) === 0 ? [] : (await call(anchor, repoPath, config.impact.callerDepth))
      .flatMap((hit) => hit.anchor === null || hit.anchor === anchor ? [] : [hit.anchor])
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  return output;
}

function guardrailCandidates(
  rawRequest: unknown,
  analysis: PrDiffReview,
  program: ProgramDomainDiagnosis,
  config: TestsConfig,
): TargetCandidate[] {
  const request = engineRequest(rawRequest, analysis);
  if (request === undefined) return [];
  const suggestions = createPlan(request).testPlan.suggestions.filter((suggestion) => suggestion.budget !== undefined);
  const subjects = derivePrTargets({ analysis, program, impacted: {}, registry: [], config }).filter((target) => target.kind === 'assurance');
  return suggestions.flatMap((suggestion, index): TargetCandidate[] => {
    const subject = subjects.find((candidate) => suggestion.targetFiles?.includes(candidate.subject.file)) ?? subjects[0];
    if (subject === undefined) return [];
    const base = { ...subject };
    delete base.dropReason;
    return [{
      ...base,
      key: `guardrail:${subject.anchors[0]}:${String(index).padStart(3, '0')}`,
      kind: 'guardrail',
      subject: {
        ...subject.subject,
        signature: `${suggestion.title}: ${JSON.stringify(suggestion.budget)}`,
      },
      risks: ['contract'],
    }];
  });
}

function engineRequest(raw: unknown, analysis: PrDiffReview): CreatePlanRequest | undefined {
  if (raw !== undefined) return createPlanRequestSchema.parse(raw);
  const record = analysis as Record<string, unknown>;
  if (!Array.isArray(record.experienceGoals) || record.experienceGoals.length === 0) return undefined;
  return createPlanRequestSchema.parse({
    objective: { kind: 'unknown', description: 'Derive experience guardrails for this change.' },
    experienceGoals: record.experienceGoals,
    ...(record.project === undefined ? {} : { project: record.project }),
    ...(record.runtimeSignals === undefined ? {} : { runtimeSignals: record.runtimeSignals }),
    ...(record.constraints === undefined ? {} : { constraints: record.constraints }),
  });
}

function parseInput(input: TestPlanInput): TestPlanInput {
  try {
    return testPlanInputSchema.parse(input);
  } catch (error) {
    throw new TestPlanInputError(messageOf(error));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

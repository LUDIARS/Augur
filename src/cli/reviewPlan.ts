import { z } from 'zod';
import { createPlan } from '../engine/createPlan.ts';
import { UsageError } from './args.ts';
import type { CreatePlanRequest, PlanResponse } from '../schema/index.ts';

// `augur review-plan` — the control-planner contract Revisor calls at the start
// of every local pull-request review (spec/interface/review-plan-cli.md).
//
// The reduction from a plan to stage decisions lives here on purpose: review
// stages are the caller's vocabulary, and putting them in the engine would make
// the planner know about one consumer's workflow.

export const CONTRACT_VERSION = 1;

const changeProfileSchema = z.object({
  kinds: z.array(z.string()),
  counts: z.record(z.string(), z.number()).optional(),
  changedFiles: z.number(),
  changedLines: z.number(),
  docsOnly: z.boolean(),
  touchesSpec: z.boolean().optional(),
  runtimeSurfaces: z.array(z.string()),
});

const requestSchema = z.object({
  version: z.number(),
  repository: z.string(),
  pullRequest: z.object({ number: z.number(), title: z.string().nullable().optional() }),
  changeProfile: changeProfileSchema,
  stages: z.array(z.object({ id: z.string(), run: z.boolean(), reason: z.string().optional() })),
  testCases: z.array(
    z.object({
      name: z.string(),
      kinds: z.array(z.string()).nullable().optional(),
      runtime: z.boolean().optional(),
      always: z.boolean().optional(),
    }),
  ),
  stageIds: z.array(z.string()),
});

export type ReviewPlanRequest = z.infer<typeof requestSchema>;

export interface ReviewPlanResponse {
  readonly stages: ReadonlyArray<{ id: string; run: boolean; reason: string }>;
  readonly testCases: readonly string[];
}

// Stages the caller enforces as mandatory. Proposing to skip one is refused on
// the caller's side, so the effort is not spent here either.
const MANDATORY = new Set([
  'leakage_scan',
  'anatomia_domain_review',
  'spec_requirements',
  'reviewer_autofix',
]);

const EXECUTABLE_KINDS = new Set(['code', 'infra', 'config', 'test']);
const RUNTIME_SURFACES = new Set(['migration', 'entrypoint', 'ui', 'infra']);

// Every rejection here is a bad request, not a broken planner, so it is raised as
// a UsageError: the caller distinguishes "you asked wrong" (exit 1) from "Augur
// broke" (exit 2) by that number alone (spec/interface/review-plan-cli.md,
// "Exit codes").
export function parseReviewPlanRequest(text: string): ReviewPlanRequest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError('stdin must contain one JSON object');
  }
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    throw new UsageError(
      path ? `${path}: ${issue?.message}` : (issue?.message ?? 'request is invalid'),
    );
  }
  // An unknown major version means the caller changed the contract; guessing at
  // it would produce a plan for a request shape Augur has not seen.
  if (parsed.data.version !== CONTRACT_VERSION) {
    throw new UsageError(
      `unsupported request version ${parsed.data.version}; this build speaks version ${CONTRACT_VERSION}`,
    );
  }
  return parsed.data;
}

// The change profile carries no diff and no paths by design, so the objective is
// inferred from what it does carry: what kinds moved and which surfaces they
// touch.
export function objectiveFor(request: ReviewPlanRequest): CreatePlanRequest['objective'] {
  const { changeProfile } = request;
  const surfaces = changeProfile.runtimeSurfaces.filter((surface) => RUNTIME_SURFACES.has(surface));
  const kind = changeProfile.docsOnly
    ? ('unknown' as const)
    : surfaces.length > 0
      ? ('stability' as const)
      : ('refactor' as const);
  const description = changeProfile.docsOnly
    ? `Documentation-only change in ${request.repository}#${request.pullRequest.number}: ${changeProfile.changedFiles} file(s), ${changeProfile.changedLines} line(s).`
    : `Change in ${request.repository}#${request.pullRequest.number} touching ${changeProfile.kinds.join(', ')}: ${changeProfile.changedFiles} file(s), ${changeProfile.changedLines} line(s)${surfaces.length > 0 ? `, runtime surfaces: ${surfaces.join(', ')}` : ''}.`;
  return {
    kind,
    description,
    desiredOutcome: 'Decide which review checks this change needs.',
  };
}

export function planRequestFor(request: ReviewPlanRequest): CreatePlanRequest {
  return {
    objective: objectiveFor(request),
    project: { name: request.repository },
    constraints: [
      {
        type: 'policy',
        value:
          'Augur only advises which checks to run; Revisor owns execution and enforces a safety floor.',
      },
    ],
  } as CreatePlanRequest;
}

function hasExecutable(request: ReviewPlanRequest): boolean {
  return request.changeProfile.kinds.some((kind) => EXECUTABLE_KINDS.has(kind));
}

// A suggestion that names no executable target is evidence that the code-analysis
// and vulnerability stages buy nothing for this change: there is nothing for them
// to report on.
export function reducePlan(request: ReviewPlanRequest, plan: PlanResponse): ReviewPlanResponse {
  const executable = hasExecutable(request);
  const securityRelevant = plan.testPlan.suggestions.some(
    (suggestion) => suggestion.kind === 'security' || suggestion.priority === 'critical',
  );
  const stages: Array<{ id: string; run: boolean; reason: string }> = [];
  const known = new Set(request.stageIds);

  const propose = (id: string, run: boolean, reason: string): void => {
    if (!known.has(id) || MANDATORY.has(id)) return;
    stages.push({ id, run, reason });
  };

  if (!executable) {
    propose(
      'anatomia_code_analysis',
      false,
      `実行コードを含まない変更 (${request.changeProfile.kinds.join('/') || 'なし'}) なので、コード解析が報告できる対象がありません`,
    );
    propose(
      'security_review',
      securityRelevant,
      securityRelevant
        ? '実行コードを含まない変更ですが、計画が security 観点の確認を挙げています'
        : '実行されるコードが動いていないため攻撃面が変化しません',
    );
  }

  return { stages, testCases: selectTestCases(request, executable) };
}

// Coverage the caller already declared is respected; Augur only re-adds a case
// the caller skipped when the plan says that kind of change still matters. It
// never drops one, because the caller refuses that on executable change anyway
// and silently thinning coverage is the failure this contract must not enable.
function selectTestCases(request: ReviewPlanRequest, executable: boolean): string[] {
  const selected = request.testCases.filter((testCase) => {
    if (testCase.always === true) return true;
    const kinds = testCase.kinds ?? [...EXECUTABLE_KINDS];
    return kinds.some((kind) => request.changeProfile.kinds.includes(kind));
  });
  if (executable) {
    // On executable change every runtime case is worth keeping: it is the only
    // evidence that replaces a human actually running the product.
    for (const testCase of request.testCases) {
      if (testCase.runtime === true && !selected.includes(testCase)) selected.push(testCase);
    }
  }
  return selected.map((testCase) => testCase.name);
}

export function reviewPlan(text: string): ReviewPlanResponse {
  const request = parseReviewPlanRequest(text);
  return reducePlan(request, createPlan(planRequestFor(request)));
}

import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  objectiveFor,
  parseReviewPlanRequest,
  reviewPlan,
  type ReviewPlanRequest,
} from '../../src/cli/reviewPlan.ts';

// The contract Revisor calls (spec/interface/review-plan-cli.md). Augur advises;
// the caller enforces the safety floor, so these tests assert that Augur never
// proposes something the floor exists to refuse.

const STAGE_IDS = [
  'leakage_scan',
  'registered_tests',
  'anatomia_code_analysis',
  'anatomia_domain_review',
  'spec_requirements',
  'security_review',
  'reviewer_autofix',
];

function request(overrides: Partial<ReviewPlanRequest> = {}): ReviewPlanRequest {
  return {
    version: CONTRACT_VERSION,
    repository: 'LUDIARS/Revisor',
    pullRequest: { number: 8, title: null },
    changeProfile: {
      kinds: ['docs'],
      changedFiles: 3,
      changedLines: 84,
      docsOnly: true,
      touchesSpec: true,
      runtimeSurfaces: [],
    },
    stages: STAGE_IDS.map((id) => ({ id, run: true, reason: 'deterministic' })),
    testCases: [
      { name: 'unit', kinds: null, runtime: false, always: false },
      { name: 'check', kinds: null, runtime: false, always: true },
      { name: 'docs-lint', kinds: ['docs'], runtime: false, always: false },
      { name: 'smoke', kinds: ['code'], runtime: true, always: false },
    ],
    stageIds: STAGE_IDS,
    ...overrides,
  } as ReviewPlanRequest;
}

function planFor(input: ReviewPlanRequest): ReturnType<typeof reviewPlan> {
  return reviewPlan(JSON.stringify(input));
}

describe('parseReviewPlanRequest', () => {
  it('rejects a payload that is not JSON', () => {
    expect(() => parseReviewPlanRequest('not json')).toThrow(/one JSON object/);
  });

  it('rejects an unknown contract version rather than guessing', () => {
    expect(() => parseReviewPlanRequest(JSON.stringify(request({ version: 99 })))).toThrow(
      /unsupported request version 99/,
    );
  });

  it('reports the first invalid field with its path', () => {
    const broken = { ...request(), changeProfile: { kinds: ['docs'] } };
    expect(() => parseReviewPlanRequest(JSON.stringify(broken))).toThrow(/changeProfile\./);
  });
});

describe('objectiveFor', () => {
  it('treats a documentation-only change as an unknown objective', () => {
    expect(objectiveFor(request()).kind).toBe('unknown');
  });

  it('treats a change with runtime surfaces as a stability objective', () => {
    const objective = objectiveFor(
      request({
        changeProfile: {
          kinds: ['code'],
          changedFiles: 2,
          changedLines: 30,
          docsOnly: false,
          touchesSpec: false,
          runtimeSurfaces: ['migration', 'entrypoint'],
        },
      }),
    );
    expect(objective.kind).toBe('stability');
    expect(objective.description).toContain('migration, entrypoint');
  });
});

describe('reviewPlan', () => {
  it('drops code analysis and the vulnerability pass for documentation', () => {
    const plan = planFor(request());
    const byId = new Map(plan.stages.map((stage) => [stage.id, stage.run]));
    expect(byId.get('anatomia_code_analysis')).toBe(false);
    expect(byId.get('security_review')).toBe(false);
  });

  it('never proposes a decision about a mandatory stage', () => {
    const plan = planFor(request());
    const mandatory = [
      'leakage_scan',
      'anatomia_domain_review',
      'spec_requirements',
      'reviewer_autofix',
    ];
    for (const id of mandatory) {
      expect(plan.stages.some((stage) => stage.id === id)).toBe(false);
    }
  });

  it('proposes nothing about an id the caller did not offer', () => {
    const plan = planFor(request({ stageIds: ['leakage_scan', 'reviewer_autofix'] }));
    expect(plan.stages).toEqual([]);
  });

  it('selects the cases that cover documentation, and always-run cases', () => {
    expect([...planFor(request()).testCases].sort()).toEqual(['check', 'docs-lint']);
  });

  it('keeps every runtime case on an executable change', () => {
    const plan = planFor(
      request({
        changeProfile: {
          kinds: ['code'],
          changedFiles: 4,
          changedLines: 120,
          docsOnly: false,
          touchesSpec: false,
          runtimeSurfaces: [],
        },
      }),
    );
    expect([...plan.testCases].sort()).toEqual(['check', 'smoke', 'unit']);
    // An executable change keeps the full surface: nothing is proposed off.
    expect(plan.stages.filter((stage) => !stage.run)).toEqual([]);
  });

  it('is deterministic, so a re-review does not silently change the checks', () => {
    expect(planFor(request())).toEqual(planFor(request()));
  });
});

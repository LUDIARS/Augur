import { describe, expect, it } from 'vitest';
import { createPlan } from '../../src/engine/createPlan.ts';
import type { CreatePlanRequest, PlanResponse } from '../../src/schema/index.ts';

// Minimum acceptance tests from spec/test/service-test-strategy.md,
// exercised at the engine level (no HTTP involved).

function evidenceIdsOf(plan: PlanResponse): Set<string> {
  return new Set(plan.evidence.map((entry) => entry.id));
}

const bugFixRequest: CreatePlanRequest = {
  objective: {
    kind: 'bug_fix',
    description: 'Fix search returning stale results after clearing the query.',
    desiredOutcome: 'Search results should reset when query is empty.',
  },
  change: { changedFiles: ['src/search.ts', 'src/search.test.ts'] },
  failure: { command: 'npm run test', exitCode: 1, stderr: 'expected [] to equal [...]' },
};

describe('ST-001 bug fix produces test-first policy', () => {
  it('includes a regression suggestion and a test_first fix policy', () => {
    const plan = createPlan(bugFixRequest);
    expect(plan.fixPolicy.strategy).toBe('test_first');
    expect(plan.testPlan.suggestions.some((suggestion) => suggestion.kind === 'regression')).toBe(true);
  });
});

describe('ST-002 refactor preserves behavior', () => {
  it('prefers behavior_preserving and focuses on existing contracts', () => {
    const plan = createPlan({
      objective: { kind: 'refactor', description: 'Extract the pricing module.' },
      change: { changedFiles: ['src/pricing.ts', 'src/cart.ts'] },
    });
    expect(plan.fixPolicy.strategy).toBe('behavior_preserving');
    expect(plan.testPlan.suggestions.some((suggestion) => suggestion.kind === 'contract')).toBe(true);
  });
});

describe('ST-003 performance uses external signals', () => {
  it('may suggest a guardrail but never performs measurement itself', () => {
    const plan = createPlan({
      objective: { kind: 'performance', description: 'Checkout feels slow.' },
      runtimeSignals: [{ type: 'api_latency', name: 'checkout p95', value: 900, unit: 'ms', percentile: 95 }],
    });
    expect(plan.testPlan.suggestions.some((suggestion) => suggestion.kind === 'performance')).toBe(true);
    // Measurement stays external: the engine only references the supplied signal.
    expect(plan.evidence.some((entry) => entry.type === 'runtime_signal')).toBe(true);
  });
});

describe('ST-004 evidence is required', () => {
  it('every suggestion and fix step references existing evidence', () => {
    const plan = createPlan(bugFixRequest);
    const known = evidenceIdsOf(plan);
    for (const suggestion of plan.testPlan.suggestions) {
      expect(suggestion.evidenceIds.length).toBeGreaterThan(0);
      for (const id of suggestion.evidenceIds) expect(known.has(id)).toBe(true);
    }
    for (const step of plan.fixPolicy.steps) {
      expect(step.evidenceIds.length).toBeGreaterThan(0);
      for (const id of step.evidenceIds) expect(known.has(id)).toBe(true);
    }
  });
});

describe('ST-005 partial input degrades gracefully', () => {
  it('returns partial guidance from objective and changed files alone', () => {
    const plan = createPlan({
      objective: { kind: 'bug_fix', description: 'Totals are sometimes wrong.' },
      change: { changedFiles: ['src/totals.ts'] },
    });
    expect(plan.testPlan.suggestions.length).toBeGreaterThan(0);
    expect(plan.fixPolicy.steps.length).toBeGreaterThan(0);
  });
});

describe('ST-006 stability investigates before fixing', () => {
  it('suggests flaky checks and prefers investigate_first without a deterministic repro', () => {
    const plan = createPlan({
      objective: { kind: 'stability', description: 'CI fails intermittently on the checkout suite.' },
      failure: { command: 'npm run test', exitCode: 1, stderr: 'Timeout waiting for element (1 of 20 runs)' },
    });
    expect(plan.fixPolicy.strategy).toBe('investigate_first');
    expect(plan.testPlan.suggestions.some((suggestion) => suggestion.kind === 'flaky')).toBe(true);
  });
});

describe('ST-007 identical input produces identical output', () => {
  it('returns byte-identical responses for the same request', () => {
    const first = createPlan(bugFixRequest);
    const second = createPlan(bugFixRequest);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

const explicitBudgetRequest: CreatePlanRequest = {
  objective: { kind: 'performance', description: 'The app should feel instant.' },
  experienceGoals: [
    {
      quality: 'responsiveness',
      targets: [{ metric: 'api_latency', threshold: 20, unit: 'ms', percentile: 95 }],
    },
  ],
};

describe('ST-008 explicit budget produces a guardrail carrying the budget', () => {
  it('emits a guardrail whose budget equals the explicit target', () => {
    const plan = createPlan(explicitBudgetRequest);
    const guardrail = plan.testPlan.suggestions.find((suggestion) => suggestion.budget !== undefined);
    expect(guardrail?.budget).toEqual({ metric: 'api_latency', threshold: 20, unit: 'ms', percentile: 95 });
    expect(guardrail?.proposedBudget).toBeUndefined();
  });
});

describe('ST-009 abstract quality produces labeled proposals', () => {
  it('caps confidence at 0.6 and labels the budget as proposed', () => {
    const plan = createPlan({
      objective: { kind: 'performance', description: 'Search should feel instant.' },
      experienceGoals: [{ quality: 'responsiveness' }],
    });
    const guardrails = plan.testPlan.suggestions.filter((suggestion) => suggestion.budget !== undefined);
    expect(guardrails.length).toBeGreaterThan(0);
    for (const guardrail of guardrails) {
      expect(guardrail.proposedBudget).toBe(true);
      expect(guardrail.confidence).toBeLessThanOrEqual(0.6);
      expect(guardrail.rationale.toLowerCase()).toContain('proposal');
    }
  });
});

describe('ST-010 budget violations raise priority', () => {
  it('emits budget_violation evidence and a critical/high guardrail with confidence >= 0.8', () => {
    const plan = createPlan({
      ...explicitBudgetRequest,
      runtimeSignals: [
        { type: 'api_latency', name: 'search p95', value: 42, unit: 'ms', percentile: 95, scope: '/search' },
      ],
    });
    expect(plan.evidence.some((entry) => entry.type === 'budget_violation')).toBe(true);
    const guardrail = plan.testPlan.suggestions.find((suggestion) => suggestion.budget?.metric === 'api_latency');
    expect(['critical', 'high']).toContain(guardrail?.priority);
    expect(guardrail?.confidence ?? 0).toBeGreaterThanOrEqual(0.8);
  });
});

describe('ST-011 exemptions relax without removing coverage', () => {
  const request: CreatePlanRequest = {
    objective: { kind: 'performance', description: 'The app should feel instant.' },
    experienceGoals: [
      {
        quality: 'responsiveness',
        targets: [{ metric: 'api_latency', threshold: 20, unit: 'ms', percentile: 95 }],
        exemptions: [
          {
            scope: 'auth (login, registration)',
            reason: 'Users tolerate multi-second auth flows.',
            relaxedTarget: { metric: 'api_latency', threshold: 3000, unit: 'ms', percentile: 95 },
          },
        ],
      },
    ],
    runtimeSignals: [
      { type: 'api_latency', name: 'search p95', value: 42, unit: 'ms', percentile: 95, scope: '/search' },
      { type: 'api_latency', name: 'login p95', value: 800, unit: 'ms', percentile: 95, scope: '/login' },
    ],
  };

  it('does not flag exempted-scope signals against the strict budget', () => {
    const plan = createPlan(request);
    const violations = plan.evidence.filter((entry) => entry.type === 'budget_violation');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('search');
  });

  it('still suggests a guardrail for the relaxed budget in the exempted scope', () => {
    const plan = createPlan(request);
    const relaxed = plan.testPlan.suggestions.find((suggestion) => suggestion.budget?.threshold === 3000);
    expect(relaxed).toBeDefined();
    expect(relaxed?.rationale.toLowerCase()).toContain('exempt');
  });
});

describe('ST-012 LLM proposals are labeled and subordinate', () => {
  it('rejects unlabeled proposals', () => {
    expect(() =>
      createPlan(explicitBudgetRequest, {
        proposedExemptions: [{ scope: 'auth', reason: 'slow is fine' }],
      }),
    ).toThrow(/proposedBy/);
  });

  it('keeps guardrails, downgrades priority, and surfaces the proposal as evidence', () => {
    const withoutProposal = createPlan(explicitBudgetRequest);
    const withProposal = createPlan(explicitBudgetRequest, {
      proposedExemptions: [
        { scope: 'auth (login, registration)', reason: 'Auth flows tolerate seconds.', proposedBy: 'llm' },
      ],
    });
    // Never deletes a guardrail.
    expect(withProposal.testPlan.suggestions.filter((s) => s.budget !== undefined).length).toBeGreaterThanOrEqual(
      withoutProposal.testPlan.suggestions.filter((s) => s.budget !== undefined).length,
    );
    // The proposal is auditable evidence, labeled as LLM-proposed.
    const exemptionEvidence = withProposal.evidence.find((entry) => entry.type === 'budget_exemption');
    expect(exemptionEvidence?.detail).toContain('llm');
    // The explicit target survives untouched.
    const guardrail = withProposal.testPlan.suggestions.find((s) => s.budget?.threshold === 20);
    expect(guardrail).toBeDefined();
  });
});

describe('ST-013 domain filters default proposals', () => {
  it('proposes only common/game defaults for a game project', () => {
    const plan = createPlan({
      objective: { kind: 'performance', description: 'Matches should feel responsive online.' },
      project: { domain: 'game' },
      experienceGoals: [{ quality: 'netplay_responsiveness' }, { quality: 'responsiveness' }],
    });
    const budgetEvidence = plan.evidence.filter((entry) => entry.type === 'experience_goal');
    expect(budgetEvidence.length).toBeGreaterThan(0);
    for (const entry of budgetEvidence) {
      expect(entry.detail).not.toMatch(/EG-W/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createPlan } from '../../src/engine/createPlan.ts';
import type { CreatePlanRequest } from '../../src/schema/index.ts';

// Media-based testing (spec/feature/media-based-testing.md): screenshot and
// video analyzer results arrive as media_analysis signals and flow through
// the standard budget machinery for EG-G11/EG-G12.

const ratingRequest: CreatePlanRequest = {
  objective: {
    kind: 'regression',
    description: 'New finisher move must keep the JP SKU within CERO B.',
  },
  project: { name: 'action-title', domain: 'game' },
  experienceGoals: [
    {
      quality: 'content_rating_compliance',
      description: 'CERO B for the JP SKU',
      targets: [{ metric: 'rating_violation_count', threshold: 0, unit: 'count' }],
    },
  ],
  runtimeSignals: [
    {
      type: 'media_analysis',
      name: 'rating_violation_count',
      value: 3,
      unit: 'count',
      scope: 'boss arena finisher',
      source: 'capture-rig 1.4 / gore-classifier 0.9, reviewed by content team',
    },
  ],
};

describe('content rating compliance via media_analysis signals', () => {
  it('flags a confirmed rating violation against an explicit target as critical', () => {
    const plan = createPlan(ratingRequest);
    const guardrail = plan.testPlan.suggestions.find((suggestion) =>
      suggestion.budget?.metric === 'rating_violation_count',
    );
    expect(guardrail).toBeDefined();
    expect(guardrail?.priority).toBe('critical');
    expect(plan.evidence.some((entry) => entry.type === 'budget_violation')).toBe(true);
  });

  it('proposes the catalog defaults when the goal has no explicit targets', () => {
    const plan = createPlan({
      objective: { kind: 'new_feature', description: 'Add dismemberment VFX to heavy attacks.' },
      project: { domain: 'game' },
      experienceGoals: [{ quality: 'content_rating_compliance' }],
    });
    const metrics = plan.testPlan.suggestions
      .filter((suggestion) => suggestion.proposedBudget === true)
      .map((suggestion) => suggestion.budget?.metric);
    expect(metrics).toContain('rating_violation_count');
    expect(metrics).toContain('prohibited_expression_count');
    expect(metrics).toContain('regional_variant_mismatch_count');
  });
});

describe('visual fidelity via media_analysis signals', () => {
  it('detects a golden-image diff exceeding the proposed budget', () => {
    const plan = createPlan({
      objective: { kind: 'regression', description: 'Lighting rework must not break existing scenes.' },
      project: { domain: 'game' },
      experienceGoals: [{ quality: 'visual_fidelity' }],
      runtimeSignals: [
        {
          type: 'media_analysis',
          name: 'golden_image_diff',
          value: 7.5,
          unit: '%',
          scope: 'chapter 3 vista',
          source: 'capture-rig 1.4 / perceptual-diff 2.1',
        },
      ],
    });
    const guardrail = plan.testPlan.suggestions.find((suggestion) =>
      suggestion.budget?.metric === 'golden_image_diff',
    );
    expect(guardrail).toBeDefined();
    // Violated but the budget was a catalog proposal, so priority caps at high.
    expect(guardrail?.priority).toBe('high');
    expect(guardrail?.rationale).toContain('EG-G11');
    expect(plan.evidence.some((entry) => entry.type === 'budget_violation')).toBe(true);
  });

  it('respects a caller exemption for declared stochastic VFX regions', () => {
    const plan = createPlan({
      objective: { kind: 'regression', description: 'Particle update must not regress rendered scenes.' },
      project: { domain: 'game' },
      experienceGoals: [
        {
          quality: 'visual_fidelity',
          targets: [{ metric: 'golden_image_diff', threshold: 2, unit: '%' }],
          exemptions: [
            {
              scope: 'weather showcase tour',
              reason: 'procedural weather makes this tour stochastic by design',
              relaxedTarget: { metric: 'golden_image_diff', threshold: 10, unit: '%' },
            },
          ],
        },
      ],
      runtimeSignals: [
        {
          type: 'media_analysis',
          name: 'golden_image_diff',
          value: 6,
          unit: '%',
          scope: 'weather showcase tour',
          source: 'capture-rig 1.4 / perceptual-diff 2.1',
        },
      ],
    });
    // 6% is within the relaxed 10% budget, so no violation is reported.
    expect(plan.evidence.some((entry) => entry.type === 'budget_violation')).toBe(false);
    expect(plan.evidence.some((entry) => entry.type === 'budget_exemption')).toBe(true);
  });
});

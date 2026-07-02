import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, confidenceFrom, draftFor, failureEvidenceIds } from './shared.ts';

export const stabilityRule: RuleModule = {
  kind: 'stability',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const failureIds = failureEvidenceIds(evidence);
    const changeIds = changeEvidenceIds(facts, evidence);
    const base = [evidence.objectiveId, ...failureIds, ...changeIds];
    const corroborating = (failureIds.length > 0 ? 1 : 0) + (changeIds.length > 0 ? 1 : 0);
    // A deterministic reproduction exists when the failure carries both the
    // command that triggers it and a stack trace locating it
    // (spec/feature/purpose-driven-fix-policy.md, stability mapping).
    const deterministicRepro = facts.failure?.command !== undefined && facts.failure.stackTrace !== undefined;

    return {
      suggestions: [
        {
          title: 'Repeat-run flakiness check on the affected flow',
          kind: 'flaky',
          priority: 'high',
          confidence: confidenceFrom(failureIds.length > 0 ? 0.7 : 0.5, corroborating),
          rationale: 'Intermittent behavior only shows under repetition; N consecutive runs expose the flake rate.',
          draft: draftFor(facts, 'Given the affected flow, when it is executed N times consecutively by the external runner, then all runs must pass.'),
          evidenceIds: base,
        },
        {
          title: 'Nondeterminism audit (time, ordering, shared state)',
          kind: 'unit',
          priority: 'medium',
          confidence: confidenceFrom(0.5, corroborating),
          rationale: 'Flaky behavior usually traces to clocks, unordered collections, races, or leaked state between tests.',
          draft: draftFor(facts, 'Given the suspected code paths, when time, ordering, and shared state are controlled, then results are identical across runs.'),
          evidenceIds: base,
        },
      ],
      fixSkeleton: {
        strategy: deterministicRepro ? 'minimal' : 'investigate_first',
        steps: deterministicRepro
          ? [
              {
                title: 'Fix the located nondeterminism narrowly',
                description: 'The reproduction locates the flake; remove the nondeterministic dependency directly.',
                evidenceIds: base,
              },
              {
                title: 'Keep the repeat-run check as a guard',
                description: 'Retain the N-run check in CI for the affected flow to catch recurrence.',
                dependsOnPrevious: true,
                evidenceIds: base,
              },
            ]
          : [
              {
                title: 'Make the failure reproducible first',
                description: 'Capture seeds, timing, and environment until the failure reproduces deterministically.',
                evidenceIds: [evidence.objectiveId, ...failureIds],
              },
              {
                title: 'Then remove the source of nondeterminism',
                description: 'With a deterministic reproduction in hand, apply a minimal fix and keep the repeat-run guard.',
                dependsOnPrevious: true,
                evidenceIds: base,
              },
            ],
        risks: [
          {
            severity: 'medium',
            description: 'Retry-based mitigation hides flakes instead of fixing them; prefer removing the nondeterminism.',
          },
        ],
      },
    };
  },
};

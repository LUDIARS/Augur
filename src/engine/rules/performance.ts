import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, confidenceFrom, draftFor, failureEvidenceIds } from './shared.ts';

// Budget-derived guardrails are produced centrally from resolved experience
// budgets (engine/experienceSuggestions.ts); this module covers the
// objective-level framing and the no-budget cases.

export const performanceRule: RuleModule = {
  kind: 'performance',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const changeIds = changeEvidenceIds(facts, evidence);
    const failureIds = failureEvidenceIds(evidence);
    const base = [evidence.objectiveId, ...changeIds];
    const hasBudgets = facts.budgets.length > 0;
    const hasSignals = facts.runtime.length > 0;
    const bottleneckKnown = facts.failure?.stackTrace !== undefined;

    const suggestions: RuleOutput['suggestions'] = [];
    if (!hasBudgets) {
      if (hasSignals) {
        const signal = facts.runtime[0];
        const signalId = signal !== undefined ? evidence.runtimeIds.get(signal) : undefined;
        suggestions.push({
          title: 'Pin the current measurement as an external guardrail',
          kind: 'performance',
          priority: 'high',
          confidence: confidenceFrom(0.65, 1),
          rationale:
            'Runtime measurements were supplied without an explicit budget; pinning them stops silent regressions while the target is negotiated.',
          draft: draftFor(
            facts,
            'Given the supplied measurement as a provisional baseline, when the metric is measured externally in CI, then it must not regress beyond the agreed tolerance.',
          ),
          evidenceIds: [evidence.objectiveId, ...(signalId !== undefined ? [signalId] : [])],
        });
      } else {
        suggestions.push({
          title: 'Establish an external measurement before optimizing',
          kind: 'performance',
          priority: 'high',
          confidence: confidenceFrom(0.4, 0),
          rationale: 'No budget or measurement was supplied; optimization without a measurement cannot be verified.',
          draft: draftFor(facts, 'Given the flow described in the objective, when an external runner measures it under a fixed profile, then a baseline exists to set a budget against.'),
          evidenceIds: [evidence.objectiveId],
        });
      }
    }

    return {
      suggestions,
      fixSkeleton: {
        strategy: bottleneckKnown ? 'minimal' : 'investigate_first',
        steps: bottleneckKnown
          ? [
              {
                title: 'Fix the identified bottleneck narrowly',
                description: 'A trace locates the bottleneck; apply the smallest change that moves the measurement.',
                evidenceIds: [evidence.objectiveId, ...failureIds],
              },
              {
                title: 'Verify externally against the budget',
                description: 'Re-run the external measurement and compare against the budget before and after.',
                dependsOnPrevious: true,
                evidenceIds: base,
              },
            ]
          : [
              {
                title: 'Profile before changing code',
                description: 'Measure and locate the bottleneck first; optimization guesses usually miss.',
                evidenceIds: [evidence.objectiveId],
              },
              {
                title: 'Optimize the located hotspot, guarded by the measurement',
                description: 'Apply the smallest effective change and keep the external guardrail as the arbiter.',
                dependsOnPrevious: true,
                evidenceIds: base,
              },
            ],
        risks: [
          {
            severity: 'medium',
            description: 'Optimizations often trade readability or memory for speed; the measurement must justify the trade.',
          },
        ],
        rollback: 'Revert the optimization if the external measurement shows no improvement or a regression elsewhere.',
      },
    };
  },
};

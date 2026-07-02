import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, confidenceFrom, draftFor, failureEvidenceIds } from './shared.ts';

export const unknownRule: RuleModule = {
  kind: 'unknown',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const failureIds = failureEvidenceIds(evidence);
    const changeIds = changeEvidenceIds(facts, evidence);
    const base = [evidence.objectiveId, ...failureIds, ...changeIds];
    const corroborating = (failureIds.length > 0 ? 1 : 0) + (changeIds.length > 0 ? 1 : 0);

    return {
      suggestions: [
        {
          title: 'Characterize current behavior around the available evidence',
          kind: failureIds.length > 0 ? 'regression' : 'unit',
          priority: 'medium',
          confidence: confidenceFrom(0.4, corroborating),
          rationale:
            'The objective kind is unknown; tests that pin what the evidence shows create a safe base for whatever comes next.',
          draft: draftFor(facts, 'Given the flows touched by the supplied signals, when they run, then current behavior is recorded as the baseline.'),
          evidenceIds: base,
        },
      ],
      fixSkeleton: {
        strategy: 'investigate_first',
        steps: [
          {
            title: 'Clarify the objective',
            description: 'Determine whether this is a bug, feature, refactor, or performance concern; the plan differs for each.',
            evidenceIds: [evidence.objectiveId],
          },
          {
            title: 'Gather the missing signal',
            description: 'Collect the diff, failure log, or measurement that the clarified objective needs.',
            dependsOnPrevious: true,
            evidenceIds: base,
          },
        ],
        risks: [
          {
            severity: 'low',
            description: 'Acting before the objective is clear risks solving the wrong problem; prefer reversible steps.',
          },
        ],
      },
    };
  },
};

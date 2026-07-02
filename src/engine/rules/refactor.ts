import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, codeFiles, confidenceFrom, draftFor } from './shared.ts';

export const refactorRule: RuleModule = {
  kind: 'refactor',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const changeIds = changeEvidenceIds(facts, evidence);
    const base = [evidence.objectiveId, ...changeIds];
    const corroborating = changeIds.length > 0 ? 1 : 0;
    const targets = codeFiles(facts);

    return {
      suggestions: [
        {
          title: 'Behavior-preserving characterization tests',
          kind: 'unit',
          priority: 'high',
          confidence: confidenceFrom(changeIds.length > 0 ? 0.7 : 0.5, corroborating),
          ...(targets.length > 0 ? { targetFiles: targets } : {}),
          rationale: 'A refactor must not change behavior; characterization tests pin the current behavior before code moves.',
          draft: draftFor(facts, 'Given the current observable behavior of the refactored area, when the refactored code runs, then outputs match the pre-refactor baseline exactly.'),
          evidenceIds: base,
        },
        {
          title: 'Existing contract checks stay green',
          kind: 'contract',
          priority: 'high',
          confidence: confidenceFrom(0.6, corroborating),
          rationale: 'Consumers of the refactored surface must see no difference.',
          draft: draftFor(facts, 'Given the public surface of the refactored modules, when existing contract tests run, then all pass unchanged.'),
          evidenceIds: base,
        },
      ],
      fixSkeleton: {
        strategy: 'behavior_preserving',
        steps: [
          {
            title: 'Pin current behavior',
            description: 'Add or verify characterization tests over the code to be moved before changing structure.',
            ...(targets.length > 0 ? { targetFiles: targets } : {}),
            evidenceIds: base,
          },
          {
            title: 'Refactor in reviewable steps',
            description: 'Restructure in small, individually green steps; never combine behavior changes with structure changes.',
            dependsOnPrevious: true,
            evidenceIds: base,
          },
        ],
        risks: [
          {
            severity: 'medium',
            description: 'Uncovered behavior in the refactored area can change silently; coverage gaps are the main refactor risk.',
          },
        ],
        rollback: 'Each refactor step is independently revertible; revert the latest step on any behavioral difference.',
      },
    };
  },
};

import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, codeFiles, confidenceFrom, draftFor, failureEvidenceIds, testFiles } from './shared.ts';

export const regressionRule: RuleModule = {
  kind: 'regression',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const failureIds = failureEvidenceIds(evidence);
    const changeIds = changeEvidenceIds(facts, evidence);
    const base = [evidence.objectiveId, ...failureIds, ...changeIds];
    const corroborating = (failureIds.length > 0 ? 1 : 0) + (changeIds.length > 0 ? 1 : 0);
    const targets = testFiles(facts);
    const smallBlastRadius = facts.changedFiles.length > 0 && facts.changedFiles.length <= 3;

    return {
      suggestions: [
        {
          title: 'Narrow test around the failing behavior',
          kind: 'regression',
          priority: 'critical',
          confidence: confidenceFrom(failureIds.length > 0 ? 0.8 : 0.55, corroborating),
          ...(targets.length > 0 ? { targetFiles: targets } : {}),
          rationale: 'Something that used to work broke; the first test should pin the exact failing behavior.',
          draft: draftFor(facts, 'Given the previously working scenario, when it runs against the current build, then the prior behavior must hold.'),
          evidenceIds: base,
        },
        {
          title: 'Boundary checks around the regressed area',
          kind: 'unit',
          priority: 'medium',
          confidence: confidenceFrom(0.5, corroborating),
          ...(codeFiles(facts).length > 0 ? { targetFiles: codeFiles(facts) } : {}),
          rationale: 'Regressions cluster; nearby boundaries of the same code path deserve checks.',
          draft: draftFor(facts, 'Given inputs adjacent to the regressed scenario, when they run, then behavior matches the pre-regression baseline.'),
          evidenceIds: base,
        },
      ],
      fixSkeleton: {
        strategy: smallBlastRadius ? 'minimal' : 'test_first',
        steps: [
          {
            title: 'Bisect to the causing change',
            description: 'Use the changed files and failure signal to locate which change introduced the regression.',
            ...(codeFiles(facts).length > 0 ? { targetFiles: codeFiles(facts) } : {}),
            evidenceIds: base,
          },
          {
            title: smallBlastRadius ? 'Apply a minimal correction' : 'Lock the behavior with tests, then correct',
            description: smallBlastRadius
              ? 'The blast radius is small; correct the causing change directly and keep the pinning test.'
              : 'The change surface is wide; add pinning tests around the regressed behavior before correcting.',
            dependsOnPrevious: true,
            evidenceIds: base,
          },
        ],
        risks: [
          {
            severity: 'medium',
            description: 'Reverting or correcting the causing change may undo an intended improvement shipped with it.',
          },
        ],
        rollback: 'If the correction is risky, revert the causing change entirely and reland it with the pinning test.',
      },
    };
  },
};

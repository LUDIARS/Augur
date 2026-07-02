import type { NormalizedFacts, EvidenceRefs, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, codeFiles, confidenceFrom, draftFor, failureEvidenceIds, testFiles } from './shared.ts';

export const bugFixRule: RuleModule = {
  kind: 'bug_fix',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const hasRepro = facts.failure !== null;
    const failureIds = failureEvidenceIds(evidence);
    const changeIds = changeEvidenceIds(facts, evidence);
    const suggestionEvidence = [evidence.objectiveId, ...failureIds, ...changeIds];
    const targets = testFiles(facts);
    const corroborating = (failureIds.length > 0 ? 1 : 0) + (changeIds.length > 0 ? 1 : 0);

    const output: RuleOutput = {
      suggestions: [
        {
          title: `Regression test reproducing: ${facts.objective.description}`,
          kind: 'regression',
          priority: 'high',
          confidence: confidenceFrom(hasRepro ? 0.8 : 0.55, corroborating),
          ...(targets.length > 0 ? { targetFiles: targets } : {}),
          rationale: hasRepro
            ? 'A failure signal was supplied; a regression test that reproduces it locks the bug out.'
            : 'No failure signal was supplied; a regression test should be written from the described behavior.',
          draft: draftFor(
            facts,
            `Given the conditions described in the objective, when the buggy path runs, then the expected behavior${
              facts.objective.desiredOutcome !== undefined ? ` (${facts.objective.desiredOutcome})` : ''
            } must hold.`,
          ),
          evidenceIds: suggestionEvidence,
        },
      ],
      fixSkeleton: {
        strategy: hasRepro ? 'test_first' : 'investigate_first',
        steps: hasRepro
          ? [
              {
                title: 'Add failing regression coverage',
                description: 'Add a test that reproduces the reported failure before touching the implementation.',
                ...(targets.length > 0 ? { targetFiles: targets } : {}),
                evidenceIds: [evidence.objectiveId, ...failureIds],
              },
              {
                title: 'Apply the narrowest fix that passes the new test',
                description: 'Change only what the regression test demands; avoid opportunistic refactoring.',
                ...(codeFiles(facts).length > 0 ? { targetFiles: codeFiles(facts) } : {}),
                dependsOnPrevious: true,
                evidenceIds: suggestionEvidence,
              },
            ]
          : [
              {
                title: 'Reproduce the bug first',
                description: 'Capture a failing command, log, or trace so the fix has evidence to aim at.',
                evidenceIds: [evidence.objectiveId],
              },
              {
                title: 'Convert the reproduction into a regression test, then fix narrowly',
                description: 'Once reproduced, lock it in as a test and apply the smallest change that passes.',
                dependsOnPrevious: true,
                evidenceIds: [evidence.objectiveId, ...changeIds],
              },
            ],
        risks: [
          {
            severity: 'medium',
            description: 'A narrow fix may mask a broader defect class; check neighboring code paths for the same pattern.',
          },
        ],
        rollback: 'Revert the fix commit; keep the regression test as documentation of the expected behavior.',
      },
    };
    return output;
  },
};

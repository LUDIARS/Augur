import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, codeFiles, confidenceFrom, draftFor, testFiles } from './shared.ts';

export const newFeatureRule: RuleModule = {
  kind: 'new_feature',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const changeIds = changeEvidenceIds(facts, evidence);
    const base = [evidence.objectiveId, ...changeIds];
    const behaviorClear = facts.objective.desiredOutcome !== undefined;
    const corroborating = changeIds.length > 0 ? 1 : 0;
    const targets = testFiles(facts);
    const outcome = facts.objective.desiredOutcome;

    return {
      suggestions: [
        {
          title: `Happy path: ${facts.objective.description}`,
          kind: 'unit',
          priority: 'high',
          confidence: confidenceFrom(behaviorClear ? 0.7 : 0.5, corroborating),
          ...(targets.length > 0 ? { targetFiles: targets } : {}),
          rationale: 'A new feature needs its primary flow verified before anything else.',
          draft: draftFor(
            facts,
            `Given valid inputs, when the feature runs, then it produces the intended outcome${outcome !== undefined ? ` (${outcome})` : ''}.`,
          ),
          evidenceIds: base,
        },
        {
          title: 'Edge cases and invalid inputs',
          kind: 'unit',
          priority: 'medium',
          confidence: confidenceFrom(behaviorClear ? 0.6 : 0.45, corroborating),
          ...(targets.length > 0 ? { targetFiles: targets } : {}),
          rationale: 'Boundary and invalid-input behavior is where new features usually break.',
          draft: draftFor(facts, 'Given boundary and invalid inputs, when the feature runs, then it fails safely with the documented behavior.'),
          evidenceIds: base,
        },
        {
          title: 'Contract with consumers of the new surface',
          kind: 'contract',
          priority: 'medium',
          confidence: confidenceFrom(0.5, corroborating),
          rationale: 'Whatever the feature exposes (API, events, props) should be pinned as a contract.',
          draft: draftFor(facts, 'Given the exposed surface of the feature, when consumers use it as documented, then the shape and semantics hold.'),
          evidenceIds: base,
        },
      ],
      fixSkeleton: {
        strategy: behaviorClear ? 'test_first' : 'investigate_first',
        steps: behaviorClear
          ? [
              {
                title: 'Write the happy-path test first',
                description: 'Encode the desired outcome as a failing test, then implement until it passes.',
                evidenceIds: base,
              },
              {
                title: 'Implement the feature minimally',
                description: 'Build the smallest implementation that satisfies the tests, then extend edge-case coverage.',
                ...(codeFiles(facts).length > 0 ? { targetFiles: codeFiles(facts) } : {}),
                dependsOnPrevious: true,
                evidenceIds: base,
              },
            ]
          : [
              {
                title: 'Clarify the expected behavior',
                description: 'The objective lacks a desired outcome; pin down observable behavior before writing code.',
                evidenceIds: [evidence.objectiveId],
              },
              {
                title: 'Then proceed test-first',
                description: 'Once behavior is agreed, encode it as tests and implement against them.',
                dependsOnPrevious: true,
                evidenceIds: base,
              },
            ],
        risks: [
          {
            severity: 'low',
            description: 'New surfaces tend to grow; keeping the initial contract small reduces later breaking changes.',
          },
        ],
      },
    };
  },
};

import type { Priority } from '../schema/index.ts';
import { draftFor } from './rules/shared.ts';
import type { CandidateSuggestion, EvidenceRefs, NormalizedFacts } from './types.ts';

// Stage 5: rank candidates and apply the confidence floor
// (spec/feature/planning-engine.md, "Scoring Rules").

const CONFIDENCE_FLOOR = 0.2;
const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function scoreAndRank(
  candidates: CandidateSuggestion[],
  facts: NormalizedFacts,
  evidence: EvidenceRefs,
): CandidateSuggestion[] {
  const surviving = candidates.filter((candidate) => candidate.confidence >= CONFIDENCE_FLOOR);

  if (surviving.length === 0) {
    // Never return an empty plan: emit investigation-first guidance instead.
    surviving.push({
      title: 'Investigate before testing: evidence is too weak to plan against',
      kind: 'unit',
      priority: 'medium',
      confidence: 0.3,
      rationale: 'No candidate cleared the confidence floor; gather a diff, failure log, or measurement first.',
      draft: draftFor(facts, 'Given the objective, when the missing signals are collected, then a concrete test plan can be derived from them.'),
      evidenceIds: [evidence.objectiveId],
    });
  }

  // Stable ordering: priority band, then confidence descending, then
  // insertion order as the tiebreak (spec/implementation-design.md).
  return surviving
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.candidate.priority] - PRIORITY_RANK[b.candidate.priority];
      if (byPriority !== 0) return byPriority;
      const byConfidence = b.candidate.confidence - a.candidate.confidence;
      if (byConfidence !== 0) return byConfidence;
      return a.index - b.index;
    })
    .map(({ candidate }) => candidate);
}

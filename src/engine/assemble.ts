import type { FixPolicy, FixStrategy, PlanResponse, TestSuggestion } from '../schema/index.ts';
import type { CandidateSuggestion, EvidenceRefs, FixPolicySkeleton, NormalizedFacts } from './types.ts';

// Stage 6: assign stable ids, link evidence, generate the summary.

const STRATEGY_PHRASE: Record<FixStrategy, string> = {
  minimal: 'apply a minimal, narrowly scoped fix',
  behavior_preserving: 'refactor in behavior-preserving steps',
  contract_first: 'define and enforce the contract first',
  test_first: 'write the failing test first, then fix',
  investigate_first: 'investigate before changing code',
};

function pad(counter: number): string {
  return String(counter).padStart(3, '0');
}

export function assemble(
  facts: NormalizedFacts,
  evidence: EvidenceRefs,
  candidates: CandidateSuggestion[],
  skeleton: FixPolicySkeleton,
): PlanResponse {
  const suggestions: TestSuggestion[] = candidates.map((candidate, index) => ({
    id: `test-${pad(index + 1)}`,
    title: candidate.title,
    kind: candidate.kind,
    priority: candidate.priority,
    confidence: candidate.confidence,
    ...(candidate.targetFiles !== undefined ? { targetFiles: candidate.targetFiles } : {}),
    rationale: candidate.rationale,
    draft: candidate.draft,
    ...(candidate.budget !== undefined ? { budget: candidate.budget } : {}),
    ...(candidate.proposedBudget !== undefined ? { proposedBudget: candidate.proposedBudget } : {}),
    evidenceIds: candidate.evidenceIds,
  }));

  const steps = skeleton.steps.map((step, index) => {
    const id = `fix-${pad(index + 1)}`;
    return {
      id,
      title: step.title,
      description: step.description,
      ...(step.targetFiles !== undefined ? { targetFiles: step.targetFiles } : {}),
      ...(step.dependsOnPrevious === true && index > 0 ? { dependsOn: [`fix-${pad(index)}`] } : {}),
      evidenceIds: step.evidenceIds.length > 0 ? step.evidenceIds : [evidence.objectiveId],
    };
  });

  const allRisks = [...skeleton.risks];
  for (const conflict of facts.exemptionConflicts) {
    allRisks.push({
      severity: 'medium',
      description: `The exemption for scope "${conflict.exemption.scope}" overlaps a caller-explicit budget (${conflict.target.metric} <= ${conflict.target.threshold}${conflict.target.unit}); explicit intent wins and the exemption was not applied to it.`,
    });
  }
  for (const description of facts.conflictingSignals) {
    allRisks.push({ severity: 'medium', description });
  }
  const weakEvidence = suggestions.length > 0 && suggestions.every((suggestion) => suggestion.confidence <= 0.5);
  if (weakEvidence) {
    allRisks.push({
      severity: 'low',
      description: 'Evidence is weak across the whole plan; prefer reversible steps until stronger signals exist.',
    });
  }

  const fixPolicy: FixPolicy = {
    strategy: skeleton.strategy,
    steps,
    risks: allRisks.map((risk, index) => ({
      id: `risk-${pad(index + 1)}`,
      severity: risk.severity,
      description: risk.description,
    })),
    ...(skeleton.rollback !== undefined ? { rollback: skeleton.rollback } : {}),
  };

  const lead = suggestions[0];
  const summary =
    lead !== undefined
      ? `Lead with "${lead.title}" (${lead.priority}), then ${STRATEGY_PHRASE[skeleton.strategy]}. ${suggestions.length} test suggestion${suggestions.length === 1 ? '' : 's'}, ${steps.length} fix step${steps.length === 1 ? '' : 's'}.`
      : `No test suggestions could be derived; ${STRATEGY_PHRASE[skeleton.strategy]}.`;

  return {
    summary,
    testPlan: { suggestions },
    fixPolicy,
    evidence: evidence.list,
  };
}

import { allEntries } from '../catalog/index.ts';
import type { Priority } from '../schema/index.ts';
import { draftFor } from './rules/shared.ts';
import type { CandidateSuggestion, EvidenceRefs, NormalizedFacts, ResolvedBudget } from './types.ts';

// Guardrail suggestions derived from resolved experience budgets, per
// spec/feature/experience-driven-constraints.md Behavior 6-7. These apply
// for any objective kind, not only `performance`.

const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

function downgrade(priority: Priority): Priority {
  const index = PRIORITY_ORDER.indexOf(priority);
  return PRIORITY_ORDER[Math.min(index + 1, PRIORITY_ORDER.length - 1)] as Priority;
}

function describeTarget(budget: ResolvedBudget): string {
  const { target } = budget;
  const percentile = target.percentile !== undefined ? ` p${target.percentile}` : '';
  const scope = target.scope !== undefined ? ` on ${target.scope}` : '';
  return `${target.metric}${percentile} <= ${target.threshold}${target.unit}${scope}`;
}

function catalogPatternFor(budget: ResolvedBudget) {
  if (budget.catalogRef === undefined) return undefined;
  const entry = allEntries.find((candidate) => candidate.id === budget.catalogRef?.entryId);
  if (entry === undefined) return undefined;
  const pattern = entry.patterns.find((candidate) => candidate.verifiesKeyResults.includes(budget.catalogRef?.keyResultId ?? ''));
  return pattern !== undefined ? { entry, pattern } : undefined;
}

export function experienceGuardrails(facts: NormalizedFacts, evidence: EvidenceRefs): CandidateSuggestion[] {
  const suggestions: CandidateSuggestion[] = [];

  for (const budget of facts.budgets) {
    const budgetId = evidence.budgetIds.get(budget);
    const violationIds = budget.violations
      .map((signal) => evidence.violationIds.get(signal))
      .filter((id): id is string => id !== undefined);
    const exemptionId = budget.exemption !== undefined ? evidence.exemptionIds.get(budget.exemption) : undefined;
    const proposalId =
      budget.downgradedByProposal !== undefined ? evidence.exemptionIds.get(budget.downgradedByProposal) : undefined;
    const evidenceIds = [
      ...(budgetId !== undefined ? [budgetId] : []),
      ...violationIds,
      ...(exemptionId !== undefined ? [exemptionId] : []),
      ...(proposalId !== undefined ? [proposalId] : []),
    ];

    const violated = budget.violations.length > 0;
    const catalog = catalogPatternFor(budget);

    let priority: Priority;
    let confidence: number;
    if (violated && !budget.proposed) {
      priority = 'critical';
      confidence = 0.85;
    } else if (violated && budget.proposed) {
      // Proposed budgets stay capped even when violated: the number itself
      // was Augur's guess (ST-009 vs ST-010 in the test strategy).
      priority = 'high';
      confidence = 0.6;
    } else if (!budget.proposed) {
      priority = budget.relaxed ? 'medium' : 'high';
      confidence = 0.7;
    } else {
      priority = budget.relaxed ? 'low' : 'medium';
      confidence = 0.55;
    }
    if (budget.downgradedByProposal !== undefined) {
      priority = downgrade(priority);
    }

    const rationaleParts: string[] = [];
    if (catalog !== undefined && budget.catalogRef !== undefined) {
      rationaleParts.push(
        `${catalog.entry.id} --realized-by--> ${budget.catalogRef.keyResultId} --verified-by--> ${catalog.pattern.id}.`,
      );
    }
    if (violated) {
      rationaleParts.push('A supplied measurement already exceeds this budget.');
    } else if (!budget.proposed) {
      rationaleParts.push('The caller set this budget explicitly; establish the external measurement first, then enforce it.');
    }
    if (budget.proposed) {
      rationaleParts.push('This budget is a proposal from the experience goal catalog, not a caller decision; confirm or replace the number.');
    }
    if (budget.relaxed && budget.exemption !== undefined) {
      rationaleParts.push(`Scope "${budget.exemption.scope}" is exempted with a relaxed budget: ${budget.exemption.reason}`);
    }
    if (budget.downgradedByProposal !== undefined) {
      rationaleParts.push(
        `An LLM-proposed exemption suggests relaxing scope "${budget.downgradedByProposal.scope}" (${budget.downgradedByProposal.reason}); the guardrail is kept at reduced priority pending caller confirmation.`,
      );
    }

    const title =
      catalog !== undefined
        ? `${catalog.pattern.title}: ${describeTarget(budget)}`
        : `Performance guardrail: ${describeTarget(budget)}`;
    const draftText =
      catalog !== undefined
        ? catalog.pattern.draft
        : `Given the flow in scope, when ${budget.target.metric} is measured externally, then it must stay within ${budget.target.threshold}${budget.target.unit}.`;

    suggestions.push({
      title,
      kind: catalog !== undefined ? catalog.pattern.kind : 'performance',
      priority,
      confidence,
      rationale: rationaleParts.join(' '),
      draft: draftFor(facts, draftText),
      budget: budget.target,
      ...(budget.proposed ? { proposedBudget: true } : {}),
      evidenceIds: evidenceIds.length > 0 ? evidenceIds : [evidence.objectiveId],
    });
  }

  return suggestions;
}

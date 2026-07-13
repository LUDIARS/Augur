import type { FocusedTestingRisk, Priority, TestKind } from '../schema/index.ts';
import { draftFor } from './rules/shared.ts';
import type { CandidateSuggestion, EvidenceRefs, NormalizedFacts } from './types.ts';

interface RiskPlan {
  title: string;
  kind: TestKind;
  assertion: string;
}

const RISK_PLANS: Record<FocusedTestingRisk, RiskPlan> = {
  boundary: {
    title: 'Boundary values and invalid inputs',
    kind: 'unit',
    assertion: 'Exercise empty, minimum, maximum, just-outside, malformed, and repeated values without corrupting state.',
  },
  memory_safety: {
    title: 'Memory ownership and lifetime protection',
    kind: 'security',
    assertion: 'Exercise allocation, release, bounds, replacement, and early-return paths with no leak, overrun, or use-after-release.',
  },
  authorization: {
    title: 'Authority and trust-boundary enforcement',
    kind: 'security',
    assertion: 'Submit unauthorized, forged, stale, and malformed actions and assert rejection before any state change.',
  },
  state_transition: {
    title: 'State-transition invariants',
    kind: 'regression',
    assertion: 'Cover every valid transition and reject invalid ordering while preserving the domain invariants.',
  },
  concurrency: {
    title: 'Concurrent ordering and race exposure',
    kind: 'flaky',
    assertion: 'Repeat competing operations under controlled order permutations and assert deterministic, race-free outcomes.',
  },
  contract: {
    title: 'Focused contract compatibility',
    kind: 'contract',
    assertion: 'Lock the public preconditions, postconditions, errors, and compatibility behavior for the focused domain.',
  },
};

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function highestPriority(domainPriority: Priority, variablePriorities: Priority[]): Priority {
  return variablePriorities.reduce(
    (highest, priority) => PRIORITY_RANK[priority] < PRIORITY_RANK[highest] ? priority : highest,
    domainPriority,
  );
}

export function focusedTestingSuggestions(
  facts: NormalizedFacts,
  evidence: EvidenceRefs,
): CandidateSuggestion[] {
  const suggestions: CandidateSuggestion[] = [];
  for (const domain of facts.focusedDomains) {
    const evidenceId = evidence.focusedDomainIds.get(domain);
    if (evidenceId === undefined) {
      throw new Error(`missing focused-test evidence for domain "${domain.domain}"`);
    }
    const variables = domain.targets.flatMap((target) => target.variables);
    const priority = highestPriority(domain.priority, variables.map((variable) => variable.priority));
    const files = [...new Set(domain.targets.map((target) => target.file))].sort();
    const symbols = domain.targets.map((target) => target.symbol);
    const variableNames = [...new Set(variables.map((variable) => variable.name))].sort();
    const rationale = domain.rationale !== undefined
      ? `Caller focus: ${domain.rationale}`
      : `Caller marked the Anatomia domain "${domain.domain}" as ${domain.priority} priority.`;
    for (const risk of domain.risks) {
      const plan = RISK_PLANS[risk];
      const riskOrigin = domain.inferredRisks?.includes(risk) === true
        ? 'Anatomia inferred this risk mechanically from the analyzed code.'
        : 'The caller requested this risk explicitly.';
      const outline = [
        `Drive analyzed symbols: ${symbols.join(', ')}`,
        plan.assertion,
      ];
      if (variableNames.length > 0) {
        outline.push(`Include focused variables in the test matrix: ${variableNames.join(', ')}`);
      }
      suggestions.push({
        title: `${domain.domain}: ${plan.title}`,
        kind: plan.kind,
        priority,
        confidence: variableNames.length > 0 ? 0.95 : 0.85,
        targetFiles: files,
        rationale: `${rationale} Anatomia resolved ${domain.targets.length} concrete target(s). ${riskOrigin}`,
        draft: draftFor(
          facts,
          `Given the analyzed ${domain.domain} targets, when ${risk.replace(/_/g, ' ')} cases are exercised, then the focused behavior remains safe and deterministic.`,
          outline,
        ),
        evidenceIds: [evidenceId],
      });
    }
  }
  return suggestions;
}

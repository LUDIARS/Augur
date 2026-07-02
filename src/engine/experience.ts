import { domainAllowsProposals, entryForQuality } from '../catalog/index.ts';
import type {
  ExperienceExemption,
  ExperienceGoal,
  ExperienceTarget,
  ProjectDomain,
  RuntimeSignal,
} from '../schema/index.ts';
import type { ExemptionConflict, ResolvedBudget } from './types.ts';

// Budget resolution per spec/feature/experience-driven-constraints.md:
// explicit targets pass through; missing targets are filled from catalog
// defaults and flagged as proposed; exemptions waive or relax per scope.

export type ExperienceResolution = {
  budgets: ResolvedBudget[];
  appliedExemptions: ExperienceExemption[];
  conflicts: ExemptionConflict[];
  unquantifiedCustomGoals: number;
};

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

// Scope strings are freeform ("auth (login, registration)", "/login").
// Heuristic: one scope governs another when either contains the other,
// or when any parenthesized/comma-separated token of the exemption scope
// appears in the other scope.
export function scopeMatches(exemptionScope: string, other: string): boolean {
  const a = normalizeScope(exemptionScope);
  const b = normalizeScope(other);
  if (a.length === 0 || b.length === 0) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const tokens = a
    .split(/[(),/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
  return tokens.some((token) => b.includes(token));
}

function unitMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function metricMatches(signal: RuntimeSignal, target: ExperienceTarget): boolean {
  const metric = target.metric.trim().toLowerCase();
  if (signal.type !== 'custom' && signal.type.toLowerCase() === metric) return true;
  return signal.name.trim().toLowerCase().includes(metric);
}

function percentileMatches(signal: RuntimeSignal, target: ExperienceTarget): boolean {
  if (signal.percentile === undefined || target.percentile === undefined) return true;
  return signal.percentile === target.percentile;
}

// Budget comparison requires matching metric, unit, and (when both sides
// declare one) percentile and scope. No silent unit conversion.
function signalMatchesBudget(signal: RuntimeSignal, budget: ResolvedBudget): boolean {
  if (!metricMatches(signal, budget.target)) return false;
  if (!unitMatches(signal.unit, budget.target.unit)) return false;
  if (!percentileMatches(signal, budget.target)) return false;
  if (budget.target.scope !== undefined && signal.scope !== undefined) {
    return scopeMatches(budget.target.scope, signal.scope);
  }
  return true;
}

type PendingTarget = {
  target: ExperienceTarget;
  proposed: boolean;
  catalogRef?: ResolvedBudget['catalogRef'];
};

function pendingTargetsFor(
  goal: ExperienceGoal,
  domain: ProjectDomain | undefined,
): { targets: PendingTarget[]; unquantifiedCustom: boolean } {
  if (goal.targets !== undefined && goal.targets.length > 0) {
    return { targets: goal.targets.map((target) => ({ target, proposed: false })), unquantifiedCustom: false };
  }
  if (goal.quality === 'custom') {
    // A custom quality without explicit targets yields investigation-first
    // guidance, never a fabricated budget.
    return { targets: [], unquantifiedCustom: true };
  }
  const entry = entryForQuality(goal.quality);
  if (entry === undefined) return { targets: [], unquantifiedCustom: false };
  // The caller referenced this quality explicitly, so defaults resolve even
  // when the entry's domain does not match the project domain. Domain
  // filtering (domainAllowsProposals) governs only engine-initiated
  // proposals, none of which exist in the MVP; the check documents intent.
  void domainAllowsProposals(entry, domain);
  return {
    targets: entry.keyResults.map((keyResult) => ({
      target: keyResult.target,
      proposed: true,
      catalogRef: { entryId: entry.id, keyResultId: keyResult.id },
    })),
    unquantifiedCustom: false,
  };
}

export function resolveExperience(
  goals: ExperienceGoal[],
  domain: ProjectDomain | undefined,
  runtimeSignals: RuntimeSignal[],
  proposedExemptions: ExperienceExemption[],
): ExperienceResolution {
  // Proposal labeling is forced by construction: unlabeled proposals are a
  // caller bug, not something to guess about (spec/implementation-design.md).
  for (const proposal of proposedExemptions) {
    if (proposal.proposedBy !== 'llm') {
      throw new Error('proposedExemptions must be labeled proposedBy: "llm"');
    }
  }

  const budgets: ResolvedBudget[] = [];
  const conflicts: ExemptionConflict[] = [];
  const appliedExemptions: ExperienceExemption[] = [];
  let unquantifiedCustomGoals = 0;

  const markApplied = (exemption: ExperienceExemption): void => {
    if (!appliedExemptions.includes(exemption)) appliedExemptions.push(exemption);
  };

  for (const goal of goals) {
    const callerExemptions = (goal.exemptions ?? []).map((exemption) => ({
      ...exemption,
      proposedBy: exemption.proposedBy ?? ('caller' as const),
    }));
    const exemptions = [...callerExemptions, ...proposedExemptions];

    const { targets, unquantifiedCustom } = pendingTargetsFor(goal, domain);
    if (unquantifiedCustom) unquantifiedCustomGoals += 1;

    for (const { target, proposed, catalogRef } of targets) {
      const base = { quality: goal.quality, proposed, ...(catalogRef !== undefined ? { catalogRef } : {}) };

      if (target.scope !== undefined) {
        const governing = exemptions.find((exemption) => scopeMatches(exemption.scope, target.scope as string));
        if (governing === undefined) {
          budgets.push({ ...base, target, relaxed: false, violations: [] });
        } else if (!proposed) {
          // Exempting a scope never deletes the caller's explicit target for
          // that same scope; the conflict surfaces as a Risk instead.
          conflicts.push({ exemption: governing, target });
          budgets.push({ ...base, target, relaxed: false, violations: [] });
        } else if (governing.proposedBy === 'llm') {
          // An LLM proposal only downgrades; the guardrail survives.
          markApplied(governing);
          budgets.push({ ...base, target, relaxed: false, downgradedByProposal: governing, violations: [] });
        } else if (governing.relaxedTarget !== undefined) {
          markApplied(governing);
          budgets.push({
            ...base,
            target: { ...governing.relaxedTarget, scope: governing.relaxedTarget.scope ?? governing.scope },
            relaxed: true,
            exemption: governing,
            violations: [],
          });
        } else {
          markApplied(governing); // fully waived for this scope
        }
        continue;
      }

      // A scope-less target applies everywhere minus exempted scopes; each
      // caller exemption with a relaxedTarget keeps coverage at its own bar.
      // LLM proposals attach as downgrades instead of narrowing coverage.
      const llmProposal = exemptions.find((exemption) => exemption.proposedBy === 'llm');
      budgets.push({
        ...base,
        target,
        relaxed: false,
        violations: [],
        ...(llmProposal !== undefined ? { downgradedByProposal: llmProposal } : {}),
      });
      for (const exemption of exemptions) {
        markApplied(exemption);
        if (exemption.proposedBy !== 'llm' && exemption.relaxedTarget !== undefined) {
          budgets.push({
            ...base,
            target: { ...exemption.relaxedTarget, scope: exemption.relaxedTarget.scope ?? exemption.scope },
            relaxed: true,
            exemption,
            violations: [],
          });
        }
      }
    }
  }

  // Compare supplied signals against resolved budgets. Signals inside a
  // caller-exempted scope are handled by the relaxed budget entry when one
  // exists, and otherwise not flagged. LLM proposals never suppress
  // violations; they only downgrade the guardrail.
  for (const signal of runtimeSignals) {
    const exempted = appliedExemptions.find(
      (exemption) =>
        exemption.proposedBy !== 'llm' && signal.scope !== undefined && scopeMatches(exemption.scope, signal.scope),
    );
    for (const budget of budgets) {
      if (!signalMatchesBudget(signal, budget)) continue;
      if (exempted !== undefined && !budget.relaxed) continue;
      if (exempted === undefined && budget.relaxed) continue;
      if (signal.value > budget.target.threshold) {
        budget.violations.push(signal);
      }
    }
  }

  return { budgets, appliedExemptions, conflicts, unquantifiedCustomGoals };
}

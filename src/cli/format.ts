import type { ExperienceTarget, PlanResponse, TestSuggestion } from '../schema/index.ts';

// Presentation only. `--json` is the compatibility surface; this layout may change
// without notice (spec/interface/cli.md, "Text Output Format").

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;
// `[` + longest priority + `]` + one separating space, so `[critical]` still has a
// gap before its title (spec/interface/cli.md, "Text Output Format").
const LABEL_WIDTH = Math.max(...PRIORITY_ORDER.map((priority) => priority.length)) + 3;

function budgetOf(target: ExperienceTarget): string {
  const percentile = target.percentile === undefined ? '' : `p${target.percentile} `;
  const scope = target.scope === undefined ? '' : ` [${target.scope}]`;
  return `${percentile}${target.metric} <= ${target.threshold}${target.unit}${scope}`;
}

function suggestionLines(suggestion: TestSuggestion): string[] {
  const label = `[${suggestion.priority}]`.padEnd(LABEL_WIDTH);
  const budget = suggestion.budget === undefined
    ? ''
    : `   ${budgetOf(suggestion.budget)}${suggestion.proposedBudget === true ? ' (proposed)' : ''}`;
  const lines = [
    `  ${label}${suggestion.title}   (${suggestion.kind}, ${suggestion.confidence.toFixed(2)})${budget}`,
    `             -> ${suggestion.draft.description}`,
  ];
  for (const step of suggestion.draft.outline ?? []) {
    lines.push(`                - ${step}`);
  }
  if (suggestion.evidenceIds.length > 0) {
    lines.push(`             evidence: ${suggestion.evidenceIds.join(', ')}`);
  }
  return lines;
}

export function formatPlanText(plan: PlanResponse, kind: string): string {
  const lines: string[] = [`Augur plan — ${kind}`, `Summary: ${plan.summary}`, '', 'Tests'];
  if (plan.testPlan.suggestions.length === 0) {
    lines.push('  (no suggestions)');
  } else {
    // Engine order is preserved inside a priority; only the grouping is ours.
    for (const priority of PRIORITY_ORDER) {
      for (const suggestion of plan.testPlan.suggestions) {
        if (suggestion.priority === priority) lines.push(...suggestionLines(suggestion));
      }
    }
  }

  lines.push('', `Fix policy: ${plan.fixPolicy.strategy}`);
  plan.fixPolicy.steps.forEach((step, index) => {
    const dependsOn = step.dependsOn === undefined || step.dependsOn.length === 0
      ? ''
      : `  (after ${step.dependsOn.join(', ')})`;
    const evidence = step.evidenceIds.length === 0 ? '' : `  [${step.evidenceIds.join(', ')}]`;
    lines.push(`  ${index + 1}. ${step.title}${dependsOn}${evidence}`);
  });
  if (plan.fixPolicy.rollback !== undefined) {
    lines.push(`  rollback: ${plan.fixPolicy.rollback}`);
  }

  if (plan.fixPolicy.risks.length > 0) {
    lines.push('', 'Risks');
    for (const risk of plan.fixPolicy.risks) {
      lines.push(`  [${risk.severity}] ${risk.description}`);
    }
  }

  if (plan.evidence.length > 0) {
    lines.push('', 'Evidence');
    const typeWidth = Math.max(...plan.evidence.map((entry) => entry.type.length));
    for (const entry of plan.evidence) {
      lines.push(`  ${entry.id}  ${entry.type.padEnd(typeWidth)}  ${entry.detail}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

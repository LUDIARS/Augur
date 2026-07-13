import type { Evidence, ExperienceExemption, FocusedDomain, RuntimeSignal } from '../schema/index.ts';
import type { EvidenceRefs, NormalizedFacts, ResolvedBudget } from './types.ts';

// Stage 3 of the pipeline: every downstream suggestion, fix step, and risk
// must trace back to entries created here. Ordering is fixed
// (spec/implementation-design.md): objective -> project -> focused domains -> change -> failure
// -> coverage -> runtime -> experience goals -> exemptions -> violations.

function firstLine(text: string | undefined): string {
  if (text === undefined) return '';
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0);
  return (line ?? '').trim();
}

function describeTarget(budget: ResolvedBudget): string {
  const { target } = budget;
  const percentile = target.percentile !== undefined ? ` p${target.percentile}` : '';
  const scope = target.scope !== undefined ? ` on ${target.scope}` : '';
  return `${target.metric}${percentile} <= ${target.threshold}${target.unit}${scope}`;
}

export function extractEvidence(facts: NormalizedFacts): EvidenceRefs {
  const list: Evidence[] = [];
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `ev-${String(counter).padStart(3, '0')}`;
  };
  const push = (entry: Omit<Evidence, 'id'>): string => {
    const id = nextId();
    list.push({ id, ...entry });
    return id;
  };

  const objectiveId = push({
    type: 'objective',
    detail: `Caller requested ${facts.objective.kind.replace(/_/g, ' ')}: ${facts.objective.description}`,
  });

  let projectId: string | undefined;
  if (facts.projectDomain !== undefined || facts.frameworks.length > 0 || facts.testRunners.length > 0) {
    const parts: string[] = [];
    if (facts.projectDomain !== undefined) parts.push(`domain ${facts.projectDomain}`);
    if (facts.frameworks.length > 0) parts.push(`frameworks ${facts.frameworks.join(', ')}`);
    if (facts.testRunners.length > 0) parts.push(`test runners ${facts.testRunners.join(', ')}`);
    projectId = push({ type: 'project_metadata', detail: `Project context: ${parts.join('; ')}.` });
  }

  const focusedDomainIds = new Map<FocusedDomain, string>();
  for (const domain of facts.focusedDomains) {
    const variables = domain.targets.flatMap((target) => target.variables);
    const variableDetail = variables.length > 0
      ? ` Important variables: ${variables.map((variable) => `${variable.name} (${variable.priority})`).join(', ')}.`
      : '';
    focusedDomainIds.set(
      domain,
      push({
        type: 'focused_test_focus',
        detail: `Anatomia focused domain "${domain.domain}" at ${domain.priority} priority with risks ${domain.risks.join(', ')}${domain.inferredRisks !== undefined ? ' (mechanically inferred)' : ' (caller-selected)'} across ${domain.targets.length} analyzed target(s).${variableDetail}`,
      }),
    );
  }

  let diffId: string | undefined;
  if (facts.hasDiff) {
    diffId = push({ type: 'diff', detail: 'A code diff was supplied with the request.' });
  }
  const changedFileIds = new Map<string, string>();
  for (const file of facts.changedFiles) {
    changedFileIds.set(file, push({ type: 'changed_file', file, detail: `Changed file: ${file}` }));
  }

  let failureLogId: string | undefined;
  let stackTraceId: string | undefined;
  if (facts.failure !== null) {
    const command = facts.failure.command !== undefined ? `${facts.failure.command} ` : '';
    const exit = facts.failure.exitCode !== undefined ? `exited with code ${facts.failure.exitCode}` : 'failed';
    const err = firstLine(facts.failure.stderr) || firstLine(facts.failure.stdout);
    failureLogId = push({
      type: 'failure_log',
      detail: `${command}${exit}${err.length > 0 ? `: ${err}` : ''}`,
    });
    if (facts.failure.stackTrace !== undefined) {
      stackTraceId = push({
        type: 'stack_trace',
        detail: `Stack trace supplied${facts.failure.frames.length > 0 ? `; top frame ${facts.failure.frames[0]}` : ''}`,
      });
    }
  }

  let coverageId: string | undefined;
  if (facts.coverage !== null) {
    coverageId = push({ type: 'coverage', detail: `Coverage data supplied (${facts.coverage.format}).` });
  }

  const runtimeIds = new Map<RuntimeSignal, string>();
  for (const signal of facts.runtime) {
    const percentile = signal.percentile !== undefined ? ` p${signal.percentile}` : '';
    const scope = signal.scope !== undefined ? ` on ${signal.scope}` : '';
    runtimeIds.set(
      signal,
      push({
        type: 'runtime_signal',
        detail: `${signal.name}${percentile}${scope} measured at ${signal.value}${signal.unit}${signal.source !== undefined ? ` (${signal.source})` : ''}`,
      }),
    );
  }

  const budgetIds = new Map<ResolvedBudget, string>();
  for (const budget of facts.budgets) {
    const origin = budget.proposed ? 'proposed from the experience goal catalog' : 'set by the caller';
    const relaxed = budget.relaxed ? ' (relaxed by exemption)' : '';
    budgetIds.set(
      budget,
      push({
        type: 'experience_goal',
        detail: `${budget.quality} budget${relaxed}: ${describeTarget(budget)}, ${origin}${
          budget.catalogRef !== undefined ? ` (${budget.catalogRef.entryId} ${budget.catalogRef.keyResultId})` : ''
        }.`,
      }),
    );
  }

  const exemptionIds = new Map<ExperienceExemption, string>();
  for (const exemption of facts.appliedExemptions) {
    const relaxed =
      exemption.relaxedTarget !== undefined
        ? `relaxed to ${exemption.relaxedTarget.threshold}${exemption.relaxedTarget.unit}`
        : 'waived';
    exemptionIds.set(
      exemption,
      push({
        type: 'budget_exemption',
        detail: `Scope "${exemption.scope}" ${relaxed} (${exemption.proposedBy ?? 'caller'}): ${exemption.reason}`,
      }),
    );
  }

  const violationIds = new Map<RuntimeSignal, string>();
  for (const budget of facts.budgets) {
    for (const signal of budget.violations) {
      if (violationIds.has(signal)) continue;
      violationIds.set(
        signal,
        push({
          type: 'budget_violation',
          detail: `${signal.name}${signal.scope !== undefined ? ` on ${signal.scope}` : ''} measured ${signal.value}${signal.unit}, exceeding the ${budget.quality} budget of ${budget.target.threshold}${budget.target.unit}.`,
        }),
      );
    }
  }

  return {
    list,
    objectiveId,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(diffId !== undefined ? { diffId } : {}),
    changedFileIds,
    ...(failureLogId !== undefined ? { failureLogId } : {}),
    ...(stackTraceId !== undefined ? { stackTraceId } : {}),
    ...(coverageId !== undefined ? { coverageId } : {}),
    runtimeIds,
    budgetIds,
    exemptionIds,
    violationIds,
    focusedDomainIds,
  };
}

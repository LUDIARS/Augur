import type { CreatePlanRequest } from '../schema/index.ts';
import { resolveExperience } from './experience.ts';
import type { FailureFact, NormalizedFacts, PlanOptions } from './types.ts';

// Stage 2 of the pipeline (spec/feature/planning-engine.md): parse raw
// signals into uniform internal facts. Rule modules only ever see these.

function filesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    const match = /^\+\+\+ b\/(.+)$/.exec(line) ?? /^diff --git a\/\S+ b\/(.+)$/.exec(line);
    const file = match?.[1];
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return files;
}

function parseFailure(failure: NonNullable<CreatePlanRequest['failure']>): FailureFact {
  const frames: string[] = [];
  const stack = failure.stackTrace ?? '';
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ')) frames.push(trimmed);
  }
  return {
    ...(failure.command !== undefined ? { command: failure.command } : {}),
    ...(failure.exitCode !== undefined ? { exitCode: failure.exitCode } : {}),
    ...(failure.stderr !== undefined ? { stderr: failure.stderr } : {}),
    ...(failure.stdout !== undefined ? { stdout: failure.stdout } : {}),
    ...(failure.stackTrace !== undefined ? { stackTrace: failure.stackTrace } : {}),
    frames,
  };
}

export function normalize(request: CreatePlanRequest, options: PlanOptions): NormalizedFacts {
  const changedFiles: string[] = [];
  for (const file of request.change?.changedFiles ?? []) {
    if (!changedFiles.includes(file)) changedFiles.push(file);
  }
  if (request.change?.diff !== undefined) {
    for (const file of filesFromDiff(request.change.diff)) {
      if (!changedFiles.includes(file)) changedFiles.push(file);
    }
  }

  const failure = request.failure !== undefined ? parseFailure(request.failure) : null;

  const conflictingSignals: string[] = [];
  if (failure !== null && failure.exitCode === 0 && (failure.stderr ?? '').trim().length > 0) {
    // Conflicting signals are surfaced as a Risk rather than resolved
    // silently (spec/feature/planning-engine.md, Graceful Degradation).
    conflictingSignals.push(
      'The supplied failure has exit code 0 but a non-empty error output; the failure signal may not reflect an actual failure.',
    );
  }

  const resolution = resolveExperience(
    request.experienceGoals ?? [],
    request.project?.domain,
    request.runtimeSignals ?? [],
    options.proposedExemptions ?? [],
  );

  return {
    objective: request.objective,
    ...(request.project?.domain !== undefined ? { projectDomain: request.project.domain } : {}),
    changedFiles,
    hasDiff: request.change?.diff !== undefined,
    failure,
    coverage: request.coverage ?? null,
    runtime: request.runtimeSignals ?? [],
    budgets: resolution.budgets,
    appliedExemptions: resolution.appliedExemptions,
    exemptionConflicts: resolution.conflicts,
    unquantifiedCustomGoals: resolution.unquantifiedCustomGoals,
    constraints: request.constraints ?? [],
    conflictingSignals,
    frameworks: request.project?.frameworks ?? [],
    testRunners: request.project?.testRunners ?? [],
  };
}

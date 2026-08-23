import { basename, dirname, extname, join } from 'node:path';
import type { ProgramDomainDiagnosis } from '../anatomia.ts';
import type { TestsConfig } from '../config.ts';
import type { AuthoringBrief, RunnerId, TestRecord, TestTarget } from '../types.ts';
import { priorityFor } from './priority.ts';
import type { FocusedRisk, TargetCandidate } from './targets.ts';

export const FIXED_MUST_NOT = [
  'network',
  'real database',
  'sleep',
] as const;

export function materializeTarget(input: {
  candidate: TargetCandidate;
  registry: readonly TestRecord[];
  config: TestsConfig;
  program: ProgramDomainDiagnosis;
}): TestTarget {
  const file = placeTarget(input.candidate, input.registry, input.config, input.program);
  const decision = priorityFor({ kind: input.candidate.kind, ...input.candidate.priorityFacts });
  return {
    key: input.candidate.key,
    kind: input.candidate.kind,
    priority: decision.priority,
    domains: input.candidate.domains,
    anchors: [...input.candidate.anchors].sort(),
    impacted: [...input.candidate.impacted].sort(),
    file,
    runner: runnerFor(file, input.config),
    runtime: decision.runtime,
    brief: briefFor(input.candidate, input.registry),
  };
}

export function placeTarget(
  candidate: TargetCandidate,
  registry: readonly TestRecord[],
  config: TestsConfig,
  program: ProgramDomainDiagnosis,
): string {
  const sameDomain = new Set(candidate.domains.program);
  const registered = registry
    .filter((test) => test.status !== 'retired' && test.domains.program.some((domain) => sameDomain.has(domain)))
    .map((test) => test.file);
  const diagnosed = program.modules
    .filter((module) => module.layer !== null && sameDomain.has(`${module.layer}:${module.moduleId}`))
    .flatMap((module) => module.files)
    .filter(isTestFile);
  const candidates = [...new Set([...registered, ...diagnosed])];
  if (candidates.length > 0) {
    return candidates.sort((left, right) => (
      commonPathLength(candidate.subject.file, right) - commonPathLength(candidate.subject.file, left)
      || left.localeCompare(right)
    ))[0]!;
  }
  return newTestPath(candidate.subject.file, config);
}

export function newTestPath(implementationFile: string, config: TestsConfig): string {
  const normalized = normalizePath(implementationFile);
  const extension = extname(normalized);
  const module = extension === '' ? normalized : normalized.slice(0, -extension.length);
  const template = config.layout.newTestPath;
  if (template !== undefined) return safeRelative(template.replaceAll('{module}', module));
  const stem = basename(module);
  return safeRelative(join(dirname(normalized), `${stem}.test${extension}`).replace(/\\/g, '/'));
}

export function runnerFor(file: string, config: TestsConfig): RunnerId {
  const extension = extname(file).toLowerCase();
  if (extension === '.rs') return 'cargo';
  if (['.cc', '.cpp', '.cxx', '.c'].includes(extension)) return 'gtest';
  if (extension === '.cs') return 'unity';
  const first = Object.keys(config.runners)[0];
  return isRunner(first) ? first : 'vitest';
}

export function briefFor(candidate: TargetCandidate, registry: readonly TestRecord[]): AuthoringBrief {
  const label = candidate.kind === 'assurance' ? 'Assurance' : candidate.kind === 'regression' ? 'Regression' : 'Guardrail';
  const exemplars = registry
    .filter((test) => test.status !== 'retired' && test.domains.program.some((domain) => candidate.domains.program.includes(domain)))
    .sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name))
    .slice(0, 2)
    .map((test) => ({ file: test.file, name: test.name }));
  return {
    title: `${label}: ${candidate.subject.symbol}`,
    purpose: purposeFor(candidate),
    subject: candidate.subject,
    risks: [...candidate.risks].sort(),
    exemplars,
    mustAssert: mustAssertFor(candidate.subject.signature, candidate.risks, candidate.kind),
    mustNot: [...FIXED_MUST_NOT],
    ...(candidate.incident === undefined ? {} : { incident: candidate.incident }),
  };
}

function purposeFor(candidate: TargetCandidate): string {
  if (candidate.kind === 'regression') {
    return `Reproduce the observed failure at ${candidate.subject.symbol} and prove the corrected behavior remains stable.`;
  }
  if (candidate.kind === 'guardrail') {
    return `Enforce the planned experience constraint at ${candidate.subject.symbol} with a deterministic runner assertion.`;
  }
  return `Prove the observable contract of ${candidate.subject.symbol} for the changed behavior and its impacted callers.`;
}

function mustAssertFor(signature: string | undefined, risks: readonly FocusedRisk[], kind: TargetCandidate['kind']): string[] {
  const assertions = new Set<string>();
  if (signature !== undefined) {
    const parameters = signature.match(/\(([^)]*)\)/)?.[1]?.split(',').map((value) => value.trim().split(/[:=]/)[0]?.trim())
      .filter((value): value is string => value !== undefined && value !== '');
    for (const parameter of parameters ?? []) assertions.add(`observable behavior for parameter ${parameter}`);
    assertions.add(`the contract expressed by ${signature}`);
  } else {
    assertions.add('the subject\'s observable return value or state change');
  }
  for (const risk of risks) assertions.add(assertionForRisk(risk));
  if (kind === 'regression') assertions.add('the exact failing case and the corrected post-fix behavior');
  if (kind === 'guardrail') assertions.add('the configured threshold at the intended scope');
  return [...assertions];
}

function assertionForRisk(risk: FocusedRisk): string {
  const assertions: Record<FocusedRisk, string> = {
    boundary: 'valid, empty, invalid, and boundary inputs',
    memory_safety: 'ownership, bounds, and release invariants',
    authorization: 'authority checks at the trust boundary',
    state_transition: 'valid and invalid state transitions and their invariants',
    concurrency: 'ordering invariants under repeated or overlapping execution',
    contract: 'public preconditions, postconditions, and compatibility behavior',
  };
  return assertions[risk];
}

function isTestFile(file: string): boolean {
  return /(?:^|\/)(?:__tests__\/.*|[^/]+\.test\.[^/]+)$/.test(normalizePath(file));
}

function commonPathLength(left: string, right: string): number {
  const a = normalizePath(left).split('/');
  const b = normalizePath(right).split('/');
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function safeRelative(file: string): string {
  const normalized = normalizePath(file);
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`layout.newTestPath produced an unsafe path: ${file}`);
  }
  return normalized;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isRunner(value: string | undefined): value is RunnerId {
  return value !== undefined && ['vitest', 'cargo', 'gtest', 'unity', 'command'].includes(value);
}

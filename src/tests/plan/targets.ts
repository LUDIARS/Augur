import type { PrDiffReview, ProgramDomainDiagnosis } from '../anatomia.ts';
import type { TestsConfig } from '../config.ts';
import type { TestKind, TestPriority, TestRecord } from '../types.ts';

export type FocusedRisk = 'boundary' | 'memory_safety' | 'authorization' | 'state_transition' | 'concurrency' | 'contract';

export interface TargetSubject {
  symbol: string;
  file: string;
  line: number;
  signature?: string;
}

export interface TargetCandidate {
  key: string;
  kind: TestKind;
  domains: TestRecord['domains'];
  anchors: string[];
  impacted: string[];
  subject: TargetSubject;
  risks: FocusedRisk[];
  priorityFacts: {
    incident: boolean;
    fanIn: number;
    nearestEntryDistance?: number;
    cyclomatic: number;
    touchesErrorViolation: boolean;
    domainPriority?: TestPriority;
    added: boolean;
  };
  incident?: { log: string; failure: string; expectedAfterFix: string };
  dropReason?: 'covered' | 'retired_equivalent';
}

export function derivePrTargets(input: {
  analysis: PrDiffReview;
  program: ProgramDomainDiagnosis;
  impacted: Readonly<Record<string, readonly string[]>>;
  registry: readonly TestRecord[];
  config: TestsConfig;
  bugFixEvidence?: string;
}): TargetCandidate[] {
  const subjects = changedSubjects(input.analysis);
  const metrics = new Map(input.analysis.quality.changedFunctions.map((metric) => [metric.anchor, metric]));
  const added = new Set(input.analysis.diff.anchors.added);
  const activeCoverage = new Set(input.registry.filter((test) => test.status === 'active').flatMap((test) => test.anchors));
  const errorViolations = new Set(input.analysis.architecture.changedViolations
    .filter((violation) => violation.severity === 'error')
    .flatMap((violation) => violation.locations.map((location) => location.anchor)));
  const bugFix = hasBugFixEvidence(input.analysis, input.bugFixEvidence);
  const candidates: TargetCandidate[] = [];

  for (const subject of subjects) {
    const domains = domainsFor(subject.anchor, subject.file, input.analysis, input.program);
    const metric = metrics.get(subject.anchor);
    const common = {
      domains,
      anchors: [subject.anchor] as string[],
      impacted: [...new Set(input.impacted[subject.anchor] ?? [])].sort(),
      subject: withoutAnchor(subject),
      risks: risksFor(input.analysis, subject),
      priorityFacts: {
        incident: false,
        fanIn: metric?.fanIn ?? 0,
        ...(nearestEntryDistance(input.analysis, subject.anchor) === undefined
          ? {}
          : { nearestEntryDistance: nearestEntryDistance(input.analysis, subject.anchor)! }),
        cyclomatic: metric?.cyclomatic ?? 0,
        touchesErrorViolation: errorViolations.has(subject.anchor),
        ...(domainPriority(input.config, domains.business) === undefined
          ? {}
          : { domainPriority: domainPriority(input.config, domains.business)! }),
        added: added.has(subject.anchor),
      },
    };
    candidates.push({
      key: `assurance:${subject.anchor}`,
      kind: 'assurance',
      ...common,
      ...(activeCoverage.has(subject.anchor) ? { dropReason: 'covered' as const } : {}),
    });
    if (bugFix) {
      candidates.push({ key: `regression:${subject.anchor}`, kind: 'regression', ...common });
    }
  }
  return candidates.sort((left, right) => left.key.localeCompare(right.key));
}

export function domainsFor(
  anchor: string,
  file: string,
  analysis: Pick<PrDiffReview, 'domain'> | undefined,
  program: ProgramDomainDiagnosis,
): TestRecord['domains'] {
  const programKeys = program.modules
    .filter((module) => module.layer !== null && module.files.includes(normalizePath(file)))
    .map((module) => `${module.layer}:${module.moduleId}`)
    .sort();
  if (programKeys.length === 0) throw new Error(`Anatomia did not return a program domain for ${anchor} (${file})`);
  const business = analysis?.domain.targetDomains
    .filter((domain) => domain.changedAnchors.includes(anchor))
    .map((domain) => domain.name)
    .sort() ?? [];
  return { business, program: [...new Set(programKeys)] };
}

export function hasBugFixEvidence(analysis: unknown, additional = ''): boolean {
  const root = asRecord(analysis);
  const pullRequest = asRecord(root?.pullRequest) ?? asRecord(root?.pr);
  const text = [
    additional,
    root?.title,
    root?.body,
    root?.description,
    root?.ref,
    pullRequest?.title,
    pullRequest?.body,
    pullRequest?.description,
    pullRequest?.ref,
  ].filter((value): value is string => typeof value === 'string').join('\n');
  return /\b(?:fix(?:e[ds])?|bug|defect|regression|issue|incident)\b|problem[_/-]logs?/i.test(text);
}

function changedSubjects(analysis: PrDiffReview): Array<TargetSubject & { anchor: string }> {
  const output: Array<TargetSubject & { anchor: string }> = [];
  for (const file of analysis.diff.files) {
    for (const item of [...file.added, ...file.changed]) {
      if (item.anchor === null) continue;
      output.push({
        anchor: item.anchor,
        symbol: item.name,
        file: normalizePath(file.path),
        line: item.line,
        ...(item.signature === undefined ? {} : { signature: item.signature }),
      });
    }
  }
  return output.sort((left, right) => left.anchor.localeCompare(right.anchor));
}

function withoutAnchor(subject: TargetSubject & { anchor: string }): TargetSubject {
  return {
    symbol: subject.symbol,
    file: subject.file,
    line: subject.line,
    ...(subject.signature === undefined ? {} : { signature: subject.signature }),
  };
}

function domainPriority(config: TestsConfig, domains: readonly string[]): TestPriority | undefined {
  const order: TestPriority[] = ['critical', 'high', 'medium', 'low'];
  return domains.map((domain) => config.quota.domains[domain]?.priority)
    .filter((value): value is TestPriority => value !== undefined)
    .sort((left, right) => order.indexOf(left) - order.indexOf(right))[0];
}

function risksFor(analysis: unknown, subject: TargetSubject & { anchor: string }): FocusedRisk[] {
  const allowed = new Set<FocusedRisk>(['boundary', 'memory_safety', 'authorization', 'state_transition', 'concurrency', 'contract']);
  const risks = new Set<FocusedRisk>();
  const root = asRecord(analysis);
  const focused = asRecord(root?.focusedTesting);
  for (const rawDomain of asArray(focused?.domains)) {
    const domain = asRecord(rawDomain);
    const targets = asArray(domain?.targets).map(asRecord).filter((value): value is Record<string, unknown> => value !== undefined);
    if (!targets.some((target) => target.symbol === subject.symbol || normalizePath(String(target.file ?? '')) === subject.file)) continue;
    for (const risk of [...asArray(domain?.risks), ...asArray(domain?.inferredRisks)]) {
      if (typeof risk === 'string' && allowed.has(risk as FocusedRisk)) risks.add(risk as FocusedRisk);
    }
  }
  if (risks.size === 0) risks.add('contract');
  return [...risks].sort();
}

function nearestEntryDistance(analysis: unknown, anchor: string): number | undefined {
  const matches: number[] = [];
  visit(analysis, (value) => {
    if (value.anchor !== anchor) return;
    const direct = numeric(value.distance) ?? numeric(value.depth) ?? numeric(value.hops);
    if (direct !== undefined) matches.push(direct);
    for (const entry of asArray(value.nearestEntries)) {
      const item = asRecord(entry);
      const distance = numeric(item?.distance) ?? numeric(item?.depth) ?? numeric(item?.hops);
      if (distance !== undefined) matches.push(distance);
    }
  });
  return matches.sort((left, right) => left - right)[0];
}

function visit(value: unknown, callback: (record: Record<string, unknown>) => void): void {
  const record = asRecord(value);
  if (record !== undefined) {
    callback(record);
    for (const child of Object.values(record)) visit(child, callback);
  } else if (Array.isArray(value)) {
    for (const child of value) visit(child, callback);
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

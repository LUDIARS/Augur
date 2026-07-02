import type { EvidenceRefs, NormalizedFacts } from '../types.ts';

export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|__tests__|spec)\//.test(file);
}

export function testFiles(facts: NormalizedFacts): string[] {
  return facts.changedFiles.filter(isTestFile);
}

export function codeFiles(facts: NormalizedFacts): string[] {
  return facts.changedFiles.filter((file) => !isTestFile(file));
}

export function changeEvidenceIds(facts: NormalizedFacts, evidence: EvidenceRefs): string[] {
  const ids: string[] = [];
  if (evidence.diffId !== undefined) ids.push(evidence.diffId);
  for (const file of facts.changedFiles) {
    const id = evidence.changedFileIds.get(file);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

export function failureEvidenceIds(evidence: EvidenceRefs): string[] {
  const ids: string[] = [];
  if (evidence.failureLogId !== undefined) ids.push(evidence.failureLogId);
  if (evidence.stackTraceId !== undefined) ids.push(evidence.stackTraceId);
  return ids;
}

// Confidence per spec/data/core-schema.md bands and the scoring rules in
// spec/feature/planning-engine.md: a rule-defined base, boosted by a fixed
// amount per independent corroborating evidence type, capped at 1.0.
export function confidenceFrom(base: number, corroboratingTypes: number): number {
  const boosted = base + 0.05 * corroboratingTypes;
  return Math.min(1, Math.round(boosted * 100) / 100);
}

export function preferredFramework(facts: NormalizedFacts): string | undefined {
  return facts.testRunners[0];
}

export function draftFor(facts: NormalizedFacts, description: string, outline?: string[]): {
  framework?: string;
  description: string;
  outline?: string[];
} {
  const framework = preferredFramework(facts);
  return {
    ...(framework !== undefined ? { framework } : {}),
    description,
    ...(outline !== undefined ? { outline } : {}),
  };
}

import type { AnatomiaDomain, Priority } from '../schema/index.ts';
import { draftFor } from './rules/shared.ts';
import type { CandidateSuggestion, EvidenceRefs, NormalizedFacts } from './types.ts';

// Plans from Anatomia's landing domains (spec/feature/focused-testing.md,
// "Anatomia landing domains"). Two signals, both read from caller-supplied
// facts only:
//   1. a landing domain whose src side has members but whose tests side has
//      none — the change cannot be paired with an existing domain test;
//   2. a change that lands in more than one domain of the same layer — the
//      boundary between them needs an integration test.

function evidenceIdFor(domain: AnatomiaDomain, evidence: EvidenceRefs): string {
  const id = evidence.anatomiaDomainIds.get(domain);
  if (id === undefined) {
    throw new Error(`missing Anatomia domain evidence for "${domain.layer}:${domain.name}"`);
  }
  return id;
}

function filesOf(domains: readonly AnatomiaDomain[]): string[] | undefined {
  const files = [...new Set(domains.flatMap((domain) => domain.files ?? []))].sort();
  return files.length > 0 ? files : undefined;
}

function untestedDomainSuggestion(
  facts: NormalizedFacts,
  domain: AnatomiaDomain,
  evidenceId: string,
): CandidateSuggestion {
  const files = filesOf([domain]);
  return {
    title: `${domain.name}: pair the change with a ${domain.layer} domain test`,
    kind: domain.layer === 'business' ? 'integration' : 'unit',
    priority: 'high',
    confidence: 0.9,
    ...(files !== undefined ? { targetFiles: files } : {}),
    rationale: `Anatomia reports src members but no tests members for the ${domain.layer} domain "${domain.name}" the change lands in, so no existing test covers it.`,
    draft: draftFor(
      facts,
      `Given the ${domain.name} domain, when the changed behavior runs, then its observable result is asserted by a test that is a member of the same domain.`,
      [
        `Place the test so Anatomia assigns it to the ${domain.layer} domain "${domain.name}"`,
        'Assert the changed behavior through the domain\'s public entry points',
      ],
    ),
    evidenceIds: [evidenceId],
  };
}

function crossDomainSuggestion(
  facts: NormalizedFacts,
  layer: AnatomiaDomain['layer'],
  domains: readonly AnatomiaDomain[],
  evidence: EvidenceRefs,
): CandidateSuggestion {
  const names = domains.map((domain) => domain.name).sort();
  const priority: Priority = domains.length >= 3 ? 'high' : 'medium';
  const files = filesOf(domains);
  return {
    title: `Cross-domain change: ${names.join(' / ')}`,
    kind: 'integration',
    priority,
    confidence: 0.8,
    ...(files !== undefined ? { targetFiles: files } : {}),
    rationale: `The change lands in ${domains.length} ${layer} domains (${names.join(', ')}); each domain's own tests do not exercise the hand-off between them.`,
    draft: draftFor(
      facts,
      `Given the ${names.join(', ')} domains, when a request crosses their boundary, then the data and errors passed between them keep their contract.`,
      [
        `Drive one flow that passes through: ${names.join(' -> ')}`,
        'Assert the values and failures that cross each domain boundary',
      ],
    ),
    evidenceIds: domains.map((domain) => evidenceIdFor(domain, evidence)),
  };
}

export function anatomiaDomainSuggestions(
  facts: NormalizedFacts,
  evidence: EvidenceRefs,
): CandidateSuggestion[] {
  const suggestions: CandidateSuggestion[] = [];
  for (const domain of facts.anatomiaDomains) {
    if (domain.membership.src && !domain.membership.tests) {
      suggestions.push(untestedDomainSuggestion(facts, domain, evidenceIdFor(domain, evidence)));
    }
  }
  for (const layer of ['program', 'business'] as const) {
    const inLayer = facts.anatomiaDomains.filter((domain) => domain.layer === layer);
    if (inLayer.length >= 2) suggestions.push(crossDomainSuggestion(facts, layer, inLayer, evidence));
  }
  return suggestions;
}

import type { EvidenceRefs, NormalizedFacts, RuleModule, RuleOutput } from '../types.ts';
import { changeEvidenceIds, codeFiles, confidenceFrom, draftFor } from './shared.ts';

export const securityRule: RuleModule = {
  kind: 'security',
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput {
    const changeIds = changeEvidenceIds(facts, evidence);
    const base = [evidence.objectiveId, ...changeIds];
    const corroborating = changeIds.length > 0 ? 1 : 0;
    const targets = codeFiles(facts);

    return {
      suggestions: [
        {
          title: 'Input validation at the trust boundary',
          kind: 'security',
          priority: 'critical',
          confidence: confidenceFrom(changeIds.length > 0 ? 0.7 : 0.55, corroborating),
          ...(targets.length > 0 ? { targetFiles: targets } : {}),
          rationale: 'Every externally reachable input needs validation tests: type, range, size, and encoding.',
          draft: draftFor(facts, 'Given malformed, oversized, and hostile inputs at the boundary, when they are submitted, then each is rejected with a safe error and no side effects.'),
          evidenceIds: base,
        },
        {
          title: 'Authorization checks for the affected operations',
          kind: 'security',
          priority: 'critical',
          confidence: confidenceFrom(0.6, corroborating),
          rationale: 'Authentication is not authorization; each operation must verify the caller may perform it on that resource.',
          draft: draftFor(facts, 'Given a caller without permission for the target resource, when the operation is attempted, then it is denied and audited.'),
          evidenceIds: base,
        },
        {
          title: 'Abuse-case scenarios',
          kind: 'security',
          priority: 'high',
          confidence: confidenceFrom(0.5, corroborating),
          rationale: 'Beyond single requests: replay, enumeration, and rate abuse are how the surface actually gets attacked.',
          draft: draftFor(facts, 'Given scripted abuse patterns (replay, enumeration, burst rates), when they run against the surface, then limits and protections engage as documented.'),
          evidenceIds: base,
        },
      ],
      fixSkeleton: {
        strategy: 'contract_first',
        steps: [
          {
            title: 'Define the validation and authorization contract',
            description: 'Write down what is accepted, who may do what, and what every rejection looks like — before code.',
            evidenceIds: [evidence.objectiveId],
          },
          {
            title: 'Enforce the contract at the boundary',
            description: 'Implement validation and authorization exactly where untrusted data enters, with tests per contract clause.',
            ...(targets.length > 0 ? { targetFiles: targets } : {}),
            dependsOnPrevious: true,
            evidenceIds: base,
          },
        ],
        risks: [
          {
            severity: 'high',
            description: 'Tightening validation can break existing legitimate callers; stage the rollout and monitor rejections.',
          },
        ],
        rollback: 'Relax to log-only enforcement if legitimate traffic is rejected, then re-tighten with corrected rules.',
      },
    };
  },
};

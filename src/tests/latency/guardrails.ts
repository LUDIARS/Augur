import type { PrDiffReview, ProgramDomainDiagnosis } from '../anatomia.ts';
import { domainsFor, type TargetCandidate, type TargetSubject } from '../plan/targets.ts';
import type { TestRecord } from '../types.ts';
import { DEFAULT_LATENCY_CATALOG_REF, describeBudget, type LatencyBudgetGroup } from './budgets.ts';
import type { HttpRoute } from './routes.ts';
import type { CatalogService } from './service-catalog.ts';
import { contract } from '../../../templates/contract-runtime/contract-runtime.ts'; /* augur-inject:import:20dbf8ac */
import augurContract_5bcb2745 from '../../../contracts/latency-guardrail.contract.ts'; /* augur-inject:contract-predicate:7bd4d0a8 */

// Default latency guardrails for Web/API services. A service is Web/API when
// Anatomia finds an HTTP route entry or its Excubitor catalog fragment declares
// a port; such a service gets the EG-C01 api_latency p95 <= 1000ms guardrail
// whether or not the caller supplied experienceGoals, plus one guardrail per
// distinct Elegantia `augur` budget, each linked to its antipattern ids.

export const LATENCY_KEY_PREFIX = 'guardrail:latency:';
export const LATENCY_TAG_PREFIX = 'latency:';

export interface WebApiDetection {
  webApi: boolean;
  reasons: string[];
}

export interface LatencyPlacement {
  anchor: string;
  subject: TargetSubject;
  domains: TestRecord['domains'];
  onRoute: boolean;
}

export function detectWebApi(input: { routes: readonly HttpRoute[]; services: readonly CatalogService[] }): WebApiDetection {
  const reasons: string[] = [];
  if (input.routes.length > 0) reasons.push(`Anatomia http-route entries: ${input.routes.length}`);
  for (const service of input.services) {
    if (service.port !== undefined) reasons.push(`Excubitor catalog service ${service.code} declares port ${service.port}`);
  }
  return { webApi: reasons.length > 0, reasons };
}

/**
 * The guardrail anchors on the first HTTP route whose file has a program
 * domain; a catalog-only service (no detected route) falls back to the first
 * changed subject of the plan. Undefined when neither exists.
 */
export function placeLatencyGuardrail(input: {
  routes: readonly HttpRoute[];
  fallback: readonly TargetCandidate[];
  analysis: Pick<PrDiffReview, 'domain'> | undefined;
  program: ProgramDomainDiagnosis;
}): LatencyPlacement | undefined {
  for (const route of input.routes) {
    let domains: TestRecord['domains'];
    try {
      domains = domainsFor(route.anchor, route.file, input.analysis, input.program);
    } catch {
      continue;
    }
    return { anchor: route.anchor, subject: { symbol: route.symbol, file: route.file, line: route.line }, domains, onRoute: true };
  }
  const subject = input.fallback[0];
  if (subject === undefined || subject.anchors[0] === undefined) return undefined;
  const { symbol, file, line } = subject.subject;
  return { anchor: subject.anchors[0], subject: { symbol, file, line }, domains: subject.domains, onRoute: false };
}

export function latencyGuardrailCandidates(input: {
  detection: WebApiDetection;
  placement: LatencyPlacement | undefined;
  groups: readonly LatencyBudgetGroup[];
  routes: readonly HttpRoute[];
  registry: readonly TestRecord[];
}): TargetCandidate[] {
  const placement = input.placement;
  if (!input.detection.webApi || placement === undefined) return [];
  const impacted = [...new Set(input.routes.map((route) => route.anchor).filter((anchor) => anchor !== placement.anchor))].sort();
  return input.groups.map((group): TargetCandidate => {
    const covered = input.registry.some((record) => record.status !== 'retired'
      && record.kind === 'guardrail'
      && (record.tags ?? []).includes(`${LATENCY_TAG_PREFIX}${group.key}`));
    const origin = group.default
      ? `${DEFAULT_LATENCY_CATALOG_REF.entryId}/${DEFAULT_LATENCY_CATALOG_REF.keyResultId}`
      : 'Elegantia';
    const refs = group.elegantiaRefs.length === 0 ? '' : ` [${group.elegantiaRefs.join(', ')}]`;
    return {
      key: `${LATENCY_KEY_PREFIX}${group.key}`,
      kind: 'guardrail',
      domains: placement.domains,
      anchors: [placement.anchor],
      impacted,
      subject: { ...placement.subject, signature: `Latency guardrail (${origin}): ${describeBudget(group.budget)}${refs}` },
      risks: ['contract'],
      priorityFacts: {
        incident: false,
        fanIn: 0,
        ...(placement.onRoute ? { nearestEntryDistance: 0 } : {}),
        cyclomatic: 0,
        touchesErrorViolation: false,
        added: false,
      },
      budget: group.budget,
      ...(group.elegantiaRefs.length === 0 ? {} : { elegantiaRefs: group.elegantiaRefs }),
      ...(covered ? { dropReason: 'covered' as const } : {}),
    };
  });
}
// @ts-expect-error augur-inject
latencyGuardrailCandidates = contract(latencyGuardrailCandidates, { ...augurContract_5bcb2745, contractId: 'C-LG-1', mode: 'observe', sample: 1, where: 'src/tests/latency/guardrails.ts:64', rule: 'contract-wrap', id: '5bcb2745' }); /* augur-inject:contract-wrap:5bcb2745 */

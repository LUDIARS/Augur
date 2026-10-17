import { entrypoints as anatomiaEntrypoints, type EntryPointGraph, type PrDiffReview, type ProgramDomainDiagnosis } from '../anatomia.ts';
import type { TargetCandidate } from '../plan/targets.ts';
import type { GuardrailSources, TestRecord } from '../types.ts';
import { mergeLatencyBudgets } from './budgets.ts';
import { fetchAntipatterns, type ElegantiaSource } from './elegantia.ts';
import { detectWebApi, latencyGuardrailCandidates, placeLatencyGuardrail } from './guardrails.ts';
import { httpRoutesFrom, repoSourceReader, type HttpRoute } from './routes.ts';
import { readRepoServices, resolveServiceBaseUrl, type CatalogService } from './service-catalog.ts';

// Gathers the facts latency guardrails need for one plan: HTTP routes
// (Anatomia), the repository's Excubitor catalog fragment, and Elegantia's
// antipatterns. Every fact that cannot be gathered is written to
// `guardrailSources` so the plan states what it planned without.

export const ELEGANTIA_SERVICE_CODE = 'elegantia';

export interface LatencyPlanDependencies {
  entrypoints: (repoPath: string) => Promise<EntryPointGraph>;
  services: (repoPath: string) => CatalogService[];
  antipatterns: () => Promise<ElegantiaSource>;
}

export const defaultLatencyPlanDependencies: LatencyPlanDependencies = {
  entrypoints: anatomiaEntrypoints,
  services: readRepoServices,
  antipatterns: async () => await fetchAntipatterns(resolveServiceBaseUrl(ELEGANTIA_SERVICE_CODE)),
};

export async function planLatencyGuardrails(
  input: {
    repoPath: string;
    analysis: Pick<PrDiffReview, 'domain'>;
    program: ProgramDomainDiagnosis;
    registry: readonly TestRecord[];
    fallback: readonly TargetCandidate[];
  },
  dependencies: Partial<LatencyPlanDependencies> = {},
): Promise<{ candidates: TargetCandidate[]; sources: GuardrailSources }> {
  const deps = { ...defaultLatencyPlanDependencies, ...dependencies };
  const diagnostics: string[] = [];
  let routes: HttpRoute[] = [];
  try {
    routes = httpRoutesFrom(await deps.entrypoints(input.repoPath), repoSourceReader(input.repoPath));
  } catch (error) {
    diagnostics.push(`Anatomia entrypoints unavailable; HTTP routes not detected: ${messageOf(error)}`);
  }
  let services: CatalogService[] = [];
  try {
    services = deps.services(input.repoPath);
  } catch (error) {
    diagnostics.push(`Excubitor catalog fragment unreadable: ${messageOf(error)}`);
  }
  const detection = detectWebApi({ routes, services });
  const elegantia: ElegantiaSource | { status: 'not_queried'; detail: string } = detection.webApi
    ? await deps.antipatterns()
    : { status: 'not_queried', detail: 'not a Web/API service' };
  if (elegantia.status !== 'ok' && elegantia.status !== 'not_queried') {
    diagnostics.push(`Elegantia ${elegantia.status}; planned with the default latency guardrail only: ${elegantia.detail}`);
  }
  const groups = mergeLatencyBudgets(elegantia.status === 'not_queried' ? { status: 'unresolved', detail: elegantia.detail } : elegantia);
  const placement = detection.webApi
    ? placeLatencyGuardrail({ routes, fallback: input.fallback, analysis: input.analysis, program: input.program })
    : undefined;
  if (detection.webApi && placement === undefined) {
    diagnostics.push('latency guardrail could not be placed: no HTTP route or changed subject has a program domain');
  }
  const candidates = latencyGuardrailCandidates({ detection, placement, groups, routes, registry: input.registry });
  return {
    candidates,
    sources: {
      webApi: detection.webApi,
      reasons: detection.reasons,
      diagnostics,
      elegantia: {
        status: elegantia.status,
        ...('detail' in elegantia ? { detail: elegantia.detail } : {}),
        ...('baseUrl' in elegantia && elegantia.baseUrl !== undefined ? { baseUrl: elegantia.baseUrl } : {}),
        refs: [...new Set(groups.flatMap((group) => group.elegantiaRefs))].sort(),
      },
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

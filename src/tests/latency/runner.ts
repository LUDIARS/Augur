import { resolve } from 'node:path';
import { entrypoints as anatomiaEntrypoints, type EntryPointGraph } from '../anatomia.ts';
import { measureLatency, type LatencyReport, type ProbeFetch } from './measure.ts';
import { httpRoutesFrom, repoSourceReader, selectProbes } from './routes.ts';
import { baseUrlFor, FRAGMENT_FILE, readRepoServices, type CatalogService } from './service-catalog.ts';

// `augur tests latency`: resolves the service's base URL from the repository's
// Excubitor catalog fragment, takes argument-free GET routes from Anatomia,
// and measures them. The service must already be running (started through
// Excubitor); this runner never starts or restarts anything.

export class LatencyInputError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = 'LatencyInputError';
  }
}

export interface LatencyCheckInput {
  repoPath: string;
  service?: string;
  iterations?: number;
  thresholdMs?: number;
  requestTimeoutMs?: number;
}

export interface LatencyCheckDependencies {
  entrypoints: (repoPath: string) => Promise<EntryPointGraph>;
  services: (repoPath: string) => CatalogService[];
  fetch?: ProbeFetch;
  now?: () => number;
}

export type LatencyCheckResult = LatencyReport & { service: string };

export async function runLatencyCheck(
  input: LatencyCheckInput,
  dependencies: Partial<LatencyCheckDependencies> = {},
): Promise<LatencyCheckResult> {
  const repoPath = resolve(input.repoPath);
  const service = pickService((dependencies.services ?? readRepoServices)(repoPath), input.service);
  const base = baseUrlFor(service);
  if ('error' in base) throw new LatencyInputError(base.error);
  const graph = await (dependencies.entrypoints ?? anatomiaEntrypoints)(repoPath);
  const selection = selectProbes(httpRoutesFrom(graph, repoSourceReader(repoPath)));
  const report = await measureLatency({
    baseUrl: base.baseUrl,
    selection,
    ...(input.iterations === undefined ? {} : { iterations: input.iterations }),
    ...(input.thresholdMs === undefined ? {} : { thresholdMs: input.thresholdMs }),
    ...(input.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: input.requestTimeoutMs }),
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  return { service: service.code, ...report };
}

function pickService(services: readonly CatalogService[], code: string | undefined): CatalogService {
  if (code !== undefined) {
    const found = services.find((service) => service.code === code);
    if (found === undefined) throw new LatencyInputError(`${FRAGMENT_FILE} declares no service "${code}"`);
    return found;
  }
  const withPort = services.filter((service) => service.port !== undefined);
  if (withPort.length === 1) return withPort[0]!;
  if (withPort.length === 0) throw new LatencyInputError(`${FRAGMENT_FILE} declares no service with a port; this repository has no Web/API surface to measure`);
  throw new LatencyInputError(`${FRAGMENT_FILE} declares several services with ports (${withPort.map((service) => service.code).join(', ')}); choose one with --service`);
}

// One place that turns a project directory into a contract summary: read the
// manifest, read the weaver logs, ask what is currently wrapped, aggregate.
// `augur contracts report` and the `contracts` section of `augur tests report`
// both go through here so the two never disagree about the same window.
//
// The marker lookup is passed in rather than imported: resolving markers is the
// injector's job (src/inject/contract-markers.ts), and contract-observation
// stays free of a dependency on the rule that happens to write them.

import { aggregateContracts, type ContractWindow, type ContractsSummary } from './aggregate.ts';
import { normalizeContractEvents } from './events.ts';
import type { ContractsManifest } from './manifest.ts';
import { loadContractsManifest, readWeaverLogLines, resolveLogsDir } from './project.ts';

export type MarkerLookup = (projectDir: string) => Promise<ReadonlyMap<string, string>>;

export type ContractCollection = {
  readonly manifest: ContractsManifest;
  readonly logsDir: string;
  readonly summary: ContractsSummary;
};

export type CollectOptions = {
  readonly markers: MarkerLookup;
  readonly logsDir?: string | undefined;
  readonly window?: ContractWindow | undefined;
};

/**
 * null when the project declares no contracts — most repositories do not.
 * @implements SPEC-CONTRACTS-REPORT-AGGREGATION
 */
export async function collectContractSummary(
  projectDir: string,
  options: CollectOptions,
): Promise<ContractCollection | null> {
  const manifest = loadContractsManifest(projectDir);
  if (manifest === null) return null;

  const logsDir = resolveLogsDir(projectDir, options.logsDir);
  const scan = normalizeContractEvents(readWeaverLogLines(logsDir));
  const markers = await options.markers(projectDir);
  const summary = aggregateContracts(scan.events, manifest.contracts, markers, options.window ?? {});
  return { manifest, logsDir, summary };
}

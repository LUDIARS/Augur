// The `contracts` section of a test report (spec/plan/2026-09-05-live-contract-testing.md §6.3).
//
// A run already fixes the window a judge cares about — what the contracts saw
// while these tests were running — so the section reuses `[startedAt, finishedAt]`
// rather than asking for one. Repositories without `augur.contracts.json` get
// nothing, which is most of them; the section never appears empty.

import { collectContractSummary } from '../contracts/collect.ts';
import type { ContractsSummary } from '../contracts/aggregate.ts';
import { activeContractMarkers } from '../inject/contract-markers.ts';
import type { RunRecord } from './types.ts';

export type ContractTotals = { readonly covered: number; readonly violated: number; readonly uncovered: number };

/** undefined when the run's repository declares no contracts. */
export async function contractsForRun(run: RunRecord): Promise<ContractsSummary | undefined> {
  try {
    const collected = await collectContractSummary(run.repoPath, {
      markers: activeContractMarkers,
      window: { since: run.startedAt, until: run.finishedAt },
    });
    return collected?.summary;
  } catch {
    // A report is a reading aid, not a gate: an unreadable contract file or log
    // directory drops the section instead of failing the whole report.
    return undefined;
  }
}

export function contractTotals(summary: ContractsSummary | undefined): ContractTotals | undefined {
  return summary === undefined ? undefined : summary.totals;
}

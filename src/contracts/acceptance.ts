// Contract summary -> Concordia `acceptance_report`
// (spec/plan/2026-09-05-live-contract-testing.md §6.2, receipts C3-2 / C3-3).
//
// `met` is `covered` and nothing else: a violated contract failed, and an
// uncovered one was never exercised, which §1.3 treats as unmet rather than as
// "no news is good news". Pure — the CLI decides the window, this decides the
// verdict material.

import type { ContractSummaryEntry, ContractsSummary } from './aggregate.ts';

export type AcceptanceItem = {
  /** The manifest's `criterion`, reproduced byte-for-byte. */
  readonly criterion: string;
  readonly met: boolean;
  readonly note: string;
};

/** The report was asked for evidence acceptance policy does not allow. */
export class ContractAcceptanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractAcceptanceError';
  }
}

export function toAcceptanceReport(summary: ContractsSummary): AcceptanceItem[] {
  assertFullSampling(summary);
  return summary.contracts.map((entry) => ({
    criterion: entry.criterion,
    met: entry.state === 'covered',
    note: noteFor(entry),
  }));
}

// Sampling drops calls the runtime did make, so an `uncovered` under `sample < 1`
// cannot be told apart from a function that was never reached. Rather than
// report a `met` nobody can trust, acceptance refuses the manifest (§6.1).
function assertFullSampling(summary: ContractsSummary): void {
  const sampled = summary.contracts.filter((entry) => entry.sample < 1);
  if (sampled.length === 0) return;
  const listed = sampled.map((entry) => `${entry.id} (sample ${entry.sample})`).join(', ');
  throw new ContractAcceptanceError(
    `--acceptance needs sample 1 for every contract; sampled: ${listed}`,
  );
}

function noteFor(entry: ContractSummaryEntry): string {
  const counts = `calls ${entry.calls}, observed ${entry.observed}, violations ${entry.violationTotal}`;
  if (entry.state === 'uncovered') {
    return `uncovered (${entry.uncoveredReason ?? 'not-called'}): ${counts}`;
  }
  if (entry.state === 'covered') {
    return `covered: ${counts}${entry.lastSeen === null ? '' : `, last seen ${entry.lastSeen}`}`;
  }
  return `violated: ${counts} [${phaseBreakdown(entry)}]; latest ${latestText(entry)}`;
}

export function phaseBreakdown(entry: ContractSummaryEntry): string {
  const parts = (Object.keys(entry.violations) as Array<keyof typeof entry.violations>)
    .filter((phase) => entry.violations[phase] > 0)
    .map((phase) => `${phase}=${entry.violations[phase]}`);
  return parts.length === 0 ? 'none' : parts.join(' ');
}

export function latestText(entry: ContractSummaryEntry): string {
  if (entry.latestReasons.length === 0) return '(no reason recorded)';
  return entry.latestReasons
    .map((reason) => `${reason.phase}: ${reason.reason}${reason.where === null ? '' : ` (${reason.where})`}`)
    .join(' | ');
}

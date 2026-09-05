// Which contract-wrap markers the *current* source actually carries
// (spec/plan/2026-09-05-live-contract-testing.md §6.2).
//
// The aggregator keys on this: an event whose `ctx.id` no active marker claims
// is evidence about code this checkout no longer has — another repository's
// same-named contract, or a wrap that moved when the function was edited. Only
// `check` can answer that, so this is the one bridge between the injector's view
// of the tree and the report.

import { loadContractTargets } from './contract-project.ts';
import { contractPointId, CONTRACT_RULE } from './contract-scan.ts';
import { runOnProject } from './project.ts';

/** contract id -> marker id, for the contracts wrapped in the working tree. */
export async function activeContractMarkers(projectDir: string): Promise<Map<string, string>> {
  const markers = new Map<string, string>();
  const targets = await loadContractTargets(projectDir, { includeExisting: true });
  if (targets.length === 0) return markers;

  let applied: ReadonlySet<string>;
  try {
    const result = runOnProject(projectDir, 'check', { write: false, rules: [CONTRACT_RULE], contractTargets: targets });
    applied = new Set(result.points.filter((point) => point.state === 'applied').map((point) => point.id));
  } catch {
    // No `augur.inject.json` (or an unreadable one) means nothing is injected
    // here; every contract reports `uncovered (not-injected)` rather than the
    // report failing on a project that only wrote contracts so far.
    return markers;
  }

  for (const target of targets) {
    const id = contractPointId(target);
    if (applied.has(id)) markers.set(target.contractId, id);
  }
  return markers;
}

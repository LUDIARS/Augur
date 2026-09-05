// Contract for aggregateContracts (spec/plan/2026-09-05-live-contract-testing.md §12, C3-1).
//
// The predicate stays pure and says nothing about the values it saw: reasons are
// fixed classification strings, never observed data (§3.2). It is deliberately
// not typed against @ludiars/log-weaver — Augur does not depend on the runtime
// package, and the injector only needs an object-literal default export.

type Summary = {
  readonly totals: { readonly covered: number; readonly violated: number; readonly uncovered: number };
  readonly contracts: ReadonlyArray<{
    readonly state: string;
    readonly observed: number;
    readonly violationTotal: number;
  }>;
};

export default {
  post: (result: Summary): true | string => {
    const { covered, violated, uncovered } = result.totals;
    if (covered + violated + uncovered !== result.contracts.length) return 'totals must count every contract exactly once';
    for (const entry of result.contracts) {
      if (entry.violationTotal > 0 && entry.state !== 'violated') return 'a contract with violations must be violated';
      if (entry.violationTotal === 0 && entry.observed > 0 && entry.state !== 'covered') return 'an observed contract with no violation must be covered';
      if (entry.violationTotal === 0 && entry.observed === 0 && entry.state !== 'uncovered') return 'a contract with no evidence must be uncovered';
    }
    return true;
  },
};

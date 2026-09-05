// Contract evidence -> per-contract verdict material
// (spec/plan/2026-09-05-live-contract-testing.md §6.2, receipt C3-1).
//
// Pure and order-stable: the same events, contracts and window always produce a
// byte-identical document. Contracts keep the manifest's order (ids are unique
// by schema), phases keep a fixed order, and reasons are the newest three by
// observation time with input order breaking ties.
//
// Only events carrying the marker id the current source resolves for a contract
// are counted. Without that filter a same-named contract in another repository —
// or a marker this branch already replaced — would be read as evidence for code
// that no longer exists.

import type { ContractEvent, ContractPhase } from './events.ts';
import type { ContractEntry } from './manifest.ts';
import { normalizeRepoPath } from './paths.ts';

export type ContractState = 'covered' | 'violated' | 'uncovered';

export type ContractUncoveredReason = 'not-injected' | 'not-called';

export type ViolationCounts = {
  readonly pre: number;
  readonly post: number;
  readonly postThrow: number;
  readonly invariant: number;
  readonly predicate: number;
};

export type ContractReason = {
  readonly phase: ContractPhase;
  readonly reason: string;
  readonly observedAt: string | null;
  readonly where: string | null;
};

export type ContractSummaryEntry = {
  readonly id: string;
  readonly criterion: string;
  readonly symbol: string;
  readonly file: string;
  readonly sample: number;
  readonly markerId: string | null;
  readonly state: ContractState;
  readonly calls: number;
  readonly observed: number;
  readonly violations: ViolationCounts;
  readonly violationTotal: number;
  readonly latestReasons: readonly ContractReason[];
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly uncoveredReason: ContractUncoveredReason | null;
};

export type ContractWindow = {
  /** Inclusive lower bound (UTC ISO 8601). Undefined means "every event". */
  readonly since?: string | undefined;
  /** Inclusive upper bound (UTC ISO 8601). */
  readonly until?: string | undefined;
};

export type ContractsSummary = {
  readonly window: { readonly since: string | null; readonly until: string | null };
  readonly totals: { readonly covered: number; readonly violated: number; readonly uncovered: number };
  readonly diagnostics: {
    /** Contract events supplied, before any filtering. */
    readonly events: number;
    /** Events attributed to a contract in this manifest. */
    readonly matched: number;
    /** Events dropped because no current marker claims them. */
    readonly foreign: number;
    /** Events outside the window. */
    readonly outOfWindow: number;
    /** Events with no readable time; excluded whenever the window is bounded. */
    readonly undated: number;
  };
  readonly contracts: readonly ContractSummaryEntry[];
};

const PHASE_ORDER = ['pre', 'post', 'postThrow', 'invariant', 'predicate'] as const;

const LATEST_REASONS = 3;

type ViolationPhase = (typeof PHASE_ORDER)[number];

type Bucket = {
  observed: number;
  violations: Record<ViolationPhase, number>;
  reasons: Array<{ event: ContractEvent; index: number }>;
  firstSeen: string | null;
  lastSeen: string | null;
};

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
export function aggregateContracts(
  events: readonly ContractEvent[],
  contracts: readonly ContractEntry[],
  activeMarkers: ReadonlyMap<string, string>,
  window: ContractWindow = {},
): ContractsSummary {
  const buckets = new Map<string, Bucket>();
  for (const contract of contracts) buckets.set(contract.id, emptyBucket());

  let matched = 0;
  let foreign = 0;
  let outOfWindow = 0;
  let undated = 0;

  events.forEach((event, index) => {
    const bucket = buckets.get(event.contractId);
    const activeMarker = activeMarkers.get(event.contractId);
    // A missing marker must never authenticate an event whose marker is also
    // missing. `undefined === undefined` would otherwise turn an un-attributed
    // log line into evidence for a contract that is not injected.
    if (bucket === undefined || activeMarker === undefined || activeMarker !== event.markerId) {
      foreign += 1;
      return;
    }
    if (event.observedAt === undefined) {
      undated += 1;
      // An undated event is still diagnostic material, but it cannot be shown to
      // belong to the delegation's window, so a bounded window drops it (§6.1).
      if (isBounded(window)) return;
    } else if (!inWindow(event.observedAt, window)) {
      outOfWindow += 1;
      return;
    }
    matched += 1;
    accumulate(bucket, event, index);
  });

  const summaries = contracts.map(
    (contract) => summarize(contract, buckets.get(contract.id) ?? emptyBucket(), activeMarkers.get(contract.id) ?? null),
  );

  return {
    window: { since: window.since ?? null, until: window.until ?? null },
    totals: {
      covered: summaries.filter((entry) => entry.state === 'covered').length,
      violated: summaries.filter((entry) => entry.state === 'violated').length,
      uncovered: summaries.filter((entry) => entry.state === 'uncovered').length,
    },
    diagnostics: { events: events.length, matched, foreign, outOfWindow, undated },
    contracts: summaries,
  };
}

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function emptyBucket(): Bucket {
  return {
    observed: 0,
    violations: { pre: 0, post: 0, postThrow: 0, invariant: 0, predicate: 0 },
    reasons: [],
    firstSeen: null,
    lastSeen: null,
  };
}

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function accumulate(bucket: Bucket, event: ContractEvent, index: number): void {
  if (event.kind === 'observed') {
    bucket.observed += 1;
  } else {
    const phase = event.kind === 'predicate-threw' ? 'predicate' : violationPhase(event.phase);
    bucket.violations[phase] += 1;
    bucket.reasons.push({ event, index });
  }
  if (event.observedAt === undefined) return;
  if (bucket.firstSeen === null || event.observedAt < bucket.firstSeen) bucket.firstSeen = event.observedAt;
  if (bucket.lastSeen === null || event.observedAt > bucket.lastSeen) bucket.lastSeen = event.observedAt;
}

// `ok` never reaches here as a violation phase; anything the runtime reports
// without a usable phase is counted as a postcondition failure, matching the
// fallback in events.ts.
/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function violationPhase(phase: ContractPhase): ViolationPhase {
  return phase === 'ok' ? 'post' : phase;
}

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function summarize(contract: ContractEntry, bucket: Bucket, markerId: string | null): ContractSummaryEntry {
  const violationTotal = PHASE_ORDER.reduce((total, phase) => total + bucket.violations[phase], 0);
  const calls = bucket.observed + violationTotal;
  const state: ContractState = violationTotal > 0
    ? 'violated'
    : bucket.observed > 0 ? 'covered' : 'uncovered';

  return {
    id: contract.id,
    criterion: contract.criterion,
    symbol: contract.symbol,
    file: normalizeRepoPath(contract.file),
    sample: contract.sample,
    markerId,
    state,
    calls,
    observed: bucket.observed,
    violations: {
      pre: bucket.violations.pre,
      post: bucket.violations.post,
      postThrow: bucket.violations.postThrow,
      invariant: bucket.violations.invariant,
      predicate: bucket.violations.predicate,
    },
    violationTotal,
    latestReasons: latestReasons(bucket),
    firstSeen: bucket.firstSeen,
    lastSeen: bucket.lastSeen,
    uncoveredReason: state !== 'uncovered' ? null : markerId === null ? 'not-injected' : 'not-called',
  };
}

// Newest first. An undated violation sorts last rather than being dropped: it is
// still the only description of what failed, and the window filter above has
// already decided whether it belongs in this report at all.
/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function latestReasons(bucket: Bucket): ContractReason[] {
  return [...bucket.reasons]
    .sort((left, right) => compareRecency(left, right))
    .slice(0, LATEST_REASONS)
    .map(({ event }) => ({
      phase: event.kind === 'predicate-threw' ? 'predicate' : event.phase,
      reason: event.reason ?? '(no reason reported)',
      observedAt: event.observedAt ?? null,
      where: event.where ?? null,
    }));
}

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function compareRecency(
  left: { event: ContractEvent; index: number },
  right: { event: ContractEvent; index: number },
): number {
  const leftAt = left.event.observedAt;
  const rightAt = right.event.observedAt;
  if (leftAt === rightAt) return right.index - left.index;
  if (leftAt === undefined) return 1;
  if (rightAt === undefined) return -1;
  return leftAt < rightAt ? 1 : -1;
}

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function isBounded(window: ContractWindow): boolean {
  return window.since !== undefined || window.until !== undefined;
}

/** @implements SPEC-CONTRACTS-REPORT-AGGREGATION */
function inWindow(observedAt: string, window: ContractWindow): boolean {
  if (window.since !== undefined && observedAt < window.since) return false;
  if (window.until !== undefined && observedAt > window.until) return false;
  return true;
}

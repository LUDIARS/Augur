// Log injection framework — shared types.
// Spec: spec/feature/log-injection.md. This module tree is operational
// tooling (driven by scripts/inject-logs.ts) and is excluded from the
// service build; the scanner/applier core stays pure — (path, text) in,
// data out — so rules are unit-testable on string fixtures.

import type { ContractMode } from '../contracts/manifest.ts';
import type { SymbolForm } from '../contracts/symbols.ts';
import type { ContractTarget } from './contract-targets.ts';

export const INJECT_RULES = [
  'entry-runtime',
  'silent-catch',
  'spawn-watch',
  'interval-guard',
  'listener-guard',
  'contract-wrap',
] as const;

export type InjectRule = (typeof INJECT_RULES)[number];

// `unresolved` / `stale-module` belong to contract-wrap: the contract file
// names a function (or a predicate module) the source no longer has
// (spec/plan/2026-09-05-live-contract-testing.md §5.2).
export type PointState = 'applied' | 'pending' | 'orphaned' | 'unresolved' | 'stale-module';

export type ContractProblem = 'unresolved' | 'stale-module';

/** What contract-wrap needs to build one fragment; assembled from the contract file. */
export type ContractBinding = {
  readonly contractId: string;
  /** Module that exports the contract runtime, owned by augur.contracts.json. */
  readonly importFrom: string;
  readonly mode: ContractMode;
  readonly sample: number;
  /** Predicate module specifier, relative to the file being edited. */
  readonly specifier: string;
  /** Local name the predicate default import is bound to. */
  readonly local: string;
  readonly form: SymbolForm;
  /** Runtime expression naming the function to wrap. */
  readonly target: string;
};

/** One place where a rule wants (or already has) an injected fragment. */
export type Candidate = {
  rule: InjectRule;
  /** Deterministic 8-hex id: hash of (rule, file, anchorPath, ordinal). */
  id: string;
  file: string;
  /** 1-based line of the anchor. */
  line: number;
  /** Human label: enclosing function chain + rule-specific detail. */
  anchor: string;
  /** True when a marker for this rule already sits at the anchor. */
  applied: boolean;
  /** Marker occurrence index in the file consumed by this candidate (when applied). */
  markerIndex?: number;
  /** Statement-insert rules: position where the fragment goes. */
  insertPos?: number;
  /** Wrap rules: source range of the callback argument to wrap. */
  wrapStart?: number;
  wrapEnd?: number;
  /** Indentation of the anchor's line (statement inserts). */
  indent?: string;
  /** spawn-watch: the variable holding the child process. */
  varName?: string;
  /** contract-wrap: id derived from the contract, not from scan ordinals. */
  presetId?: string;
  /** contract-wrap: the contract this fragment observes. */
  contract?: ContractBinding;
  /** contract-wrap: why the named function cannot be wrapped right now. */
  problem?: ContractProblem;
};

/** A marker comment found in source text. */
export type MarkerHit = {
  rule: string;
  id: string;
  /** Start offset of the comment. */
  start: number;
  /** End offset (exclusive) of the comment. */
  end: number;
};

/** A splice: replace [start, end) with `text`. */
export type TextEdit = { start: number; end: number; text: string };

export type InjectionPoint = {
  rule: string;
  id: string;
  file: string;
  line: number;
  anchor: string;
  state: PointState;
};

/**
 * Extra input a rule may need beyond the file's own text. Only contract-wrap
 * uses it today: its targets come from `augur.contracts.json`, which the CLI
 * layer reads and passes down so the scanner stays pure.
 */
export type InjectContext = {
  readonly contractTargets?: readonly ContractTarget[];
};

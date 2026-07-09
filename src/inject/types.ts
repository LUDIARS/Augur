// Log injection framework — shared types.
// Spec: spec/feature/log-injection.md. This module tree is operational
// tooling (driven by scripts/inject-logs.ts) and is excluded from the
// service build; the scanner/applier core stays pure — (path, text) in,
// data out — so rules are unit-testable on string fixtures.

export const INJECT_RULES = [
  'entry-runtime',
  'silent-catch',
  'spawn-watch',
  'interval-guard',
  'listener-guard',
] as const;

export type InjectRule = (typeof INJECT_RULES)[number];

export type PointState = 'applied' | 'pending' | 'orphaned';

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

export type InjectionPoint = {
  rule: string;
  id: string;
  file: string;
  line: number;
  anchor: string;
  state: PointState;
};

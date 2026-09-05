// Weaver JSONL line -> ContractEvent (spec/plan/2026-09-05-live-contract-testing.md §2.4).
// Pure: the caller supplies already-read lines, so the same normalization runs
// over a log directory, a fixture, or a run's captured output.
//
// Only the three messages the runtime's `contract()` emits are contract
// evidence. Every other line on the sink — ordinary application logging, the
// other injection rules, a truncated write — is ignored rather than guessed at.

/** Phase reported by the runtime; `ok` is the observation of a satisfied call. */
export type ContractPhase = 'pre' | 'post' | 'postThrow' | 'invariant' | 'predicate' | 'ok';

export type ContractEventKind = 'observed' | 'violated' | 'predicate-threw';

export type ContractEvent = {
  readonly kind: ContractEventKind;
  readonly contractId: string;
  /** `ctx.id` — the injection marker that produced this event, when present. */
  readonly markerId: string | undefined;
  readonly phase: ContractPhase;
  readonly reason: string | undefined;
  /** UTC ISO 8601, or undefined when no field on the line could be read as a time. */
  readonly observedAt: string | undefined;
  readonly where: string | undefined;
};

export type ContractEventScan = {
  readonly events: readonly ContractEvent[];
  /** Lines that are not contract evidence (bad JSON, or another message). */
  readonly ignored: number;
  /** Contract events whose time could not be read (`observedAt === undefined`). */
  readonly unparsableTime: number;
};

const KIND_BY_MESSAGE: Readonly<Record<string, ContractEventKind>> = {
  'contract violated': 'violated',
  'contract observed': 'observed',
  'contract predicate threw': 'predicate-threw',
};

const PHASES: readonly ContractPhase[] = ['pre', 'post', 'postThrow', 'invariant', 'predicate', 'ok'];

// A timezone is mandatory. Date accepts implementation-dependent inputs such as
// `09/05/2026` and timezone-less local times, which would make an acceptance
// window mean different instants on different machines.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function normalizeContractEvents(lines: Iterable<string>): ContractEventScan {
  const events: ContractEvent[] = [];
  let ignored = 0;
  let unparsableTime = 0;

  for (const line of lines) {
    const event = normalizeContractEvent(line);
    if (event === null) {
      ignored += 1;
      continue;
    }
    if (event.observedAt === undefined) unparsableTime += 1;
    events.push(event);
  }
  return { events, ignored, unparsableTime };
}

/** null when the line is not one of the three contract messages. */
export function normalizeContractEvent(line: string): ContractEvent | null {
  const record = parseLine(line);
  if (record === null) return null;
  const kind = KIND_BY_MESSAGE[stringOf(record.msg) ?? ''];
  if (kind === undefined) return null;
  const ctx = isRecord(record.ctx) ? record.ctx : {};
  const contractId = stringOf(ctx.contract);
  if (contractId === undefined) return null;

  return {
    kind,
    contractId,
    markerId: stringOf(ctx.id),
    phase: phaseOf(ctx.phase, kind),
    reason: stringOf(ctx.reason),
    observedAt: normalizeContractTimestamp(ctx.observed_at)
      ?? normalizeContractTimestamp(record.time)
      ?? normalizeContractTimestamp(record.ts),
    where: stringOf(ctx.where),
  };
}

function parseLine(line: string): Record<string, unknown> | null {
  const text = line.trim();
  if (text === '') return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A missing or unknown phase falls back to the one the message itself implies,
// so an older runtime that omits `ctx.phase` still counts as evidence instead of
// being dropped as unreadable.
function phaseOf(value: unknown, kind: ContractEventKind): ContractPhase {
  const phase = stringOf(value);
  if (phase !== undefined && (PHASES as readonly string[]).includes(phase)) return phase as ContractPhase;
  if (kind === 'observed') return 'ok';
  if (kind === 'predicate-threw') return 'predicate';
  return 'post';
}

/**
 * Accepts a timezone-qualified ISO instant or epoch milliseconds.
 * @implements SPEC-CONTRACTS-REPORT-AGGREGATION
 */
export function normalizeContractTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? undefined : fromNumber.toISOString();
  }
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

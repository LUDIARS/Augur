import type { BundleKind, TestRecord } from './types.ts';

export interface BundleSelection {
  kind: BundleKind;
  selector: string | null;
  testIds: string[];
  reason: Record<string, string>;
  tests: TestRecord[];
}

export interface BundleRequest {
  kind: BundleKind;
  selector?: string | null;
  changedAnchors?: readonly string[];
  impactedAnchors?: readonly string[];
}

export function selectBundle(records: readonly TestRecord[], request: BundleRequest): BundleSelection {
  const selector = request.selector ?? null;
  const eligible = (record: TestRecord): boolean => record.status === 'active' || record.status === 'probation';
  const impacted = new Set([...(request.changedAnchors ?? []), ...(request.impactedAnchors ?? [])]);
  const requestedIds = new Set(
    request.kind === 'ids' && selector !== null
      ? selector.split(',').map((id) => id.trim()).filter(Boolean)
      : [],
  );

  const tests = records.filter((record) => {
    if (request.kind === 'ids') return requestedIds.has(record.id);
    if (!eligible(record)) return false;
    if (request.kind === 'all') return true;
    if (request.kind === 'domain') {
      return selector !== null && [...record.domains.business, ...record.domains.program].includes(selector);
    }
    return record.always || record.anchors.some((anchor) => impacted.has(anchor));
  }).sort((left, right) => left.id.localeCompare(right.id));

  const reason: Record<string, string> = {};
  for (const record of tests) {
    if (request.kind === 'ids') reason[record.id] = 'explicit';
    else if (request.kind === 'domain') reason[record.id] = `domain:${selector}`;
    else if (request.kind === 'all') reason[record.id] = 'all';
    else {
      const anchor = [...record.anchors].sort().find((candidate) => impacted.has(candidate));
      reason[record.id] = anchor === undefined ? 'always' : `anchor:${anchor}`;
    }
  }

  return { kind: request.kind, selector, testIds: tests.map((record) => record.id), reason, tests };
}

export function parseBundle(value: string): { kind: BundleKind; selector: string | null } {
  if (value === 'all') return { kind: 'all', selector: null };
  const colon = value.indexOf(':');
  const kind = colon < 0 ? value : value.slice(0, colon);
  const selector = colon < 0 ? null : value.slice(colon + 1);
  if (!['pr', 'domain', 'ids'].includes(kind)) throw new Error(`invalid bundle: ${value}`);
  if ((kind === 'domain' || kind === 'ids') && !selector) throw new Error(`${kind} bundle requires a selector`);
  return { kind: kind as BundleKind, selector };
}

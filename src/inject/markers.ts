// Marker comments are the framework's only state (no lockfile):
//   /* augur-inject:<rule>:<id8> */
// apply skips marked anchors, check diffs markers against a fresh scan,
// remove strips fragments by marker. Spec: spec/feature/log-injection.md.

import { createHash } from 'node:crypto';
import type { MarkerHit } from './types.ts';

export const MARKER_PREFIX = 'augur-inject';

const MARKER_RE = /\/\* augur-inject:([a-z-]+):([0-9a-f]{8}) \*\//g;

export function marker(rule: string, id: string): string {
  return `/* ${MARKER_PREFIX}:${rule}:${id} */`;
}

/** Deterministic id so re-scans of unchanged code name the same points. */
export function pointId(rule: string, file: string, anchorPath: string, ordinal: number): string {
  return createHash('sha256')
    .update(`${rule}|${file}|${anchorPath}|${ordinal}`)
    .digest('hex')
    .slice(0, 8);
}

export function findMarkers(text: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  for (const match of text.matchAll(MARKER_RE)) {
    hits.push({
      rule: match[1] as string,
      id: match[2] as string,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return hits;
}

export function hasAnyMarker(text: string): boolean {
  return text.includes(`/* ${MARKER_PREFIX}:`);
}

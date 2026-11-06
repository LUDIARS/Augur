// Undo C++ contract-wrap fragments (SPEC-CONTRACT-CPP-INJECT): delete exactly
// what cpp-contract-apply inserted so the file returns to its original bytes.
// Pure: (text, rules) -> text.

import { CONTRACT_IMPORT_RULE, CONTRACT_RULE } from './contract-scan.ts';
import { CONTRACT_END_RULE, CPP_RUNTIME_INCLUDE_RULE } from './cpp-contract-apply.ts';
import { findMarkers } from './markers.ts';
import type { InjectRule, MarkerHit } from './types.ts';
import type { RemoveResult } from './remove.ts';

const OPEN_PREFIX = ' return ::augur::invoke_observed(';
/** `}, a, b); ` or `}); ` — the closing fragment up to its marker. */
const CLOSE_SHAPE = /^\}(?:, [A-Za-z_]\w*(?:, [A-Za-z_]\w*)*)?\); $/;

function lineStart(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

function removeOpen(text: string, hit: MarkerHit): string | null {
  const start = text.lastIndexOf(OPEN_PREFIX, hit.start);
  if (start < 0 || text.slice(start, hit.start).includes('\n')) return null;
  return text.slice(0, start) + text.slice(hit.end);
}

function removeClose(text: string, hit: MarkerHit): string | null {
  // The fragment ends with the marker plus one space; it starts at the `}` that
  // makes the text up to the marker look exactly like what apply wrote.
  const from = lineStart(text, hit.start);
  for (let at = hit.start - 1; at >= from; at -= 1) {
    if (text[at] !== '}' || !CLOSE_SHAPE.test(text.slice(at, hit.start))) continue;
    const end = text[hit.end] === ' ' ? hit.end + 1 : hit.end;
    return text.slice(0, at) + text.slice(end);
  }
  return null;
}

function removeIncludeLine(text: string, hit: MarkerHit): string | null {
  const start = lineStart(text, hit.start);
  if (!/^#include "[^"\n]+" $/.test(text.slice(start, hit.start))) return null;
  let end = hit.end;
  if (text[end] === '\r') end += 1;
  if (text[end] === '\n') end += 1;
  return text.slice(0, start) + text.slice(end);
}

function removeOne(text: string, hit: MarkerHit): string | null {
  if (hit.rule === CONTRACT_RULE) return removeOpen(text, hit);
  if (hit.rule === CONTRACT_END_RULE) return removeClose(text, hit);
  return removeIncludeLine(text, hit);
}

const CPP_RULES = new Set<string>([CONTRACT_RULE, CONTRACT_END_RULE, CONTRACT_IMPORT_RULE, CPP_RUNTIME_INCLUDE_RULE]);

export function computeCppRemove(text: string, onlyRules?: readonly InjectRule[]): RemoveResult {
  // contract-wrap is the only C++ rule; its includes and closing halves go with it.
  if (onlyRules !== undefined && !onlyRules.includes('contract-wrap')) return { text, removed: 0, changed: false };
  let current = text;
  let removed = 0;
  // Last marker first, so earlier offsets stay valid.
  for (const hit of findMarkers(text).filter((marker) => CPP_RULES.has(marker.rule)).reverse()) {
    const next = removeOne(current, hit);
    // An unrecognized shape keeps its text; only the marker comment goes, so the loop terminates.
    current = next ?? current.slice(0, hit.start) + current.slice(hit.end);
    removed += 1;
  }
  return { text: current, removed, changed: removed > 0 };
}

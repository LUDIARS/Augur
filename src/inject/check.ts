// Drift classification (spec/feature/log-injection.md, "Markers"):
//   applied  — scan candidate with a matching marker
//   pending  — candidate with no marker (new code appeared)
//   orphaned — marker no candidate claims (anchor refactored away)
//   unresolved   — a contract names a function the source no longer declares
//   stale-module — a contract's predicate module is missing or malformed
// Marker imports (the runtime import and each contract's predicate import) are
// bookkeeping: orphaned only when they are the last augur marker left in the file.

import { CONTRACT_IMPORT_RULE } from './contract-scan.ts';
import type { InjectManifest } from './manifest.ts';
import { findMarkers } from './markers.ts';
import { scanSource } from './scan.ts';
import type { InjectContext, InjectionPoint } from './types.ts';

/** Markers that only support other fragments; they are never a point of their own. */
const BOOKKEEPING_RULES = new Set<string>(['import', CONTRACT_IMPORT_RULE]);

export function checkSource(
  relPath: string,
  text: string,
  manifest: InjectManifest,
  context?: InjectContext,
): InjectionPoint[] {
  const candidates = scanSource(relPath, text, manifest, context);
  const markers = findMarkers(text);
  const claimed = new Set<number>(
    candidates.filter((c) => c.markerIndex !== undefined).map((c) => c.markerIndex as number),
  );

  const points: InjectionPoint[] = candidates.map((c) => ({
    rule: c.rule,
    id: c.id,
    file: c.file,
    line: c.line,
    anchor: c.anchor,
    state: c.problem ?? (c.applied ? 'applied' : 'pending'),
  }));

  const ruleMarkers = markers.filter((m) => !BOOKKEEPING_RULES.has(m.rule));
  for (const m of ruleMarkers) {
    if (claimed.has(m.start)) continue;
    points.push({
      rule: m.rule,
      id: m.id,
      file: relPath,
      line: lineOf(text, m.start),
      anchor: '(marker present, anchor gone)',
      state: 'orphaned',
    });
  }
  for (const m of markers) {
    if (!BOOKKEEPING_RULES.has(m.rule)) continue;
    if (ruleMarkers.length === 0) {
      points.push({
        rule: m.rule,
        id: m.id,
        file: relPath,
        line: lineOf(text, m.start),
        anchor: '(import with no remaining fragments)',
        state: 'orphaned',
      });
    }
  }
  return points;
}

function lineOf(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

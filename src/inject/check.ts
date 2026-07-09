// Drift classification (spec/feature/log-injection.md, "Markers"):
//   applied  — scan candidate with a matching marker
//   pending  — candidate with no marker (new code appeared)
//   orphaned — marker no candidate claims (anchor refactored away)
// Marker imports are bookkeeping: orphaned only when they are the last
// augur marker left in the file.

import type { InjectManifest } from './manifest.ts';
import { findMarkers } from './markers.ts';
import { scanSource } from './scan.ts';
import type { InjectionPoint } from './types.ts';

export function checkSource(relPath: string, text: string, manifest: InjectManifest): InjectionPoint[] {
  const candidates = scanSource(relPath, text, manifest);
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
    state: c.applied ? 'applied' : 'pending',
  }));

  const ruleMarkers = markers.filter((m) => m.rule !== 'import');
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
    if (m.rule !== 'import') continue;
    if (ruleMarkers.length === 0) {
      points.push({
        rule: 'import',
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

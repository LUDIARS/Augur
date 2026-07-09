import { describe, expect, it } from 'vitest';
import { computeApply } from '../../../src/inject/apply.ts';
import { checkSource } from '../../../src/inject/check.ts';
import { parseManifest } from '../../../src/inject/manifest.ts';

const manifest = parseManifest({ service: 'fixture' });

describe('checkSource', () => {
  it('reports pending on pristine code and applied after apply', () => {
    const text = 'try { a(); } catch {}\n';
    expect(checkSource('a.ts', text, manifest)).toMatchObject([{ rule: 'silent-catch', state: 'pending' }]);

    const applied = computeApply('a.ts', text, manifest).text;
    const states = checkSource('a.ts', applied, manifest).map((p) => p.state);
    expect(states).toEqual(['applied']);
  });

  it('reports orphaned when a marker outlives its anchor', () => {
    // A stray marker with no fragment: the anchor was refactored away.
    const text = "const x = 1; /* augur-inject:spawn-watch:deadbeef */\n";
    const points = checkSource('a.ts', text, manifest);
    expect(points).toMatchObject([{ rule: 'spawn-watch', id: 'deadbeef', state: 'orphaned' }]);
  });

  it('reports the managed import as orphaned once no fragments remain', () => {
    const text = "import { weaverLog } from '@ludiars/log-weaver'; /* augur-inject:import:0a0a0a0a */\nconst x = 1;\n";
    const points = checkSource('a.ts', text, manifest);
    expect(points).toMatchObject([{ rule: 'import', state: 'orphaned' }]);
  });

  it('keeps the import unflagged while fragments remain', () => {
    const applied = computeApply('a.ts', 'try { a(); } catch {}\n', manifest).text;
    const points = checkSource('a.ts', applied, manifest);
    expect(points.filter((p) => p.rule === 'import')).toHaveLength(0);
  });
});

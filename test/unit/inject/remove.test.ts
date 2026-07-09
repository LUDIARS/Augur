import { describe, expect, it } from 'vitest';
import { computeApply } from '../../../src/inject/apply.ts';
import { parseManifest } from '../../../src/inject/manifest.ts';
import { computeRemove } from '../../../src/inject/remove.ts';

const manifest = parseManifest({ service: 'fixture' });

describe('computeRemove', () => {
  it('round-trips apply → remove back to the exact original', () => {
    const original = [
      "import { spawn } from 'node:child_process';",
      '',
      'export function launch() {',
      "  const child = spawn('wt.exe', ['-w']);",
      '  return child;',
      '}',
      '',
      'export function flush() {',
      '  try { work(); } catch {}',
      '}',
      '',
      'setInterval(async () => { await tick(); }, 5000);',
      "bus.on('task', async (t) => { await handle(t); });",
      '',
    ].join('\n');

    const applied = computeApply('src/all.ts', original, manifest);
    expect(applied.changed).toBe(true);
    const removed = computeRemove('src/all.ts', applied.text);
    expect(removed.changed).toBe(true);
    expect(removed.text).toBe(original);
  });

  it('round-trips an empty catch with newline formatting', () => {
    const original = 'try {\n  a();\n} catch {\n}\n';
    const applied = computeApply('a.ts', original, manifest);
    expect(computeRemove('a.ts', applied.text).text).toBe(original);
  });

  it('round-trips the entry-runtime import (shebang preserved)', () => {
    const entryManifest = parseManifest({
      service: 'fixture',
      runtime: { autoImport: true, entrypoints: ['bin/serve.ts'] },
    });
    const original = '#!/usr/bin/env node\nboot();\n';
    const applied = computeApply('bin/serve.ts', original, entryManifest);
    expect(computeRemove('bin/serve.ts', applied.text).text).toBe(original);
  });

  it('unwraps nested fragments (injected catch inside a guarded listener)', () => {
    const original = [
      "bus.on('task', async (t) => {",
      '  await prepare(t);',
      '  try { await handle(t); } catch {}',
      '});',
      '',
    ].join('\n');
    const applied = computeApply('a.ts', original, manifest);
    // Both listener-guard (outer wrap) and silent-catch (inner) were injected.
    expect(applied.injected.map((c) => c.rule).sort()).toEqual(['listener-guard', 'silent-catch']);
    expect(computeRemove('a.ts', applied.text).text).toBe(original);
  });

  it('does nothing on marker-free text', () => {
    const result = computeRemove('a.ts', 'const x = 1;\n');
    expect(result.changed).toBe(false);
    expect(result.removed).toBe(0);
  });
});

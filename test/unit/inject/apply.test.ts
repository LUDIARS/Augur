import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { computeApply } from '../../../src/inject/apply.ts';
import { parseManifest } from '../../../src/inject/manifest.ts';
import { scanSource } from '../../../src/inject/scan.ts';

const manifest = parseManifest({ service: 'fixture' });

const FIXTURE = [
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

function parseClean(text: string): void {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics;
  expect(diagnostics).toHaveLength(0);
}

describe('computeApply', () => {
  it('injects all pending fragments and stays syntactically valid', () => {
    const result = computeApply('src/all.ts', FIXTURE, manifest);
    expect(result.changed).toBe(true);
    expect(result.injected.map((c) => c.rule).sort()).toEqual([
      'interval-guard',
      'listener-guard',
      'silent-catch',
      'spawn-watch',
    ]);
    parseClean(result.text);

    expect(result.text).toContain("watchChild(child, { where: 'src/all.ts:4'");
    expect(result.text).toContain("weaverLog('warn', 'swallowed error'");
    expect(result.text).toContain('setInterval(guardAsync(async () => { await tick(); }');
    expect(result.text).toContain("bus.on('task', guardAsync(async (t) => { await handle(t); }");
    // One managed import with exactly the three needed symbols.
    expect(result.text).toContain(
      "import { guardAsync, watchChild, weaverLog } from '@ludiars/log-weaver'; /* augur-inject:import:",
    );
  });

  it('is idempotent: a second apply changes nothing', () => {
    const once = computeApply('src/all.ts', FIXTURE, manifest);
    const twice = computeApply('src/all.ts', once.text, manifest);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  it('after apply, every point scans as applied', () => {
    const { text } = computeApply('src/all.ts', FIXTURE, manifest);
    const points = scanSource('src/all.ts', text, manifest);
    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(points.every((p) => p.applied)).toBe(true);
  });

  it('imports only the symbols the fragments need', () => {
    const result = computeApply('a.ts', 'try { a(); } catch {}\n', manifest);
    expect(result.text).toContain("import { weaverLog } from '@ludiars/log-weaver';");
    expect(result.text).not.toContain('guardAsync');
  });

  it('respects symbols the host already imports', () => {
    const text = "import { weaverLog } from '@ludiars/log-weaver';\ntry { a(); } catch {}\n";
    const result = computeApply('a.ts', text, manifest);
    expect(result.text.match(/from '@ludiars\/log-weaver'/g)).toHaveLength(1);
  });

  it('extends the managed import when later rules need more symbols', () => {
    const first = computeApply('a.ts', 'try { a(); } catch {}\nsetInterval(async () => { await b(); }, 9);\n', manifest, ['silent-catch']);
    expect(first.text).toContain('import { weaverLog }');
    const second = computeApply('a.ts', first.text, manifest, ['interval-guard']);
    expect(second.text).toContain('import { guardAsync, weaverLog }');
    expect(second.text.match(/augur-inject:import:/g)).toHaveLength(1);
    parseClean(second.text);
  });

  it('inserts the entry-runtime import after a shebang', () => {
    const entryManifest = parseManifest({
      service: 'fixture',
      runtime: { autoImport: true, entrypoints: ['bin/serve.ts'] },
    });
    const result = computeApply('bin/serve.ts', '#!/usr/bin/env node\nboot();\n', entryManifest);
    expect(result.text.startsWith("#!/usr/bin/env node\nimport '@ludiars/log-weaver/auto'; /* augur-inject:entry-runtime:")).toBe(true);
  });

  it('leaves a file without candidates untouched', () => {
    const text = 'export const x = 1;\n';
    const result = computeApply('a.ts', text, manifest);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });
});

import { describe, expect, it } from 'vitest';
import { parseManifest } from '../../../src/inject/manifest.ts';
import { scanSource } from '../../../src/inject/scan.ts';

const manifest = parseManifest({ service: 'fixture' });

describe('silent-catch', () => {
  it('detects a bare empty catch', () => {
    const text = [
      'export function flushQueue() {',
      '  try { work(); } catch {}',
      '}',
      '',
    ].join('\n');
    const points = scanSource('src/db/repo.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      rule: 'silent-catch',
      applied: false,
      line: 2,
      anchor: 'catch in flushQueue',
    });
    expect(points[0]?.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('skips a catch that carries a comment (human decision)', () => {
    const text = 'try { a(); } catch { /* never throw from logging */ }\n';
    expect(scanSource('a.ts', text, manifest)).toHaveLength(0);
  });

  it('skips a catch with real handling', () => {
    const text = 'try { a(); } catch (e) { console.error(e); }\n';
    expect(scanSource('a.ts', text, manifest)).toHaveLength(0);
  });

  it('recognizes an injected fragment as applied', () => {
    const text =
      "try { a(); } catch { weaverLog('warn', 'swallowed error', { where: 'a.ts:1' }); /* augur-inject:silent-catch:0123abcd */ }\n";
    const points = scanSource('a.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ rule: 'silent-catch', applied: true, id: '0123abcd' });
  });
});

describe('spawn-watch', () => {
  it('detects an unwatched spawn assignment', () => {
    const text = [
      "import { spawn } from 'node:child_process';",
      'export function launch() {',
      "  const child = spawn('wt.exe', ['-w']);",
      '  return child;',
      '}',
      '',
    ].join('\n');
    const points = scanSource('src/run.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      rule: 'spawn-watch',
      applied: false,
      line: 3,
      varName: 'child',
      anchor: 'child ← spawn() in launch',
    });
  });

  it('skips a spawn whose scope attaches an error listener', () => {
    const text = [
      "const child = spawn('x');",
      "child.on('error', (e) => log(e));",
      '',
    ].join('\n');
    // The error listener is sync, so no listener-guard either: nothing at all.
    expect(scanSource('a.ts', text, manifest)).toHaveLength(0);
  });

  it('treats a watchChild call in scope as applied', () => {
    const text = [
      "const child = spawn('x');",
      "watchChild(child, { where: 'a.ts:1' }); /* augur-inject:spawn-watch:deadbeef */",
      '',
    ].join('\n');
    const points = scanSource('a.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ rule: 'spawn-watch', applied: true, id: 'deadbeef' });
  });

  it('also detects execFile via property access', () => {
    const text = "const proc = cp.execFile('git', ['status']);\n";
    expect(scanSource('a.ts', text, manifest)[0]).toMatchObject({ rule: 'spawn-watch', varName: 'proc' });
  });
});

describe('interval-guard', () => {
  it('detects an unguarded async interval body', () => {
    const text = 'setInterval(async () => { await tick(); }, 5000);\n';
    const points = scanSource('src/loop.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ rule: 'interval-guard', applied: false });
    expect(points[0]?.wrapStart).toBeGreaterThan(0);
  });

  it('skips a sync callback and a fully try/catch-wrapped body', () => {
    const sync = 'setInterval(() => tick(), 5000);\n';
    const wrapped = 'setInterval(async () => { try { await tick(); } catch (e) { log(e); } }, 5000);\n';
    expect(scanSource('a.ts', sync, manifest)).toHaveLength(0);
    expect(scanSource('a.ts', wrapped, manifest)).toHaveLength(0);
  });

  it('recognizes a guardAsync wrap as applied', () => {
    const text =
      "setInterval(guardAsync(async () => { await tick(); }, { where: 'a.ts:1' }) /* augur-inject:interval-guard:cafe0123 */, 5000);\n";
    const points = scanSource('a.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ rule: 'interval-guard', applied: true, id: 'cafe0123' });
  });
});

describe('listener-guard', () => {
  it('detects an async listener registered with .on', () => {
    const text = "bus.on('task-created', async (task) => { await handle(task); });\n";
    const points = scanSource('src/bus.ts', text, manifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      rule: 'listener-guard',
      applied: false,
      anchor: "bus.on('task-created') in <top>",
    });
  });

  it('ignores non-string first args and sync listeners', () => {
    expect(scanSource('a.ts', 'bus.on(EVENT, async () => {});\n', manifest)).toHaveLength(0);
    expect(scanSource('a.ts', "bus.on('x', (v) => handle(v));\n", manifest)).toHaveLength(0);
  });
});

describe('entry-runtime', () => {
  const entryManifest = parseManifest({
    service: 'fixture',
    runtime: { autoImport: true, entrypoints: ['src/server.ts'] },
  });

  it('proposes the auto import for a declared entrypoint', () => {
    const points = scanSource('src/server.ts', "import { boot } from './boot.ts';\nboot();\n", entryManifest);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ rule: 'entry-runtime', applied: false, insertPos: 0 });
  });

  it('skips entrypoints that install their own safety net', () => {
    const text = "process.on('unhandledRejection', (e) => log(e));\n";
    expect(scanSource('src/server.ts', text, entryManifest)).toHaveLength(0);
  });

  it('inserts after a shebang and does nothing for non-entrypoints', () => {
    const points = scanSource('src/server.ts', '#!/usr/bin/env node\nboot();\n', entryManifest);
    expect(points[0]?.insertPos).toBe('#!/usr/bin/env node\n'.length);
    expect(scanSource('src/other.ts', 'boot();\n', entryManifest)).toHaveLength(0);
  });
});

describe('determinism and rule toggles', () => {
  it('same input produces identical ids', () => {
    const text = 'try { a(); } catch {}\nsetInterval(async () => { await b(); }, 1000);\n';
    const first = scanSource('a.ts', text, manifest);
    const second = scanSource('a.ts', text, manifest);
    expect(first).toEqual(second);
  });

  it('a disabled rule stops detecting', () => {
    const off = parseManifest({ service: 'fixture', rules: { 'silent-catch': false } });
    expect(scanSource('a.ts', 'try { a(); } catch {}\n', off)).toHaveLength(0);
  });
});

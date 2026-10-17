import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCatalogFragment, readRepoServices, resolveServiceBaseUrl } from '../../../src/tests/latency/service-catalog.ts';

const FRAGMENT = [
  '# comment',
  'services:',
  '  - code: foo',
  '    name: Foo # trailing comment',
  '    port: 4210',
  '    health:',
  '      type: http',
  '      port: 9999',
  '  - code: "bar"',
  '    command: node worker.js',
  '',
].join('\n');

function root(fragments: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'augur-catalog-'));
  for (const [child, text] of Object.entries(fragments)) {
    mkdirSync(join(dir, child));
    writeFileSync(join(dir, child, 'excubitor.catalog.yaml'), text, 'utf8');
  }
  return dir;
}

describe('parseCatalogFragment', () => {
  it('reads code and port of each service item, ignoring nested keys', () => {
    expect(parseCatalogFragment(FRAGMENT)).toEqual([{ code: 'foo', port: 4210 }, { code: 'bar' }]);
  });
});

describe('resolveServiceBaseUrl', () => {
  it('resolves a loopback base URL from the fragment that declares the code', () => {
    const dir = root({ Elegantia: 'services:\n  - code: elegantia\n    port: 17860\n', Foo: FRAGMENT });
    expect(resolveServiceBaseUrl('elegantia', dir)).toEqual({ baseUrl: 'http://127.0.0.1:17860', code: 'elegantia' });
    expect(readRepoServices(join(dir, 'Foo'))).toEqual([{ code: 'foo', port: 4210 }, { code: 'bar' }]);
  });

  it('fails closed when a code is declared twice, missing, or has no port', () => {
    const dir = root({ A: 'services:\n  - code: dup\n    port: 1\n', B: 'services:\n  - code: dup\n    port: 2\n', C: FRAGMENT });
    expect(resolveServiceBaseUrl('dup', dir)).toMatchObject({ error: expect.stringContaining('declared by 2 fragments') });
    expect(resolveServiceBaseUrl('elegantia', dir)).toMatchObject({ error: expect.stringContaining('declares service code "elegantia"') });
    expect(resolveServiceBaseUrl('bar', dir)).toMatchObject({ error: expect.stringContaining('declares no port') });
  });
});

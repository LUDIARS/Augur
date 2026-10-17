import { describe, expect, it } from 'vitest';
import { httpRoutesFrom, selectProbes } from '../../../src/tests/latency/routes.ts';

function entry(name: string, path: string, line = 1, reasons?: string[]) {
  return {
    id: `anchor-${name}`,
    classes: ['http-route'],
    symbol: { anchor: `anchor-${name}`, name, path, line },
    ...(reasons === undefined ? {} : { reasons }),
  };
}

describe('httpRoutesFrom', () => {
  it('recovers verb and path from Anatomia reasons, then from the handler source', () => {
    const sources: Record<string, string> = {
      'src/routes.ts': [
        "app.get('/v1/health', health);",
        'app.post("/v1/items", createItem);',
        'router.get(`/v1/items/:id`, getItem)',
        '',
      ].join('\n'),
    };
    const routes = httpRoutesFrom({
      entries: [
        entry('listItems', 'src/list.ts', 3, ['GET /v1/items → listItems() in src/list.ts']),
        entry('health', 'src/routes.ts', 1),
        entry('createItem', 'src/routes.ts', 2),
        entry('getItem', 'src/routes.ts', 3),
        entry('orphan', 'src/orphan.ts', 9),
        { ...entry('main', 'src/main.ts'), classes: ['process'] },
      ],
    }, (file) => sources[file]);
    expect(routes.map((route) => [route.symbol, route.method, route.path])).toEqual([
      ['listItems', 'GET', '/v1/items'],
      ['orphan', undefined, undefined],
      ['health', 'GET', '/v1/health'],
      ['createItem', 'POST', '/v1/items'],
      ['getItem', 'GET', '/v1/items/:id'],
    ]);
  });

  it('derives Next app-router and pages-api paths from the file', () => {
    const routes = httpRoutesFrom({
      entries: [entry('GET', 'app/(shop)/api/products/route.ts'), entry('handler', 'pages/api/status/index.ts')],
    }, () => undefined);
    expect(routes.map((route) => [route.method, route.path])).toEqual([
      ['GET', '/api/products'],
      ['ALL', '/api/status'],
    ]);
  });
});

describe('selectProbes', () => {
  it('measures argument-free GET routes and records why the rest are skipped', () => {
    const base = { anchor: 'a', file: 'src/routes.ts', line: 1 };
    const selection = selectProbes([
      { ...base, symbol: 'health', method: 'GET', path: '/v1/health' },
      { ...base, symbol: 'dup', method: 'GET', path: '/v1/health' },
      { ...base, symbol: 'create', method: 'POST', path: '/v1/items' },
      { ...base, symbol: 'one', method: 'GET', path: '/v1/items/:id' },
      { ...base, symbol: 'orphan' },
    ]);
    expect(selection.probes.map((probe) => probe.symbol)).toEqual(['health']);
    expect(selection.skipped.map((skip) => [skip.route.symbol, skip.reason])).toEqual([
      ['create', 'POST route; only GET routes are measured'],
      ['one', 'path /v1/items/:id takes arguments'],
      ['orphan', 'route method/path could not be recovered for orphan (src/routes.ts:1)'],
    ]);
  });
});

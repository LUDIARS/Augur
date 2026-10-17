import { describe, expect, it } from 'vitest';
import { fetchAntipatterns, type FetchLike } from '../../../src/tests/latency/elegantia.ts';

function respond(status: number, body: unknown): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe('fetchAntipatterns', () => {
  const base = { baseUrl: 'http://127.0.0.1:17860', code: 'elegantia' };

  it('returns items sorted by id on success', async () => {
    const result = await fetchAntipatterns(base, respond(200, {
      items: [{ id: 'AP02', augur: null }, { id: 'AP01', augur: { metric: 'api_latency', threshold: 1000, unit: 'ms' } }],
    }));
    expect(result).toMatchObject({ status: 'ok', items: [{ id: 'AP01' }, { id: 'AP02' }] });
  });

  it('states why it planned without Elegantia', async () => {
    expect(await fetchAntipatterns({ error: 'no fragment' })).toEqual({ status: 'unresolved', detail: 'no fragment' });
    expect(await fetchAntipatterns(base, async () => { throw new Error('ECONNREFUSED'); }))
      .toMatchObject({ status: 'unreachable', detail: expect.stringContaining('ECONNREFUSED') });
    expect(await fetchAntipatterns(base, respond(503, {}))).toMatchObject({ status: 'unreachable', detail: expect.stringContaining('HTTP 503') });
    expect(await fetchAntipatterns(base, respond(200, { items: [{ title: 'no id' }] }))).toMatchObject({ status: 'invalid' });
  });
});

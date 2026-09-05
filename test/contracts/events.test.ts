import { describe, expect, it } from 'vitest';
import { normalizeContractEvent, normalizeContractEvents } from '../../src/contracts/events.ts';

const line = (value: unknown): string => JSON.stringify(value);

describe('normalizeContractEvents', () => {
  it('accepts only the three contract messages', () => {
    const scan = normalizeContractEvents([
      line({ level: 'debug', msg: 'contract observed', ctx: { contract: 'C-1', phase: 'ok', id: 'm1', observed_at: '2026-09-05T00:00:00.000Z' } }),
      line({ level: 'error', msg: 'contract violated', ctx: { contract: 'C-1', phase: 'post', reason: 'shrank', id: 'm1', observed_at: '2026-09-05T00:00:01.000Z' } }),
      line({ level: 'warn', msg: 'contract predicate threw', ctx: { contract: 'C-1', phase: 'predicate', id: 'm1', observed_at: '2026-09-05T00:00:02.000Z' } }),
      line({ level: 'info', msg: 'request handled', ctx: { route: '/x' } }),
      line({ level: 'debug', msg: 'aspect enter', ctx: { id: 'm1' } }),
      'not json at all',
      '',
    ]);
    expect(scan.events.map((event) => event.kind)).toEqual(['observed', 'violated', 'predicate-threw']);
    expect(scan.ignored).toBe(4);
    expect(scan.unparsableTime).toBe(0);
  });

  it('falls back from ctx.observed_at to the line time, then to ts', () => {
    const fromTime = normalizeContractEvent(line({
      msg: 'contract observed',
      time: '2026-09-05T01:00:00.000Z',
      ctx: { contract: 'C-1', id: 'm1' },
    }));
    const fromTs = normalizeContractEvent(line({
      msg: 'contract observed',
      ts: Date.parse('2026-09-05T02:00:00.000Z'),
      ctx: { contract: 'C-1', id: 'm1' },
    }));
    expect(fromTime?.observedAt).toBe('2026-09-05T01:00:00.000Z');
    expect(fromTs?.observedAt).toBe('2026-09-05T02:00:00.000Z');
  });

  it('prefers ctx.observed_at over the writer timestamp', () => {
    const event = normalizeContractEvent(line({
      msg: 'contract observed',
      time: '2026-09-05T01:00:00.000Z',
      ctx: { contract: 'C-1', id: 'm1', observed_at: '2026-09-05T00:00:00.000Z' },
    }));
    expect(event?.observedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('counts an unreadable time as unparsable instead of dropping the event', () => {
    const scan = normalizeContractEvents([
      line({ msg: 'contract violated', ctx: { contract: 'C-1', id: 'm1', phase: 'pre', reason: 'bad kind', observed_at: 'yesterday' } }),
    ]);
    expect(scan.events).toHaveLength(1);
    expect(scan.events[0]?.observedAt).toBeUndefined();
    expect(scan.unparsableTime).toBe(1);
  });

  it('rejects timezone-less timestamps so windows stay machine-independent', () => {
    const event = normalizeContractEvent(line({
      msg: 'contract observed',
      ctx: { contract: 'C-1', id: 'm1', observed_at: '2026-09-05T00:00:00' },
    }));
    expect(event?.observedAt).toBeUndefined();
  });

  it('infers the phase a message implies when ctx.phase is missing or unknown', () => {
    const observed = normalizeContractEvent(line({ msg: 'contract observed', ctx: { contract: 'C-1', id: 'm1' } }));
    const violated = normalizeContractEvent(line({ msg: 'contract violated', ctx: { contract: 'C-1', id: 'm1', phase: 'nonsense' } }));
    const threw = normalizeContractEvent(line({ msg: 'contract predicate threw', ctx: { contract: 'C-1', id: 'm1' } }));
    expect([observed?.phase, violated?.phase, threw?.phase]).toEqual(['ok', 'post', 'predicate']);
  });

  it('ignores a contract event with no contract id', () => {
    expect(normalizeContractEvent(line({ msg: 'contract observed', ctx: { id: 'm1' } }))).toBeNull();
  });
});

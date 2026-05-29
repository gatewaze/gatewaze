import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the Supabase client: createClient returns a client whose from()
//    yields a chainable builder. The builder is thenable (so `await
//    .eq(...)` resolves) and exposes single()/maybeSingle() terminals. ────────
const fromMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}));

import { EventsStore, isLumaSyncStatus } from '../lib/events-store.js';

type Result = { data: unknown; error: unknown };

function builder(result: Result) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.maybeSingle = vi.fn(() => Promise.resolve(result));
  b.single = vi.fn(() => Promise.resolve(result));
  // Thenable so `await builder` (after a terminal .eq) resolves to `result`.
  b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return b;
}

function store() {
  return new EventsStore('http://supabase', 'service-key');
}

beforeEach(() => {
  fromMock.mockReset();
});

describe('isLumaSyncStatus', () => {
  it('accepts the four valid statuses', () => {
    for (const s of ['pending', 'syncing', 'synced', 'failed']) {
      expect(isLumaSyncStatus(s)).toBe(true);
    }
  });
  it('rejects anything else', () => {
    expect(isLumaSyncStatus('done')).toBe(false);
    expect(isLumaSyncStatus('')).toBe(false);
  });
});

describe('lumaSyncable (ownership gate + change detection)', () => {
  it('returns only sync-enabled events that need a push, deduped, with luma_calendar_id attached', async () => {
    const b = builder({
      data: [
        {
          luma_calendar_id: 'cal-1',
          calendars_events: [
            // never pushed → needs sync → INCLUDE
            { events: { id: 'e1', luma_event_id: 'lu1', luma_synced_at: null, updated_at: '2026-01-01T00:00:00Z' } },
            // no luma_event_id → not yet on Luma → EXCLUDE
            { events: { id: 'e2', luma_event_id: null, luma_synced_at: null, updated_at: null } },
            // synced after last update → unchanged → EXCLUDE
            { events: { id: 'e3', luma_event_id: 'lu3', luma_synced_at: '2026-02-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } },
            // updated after last sync → changed → INCLUDE
            { events: { id: 'e4', luma_event_id: 'lu4', luma_synced_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' } },
          ],
        },
        {
          luma_calendar_id: 'cal-2',
          // duplicate of e1 on a second calendar → DEDUPE (keep first)
          calendars_events: [
            { events: { id: 'e1', luma_event_id: 'lu1', luma_synced_at: null, updated_at: '2026-01-01T00:00:00Z' } },
          ],
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(b);

    const out = await store().lumaSyncable();

    expect(fromMock).toHaveBeenCalledWith('calendars');
    expect(b.eq).toHaveBeenCalledWith('luma_sync_enabled', true);
    expect(out.map((e) => e.id).sort()).toEqual(['e1', 'e4']);
    expect(out.find((e) => e.id === 'e1')?.luma_calendar_id).toBe('cal-1');
  });

  it('tolerates null/empty nesting', async () => {
    fromMock.mockReturnValue(builder({ data: null, error: null }));
    expect(await store().lumaSyncable()).toEqual([]);
  });

  it('throws when the query errors', async () => {
    fromMock.mockReturnValue(builder({ data: null, error: { message: 'boom' } }));
    await expect(store().lumaSyncable()).rejects.toThrow(/luma_syncable_failed: boom/);
  });
});

describe('get', () => {
  it('looks up by the id column for a UUID', async () => {
    const b = builder({ data: { id: 'x' }, error: null });
    fromMock.mockReturnValue(b);
    const res = await store().get('123e4567-e89b-12d3-a456-426614174000');
    expect(fromMock).toHaveBeenCalledWith('events');
    expect(b.eq).toHaveBeenCalledWith('id', '123e4567-e89b-12d3-a456-426614174000');
    expect(res).toEqual({ id: 'x' });
  });

  it('looks up by the event_id slug for a non-UUID', async () => {
    const b = builder({ data: null, error: null });
    fromMock.mockReturnValue(b);
    await store().get('my-event-slug');
    expect(b.eq).toHaveBeenCalledWith('event_id', 'my-event-slug');
  });

  it('throws on error', async () => {
    fromMock.mockReturnValue(builder({ data: null, error: { message: 'nope' } }));
    await expect(store().get('abc')).rejects.toThrow(/events_get_failed: nope/);
  });
});

describe('setLumaSync (writes only luma_sync_* columns)', () => {
  it('stamps luma_synced_at and clears the error on synced', async () => {
    const b = builder({ data: { id: 'e1', luma_sync_status: 'synced' }, error: null });
    fromMock.mockReturnValue(b);
    await store().setLumaSync('e1', 'synced', 'hash123');
    const patch = b.update.mock.calls[0][0];
    expect(patch.luma_sync_status).toBe('synced');
    expect(typeof patch.luma_synced_at).toBe('string');
    expect(patch.luma_pushed_hash).toBe('hash123');
    expect(patch.luma_sync_error).toBeNull();
    expect(b.eq).toHaveBeenCalledWith('id', 'e1');
  });

  it('records the error and does not stamp synced_at on failed', async () => {
    const b = builder({ data: { id: 'e1', luma_sync_status: 'failed' }, error: null });
    fromMock.mockReturnValue(b);
    await store().setLumaSync('e1', 'failed', undefined, 'luma rejected the request');
    const patch = b.update.mock.calls[0][0];
    expect(patch.luma_sync_status).toBe('failed');
    expect(patch.luma_synced_at).toBeUndefined();
    expect(patch.luma_sync_error).toBe('luma rejected the request');
  });

  it('throws on error', async () => {
    fromMock.mockReturnValue(builder({ data: null, error: { message: 'denied' } }));
    await expect(store().setLumaSync('e1', 'pending')).rejects.toThrow(/events_set_luma_sync_failed: denied/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
  getRequestSupabase: () => mockSupabase.client,
  // Anon client used by portal-events. The same chainable mock works
  // because the routes only consume the query-builder surface — they
  // don't introspect which client they got back.
  getAnonSupabase: () => mockSupabase.client,
  resolveSupabaseUrl: () => 'http://supabase.local',
  resolveAnonKey: () => 'anon-key',
  resolveServiceRoleKey: () => 'service-role-key',
}));

const { default: app } = await import('../../server.js');

describe('Portal Events API (public reads)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/portal/events', () => {
    it('returns paginated upcoming events by default', async () => {
      const events = [{ event_id: 'e1', event_title: 'Test Event' }];
      mockSupabase.mockResult(events, null, 1);

      const res = await request(app).get('/api/portal/events');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(events);
      expect(res.body.total).toBe(1);
      expect(res.body.limit).toBe(100);
      expect(res.body.offset).toBe(0);
    });

    it('rejects invalid direction', async () => {
      const res = await request(app).get('/api/portal/events?direction=sideways');
      expect(res.status).toBe(400);
    });

    it('clamps oversized limit to PAGE_SIZE (1000)', async () => {
      mockSupabase.mockResult([], null, 0);
      const res = await request(app).get('/api/portal/events?limit=99999');
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(1000);
    });

    it('emits Cache-Control + Cache-Tag headers for CDN', async () => {
      mockSupabase.mockResult([], null, 0);
      const res = await request(app).get('/api/portal/events?direction=past');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('s-maxage=300');
      expect(res.headers['cache-tag']).toContain('events:list');
      expect(res.headers['cache-tag']).toContain('events:list:past');
      // Defence-in-depth against multi-brand cache poisoning.
      expect(res.headers['vary']).toContain('Host');
    });
  });

  describe('GET /api/portal/events/:identifier', () => {
    it('returns the event by slug', async () => {
      const event = { id: 'uuid-1', event_id: 'EVT-1', event_title: 'My Event', event_slug: 'my-event-evt-1' };
      mockSupabase.mockResult(event);

      const res = await request(app).get('/api/portal/events/my-event-evt-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(event);
      expect(res.headers['cache-tag']).toContain('event:EVT-1');
    });

    it('returns 404 with brief cache when event missing', async () => {
      mockSupabase.mockResultsSequence([
        { data: null, error: null }, // event_slug lookup miss
        { data: null, error: null }, // event_id lookup miss
        { data: null, error: null }, // extracted-id lookup miss
      ]);

      const res = await request(app).get('/api/portal/events/missing-event-zzz');

      expect(res.status).toBe(404);
      // Short cache so a hot mistyped URL doesn't hammer the DB.
      expect(res.headers['cache-control']).toContain('s-maxage=60');
    });

    it('retries with stable fields when nearby_hotels column is missing', async () => {
      const stableEvent = { id: 'u1', event_id: 'E1', event_title: 'X' };
      mockSupabase.mockResultsSequence([
        // First fetch: nearby_hotels column doesn't exist on this brand.
        { data: null, error: { code: '42703', message: 'column events.nearby_hotels does not exist' } },
        // Retry with stable fields succeeds.
        { data: stableEvent, error: null },
      ]);

      const res = await request(app).get('/api/portal/events/some-event');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(stableEvent);
    });
  });

  describe('GET /api/portal/events/:identifier/counts', () => {
    it('returns aggregated counts and falls back to placeholder speakers when no confirmed', async () => {
      // Sequence:
      //   1. fetchEventByIdentifier (slug lookup)
      //   2-4. (slug-by-id and extracted-id lookups skipped because slug found)
      //   5. confirmed speakers count (0)
      //   6. placeholder speakers count (3)
      //   7. sponsors (2)
      //   8. competitions (1)
      //   9. discounts (0)
      //  10. media (5)
      //  11. live_event_config (1 → hasVirtualEvent: true)
      mockSupabase.mockResultsSequence([
        { data: { id: 'u1', event_id: 'E1' }, error: null },
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 3 },
        { data: null, error: null, count: 2 },
        { data: null, error: null, count: 1 },
        { data: null, error: null, count: 0 },
        { data: null, error: null, count: 5 },
        { data: null, error: null, count: 1 },
      ]);

      const res = await request(app).get('/api/portal/events/E1/counts');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        eventId: 'E1',
        eventUuid: 'u1',
        speakerCount: 3, // fell back to placeholder since confirmed = 0
        sponsorCount: 2,
        competitionCount: 1,
        discountCount: 0,
        mediaCount: 5,
        hasVirtualEvent: true,
      });
    });
  });

  describe('cache headers — defence in depth', () => {
    it('Vary includes Authorization so CDN never serves an authed response to anon', async () => {
      mockSupabase.mockResult([], null, 0);
      const res = await request(app).get('/api/portal/events');
      // The CDN spec strips cache hits when Authorization is present;
      // Vary backs that up so any naïve intermediary still partitions.
      expect(res.headers['vary']).toContain('Authorization');
    });
  });
});

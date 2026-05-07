import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
  getRequestSupabase: () => mockSupabase.client,
}));

const { default: app } = await import('../../server.js');

const CAL_ID = '11111111-2222-3333-4444-555555555555';
const BLAST_ID = '99999999-aaaa-bbbb-cccc-dddddddddddd';

describe('Calendar Blasts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.mockResult(null);
    mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: null });
  });

  // -------------------------------------------------------------------------
  // POST /api/calendars/:id/audience/preview
  // -------------------------------------------------------------------------

  describe('POST /api/calendars/:id/audience/preview', () => {
    it('returns count + masked sample + filter_hash', async () => {
      mockSupabase.mockResult([
        { member_id: 'm1', person_id: 'p1', email: 'jane@example.com', phone: null, membership_type: 'member' },
        { member_id: 'm2', person_id: 'p2', email: 'bob@example.com', phone: null, membership_type: 'vip' },
      ]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({ channel: 'email', filter: { membership_types: ['member', 'vip'] } });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.sample).toHaveLength(2);
      expect(res.body.sample[0].email_masked).toBe('j***e@example.com');
      expect(res.body.filter_hash).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('resolve_calendar_audience', {
        p_calendar_id: CAL_ID,
        p_filter: { membership_types: ['member', 'vip'] },
        p_channel: 'email',
      });
    });

    it('defaults channel to email when omitted', async () => {
      mockSupabase.mockResult([]);
      await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({ filter: {} });

      expect(mockSupabase.client.rpc).toHaveBeenCalledWith(
        'resolve_calendar_audience',
        expect.objectContaining({ p_channel: 'email' })
      );
    });

    it('rejects an invalid channel with 400 validation_failed', async () => {
      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({ channel: 'pigeon', filter: {} });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    });

    it('rejects malformed event_participation with 400', async () => {
      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({
          channel: 'email',
          filter: { event_participation: [{ mode: 'wat', kind: 'attended' }] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error.details.field).toBe('filter.event_participation[0].mode');
    });

    it('maps Postgres permission denied (42501) to 403 forbidden', async () => {
      mockSupabase.mockResult(null, { code: '42501', message: 'permission denied' });

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({ channel: 'email', filter: {} });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('produces stable filter_hash regardless of object key order', async () => {
      mockSupabase.mockResult([]);
      const a = await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({ channel: 'email', filter: { membership_types: ['member'], membership_status: ['active'] } });
      mockSupabase.mockResult([]);
      const b = await request(app)
        .post(`/api/calendars/${CAL_ID}/audience/preview`)
        .send({ channel: 'email', filter: { membership_status: ['active'], membership_types: ['member'] } });

      expect(a.body.filter_hash).toBe(b.body.filter_hash);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/calendars/:id/blasts
  // -------------------------------------------------------------------------

  describe('POST /api/calendars/:id/blasts', () => {
    it('rejects when subject is missing for email', async () => {
      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({ channel: 'email', body_template: 'hi', audience_filter: {} });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error.details.missing_fields).toContain('subject');
    });

    it('rejects when audience resolves to zero (422 validation_failed)', async () => {
      mockSupabase.mockResultsSequence([
        { data: [] }, // resolve_calendar_audience returns 0 rows
      ]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({
          channel: 'email',
          subject: 'hi',
          body_template: 'body',
          audience_filter: {},
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error.details.recipient_count).toBe(0);
    });

    it('creates a draft and queues email-batch-send for send-now email', async () => {
      mockSupabase.mockResultsSequence([
        // 1. resolve_calendar_audience
        { data: [{ member_id: 'm1', person_id: 'p1', email: 'a@b.co', phone: null, membership_type: 'member' }] },
        // 2. insert calendars_blasts → returns the row
        { data: { id: BLAST_ID, calendar_id: CAL_ID, channel: 'email', subject: 'hi', body_template: 'body' } },
        // 3. insert email_batch_jobs → returns id
        { data: { id: 'job-123' } },
        // 4. update calendars_blasts.email_batch_job_id (await chain)
        { data: null },
      ]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({
          channel: 'email',
          subject: 'hi',
          body_template: 'body',
          audience_filter: {},
        });

      expect(res.status).toBe(201);
      expect(res.body.blast_id).toBe(BLAST_ID);
      expect(res.body.status).toBe('sending');
      expect(res.body.recipient_count).toBe(1);
      expect(res.body.email_batch_job_id).toBe('job-123');
      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('email-batch-send', {
        body: { jobId: 'job-123' },
      });
    });

    it('schedules an email blast when schedule.send_at is in the future', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      mockSupabase.mockResultsSequence([
        { data: [{ member_id: 'm1', person_id: 'p1', email: 'a@b.co', phone: null, membership_type: 'member' }] },
        { data: { id: BLAST_ID, calendar_id: CAL_ID, channel: 'email', subject: 'hi', body_template: 'body' } },
      ]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({
          channel: 'email',
          subject: 'hi',
          body_template: 'body',
          audience_filter: {},
          schedule: { send_at: future },
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('scheduled');
      // Scheduled blasts MUST NOT invoke email-batch-send synchronously —
      // the cron picks them up.
      expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('rejects above the 100k recipient cap', async () => {
      const huge = Array.from({ length: 100_001 }, (_, i) => ({
        member_id: `m${i}`,
        person_id: `p${i}`,
        email: `u${i}@x.co`,
        phone: null,
        membership_type: 'member',
      }));
      mockSupabase.mockResultsSequence([{ data: huge }]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({
          channel: 'email',
          subject: 'hi',
          body_template: 'body',
          audience_filter: {},
        });

      expect(res.status).toBe(422);
      expect(res.body.error.details.cap).toBe(100_000);
    });

    it('treats SMS send-now as scheduled (cron picks up)', async () => {
      mockSupabase.mockResultsSequence([
        { data: [{ member_id: 'm1', person_id: 'p1', email: null, phone: '+15551234567', membership_type: 'member' }] },
        { data: { id: BLAST_ID, calendar_id: CAL_ID, channel: 'sms', subject: null, body_template: 'sms body' } },
      ]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({ channel: 'sms', body_template: 'sms body', audience_filter: {} });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('scheduled');
      // No email-batch-send invocation for SMS.
      expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('rate-limits send to 1/min (handled by rate-limiter when Redis present)', async () => {
      // Without Redis configured in tests the rate-limiter fails open
      // (PERMISSIVE mode logged on first use) — the spec rate is enforced
      // when Redis is wired up; the test asserts the route still functions
      // in the dev fallback rather than testing the limiter itself, which
      // has its own coverage in lib/__tests__/rate-limiter.test.ts.
      mockSupabase.mockResultsSequence([
        { data: [{ member_id: 'm1', person_id: 'p1', email: 'a@b.co', phone: null, membership_type: 'member' }] },
        { data: { id: BLAST_ID, calendar_id: CAL_ID, channel: 'email', subject: 'hi', body_template: 'body' } },
        { data: { id: 'job-1' } },
        { data: null },
      ]);

      const res = await request(app)
        .post(`/api/calendars/${CAL_ID}/blasts`)
        .send({ channel: 'email', subject: 'hi', body_template: 'body', audience_filter: {} });

      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/calendars/:id/blasts
  // -------------------------------------------------------------------------

  describe('GET /api/calendars/:id/blasts', () => {
    it('returns paginated history', async () => {
      const blasts = [
        { id: BLAST_ID, channel: 'email', status: 'sent', recipient_count: 10 },
      ];
      mockSupabase.mockResult(blasts, null, 1);

      const res = await request(app).get(`/api/calendars/${CAL_ID}/blasts`);

      expect(res.status).toBe(200);
      expect(res.body.blasts).toEqual(blasts);
      expect(res.body.total).toBe(1);
      expect(res.body.limit).toBe(50);
    });

    it('caps limit at 200', async () => {
      mockSupabase.mockResult([], null, 0);
      await request(app).get(`/api/calendars/${CAL_ID}/blasts?limit=999`);
      expect(mockSupabase.client.range).toHaveBeenCalledWith(0, 199);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/calendars/:id/blasts/:blastId
  // -------------------------------------------------------------------------

  describe('GET /api/calendars/:id/blasts/:blastId', () => {
    it('returns blast + email_send_log recipients', async () => {
      const blast = {
        id: BLAST_ID,
        calendar_id: CAL_ID,
        channel: 'email',
        email_batch_job_id: 'job-123',
      };
      const recipients = [
        { id: 'r1', recipient_email: 'a@b.co', status: 'delivered', sent_at: '2026-05-06T10:00:00Z', failure_error: null, created_at: '2026-05-06T10:00:00Z' },
      ];
      mockSupabase.mockResultsSequence([
        { data: blast },
        { data: recipients },
      ]);

      const res = await request(app).get(`/api/calendars/${CAL_ID}/blasts/${BLAST_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.blast).toEqual(blast);
      expect(res.body.recipients).toEqual(recipients);
    });

    it('returns 404 when blast does not exist', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app).get(`/api/calendars/${CAL_ID}/blasts/${BLAST_ID}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('returns empty recipients for SMS/WhatsApp blasts', async () => {
      mockSupabase.mockResultsSequence([
        { data: { id: BLAST_ID, calendar_id: CAL_ID, channel: 'sms', email_batch_job_id: null } },
      ]);

      const res = await request(app).get(`/api/calendars/${CAL_ID}/blasts/${BLAST_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.recipients).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/calendars/:id/blasts/:blastId/cancel
  // -------------------------------------------------------------------------

  describe('POST /api/calendars/:id/blasts/:blastId/cancel', () => {
    it('cancels a draft blast', async () => {
      mockSupabase.mockResult({ id: BLAST_ID, status: 'cancelled' });

      const res = await request(app).post(`/api/calendars/${CAL_ID}/blasts/${BLAST_ID}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
      // Verify CAS guard against non-cancellable states.
      expect(mockSupabase.client.in).toHaveBeenCalledWith('status', ['draft', 'scheduled', 'sending']);
    });

    it('returns 409 conflict when the blast is not in a cancellable state', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app).post(`/api/calendars/${CAL_ID}/blasts/${BLAST_ID}/cancel`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('conflict');
    });
  });
});

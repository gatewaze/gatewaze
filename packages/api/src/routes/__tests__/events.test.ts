import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
}));

// Import app after mocking
const { default: app } = await import('../../server.js');

describe('Events API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/events', () => {
    it('returns paginated events', async () => {
      const events = [
        { id: '1', event_title: 'Test Event', status: 'published' },
      ];
      mockSupabase.mockResult(events, null, 1);

      const res = await request(app).get('/api/events');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(events);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(25);
    });

    it('respects page and limit params', async () => {
      mockSupabase.mockResult([], null, 0);

      const res = await request(app).get('/api/events?page=2&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(10);
      expect(mockSupabase.client.range).toHaveBeenCalledWith(10, 19);
    });

    it('caps limit at 100', async () => {
      mockSupabase.mockResult([], null, 0);

      const res = await request(app).get('/api/events?limit=500');

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });

    it('searches by title', async () => {
      mockSupabase.mockResult([], null, 0);

      await request(app).get('/api/events?search=conference');

      expect(mockSupabase.client.ilike).toHaveBeenCalledWith(
        'event_title',
        '%conference%'
      );
    });

    it('returns 500 on database error', async () => {
      mockSupabase.mockError('Database error');

      const res = await request(app).get('/api/events');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch events');
    });
  });

  describe('GET /api/events/:id', () => {
    it('returns a single event', async () => {
      const event = { id: '1', event_title: 'Test Event' };
      mockSupabase.mockResult(event);

      const res = await request(app).get('/api/events/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(event);
    });

    it('returns 500 on database error', async () => {
      mockSupabase.mockError('Not found');

      const res = await request(app).get('/api/events/999');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/events', () => {
    it('creates an event', async () => {
      const newEvent = { id: '1', event_title: 'New Event', event_id: 'abc123' };
      mockSupabase.mockResult(newEvent);

      const res = await request(app)
        .post('/api/events')
        .send({ event_title: 'New Event', event_id: 'abc123' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newEvent);
    });

    it('returns 500 on database error', async () => {
      mockSupabase.mockError('Insert failed');

      const res = await request(app)
        .post('/api/events')
        .send({ event_title: 'Bad Event' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to create event');
    });
  });

  describe('PATCH /api/events/:id', () => {
    it('updates an event', async () => {
      const updated = { id: '1', event_title: 'Updated Event' };
      mockSupabase.mockResult(updated);

      const res = await request(app)
        .patch('/api/events/1')
        .send({ event_title: 'Updated Event' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
    });
  });

  describe('DELETE /api/events/:id', () => {
    it('deletes an event', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app).delete('/api/events/1');

      expect(res.status).toBe(204);
    });
  });
});

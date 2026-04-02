import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
}));

const { default: app } = await import('../../server.js');

describe('Registrations API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/registrations', () => {
    it('returns paginated registrations', async () => {
      const registrations = [{ id: '1', event_id: 'evt-1', status: 'confirmed' }];
      mockSupabase.mockResult(registrations, null, 1);

      const res = await request(app).get('/api/registrations');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(registrations);
      expect(res.body.total).toBe(1);
    });

    it('filters by event_id', async () => {
      mockSupabase.mockResult([], null, 0);

      await request(app).get('/api/registrations?event_id=evt-1');

      expect(mockSupabase.client.eq).toHaveBeenCalledWith('event_id', 'evt-1');
    });

    it('filters by status', async () => {
      mockSupabase.mockResult([], null, 0);

      await request(app).get('/api/registrations?status=confirmed');

      expect(mockSupabase.client.eq).toHaveBeenCalledWith('status', 'confirmed');
    });
  });

  describe('GET /api/registrations/:id', () => {
    it('returns a single registration', async () => {
      const reg = { id: '1', event_id: 'evt-1' };
      mockSupabase.mockResult(reg);

      const res = await request(app).get('/api/registrations/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(reg);
    });
  });

  describe('POST /api/registrations', () => {
    it('creates a registration', async () => {
      const reg = { id: '1', event_id: 'evt-1', customer_id: 'cust-1' };
      mockSupabase.mockResult(reg);

      const res = await request(app)
        .post('/api/registrations')
        .send({ event_id: 'evt-1', customer_id: 'cust-1' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(reg);
    });
  });

  describe('PATCH /api/registrations/:id', () => {
    it('updates a registration', async () => {
      const updated = { id: '1', status: 'attended' };
      mockSupabase.mockResult(updated);

      const res = await request(app)
        .patch('/api/registrations/1')
        .send({ status: 'attended' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
    });
  });

  describe('DELETE /api/registrations/:id', () => {
    it('deletes a registration', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app).delete('/api/registrations/1');

      expect(res.status).toBe(204);
    });
  });
});

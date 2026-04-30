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

describe('People API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/people', () => {
    it('returns paginated people', async () => {
      const people = [{ id: '1', first_name: 'Jane', last_name: 'Doe' }];
      mockSupabase.mockResult(people, null, 1);

      const res = await request(app).get('/api/people');

      expect(res.status).toBe(200);
      // Each row is enriched with HATEOAS _links.self; assert the
      // domain fields and the link separately rather than deep-equal
      // on the augmented shape.
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject(people[0]);
      expect(res.body.data[0]._links?.self?.href).toBe('/api/people/1');
      expect(res.body.total).toBe(1);
    });

    it('searches across name, email, and company', async () => {
      mockSupabase.mockResult([], null, 0);

      await request(app).get('/api/people?search=jane');

      expect(mockSupabase.client.or).toHaveBeenCalledWith(
        expect.stringContaining('jane')
      );
    });

    it('strips PostgREST filter metacharacters from search', async () => {
      mockSupabase.mockResult([], null, 0);

      // Comma + paren + asterisk + backslash all need to be stripped
      // before interpolating into .or() — otherwise the request can
      // inject extra disjunction clauses (e.g. 'jane,id.gt.0' would
      // become a top-level OR clause that returns every row).
      await request(app).get(
        '/api/people?search=' + encodeURIComponent('jane,id.gt.0(*\\)')
      );

      const orArg = mockSupabase.client.or.mock.calls[0]?.[0] as string;
      expect(orArg).toBeDefined();
      // Sanitised value is 'janeid.gt.0' — note: the surrounding
      // .or(...) string legitimately contains commas as filter
      // separators, so we look for the injection signature inside
      // the ilike %...% patterns rather than against the whole string.
      expect(orArg).toContain('%janeid.gt.0%');
      expect(orArg).not.toContain('%jane,');
      expect(orArg).not.toContain('(*');
      expect(orArg).not.toContain('\\)');
    });

    it('filters by status', async () => {
      mockSupabase.mockResult([], null, 0);

      await request(app).get('/api/people?status=active');

      expect(mockSupabase.client.eq).toHaveBeenCalledWith('status', 'active');
    });
  });

  describe('GET /api/people/:id', () => {
    it('returns a single person', async () => {
      const person = { id: '1', first_name: 'Jane' };
      mockSupabase.mockResult(person);

      const res = await request(app).get('/api/people/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(person);
    });
  });

  describe('POST /api/people', () => {
    it('creates a person', async () => {
      const person = { id: '1', first_name: 'Jane', email: 'jane@example.com' };
      mockSupabase.mockResult(person);

      const res = await request(app)
        .post('/api/people')
        .send({ first_name: 'Jane', email: 'jane@example.com' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(person);
    });
  });

  describe('PATCH /api/people/:id', () => {
    it('updates a person', async () => {
      const updated = { id: '1', first_name: 'Janet' };
      mockSupabase.mockResult(updated);

      const res = await request(app)
        .patch('/api/people/1')
        .send({ first_name: 'Janet' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
    });
  });

  describe('DELETE /api/people/:id', () => {
    it('deletes a person', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app).delete('/api/people/1');

      expect(res.status).toBe(204);
    });
  });
});

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

const validLayout = {
  version: 1,
  sidebar: [{ id: 'content', title: 'Content', items: [{ key: 'inbox' }] }],
  settings: [{ key: 'admin.users' }],
  hidden: [],
  defaultRoute: 'inbox',
};

describe('Admin nav-layout API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.mockResult(null);
  });

  describe('GET /api/admin/nav-layout/org', () => {
    it('returns the parsed org layout', async () => {
      mockSupabase.mockResult({ value: JSON.stringify(validLayout) });

      const res = await request(app).get('/api/admin/nav-layout/org');

      expect(res.status).toBe(200);
      expect(res.body.layout.sidebar[0].title).toBe('Content');
      expect(res.body.layout.defaultRoute).toBe('inbox');
    });

    it('returns null when no org layout is set', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app).get('/api/admin/nav-layout/org');

      expect(res.status).toBe(200);
      expect(res.body.layout).toBeNull();
    });
  });

  describe('PUT /api/admin/nav-layout/org', () => {
    it('saves the layout for a super_admin', async () => {
      // First query: role lookup → super_admin. Second: the upsert.
      mockSupabase.mockResultsSequence([
        { data: { role: 'super_admin' } },
        { data: null },
      ]);

      const res = await request(app)
        .put('/api/admin/nav-layout/org')
        .send({ layout: validLayout });

      expect(res.status).toBe(200);
      expect(res.body.layout.sidebar[0].items[0].key).toBe('inbox');
    });

    it('rejects a non-super_admin with 403', async () => {
      mockSupabase.mockResult({ role: 'admin' });

      const res = await request(app)
        .put('/api/admin/nav-layout/org')
        .send({ layout: validLayout });

      expect(res.status).toBe(403);
    });

    it('rejects a malformed layout with 400', async () => {
      mockSupabase.mockResultsSequence([{ data: { role: 'super_admin' } }]);

      const res = await request(app)
        .put('/api/admin/nav-layout/org')
        .send({ layout: { version: 1, sidebar: 'not-an-array' } });

      expect(res.status).toBe(400);
    });

    it('resets the org layout when given a null payload', async () => {
      mockSupabase.mockResultsSequence([
        { data: { role: 'super_admin' } },
        { data: null },
      ]);

      const res = await request(app)
        .put('/api/admin/nav-layout/org')
        .send({ layout: null });

      expect(res.status).toBe(200);
      expect(res.body.layout).toBeNull();
    });
  });

  describe('GET /api/admin/nav-layout/me', () => {
    it('returns the personal layout', async () => {
      mockSupabase.mockResult({ nav_layout: validLayout });

      const res = await request(app).get('/api/admin/nav-layout/me');

      expect(res.status).toBe(200);
      expect(res.body.layout.sidebar[0].items[0].key).toBe('inbox');
    });

    it('returns null when the user follows the org default', async () => {
      mockSupabase.mockResult({ nav_layout: null });

      const res = await request(app).get('/api/admin/nav-layout/me');

      expect(res.status).toBe(200);
      expect(res.body.layout).toBeNull();
    });
  });

  describe('PUT /api/admin/nav-layout/me', () => {
    it('saves the personal layout without any role gate', async () => {
      mockSupabase.mockResult(null);

      const res = await request(app)
        .put('/api/admin/nav-layout/me')
        .send({ layout: validLayout });

      expect(res.status).toBe(200);
      expect(res.body.layout.sidebar[0].title).toBe('Content');
    });

    it('rejects a malformed personal layout with 400', async () => {
      const res = await request(app)
        .put('/api/admin/nav-layout/me')
        .send({ layout: 'nope' });

      expect(res.status).toBe(400);
    });
  });
});

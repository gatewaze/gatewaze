import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();
vi.mock('../../lib/supabase.js', () => ({ getSupabase: () => mockSupabase.client }));

const { default: app } = await import('../../server.js');

/**
 * Proves requireJwt() is actually mounted on the JWT-labeled routers.
 *
 * The other route tests run with `GATEWAZE_TEST_DISABLE_AUTH=1` set in the
 * setup file — the middleware injects a fake user/account and lets them
 * exercise route logic without minting tokens. This file flips the bypass
 * off and asserts those same routes return 401 from the verification path.
 */
describe('JWT enforcement on admin routers', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GATEWAZE_TEST_DISABLE_AUTH;
    delete process.env.GATEWAZE_TEST_DISABLE_AUTH;
  });
  afterEach(() => {
    if (saved !== undefined) process.env.GATEWAZE_TEST_DISABLE_AUTH = saved;
  });

  // Only routers actually mounted in server.ts. events/registrations/
  // attendance have route files but no static mount — they ship via the
  // events module's apiRoutes callback, which is out of scope for this
  // session.
  const jwtPaths = [
    'GET  /api/people',
    'GET  /api/calendars',
    'GET  /api/jobs',
    'GET  /api/screenshots/health',
    'GET  /api/customerio/segments',
    'GET  /api/avatars/health',
    'GET  /api/redirects',
    'GET  /api/api-keys',
    'GET  /api/modules/bootstrap-check',
    'GET  /api/app-releases/latest',
  ];

  for (const spec of jwtPaths) {
    const [method, path] = spec.split(/\s+/);
    it(`${method} ${path} returns 401 when no JWT is present`, async () => {
      const res = await (request(app) as any)[method.toLowerCase()](path);
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('unauthenticated');
    });
  }

  // The module gate skips auth for /api/modules/<id>/internal/* (service-to-
  // service routes that authenticate themselves). It used to test the whole
  // originalUrl, so a query string containing "/internal/" skipped auth on
  // every module route.
  describe('module /internal/ skip is path-only', () => {
    it.each([
      '/api/modules/bootstrap-check?x=/internal/',
      '/api/modules/bootstrap-check?x=%2Finternal%2F',
      '/api/modules/bootstrap-check?a=1&b=/internal/x',
    ])('GET %s still returns 401', async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('unauthenticated');
    });

    it('does not skip when /internal/ is deeper than the module id', async () => {
      const res = await request(app).get('/api/modules/some-module/admin/internal/x');
      expect(res.status).toBe(401);
    });

    it('still skips the JWT gate for a genuine module internal path', async () => {
      // No module mounts this in tests, so it falls through to 404 — the
      // point is that the gate let it past instead of answering 401.
      const res = await request(app).get('/api/modules/some-module/internal/ping');
      expect(res.status).not.toBe(401);
    });
  });

  it('GET /api/health (public) does NOT require a JWT', async () => {
    const res = await request(app).get('/api/health');
    // It may be 'degraded' if Redis isn't configured in tests — what we
    // care about is that we got past auth (200, not 401).
    expect(res.status).toBe(200);
  });
});

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
  ];

  for (const spec of jwtPaths) {
    const [method, path] = spec.split(/\s+/);
    it(`${method} ${path} returns 401 when no JWT is present`, async () => {
      const res = await (request(app) as any)[method.toLowerCase()](path);
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('unauthenticated');
    });
  }

  it('GET /api/health (public) does NOT require a JWT', async () => {
    const res = await request(app).get('/api/health');
    // It may be 'degraded' if Redis isn't configured in tests — what we
    // care about is that we got past auth (200, not 401).
    expect(res.status).toBe(200);
  });
});

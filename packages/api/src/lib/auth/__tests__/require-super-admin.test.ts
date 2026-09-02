import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Cover for the super_admin gate on module management.
 *
 * /api/modules installs and enables code from configured sources, swaps the
 * live tree, runs migrations and rotates secrets. It was previously reachable
 * by any authenticated user, so these cases pin the shape of the gate: only an
 * active super_admin passes, and every other outcome fails closed.
 */

let profileRow: { role: string; is_active: boolean } | null = null;
let lookupError: { message: string } | null = null;
let lookupThrows = false;

vi.mock('../../supabase.js', () => ({
  getServiceSupabase: () => ({
    from(_table: string) {
      const builder = {
        select(_cols: string) { return builder; },
        eq(_col: string, _val: string) { return builder; },
        async maybeSingle() {
          if (lookupThrows) throw new Error('connection reset');
          return { data: profileRow, error: lookupError };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('../../logger.js', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
}));

let requireSuperAdmin: typeof import('../require-super-admin.js').requireSuperAdmin;

/** App whose only auth is the gate, with `userId` injected as requireJwt would. */
function makeApp(userId?: string) {
  const app = express();
  app.use((req, _res, next) => {
    if (userId) req.userId = userId;
    next();
  });
  app.use(requireSuperAdmin());
  app.post('/thing', (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('requireSuperAdmin', () => {
  const priorBypass = process.env.GATEWAZE_TEST_DISABLE_AUTH;

  beforeEach(async () => {
    // The api test setup sets the bypass globally; clear it so these cases
    // exercise the real path rather than the short-circuit.
    delete process.env.GATEWAZE_TEST_DISABLE_AUTH;
    profileRow = null;
    lookupError = null;
    lookupThrows = false;
    vi.resetModules();
    ({ requireSuperAdmin } = await import('../require-super-admin.js'));
  });

  afterEach(() => {
    if (priorBypass === undefined) delete process.env.GATEWAZE_TEST_DISABLE_AUTH;
    else process.env.GATEWAZE_TEST_DISABLE_AUTH = priorBypass;
  });

  it('allows an active super_admin', async () => {
    profileRow = { role: 'super_admin', is_active: true };
    const res = await request(makeApp('user-1')).post('/thing');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects an ordinary admin', async () => {
    profileRow = { role: 'admin', is_active: true };
    const res = await request(makeApp('user-1')).post('/thing');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('rejects an editor', async () => {
    profileRow = { role: 'editor', is_active: true };
    expect((await request(makeApp('user-1')).post('/thing')).status).toBe(403);
  });

  it('rejects an authenticated user with no admin profile', async () => {
    // The case that mattered: a signed-up portal member reaching module routes.
    profileRow = null;
    const res = await request(makeApp('portal-member')).post('/thing');
    expect(res.status).toBe(403);
  });

  it('rejects a deactivated super_admin', async () => {
    profileRow = { role: 'super_admin', is_active: false };
    expect((await request(makeApp('user-1')).post('/thing')).status).toBe(403);
  });

  it('rejects when no userId was established', async () => {
    // Route wired without requireJwt in front: fail closed rather than
    // treating an absent identity as permission.
    profileRow = { role: 'super_admin', is_active: true };
    const res = await request(makeApp(undefined)).post('/thing');
    expect(res.status).toBe(401);
  });

  it('fails closed when the role lookup errors', async () => {
    lookupError = { message: 'permission denied' };
    const res = await request(makeApp('user-1')).post('/thing');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('fails closed when the role lookup throws', async () => {
    lookupThrows = true;
    expect((await request(makeApp('user-1')).post('/thing')).status).toBe(500);
  });

  it('honours the test bypass so route tests need no admin_profiles row', async () => {
    process.env.GATEWAZE_TEST_DISABLE_AUTH = '1';
    vi.resetModules();
    ({ requireSuperAdmin } = await import('../require-super-admin.js'));
    profileRow = null;
    expect((await request(makeApp('user-1')).post('/thing')).status).toBe(200);
  });
});

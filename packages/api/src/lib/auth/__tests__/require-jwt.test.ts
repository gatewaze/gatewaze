import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
const TEST_SECRET = 'test-jwt-secret-do-not-use-in-prod-do-not-use-do-not-use';

vi.mock('../../supabase.js', () => ({
  getSupabase: () => makeFakeSupabase(),
}));

let memberRows: Array<{ user_id: string; account_id: string; created_at: string }> = [];
// tenancy_v2_enforced platform flag as seen by requireJwt in each test.
// Defaults ON so the account-membership enforcement (strict path) is exercised;
// a dedicated case flips it off to cover the legacy soft-fail. The strict path
// is what the pre-flag tests assumed — see 1dbd35a for why the flag exists.
let tenancyEnforced = true;

// Imported dynamically per-test (see beforeEach) so require-jwt's module-level
// 60 s tenancy-flag cache is reset between cases.
let requireJwt: typeof import('../require-jwt.js').requireJwt;

function makeFakeSupabase() {
  return {
    from(table: string) {
      const filter: Record<string, string> = {};
      const builder = {
        select(_cols: string) { return builder; },
        eq(col: string, val: string) { filter[col] = val; return builder; },
        order(_col: string, _opts: unknown) { return builder; },
        limit(_n: number) { return builder; },
        async maybeSingle() {
          // isTenancyV2Enforced() reads the flag from platform_settings.
          if (table === 'platform_settings') {
            return { data: { value: tenancyEnforced ? 'true' : 'false' }, error: null };
          }
          // resolveActiveAccount() resolves in two hops:
          //   admin_profiles (auth user_id -> admin_profiles.id), then
          //   accounts_users (admin_profile_id -> account_id).
          // memberRows is authored keyed by user_id for readability; the
          // mock maps user_id <-> a synthetic profile id to model the hop.
          if (table === 'admin_profiles') {
            const hasProfile = memberRows.some(r => r.user_id === filter.user_id);
            return { data: hasProfile ? { id: profileIdFor(filter.user_id) } : null, error: null };
          }
          if (table === 'accounts_users') {
            const userId = userIdForProfile(filter.admin_profile_id);
            const matches = memberRows
              .filter(r =>
                r.user_id === userId &&
                (!filter.account_id || r.account_id === filter.account_id))
              // require-jwt orders by created_at ascending, limit 1.
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            const row = matches[0];
            return {
              data: row ? { account_id: row.account_id, created_at: row.created_at } : null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
}

// The membership FK is admin_profile_id, not the raw auth user_id — the mock
// round-trips through this synthetic profile id to mirror the real schema.
const PROFILE_PREFIX = 'profile-of-';
function profileIdFor(userId: string) {
  return PROFILE_PREFIX + userId;
}
function userIdForProfile(profileId: string | undefined) {
  return profileId?.startsWith(PROFILE_PREFIX) ? profileId.slice(PROFILE_PREFIX.length) : undefined;
}

function buildApp() {
  const app = express();
  app.get('/private', requireJwt(), (req, res) => {
    res.json({ userId: req.userId, accountId: req.accountId });
  });
  return app;
}

let savedDisable: string | undefined;
beforeEach(async () => {
  // Reset the module registry so require-jwt's 60 s tenancy-flag cache
  // (cachedTenancyFlag) doesn't leak between tests, then re-import against
  // the freshly re-applied supabase mock.
  vi.resetModules();
  ({ requireJwt } = await import('../require-jwt.js'));
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  // Disable the test bypass so requireJwt() actually verifies tokens here.
  savedDisable = process.env.GATEWAZE_TEST_DISABLE_AUTH;
  delete process.env.GATEWAZE_TEST_DISABLE_AUTH;
  memberRows = [];
  tenancyEnforced = true;
});

afterEach(() => {
  delete process.env.SUPABASE_JWT_SECRET;
  if (savedDisable !== undefined) process.env.GATEWAZE_TEST_DISABLE_AUTH = savedDisable;
});

describe('requireJwt', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await request(buildApp()).get('/private');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects malformed bearer tokens', async () => {
    const res = await request(buildApp()).get('/private').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('rejects expired tokens', async () => {
    const token = jwt.sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 }, TEST_SECRET, {
      algorithm: 'HS256',
    });
    const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_expired');
  });

  it('rejects tokens missing sub claim', async () => {
    const token = jwt.sign({ email: 'x@y.z' }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('rejects users with no account membership', async () => {
    const token = jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('no_account');
  });

  it('soft-fails (no accountId, 200) for a membership-less user when tenancy_v2 is not enforced', async () => {
    // Legacy path (pre-tenancy_v2): a user with no account membership is
    // allowed through without an accountId. The 403 no_account above only
    // applies once tenancy_v2_enforced flips on. See 1dbd35a.
    tenancyEnforced = false;
    const token = jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-1');
    expect(res.body.accountId).toBeUndefined();
  });

  it('attaches userId and accountId on success (first-membership fallback)', async () => {
    const accountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    memberRows = [{ user_id: 'user-1', account_id: accountId, created_at: '2024-01-01' }];
    const token = jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'user-1', accountId });
  });

  it('honours X-Gatewaze-Account header when user is a member', async () => {
    const accountA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const accountB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    memberRows = [
      { user_id: 'user-1', account_id: accountA, created_at: '2024-01-01' },
      { user_id: 'user-1', account_id: accountB, created_at: '2024-02-01' },
    ];
    const token = jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp())
      .get('/private')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Gatewaze-Account', accountB);
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe(accountB);
  });

  it('rejects X-Gatewaze-Account when user is not a member', async () => {
    const accountA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const accountC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    memberRows = [{ user_id: 'user-1', account_id: accountA, created_at: '2024-01-01' }];
    const token = jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp())
      .get('/private')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Gatewaze-Account', accountC);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('honours active_account_id JWT claim when user is a member', async () => {
    const accountA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const accountB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    memberRows = [
      { user_id: 'user-1', account_id: accountA, created_at: '2024-01-01' },
      { user_id: 'user-1', account_id: accountB, created_at: '2024-02-01' },
    ];
    const token = jwt.sign({ sub: 'user-1', active_account_id: accountB }, TEST_SECRET, {
      algorithm: 'HS256',
    });
    const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe(accountB);
  });

  it('falls back to JWT_SECRET when SUPABASE_JWT_SECRET is unset (matches docker-compose env)', async () => {
    // Repro the local-dev / docker-compose case: only JWT_SECRET is set.
    delete process.env.SUPABASE_JWT_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
    try {
      memberRows = [{ user_id: 'user-1', account_id: '00000000-0000-0000-0000-000000000001', created_at: '2024-01-01' }];
      const token = jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256' });
      const res = await request(buildApp()).get('/private').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe('user-1');
    } finally {
      delete process.env.JWT_SECRET;
    }
  });
});

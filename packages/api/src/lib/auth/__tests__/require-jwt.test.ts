import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { requireJwt } from '../require-jwt.js';

const TEST_SECRET = 'test-jwt-secret-do-not-use-in-prod-do-not-use-do-not-use';

vi.mock('../../supabase.js', () => ({
  getSupabase: () => makeFakeSupabase(),
}));

let memberRows: Array<{ user_id: string; account_id: string; created_at: string }> = [];

function makeFakeSupabase() {
  return {
    from(_table: string) {
      const filter: Record<string, string> = {};
      const builder = {
        select(_cols: string) { return builder; },
        eq(col: string, val: string) { filter[col] = val; return builder; },
        order(_col: string, _opts: unknown) { return builder; },
        limit(_n: number) { return builder; },
        async maybeSingle() {
          const matches = memberRows.filter(r =>
            (!filter.user_id || r.user_id === filter.user_id) &&
            (!filter.account_id || r.account_id === filter.account_id),
          );
          return { data: matches[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

function buildApp() {
  const app = express();
  app.get('/private', requireJwt(), (req, res) => {
    res.json({ userId: req.userId, accountId: req.accountId });
  });
  return app;
}

let savedDisable: string | undefined;
beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  // Disable the test bypass so requireJwt() actually verifies tokens here.
  savedDisable = process.env.GATEWAZE_TEST_DISABLE_AUTH;
  delete process.env.GATEWAZE_TEST_DISABLE_AUTH;
  memberRows = [];
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
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  integrationEnabled,
  getContext,
  signUserJwt,
  createTestUser,
  createTestAccount,
  cleanupAccount,
} from './harness.js';
import { requireJwt } from '../../src/lib/auth/require-jwt.js';

const describeIfIntegration = integrationEnabled ? describe : describe.skip;

/**
 * End-to-end requireJwt() exercise against a real Supabase instance.
 * Covers the bootstrap path that resolves active account via the
 * service-role client *before* the user-scoped client is built.
 */
describeIfIntegration('requireJwt — real Supabase', () => {
  let ctx: ReturnType<typeof getContext>;
  let accountId: string;
  let alice: { userId: string; email: string };
  let savedDisable: string | undefined;

  const app = express();
  app.get('/whoami', requireJwt(), (req, res) => {
    res.json({ userId: req.userId, accountId: req.accountId });
  });

  beforeAll(async () => {
    ctx = getContext();
    accountId = await createTestAccount(ctx.service, 'Integration Auth Account');
    alice = await createTestUser(ctx.service, `alice-auth-${Date.now()}@test.dev`, accountId);
    // Disable bypass so requireJwt() actually verifies the JWT.
    savedDisable = process.env.GATEWAZE_TEST_DISABLE_AUTH;
    delete process.env.GATEWAZE_TEST_DISABLE_AUTH;
  });

  afterAll(async () => {
    if (savedDisable !== undefined) process.env.GATEWAZE_TEST_DISABLE_AUTH = savedDisable;
    await cleanupAccount(ctx.service, accountId);
  });

  it('rejects requests without an Authorization header', async () => {
    const res = await request(app).get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects expired tokens', async () => {
    const expired = signUserJwt(ctx.jwtSecret, alice.userId, {
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_expired');
  });

  it('attaches userId + accountId on a valid token', async () => {
    const token = signUserJwt(ctx.jwtSecret, alice.userId);
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(alice.userId);
    expect(res.body.accountId).toBe(accountId);
  });

  it('rejects X-Gatewaze-Account when user is not a member', async () => {
    const otherAccount = await createTestAccount(ctx.service, 'Foreign Account');
    try {
      const token = signUserJwt(ctx.jwtSecret, alice.userId);
      const res = await request(app)
        .get('/whoami')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Gatewaze-Account', otherAccount);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    } finally {
      await cleanupAccount(ctx.service, otherAccount);
    }
  });
});

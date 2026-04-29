import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  integrationEnabled,
  getContext,
  signUserJwt,
  createTestUser,
  createTestAccount,
  setFlag,
  cleanupAccount,
} from './harness.js';

const describeIfIntegration = integrationEnabled ? describe : describe.skip;

describeIfIntegration('tenancy_v2 RLS — multi-tenant isolation', () => {
  let ctx: ReturnType<typeof getContext>;
  let accountA: string;
  let accountB: string;
  let alice: { userId: string; email: string };
  let bob: { userId: string; email: string };

  beforeAll(async () => {
    ctx = getContext();
    accountA = await createTestAccount(ctx.service, 'Integration Test Account A');
    accountB = await createTestAccount(ctx.service, 'Integration Test Account B');
    alice = await createTestUser(ctx.service, `alice-${Date.now()}@a.test`, accountA);
    bob = await createTestUser(ctx.service, `bob-${Date.now()}@b.test`, accountB);
    // One person per account.
    await ctx.service.from('people').insert([
      { auth_user_id: alice.userId, email: alice.email, account_id: accountA },
      { auth_user_id: bob.userId, email: bob.email, account_id: accountB },
    ]);
    await setFlag(ctx.service, 'tenancy_v2_enforced', 'true');
  });

  afterAll(async () => {
    await setFlag(ctx.service, 'tenancy_v2_enforced', 'false');
    await cleanupAccount(ctx.service, accountA);
    await cleanupAccount(ctx.service, accountB);
  });

  it('alice (account A) cannot see bob (account B) under flag-on', async () => {
    const aliceClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, alice.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await aliceClient
      .from('people')
      .select('id, email, account_id')
      .eq('email', bob.email);
    expect(data ?? []).toEqual([]);
  });

  it('alice can see herself', async () => {
    const aliceClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, alice.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await aliceClient
      .from('people')
      .select('id, email')
      .eq('email', alice.email);
    expect(data?.length).toBe(1);
    expect(data?.[0]?.email).toBe(alice.email);
  });

  it('the GUC fast-path narrows scope to the supplied account', async () => {
    const aliceClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, alice.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Set GUC to account B (not a member). Helper bypasses ordinary
    // membership checks; the SELECT below should still be empty
    // because the row belongs to A.
    await aliceClient.rpc('set_app_account_id', { p_account_id: accountB });
    const { data } = await aliceClient
      .from('people')
      .select('id')
      .eq('email', alice.email);
    // GUC=B narrows to account B's rows; alice's row is in A.
    expect(data ?? []).toEqual([]);
  });
});

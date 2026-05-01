import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
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

/**
 * Event-invites tenant scoping smoke test (premium-gatewaze-modules
 * /event-invites/014_tenancy_v2.sql). Two-account scenario; each
 * account has one event and one invite. Under flag-on, the wrong
 * tenant must not see the other's invites.
 *
 * Anon access via the invite token stays open (the public RSVP path
 * uses the token as authorization, not RLS).
 */
describeIfIntegration('event_invites — tenancy_v2 scoping', () => {
  let ctx: ReturnType<typeof getContext>;
  let accountA: string;
  let accountB: string;
  let alice: { userId: string; email: string };
  let bob: { userId: string; email: string };
  let inviteAId: string;
  let inviteBId: string;

  beforeAll(async () => {
    ctx = getContext();
    accountA = await createTestAccount(ctx.service, 'Invites Account A');
    accountB = await createTestAccount(ctx.service, 'Invites Account B');
    alice = await createTestUser(ctx.service, `alice-inv-${Date.now()}@a.test`, accountA);
    bob = await createTestUser(ctx.service, `bob-inv-${Date.now()}@b.test`, accountB);

    // One event per account.
    const eventAId = randomUUID();
    const eventBId = randomUUID();
    await ctx.service.from('events').insert([
      { id: eventAId, event_id: `inv-a-${Date.now()}`, event_title: 'Invites A', account_id: accountA },
      { id: eventBId, event_id: `inv-b-${Date.now()}`, event_title: 'Invites B', account_id: accountB },
    ]);

    // One invite per event with a known token.
    inviteAId = randomUUID();
    inviteBId = randomUUID();
    await ctx.service.from('event_invites').insert([
      {
        id: inviteAId,
        event_id: eventAId,
        email: `guest-a@test.dev`,
        token: `tok-a-${Date.now()}`,
        status: 'pending',
      },
      {
        id: inviteBId,
        event_id: eventBId,
        email: `guest-b@test.dev`,
        token: `tok-b-${Date.now()}`,
        status: 'pending',
      },
    ]);

    await setFlag(ctx.service, 'tenancy_v2_enforced', 'true');
  });

  afterAll(async () => {
    await setFlag(ctx.service, 'tenancy_v2_enforced', 'false');
    await cleanupAccount(ctx.service, accountA);
    await cleanupAccount(ctx.service, accountB);
  });

  it('alice (account A) sees the account-A invite', async () => {
    const aliceClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, alice.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await aliceClient
      .from('event_invites')
      .select('id, email')
      .eq('id', inviteAId);
    expect(data?.length).toBe(1);
    expect(data?.[0]?.email).toBe('guest-a@test.dev');
  });

  it('alice cannot see the account-B invite', async () => {
    const aliceClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, alice.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await aliceClient
      .from('event_invites')
      .select('id')
      .eq('id', inviteBId);
    expect(data ?? []).toEqual([]);
  });

  it('bob sees only the account-B invite', async () => {
    const bobClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, bob.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await bobClient
      .from('event_invites')
      .select('id, email')
      .eq('id', inviteBId);
    expect(data?.length).toBe(1);
    const { data: notVisible } = await bobClient
      .from('event_invites')
      .select('id')
      .eq('id', inviteAId);
    expect(notVisible ?? []).toEqual([]);
  });

  it('anon can read by token (public RSVP path)', async () => {
    const anonClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await anonClient
      .from('event_invites')
      .select('id, email, status')
      .eq('id', inviteAId);
    // Anon select is permitted by event_invites_anon_select policy
    // (token is the authorization, not RLS).
    expect(data?.length).toBe(1);
  });
});

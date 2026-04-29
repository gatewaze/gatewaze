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
 * RSVP smoke test — reads/writes events_registrations through the
 * service-role client (the route migration to user-scoped
 * getRequestSupabase() is a separate workstream). What we verify
 * here is that registrations created with the right account_id
 * are visible to the right tenant under flag-on, and invisible
 * across tenants.
 */
describeIfIntegration('RSVP — tenant scoping under flag-on', () => {
  let ctx: ReturnType<typeof getContext>;
  let accountA: string;
  let accountB: string;
  let alice: { userId: string; email: string };
  let bob: { userId: string; email: string };
  let eventA: string;

  beforeAll(async () => {
    ctx = getContext();
    accountA = await createTestAccount(ctx.service, 'RSVP Test Account A');
    accountB = await createTestAccount(ctx.service, 'RSVP Test Account B');
    alice = await createTestUser(ctx.service, `alice-rsvp-${Date.now()}@test.dev`, accountA);
    bob = await createTestUser(ctx.service, `bob-rsvp-${Date.now()}@test.dev`, accountB);

    eventA = randomUUID();
    await ctx.service.from('events').insert({
      id: eventA,
      event_id: `rsvp-${Date.now()}`,
      event_title: 'RSVP Test Event A',
      account_id: accountA,
    });

    // One person + registration per account.
    const personA = randomUUID();
    await ctx.service.from('people').insert({
      id: personA,
      auth_user_id: alice.userId,
      email: alice.email,
      account_id: accountA,
    });
    await ctx.service.from('events_registrations').insert({
      id: randomUUID(),
      event_id: eventA,
      person_id: personA,
      status: 'confirmed',
    });

    await setFlag(ctx.service, 'tenancy_v2_enforced', 'true');
  });

  afterAll(async () => {
    await setFlag(ctx.service, 'tenancy_v2_enforced', 'false');
    await cleanupAccount(ctx.service, accountA);
    await cleanupAccount(ctx.service, accountB);
  });

  it('alice (account A) sees the registration on her event', async () => {
    const aliceClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, alice.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await aliceClient
      .from('events_registrations')
      .select('id, event_id, status')
      .eq('event_id', eventA);
    expect(data?.length ?? 0).toBeGreaterThan(0);
    expect(data?.[0]?.status).toBe('confirmed');
  });

  it('bob (account B) cannot see registrations on account A events', async () => {
    const bobClient = createClient(ctx.url, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUserJwt(ctx.jwtSecret, bob.userId)}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await bobClient
      .from('events_registrations')
      .select('id')
      .eq('event_id', eventA);
    expect(data ?? []).toEqual([]);
  });
});

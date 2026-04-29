#!/usr/bin/env tsx
/**
 * Seed Playwright E2E test data: two accounts, one admin per
 * account, two events (one per account), and two invite tokens
 * (open + full) for the RSVP capacity test.
 *
 * Idempotent — safe to re-run. Uses service-role to bypass RLS.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional env: E2E_ACCOUNT_A_EMAIL, E2E_ACCOUNT_A_PASSWORD,
 *               E2E_ACCOUNT_B_EMAIL, E2E_ACCOUNT_B_PASSWORD.
 */

import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const accountAId = '11111111-1111-1111-1111-111111111111';
  const accountBId = '22222222-2222-2222-2222-222222222222';
  const userAId    = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const userBId    = 'aaaaaaaa-2222-2222-2222-aaaaaaaaaaaa';
  const eventAId   = 'eeeeeeee-1111-1111-1111-eeeeeeeeeeee';
  const eventBId   = 'eeeeeeee-2222-2222-2222-eeeeeeeeeeee';

  console.log('Seeding accounts...');
  await supabase.from('accounts').upsert([
    { id: accountAId, name: 'E2E Account A' },
    { id: accountBId, name: 'E2E Account B' },
  ]);

  // Auth users via Supabase Admin API.
  console.log('Seeding auth users...');
  const adminAEmail = process.env.E2E_ACCOUNT_A_EMAIL ?? 'admin-a@localhost';
  const adminBEmail = process.env.E2E_ACCOUNT_B_EMAIL ?? 'admin-b@localhost';
  const adminAPassword = process.env.E2E_ACCOUNT_A_PASSWORD ?? 'admin-a-pw';
  const adminBPassword = process.env.E2E_ACCOUNT_B_PASSWORD ?? 'admin-b-pw';

  for (const u of [
    { id: userAId, email: adminAEmail, password: adminAPassword },
    { id: userBId, email: adminBEmail, password: adminBPassword },
  ]) {
    // createUser fails on duplicate; tolerate the conflict.
    const { error } = await supabase.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: u.password,
      email_confirm: true,
    });
    if (error && !/already.*registered/i.test(error.message)) {
      throw error;
    }
  }

  console.log('Seeding accounts_users + admin_profiles...');
  await supabase.from('accounts_users').upsert([
    { account_id: accountAId, user_id: userAId, role: 'owner' },
    { account_id: accountBId, user_id: userBId, role: 'owner' },
  ]);
  await supabase.from('admin_profiles').upsert([
    { user_id: userAId, email: adminAEmail, name: 'Admin A', role: 'admin', is_active: true },
    { user_id: userBId, email: adminBEmail, name: 'Admin B', role: 'admin', is_active: true },
  ]);

  console.log('Seeding events...');
  await supabase.from('events').upsert([
    { id: eventAId, event_id: 'e2e-aaa', event_title: 'Account A Event', account_id: accountAId },
    { id: eventBId, event_id: 'e2e-bbb', event_title: 'Account B Event', account_id: accountBId },
  ]);

  console.log('Done. Two accounts seeded for Playwright E2E.');
  console.log(`  account A: ${adminAEmail} / ${adminAPassword}`);
  console.log(`  account B: ${adminBEmail} / ${adminBPassword}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

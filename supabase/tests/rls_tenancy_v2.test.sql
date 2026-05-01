-- Test the tenancy_v2 RLS path on people: with the flag on, a member of
-- account A cannot see people rows scoped to account B, and vice versa.
-- A super-admin sees everything regardless.
--
-- This test only covers the helpers (account_in_scope, user_account_ids,
-- current_account_id, tenancy_v2_enforced) and the people_*_v2 policies
-- from 00024_tenancy_v2_helpers.sql. Tenant scoping on events,
-- events_registrations, and events_attendance is in the events module's
-- 010_tenancy_v2.sql migration and exercised by tests in
-- gatewaze-modules/modules/events/tests/.

BEGIN;

SELECT plan(8);

-- ==========================================================================
-- Setup: two accounts, two users (one per account), one super-admin.
-- ==========================================================================

INSERT INTO auth.users (id, email, role, aud, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice@a.example', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'bob@b.example',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'super@example',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO public.accounts (id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Account A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Account B');

INSERT INTO public.accounts_users (account_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'member'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'member');

INSERT INTO public.admin_profiles (id, user_id, email, name, role, is_active) VALUES
  ('99999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', 'super@example', 'Super', 'super_admin', true);

-- One person per account, plus an unscoped person (NULL account_id).
INSERT INTO public.people (id, auth_user_id, email, account_id, attributes) VALUES
  ('cccccccc-1111-1111-1111-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'alice@a.example', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb),
  ('cccccccc-2222-2222-2222-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'bob@b.example',   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '{}'::jsonb),
  ('cccccccc-0000-0000-0000-cccccccccccc', NULL,                                   'orphan@example',  NULL,                                  '{}'::jsonb);

-- Flip the flag on for this transaction.
UPDATE public.platform_settings SET value = 'true' WHERE key = 'tenancy_v2_enforced';

SELECT is(
  public.tenancy_v2_enforced(),
  true,
  'tenancy_v2_enforced flipped to true for this test'
);

-- ==========================================================================
-- Test 1: Alice (account A member) sees the A person, not the B person.
-- ==========================================================================
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"alice@a.example"}';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'cccccccc-1111-1111-1111-cccccccccccc'),
  1,
  'Alice sees the account-A person'
);

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'cccccccc-2222-2222-2222-cccccccccccc'),
  0,
  'Alice cannot see the account-B person'
);

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'cccccccc-0000-0000-0000-cccccccccccc'),
  0,
  'Alice cannot see the unscoped (NULL account_id) person'
);

-- ==========================================================================
-- Test 2: Bob (account B member) sees the B person, not the A person.
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","email":"bob@b.example"}';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'cccccccc-2222-2222-2222-cccccccccccc'),
  1,
  'Bob sees the account-B person'
);

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'cccccccc-1111-1111-1111-cccccccccccc'),
  0,
  'Bob cannot see the account-A person'
);

-- ==========================================================================
-- Test 3: Super-admin sees everything (including the orphan).
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"super@example"}';

SELECT is(
  (SELECT count(*)::int FROM public.people),
  3,
  'super-admin sees all people regardless of account_id'
);

-- ==========================================================================
-- Test 4: GUC fast-path narrows access to the GUC value.
-- Set app.account_id to A and confirm Alice no longer sees herself when
-- the GUC is account B (not a member). The GUC takes precedence over
-- the membership subquery.
-- Note: GUC-narrowing-to-a-non-member is a defensive case — the API
-- middleware would never set the GUC to an account the user isn't in,
-- because resolveActiveAccount() validates membership first.
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"alice@a.example"}';
SET LOCAL app.account_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'cccccccc-1111-1111-1111-cccccccccccc'),
  0,
  'Alice with GUC=B cannot see the account-A person (GUC takes precedence)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

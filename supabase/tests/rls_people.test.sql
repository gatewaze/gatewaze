-- Test RLS policies on the people (customers/members) table.
--
-- Repaired in spec-production-readiness-hardening Session 4: the prior
-- version referenced columns that don't exist on people (`user_id`,
-- `first_name`, `last_name`). Names live in `attributes` JSONB; the
-- user link is `auth_user_id`. Self-access uses email matching, not
-- user_id, per the legacy people_select_v1 policy.

BEGIN;

SELECT plan(5);

-- ==========================================================================
-- Setup: three users (alice, bob, admin) and matching people rows.
-- The people rows are inserted before SET ROLE, so they bypass RLS.
-- ==========================================================================

INSERT INTO auth.users (id, email, role, aud, instance_id) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', 'alice@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb2222-2222-2222-2222-222222222222', 'bob@example.com',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('cccc3333-3333-3333-3333-333333333333', 'admin@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO public.admin_profiles (id, user_id, email, name, role, is_active) VALUES
  ('dddd4444-4444-4444-4444-444444444444', 'cccc3333-3333-3333-3333-333333333333', 'admin@example.com', 'Admin User', 'admin', true);

INSERT INTO public.people (id, auth_user_id, email, attributes) VALUES
  ('eeee5555-5555-5555-5555-555555555555', 'aaaa1111-1111-1111-1111-111111111111', 'alice@example.com', '{"first_name":"Alice","last_name":"Smith"}'::jsonb),
  ('ffff6666-6666-6666-6666-666666666666', 'bbbb2222-2222-2222-2222-222222222222', 'bob@example.com',   '{"first_name":"Bob","last_name":"Jones"}'::jsonb);

-- ==========================================================================
-- Sanity: the v2 flag should be off by default (set by 00024 migration).
-- ==========================================================================
SELECT is(
  public.tenancy_v2_enforced(),
  false,
  'tenancy_v2_enforced is false by default'
);

-- ==========================================================================
-- Test 1: User A can see their own record (matched via email).
-- ==========================================================================
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"aaaa1111-1111-1111-1111-111111111111","role":"authenticated","email":"alice@example.com"}';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'eeee5555-5555-5555-5555-555555555555'),
  1,
  'user A sees their own people record (matched by email)'
);

-- ==========================================================================
-- Test 2: User A cannot see User B's record.
-- ==========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'ffff6666-6666-6666-6666-666666666666'),
  0,
  'user A cannot see user B''s people record'
);

-- ==========================================================================
-- Test 3 & 4: Admin can see all people records.
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"cccc3333-3333-3333-3333-333333333333","role":"authenticated","email":"admin@example.com"}';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'eeee5555-5555-5555-5555-555555555555'),
  1,
  'admin sees Alice''s people record'
);

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'ffff6666-6666-6666-6666-666666666666'),
  1,
  'admin sees Bob''s people record'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

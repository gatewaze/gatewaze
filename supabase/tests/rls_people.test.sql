-- Test RLS policies on the people (customers/members) table
BEGIN;

SELECT plan(4);

-- ==========================================================================
-- Setup
-- ==========================================================================

-- User A
INSERT INTO auth.users (id, email, role, aud, instance_id)
VALUES (
  'aaaa1111-1111-1111-1111-111111111111',
  'alice@example.com',
  'authenticated',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'
);

-- User B
INSERT INTO auth.users (id, email, role, aud, instance_id)
VALUES (
  'bbbb2222-2222-2222-2222-222222222222',
  'bob@example.com',
  'authenticated',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'
);

-- Admin user
INSERT INTO auth.users (id, email, role, aud, instance_id)
VALUES (
  'cccc3333-3333-3333-3333-333333333333',
  'admin@example.com',
  'authenticated',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'
);

INSERT INTO public.admin_profiles (id, user_id, email, name, role, is_active)
VALUES (
  'dddd4444-4444-4444-4444-444444444444',
  'cccc3333-3333-3333-3333-333333333333',
  'admin@example.com',
  'Admin User',
  'admin',
  true
);

-- Insert people records linked to user_id
INSERT INTO public.people (id, user_id, first_name, last_name, email)
VALUES
  ('eeee5555-5555-5555-5555-555555555555', 'aaaa1111-1111-1111-1111-111111111111', 'Alice', 'Smith', 'alice@example.com'),
  ('ffff6666-6666-6666-6666-666666666666', 'bbbb2222-2222-2222-2222-222222222222', 'Bob', 'Jones', 'bob@example.com');

-- ==========================================================================
-- Test 1: User A can see their own record
-- ==========================================================================
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "aaaa1111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'eeee5555-5555-5555-5555-555555555555'),
  1,
  'user can see their own people record'
);

-- ==========================================================================
-- Test 2: User A cannot see User B's record
-- ==========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'ffff6666-6666-6666-6666-666666666666'),
  0,
  'user cannot see another user''s people record'
);

-- ==========================================================================
-- Test 3: Admin can see all people records
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "cccc3333-3333-3333-3333-333333333333", "role": "authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'eeee5555-5555-5555-5555-555555555555'),
  1,
  'admin can see Alice''s people record'
);

SELECT is(
  (SELECT count(*)::int FROM public.people WHERE id = 'ffff6666-6666-6666-6666-666666666666'),
  1,
  'admin can see Bob''s people record'
);

-- ==========================================================================
-- Cleanup
-- ==========================================================================
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;

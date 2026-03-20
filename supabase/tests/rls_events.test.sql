-- Test RLS policies on the events table
BEGIN;

SELECT plan(6);

-- ==========================================================================
-- Setup: Insert test data using service_role (bypasses RLS)
-- ==========================================================================

-- Create a test user in auth.users
INSERT INTO auth.users (id, email, role, aud, instance_id)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'testuser@example.com',
  'authenticated',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'
);

-- Create an admin user in auth.users
INSERT INTO auth.users (id, email, role, aud, instance_id)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'admin@example.com',
  'authenticated',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'
);

-- Create admin profile for the admin user
INSERT INTO public.admin_profiles (id, user_id, email, name, role, is_active)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'admin@example.com',
  'Test Admin',
  'admin',
  true
);

-- Insert test events: one published, one draft
INSERT INTO public.events (id, event_id, event_title, status)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pub001', 'Published Event', 'published'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dft001', 'Draft Event', 'draft');

-- ==========================================================================
-- Test 1: anon can only see published events
-- ==========================================================================
SET ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'anon can see published events'
);

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'anon cannot see draft events'
);

-- ==========================================================================
-- Test 2: authenticated non-admin can only see published events
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
-- Simulate being the non-admin user
SET request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'authenticated non-admin can see published events'
);

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'authenticated non-admin cannot see draft events'
);

-- ==========================================================================
-- Test 3: admin can see all events (published and draft)
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'admin can see published events'
);

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'admin can see draft events'
);

-- ==========================================================================
-- Cleanup
-- ==========================================================================
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;

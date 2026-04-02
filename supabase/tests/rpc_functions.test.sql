-- Test RPC functions
BEGIN;

SELECT plan(5);

-- ==========================================================================
-- Setup
-- ==========================================================================

-- Admin user
INSERT INTO auth.users (id, email, role, aud, instance_id)
VALUES (
  'aa111111-1111-1111-1111-111111111111',
  'rpcadmin@example.com',
  'authenticated',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'
);

INSERT INTO public.admin_profiles (id, user_id, email, name, role, is_active)
VALUES (
  'bb222222-2222-2222-2222-222222222222',
  'aa111111-1111-1111-1111-111111111111',
  'rpcadmin@example.com',
  'RPC Admin',
  'admin',
  true
);

-- Create a permission group with features
INSERT INTO public.admin_permission_groups (id, name, features)
VALUES (
  'cc333333-3333-3333-3333-333333333333',
  'Event Managers',
  ARRAY['events', 'calendars', 'registrations']
);

-- Assign admin to the group
INSERT INTO public.admin_permission_group_assignments (id, admin_id, group_id)
VALUES (
  'dd444444-4444-4444-4444-444444444444',
  'bb222222-2222-2222-2222-222222222222',
  'cc333333-3333-3333-3333-333333333333'
);

-- Direct permission
INSERT INTO public.admin_permissions (id, admin_id, feature, is_active)
VALUES (
  'ee555555-5555-5555-5555-555555555555',
  'bb222222-2222-2222-2222-222222222222',
  'members',
  true
);

-- ==========================================================================
-- Test 1: admin_has_feature_permission — direct permission
-- ==========================================================================
SELECT is(
  public.admin_has_feature_permission('bb222222-2222-2222-2222-222222222222', 'members'),
  true,
  'admin has direct feature permission for members'
);

-- ==========================================================================
-- Test 2: admin_has_feature_permission — group permission
-- ==========================================================================
SELECT is(
  public.admin_has_feature_permission('bb222222-2222-2222-2222-222222222222', 'events'),
  true,
  'admin has group feature permission for events'
);

-- ==========================================================================
-- Test 3: admin_has_feature_permission — missing permission
-- ==========================================================================
SELECT is(
  public.admin_has_feature_permission('bb222222-2222-2222-2222-222222222222', 'billing'),
  false,
  'admin does not have permission for billing'
);

-- ==========================================================================
-- Test 4: admin_get_features — returns all features
-- ==========================================================================
SELECT ok(
  'members' = ANY(public.admin_get_features('bb222222-2222-2222-2222-222222222222'))
  AND 'events' = ANY(public.admin_get_features('bb222222-2222-2222-2222-222222222222'))
  AND 'calendars' = ANY(public.admin_get_features('bb222222-2222-2222-2222-222222222222'))
  AND 'registrations' = ANY(public.admin_get_features('bb222222-2222-2222-2222-222222222222')),
  'admin_get_features returns all direct + group features'
);

-- ==========================================================================
-- Test 5: events_get_registration_count
-- ==========================================================================

-- Create an event and some registrations
INSERT INTO public.events (id, event_id, event_title, status)
VALUES ('ff666666-6666-6666-6666-666666666666', 'rpcevt', 'RPC Test Event', 'published');

INSERT INTO public.events_registrations (id, event_id, status)
VALUES
  ('11aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ff666666-6666-6666-6666-666666666666', 'confirmed'),
  ('22bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ff666666-6666-6666-6666-666666666666', 'confirmed'),
  ('33cccccc-cccc-cccc-cccc-cccccccccccc', 'ff666666-6666-6666-6666-666666666666', 'cancelled');

SELECT is(
  public.events_get_registration_count('ff666666-6666-6666-6666-666666666666'),
  2::bigint,
  'events_get_registration_count excludes cancelled registrations'
);

-- ==========================================================================
-- Cleanup
-- ==========================================================================
SELECT * FROM finish();

ROLLBACK;

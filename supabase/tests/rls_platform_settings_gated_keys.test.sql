-- platform_settings keys that only a super_admin may write: the tracking
-- keys (00028) and the org navigation layout (00050). Other keys stay
-- writable by any admin.

BEGIN;

SELECT plan(7);

INSERT INTO auth.users (id, email, role, aud, instance_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'super@example', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO public.admin_profiles (user_id, email, role, is_active) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example', 'admin', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'super@example', 'super_admin', true);

-- An existing ordinary row an admin may edit.
INSERT INTO public.platform_settings (key, value) VALUES ('pgtap_plain_key', 'v0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ==========================================================================
-- As a plain admin.
-- ==========================================================================
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated","email":"admin@example"}';

SELECT throws_ok(
  $$INSERT INTO public.platform_settings (key, value) VALUES ('admin_nav_layout', '{"version":1,"sidebar":[],"settings":[],"hidden":[]}')$$,
  '42501',
  NULL,
  'admin cannot insert the org navigation layout'
);

SELECT throws_ok(
  $$INSERT INTO public.platform_settings (key, value) VALUES ('tracking_head', '<script></script>')$$,
  '42501',
  NULL,
  'admin still cannot insert a tracking key'
);

SELECT lives_ok(
  $$UPDATE public.platform_settings SET value = 'v1' WHERE key = 'pgtap_plain_key'$$,
  'admin can still update an ordinary key'
);

SELECT throws_ok(
  $$UPDATE public.platform_settings SET key = 'admin_nav_layout' WHERE key = 'pgtap_plain_key'$$,
  '42501',
  NULL,
  'admin cannot rename a row into the org navigation layout key'
);

-- ==========================================================================
-- As a super_admin.
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated","email":"super@example"}';

SELECT lives_ok(
  $$INSERT INTO public.platform_settings (key, value) VALUES ('admin_nav_layout', '{"version":1,"sidebar":[],"settings":[],"hidden":[]}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value$$,
  'super_admin can write the org navigation layout'
);

SELECT lives_ok(
  $$UPDATE public.platform_settings SET value = '{"version":1,"sidebar":[],"settings":[],"hidden":[],"defaultRoute":"inbox"}' WHERE key = 'admin_nav_layout'$$,
  'super_admin can update the org navigation layout'
);

-- ==========================================================================
-- Admin update of the gated row matches nothing (RLS hides it for writes).
-- ==========================================================================
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated","email":"admin@example"}';

UPDATE public.platform_settings SET value = 'tampered' WHERE key = 'admin_nav_layout';
RESET ROLE;

SELECT isnt(
  (SELECT value FROM public.platform_settings WHERE key = 'admin_nav_layout'),
  'tampered',
  'admin update of the org navigation layout changes nothing'
);

SELECT * FROM finish();
ROLLBACK;

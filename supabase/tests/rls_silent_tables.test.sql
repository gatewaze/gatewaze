-- Test the explicit deny-all + service-role-bypass policies on the
-- "silent deny" tables (integration_events, api_keys,
-- public_api_idempotency_keys) added by 00025_silent_table_policies.sql.
--
-- The contract: an authenticated user reading via PostgREST sees nothing
-- and cannot insert; service_role can do everything.

BEGIN;

SELECT plan(6);

-- ==========================================================================
-- Setup: a regular authenticated user.
-- ==========================================================================
INSERT INTO auth.users (id, email, role, aud, instance_id) VALUES
  ('11111111-2222-3333-4444-555555555555', 'user@example', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

-- Insert one row per silent table via service_role (the migration enabled
-- RLS but service_role bypasses).
INSERT INTO public.integration_events (id, event_type, payload)
VALUES ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'test.event', '{}'::jsonb);

INSERT INTO public.api_keys (id, name, key_hash, key_prefix, scopes, rate_limit_rpm, write_rate_limit_rpm)
VALUES ('aaaaaaaa-2222-2222-2222-aaaaaaaaaaaa', 'test-key', 'hash-test', 'gw_live_', ARRAY['read']::text[], 60, 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.public_api_idempotency_keys (api_key_id, idempotency_key, request_hash, response_status, response_body)
VALUES ('aaaaaaaa-2222-2222-2222-aaaaaaaaaaaa', 'idemp-test-1', 'hash-1', 200, '{"ok":true}'::jsonb)
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- As an authenticated user, all three tables should appear empty.
-- ==========================================================================
SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated","email":"user@example"}';

SELECT is(
  (SELECT count(*)::int FROM public.integration_events),
  0,
  'authenticated user sees 0 integration_events rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.api_keys),
  0,
  'authenticated user sees 0 api_keys rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.public_api_idempotency_keys),
  0,
  'authenticated user sees 0 public_api_idempotency_keys rows'
);

-- And inserts must be rejected (deny-all WITH CHECK).
SELECT throws_ok(
  $$INSERT INTO public.integration_events (event_type, payload) VALUES ('attacker.event', '{}'::jsonb)$$,
  NULL,
  NULL,
  'authenticated user cannot insert into integration_events'
);

-- ==========================================================================
-- Service-role bypass — should see everything.
-- ==========================================================================
RESET ROLE;
SET ROLE service_role;

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.integration_events),
  '>=',
  1,
  'service_role sees integration_events rows'
);

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.api_keys),
  '>=',
  1,
  'service_role sees api_keys rows'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

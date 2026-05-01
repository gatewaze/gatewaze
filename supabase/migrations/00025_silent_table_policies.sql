-- =============================================================================
-- 00025_silent_table_policies.sql
--
-- Closes spec PR-H-7 ("RLS enabled but zero policies — silent deny is
-- fragile"). The three tables below are intended to be service-role-only.
-- This migration:
--   * Enables RLS on integration_events (it had NONE — wide-open to any
--     authenticated user with PostgREST access).
--   * Adds explicit deny-all-for-authenticated + service-role-bypass
--     policies on integration_events, api_keys, and
--     public_api_idempotency_keys.
--
-- Service-role clients bypass RLS by default, so existing application
-- behaviour is preserved. The change here is making the deny *explicit*
-- — anyone with PostgREST access who isn't service-role gets a clear,
-- documented refusal rather than silent empty results.
-- =============================================================================

-- =============================================================================
-- integration_events
-- =============================================================================

ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_events_deny_authenticated"
  ON public.integration_events FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "integration_events_deny_anon"
  ON public.integration_events FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "integration_events_service_role"
  ON public.integration_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.integration_events IS
  'Outbox for integration events. Service-role only; deny-all for everyone else.';

-- =============================================================================
-- api_keys
-- =============================================================================

CREATE POLICY "api_keys_deny_authenticated"
  ON public.api_keys FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "api_keys_deny_anon"
  ON public.api_keys FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "api_keys_service_role"
  ON public.api_keys FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- public_api_idempotency_keys
-- =============================================================================

CREATE POLICY "public_api_idempotency_keys_deny_authenticated"
  ON public.public_api_idempotency_keys FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "public_api_idempotency_keys_deny_anon"
  ON public.public_api_idempotency_keys FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "public_api_idempotency_keys_service_role"
  ON public.public_api_idempotency_keys FOR ALL TO service_role
  USING (true) WITH CHECK (true);

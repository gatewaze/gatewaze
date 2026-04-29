-- =============================================================================
-- 00026_set_app_account_id.sql
--
-- Public wrapper RPC the API's user-scoped Supabase client calls at the
-- start of every request to set the `app.account_id` GUC. RLS policies
-- using `current_account_id()` then fast-path on this value.
--
-- Why a wrapper: pg_catalog.set_config() is not exposed by PostgREST
-- (only the public schema is). A SECURITY INVOKER wrapper limits the
-- callable to setting our specific GUC, with no side effects on other
-- session state.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_app_account_id(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- is_local = true → reverts at end of transaction. With Supabase's
  -- transaction-pooled connections this scopes the GUC to the request.
  PERFORM set_config('app.account_id', p_account_id::text, true);
END;
$$;

COMMENT ON FUNCTION public.set_app_account_id(uuid) IS
  'Sets the per-request app.account_id GUC. Called by getRequestSupabase().';

-- Allow authenticated users to call this — the caller can only set the
-- GUC on their own session, and RLS still enforces membership at query
-- time. anon and service_role implicitly inherit EXECUTE.
GRANT EXECUTE ON FUNCTION public.set_app_account_id(uuid) TO authenticated;

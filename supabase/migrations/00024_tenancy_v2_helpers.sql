-- =============================================================================
-- 00024_tenancy_v2_helpers.sql
--
-- Foundations for tenancy_v2 per spec-production-readiness-hardening §5.1
-- and §6.2. Adds:
--   * `account_id` columns on `people` and `email_logs` (NULL-allowed; the
--     phase-1 backfill script populates them before the flag flip).
--   * Helper SQL functions used by tenant-scoped RLS policies.
--   * The `tenancy_v2_enforced` global flag in `platform_settings`.
--   * A self-select policy on `accounts_users` so an authenticated user can
--     read their own membership rows (required by the helper functions
--     when invoked from a user-scoped Supabase client).
--   * Dual-track RLS on `people` and `email_logs`: the existing legacy
--     policies are replaced by gated versions that check the flag, plus
--     a tenancy_v2 path that scopes by `account_id`.
--
-- This migration is no-op for runtime behaviour while
-- `tenancy_v2_enforced = 'false'` (the default). The events module's
-- tenant policies (010_tenancy_v2.sql) and the API user-scoped client
-- (Session 5) are gated by the same flag.
-- =============================================================================

-- =============================================================================
-- STEP 1: account_id columns (NULL-allowed; populated by backfill)
-- =============================================================================

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_people_account_id ON public.people(account_id);

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_account_id ON public.email_logs(account_id);

-- =============================================================================
-- STEP 2: tenancy_v2_enforced global flag
-- =============================================================================

INSERT INTO public.platform_settings (key, value)
VALUES ('tenancy_v2_enforced', 'false')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.platform_settings.key IS
  'tenancy_v2_enforced=true activates account_id-scoped RLS; default false.';

-- =============================================================================
-- STEP 3: helper functions
-- =============================================================================

-- Returns the set of account_ids the current authenticated user belongs to.
-- Used by both the GUC fast-path policies and the subquery fallback.
-- SECURITY DEFINER so it bypasses RLS on accounts_users (the "can a user
-- see their own membership" question is one the function itself answers).
CREATE OR REPLACE FUNCTION public.user_account_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  -- accounts_users keys to admin_profiles (admin_profile_id), not directly
  -- to auth.users. admin_profiles.user_id is the link to auth.uid(); join
  -- through it to resolve the current user's account memberships.
  SELECT au.account_id
  FROM public.accounts_users au
  JOIN public.admin_profiles ap ON ap.id = au.admin_profile_id
  WHERE ap.user_id = auth.uid()
$$;

COMMENT ON FUNCTION public.user_account_ids() IS
  'Set of account_ids the current authenticated user is a member of.';

-- Returns the active account_id from the per-request GUC, or NULL if unset.
-- The API server sets this via SET LOCAL app.account_id = '...' at the
-- start of each user-scoped DB call (added in Session 5).
CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.account_id', true), '')::uuid
$$;

COMMENT ON FUNCTION public.current_account_id() IS
  'Reads the per-request app.account_id GUC; NULL when unset.';

-- Returns true iff the global tenancy_v2_enforced flag is set.
CREATE OR REPLACE FUNCTION public.tenancy_v2_enforced()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT value::boolean FROM public.platform_settings WHERE key = 'tenancy_v2_enforced'),
    false
  )
$$;

COMMENT ON FUNCTION public.tenancy_v2_enforced() IS
  'Reads the platform_settings tenancy_v2_enforced flag (default false).';

-- Convenience predicate: a row.account_id matches the current user's tenant.
-- Prefers the GUC fast-path; falls back to the membership subquery when
-- the GUC has not been set (legacy code paths during phase-1 rollout).
CREATE OR REPLACE FUNCTION public.account_in_scope(p_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT
    p_account_id IS NOT NULL
    AND (
      p_account_id = public.current_account_id()
      OR (
        public.current_account_id() IS NULL
        AND p_account_id IN (SELECT public.user_account_ids())
      )
    )
$$;

COMMENT ON FUNCTION public.account_in_scope(uuid) IS
  'True iff the row.account_id is in the current user''s scope (GUC or membership).';

-- =============================================================================
-- STEP 4: accounts_users self-select policy
-- =============================================================================
-- The existing accounts_users_select_admin policy only allows admins. With
-- user-scoped Supabase clients (Session 5), a regular user needs to be able
-- to read their own membership rows so user_account_ids() resolves under
-- RLS. We add a self-select policy that does not widen access — every user
-- still sees only their own rows.

CREATE POLICY "accounts_users_select_self"
  ON public.accounts_users FOR SELECT TO authenticated
  USING (
    admin_profile_id IN (
      SELECT id FROM public.admin_profiles WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- STEP 5: dual-track RLS on people
-- =============================================================================
-- Strategy: drop the existing select/insert/update/delete policies and
-- recreate them with the flag predicate. When flag=false (default), the
-- legacy email-equality / is_admin() rules apply. When flag=true, scope
-- by account_id via account_in_scope(). Existing rows with NULL account_id
-- are accessible only to admins under v2 — backfill assigns them before
-- the flag flips.

DROP POLICY IF EXISTS "people_select_own"   ON public.people;
DROP POLICY IF EXISTS "people_insert_admin" ON public.people;
DROP POLICY IF EXISTS "people_insert_self"  ON public.people;
DROP POLICY IF EXISTS "people_update_admin" ON public.people;
DROP POLICY IF EXISTS "people_update_own"   ON public.people;
DROP POLICY IF EXISTS "people_delete_admin" ON public.people;

-- v1 (flag off) — preserves prior behaviour exactly.
CREATE POLICY "people_select_v1"
  ON public.people FOR SELECT TO authenticated
  USING (
    NOT public.tenancy_v2_enforced()
    AND (email = (auth.jwt() ->> 'email') OR public.is_admin())
  );

CREATE POLICY "people_insert_admin_v1"
  ON public.people FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.tenancy_v2_enforced() AND public.is_admin()
  );

CREATE POLICY "people_insert_self_v1"
  ON public.people FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.tenancy_v2_enforced() AND email = (auth.jwt() ->> 'email')
  );

CREATE POLICY "people_update_admin_v1"
  ON public.people FOR UPDATE TO authenticated
  USING (
    NOT public.tenancy_v2_enforced() AND public.is_admin()
  );

CREATE POLICY "people_update_own_v1"
  ON public.people FOR UPDATE TO authenticated
  USING (
    NOT public.tenancy_v2_enforced() AND email = (auth.jwt() ->> 'email')
  );

CREATE POLICY "people_delete_admin_v1"
  ON public.people FOR DELETE TO authenticated
  USING (
    NOT public.tenancy_v2_enforced() AND public.is_admin()
  );

-- v2 (flag on) — account-scoped + super-admin override.
CREATE POLICY "people_select_v2"
  ON public.people FOR SELECT TO authenticated
  USING (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "people_insert_v2"
  ON public.people FOR INSERT TO authenticated
  WITH CHECK (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "people_update_v2"
  ON public.people FOR UPDATE TO authenticated
  USING (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  )
  WITH CHECK (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "people_delete_v2"
  ON public.people FOR DELETE TO authenticated
  USING (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

-- service_role bypass (always-on; legitimate escalation paths).
CREATE POLICY "people_service_role"
  ON public.people FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- STEP 6: dual-track RLS on email_logs
-- =============================================================================

DROP POLICY IF EXISTS "email_logs_select_admin"        ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_insert_admin"        ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_update_super_admin"  ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_delete_super_admin"  ON public.email_logs;

-- v1 — preserves the existing admin-only behaviour.
CREATE POLICY "email_logs_select_v1"
  ON public.email_logs FOR SELECT TO authenticated
  USING (NOT public.tenancy_v2_enforced() AND public.is_admin());

CREATE POLICY "email_logs_insert_v1"
  ON public.email_logs FOR INSERT TO authenticated
  WITH CHECK (NOT public.tenancy_v2_enforced() AND public.is_admin());

CREATE POLICY "email_logs_update_v1"
  ON public.email_logs FOR UPDATE TO authenticated
  USING (NOT public.tenancy_v2_enforced() AND public.is_super_admin());

CREATE POLICY "email_logs_delete_v1"
  ON public.email_logs FOR DELETE TO authenticated
  USING (NOT public.tenancy_v2_enforced() AND public.is_super_admin());

-- v2 — account-scoped.
CREATE POLICY "email_logs_select_v2"
  ON public.email_logs FOR SELECT TO authenticated
  USING (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "email_logs_insert_v2"
  ON public.email_logs FOR INSERT TO authenticated
  WITH CHECK (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "email_logs_update_v2"
  ON public.email_logs FOR UPDATE TO authenticated
  USING (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  )
  WITH CHECK (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "email_logs_delete_v2"
  ON public.email_logs FOR DELETE TO authenticated
  USING (
    public.tenancy_v2_enforced()
    AND (public.account_in_scope(account_id) OR public.is_super_admin())
  );

CREATE POLICY "email_logs_service_role"
  ON public.email_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

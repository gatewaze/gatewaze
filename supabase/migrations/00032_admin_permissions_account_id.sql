-- ============================================================================
-- 00032_admin_permissions_account_id
-- ============================================================================
-- Per spec-tenancy-v2 §6. Admin permissions (and grouped permissions) are
-- scoped per (admin_id, feature, account_id). The admin SPA at
-- packages/admin/src/lib/permissions/service.ts already upserts with
--   .upsert({admin_id, feature, account_id, …},
--           { onConflict: 'admin_id,feature,account_id' })
-- but no migration ever shipped the column. PostgREST rejected every save
-- with `PGRST204 Could not find the 'account_id' column of 'admin_permissions'`
-- and operators saw "permission isn't being saved" (skearns@linuxfoundation.org
-- on AAIF, 2026-06-04).
--
-- Add the column nullable so existing rows (single-account installs) keep
-- working with NULL = "all accounts".
--
-- Unique shape: a single UNIQUE INDEX over (admin_id, feature, account_id)
-- with `NULLS NOT DISTINCT` (PG 15+). The supabase client uses
-- `INSERT … ON CONFLICT (admin_id, feature, account_id)`; ON CONFLICT
-- requires a non-partial unique constraint/index whose columns match
-- exactly. Partial indexes split by `WHERE account_id IS NULL/NOT NULL`
-- don't satisfy that — Postgres returns 42P10 "no unique or exclusion
-- constraint matching the ON CONFLICT specification". NULLS NOT DISTINCT
-- makes (admin_id, feature, NULL) compare equal to another (admin_id,
-- feature, NULL) so the legacy "global" row still de-dupes correctly.
-- ============================================================================

-- admin_permissions ----------------------------------------------------------

ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- Drop the original UNIQUE (admin_id, feature) so the new (… , account_id)
-- shape can take over. The constraint name comes from CREATE TABLE in
-- 00002_admin.sql.
ALTER TABLE public.admin_permissions
  DROP CONSTRAINT IF EXISTS admin_permissions_admin_id_feature_key;

-- Drop any earlier-attempted partial indexes so re-running this migration
-- on a half-patched DB lands cleanly.
DROP INDEX IF EXISTS public.admin_permissions_admin_feature_global_idx;
DROP INDEX IF EXISTS public.admin_permissions_admin_feature_account_idx;

CREATE UNIQUE INDEX IF NOT EXISTS admin_permissions_admin_feature_account_uidx
  ON public.admin_permissions (admin_id, feature, account_id)
  NULLS NOT DISTINCT;

COMMENT ON COLUMN public.admin_permissions.account_id IS
  'Per-account scope. NULL = the permission applies to every account this admin can see (legacy single-account installs).';

-- admin_permission_group_assignments -----------------------------------------
-- service.ts also upserts admin_permission_group_assignments with
-- onConflict: 'admin_id,group_id,account_id', plus expires_at + is_active.
-- The deployed schema on AAIF only had (admin_id, group_id, assigned_by,
-- assigned_at) — three columns short.
--
-- Note: this is the assignment / join table. admin_permission_groups (the
-- group *definitions*) already has its own account_id from an earlier
-- migration; no work needed there.

DO $$
BEGIN
  IF to_regclass('public.admin_permission_group_assignments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admin_permission_group_assignments
             ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE';
    EXECUTE 'ALTER TABLE public.admin_permission_group_assignments
             ADD COLUMN IF NOT EXISTS expires_at timestamptz';
    EXECUTE 'ALTER TABLE public.admin_permission_group_assignments
             ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true';
    EXECUTE 'ALTER TABLE public.admin_permission_group_assignments
             DROP CONSTRAINT IF EXISTS admin_permission_group_assignments_admin_id_group_id_key';
    -- Drop the partial indexes from the first (broken) shape of this
    -- migration so re-applies converge.
    EXECUTE 'DROP INDEX IF EXISTS public.admin_perm_group_assign_admin_group_global_idx';
    EXECUTE 'DROP INDEX IF EXISTS public.admin_perm_group_assign_admin_group_account_idx';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS admin_perm_group_assign_admin_group_account_uidx
               ON public.admin_permission_group_assignments (admin_id, group_id, account_id)
               NULLS NOT DISTINCT';
    EXECUTE $c$COMMENT ON COLUMN public.admin_permission_group_assignments.account_id IS
             'Per-account scope. NULL = assignment applies to every account.'$c$;
  END IF;
END $$;

-- Tell PostgREST the schema changed so the new column is visible without
-- waiting for the next reload cycle.
NOTIFY pgrst, 'reload schema';

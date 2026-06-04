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
-- working with NULL = "all accounts". Same pattern for admin_permission_groups.
-- Re-shape the unique constraints so NULL account_id rows don't double-up
-- — Postgres treats NULLs as distinct in a regular UNIQUE, so we use two
-- partial unique indexes: one over (admin_id, feature) WHERE account_id IS
-- NULL (covers the "global" row) and one over (admin_id, feature, account_id)
-- WHERE account_id IS NOT NULL (covers per-account rows).
-- ============================================================================

-- admin_permissions ----------------------------------------------------------

ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- Drop the original UNIQUE (admin_id, feature) so the new (… , account_id)
-- shape can take over. The constraint name comes from CREATE TABLE in
-- 00002_admin.sql.
ALTER TABLE public.admin_permissions
  DROP CONSTRAINT IF EXISTS admin_permissions_admin_id_feature_key;

CREATE UNIQUE INDEX IF NOT EXISTS admin_permissions_admin_feature_global_idx
  ON public.admin_permissions (admin_id, feature)
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_permissions_admin_feature_account_idx
  ON public.admin_permissions (admin_id, feature, account_id)
  WHERE account_id IS NOT NULL;

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
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS admin_perm_group_assign_admin_group_global_idx
               ON public.admin_permission_group_assignments (admin_id, group_id)
               WHERE account_id IS NULL';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS admin_perm_group_assign_admin_group_account_idx
               ON public.admin_permission_group_assignments (admin_id, group_id, account_id)
               WHERE account_id IS NOT NULL';
    EXECUTE $c$COMMENT ON COLUMN public.admin_permission_group_assignments.account_id IS
             'Per-account scope. NULL = assignment applies to every account.'$c$;
  END IF;
END $$;

-- Tell PostgREST the schema changed so the new column is visible without
-- waiting for the next reload cycle.
NOTIFY pgrst, 'reload schema';

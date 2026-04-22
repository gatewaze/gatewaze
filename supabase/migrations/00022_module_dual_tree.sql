-- =============================================================================
-- 00022_module_dual_tree.sql
-- Supports spec-module-deployment-overhaul: separates upstream cache from
-- live serving tree. Adds snapshot metadata to installed_modules, a
-- module_updates_available table driven by the update-detection job, and
-- a rebuild counter sequence used by the in-container supervisor trigger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- installed_modules — snapshot metadata
-- -----------------------------------------------------------------------------

ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.module_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS source_snapshot_sha  text,
  ADD COLUMN IF NOT EXISTS snapshot_taken_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_rebuild_error   text;

-- Status values: enabled, disabled, error (existing) + orphaned, bundle_pending (new).
-- Drop the existing CHECK if any, recreate with the expanded set.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'installed_modules'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.installed_modules DROP CONSTRAINT %I', conname);
  END IF;
END$$;

ALTER TABLE public.installed_modules
  ADD CONSTRAINT installed_modules_status_check
  CHECK (status IN ('enabled', 'disabled', 'error', 'orphaned', 'bundle_pending'));

-- -----------------------------------------------------------------------------
-- module_updates_available — produced by check-module-updates job
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.module_updates_available (
  module_id            text         PRIMARY KEY REFERENCES public.installed_modules(id) ON DELETE CASCADE,
  source_id            uuid         NOT NULL REFERENCES public.module_sources(id) ON DELETE CASCADE,
  upstream_sha         text,
  upstream_hash        text         NOT NULL,
  upstream_version     text,
  detected_at          timestamptz  NOT NULL DEFAULT now(),
  platform_compatible  boolean      NOT NULL DEFAULT true,
  min_platform_version text
);

CREATE INDEX IF NOT EXISTS module_updates_available_source_idx
  ON public.module_updates_available (source_id);

ALTER TABLE public.module_updates_available ENABLE ROW LEVEL SECURITY;

-- Any authenticated admin UI user may read update availability.
DROP POLICY IF EXISTS "authenticated_select_module_updates" ON public.module_updates_available;
CREATE POLICY "authenticated_select_module_updates"
  ON public.module_updates_available FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "service_role_all_module_updates" ON public.module_updates_available;
CREATE POLICY "service_role_all_module_updates"
  ON public.module_updates_available FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- module_rebuild_counter — sequence bumped by POST /api/modules/rebuild
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.module_rebuild_counter
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- Accessible to service_role (API) for nextval; no direct UI access needed.

-- RPC wrapper so supabase-js can request nextval() without a raw SQL RPC.
CREATE OR REPLACE FUNCTION public.module_rebuild_next()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('public.module_rebuild_counter');
$$;

REVOKE ALL ON FUNCTION public.module_rebuild_next() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.module_rebuild_next() TO service_role;


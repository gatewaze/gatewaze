-- ============================================================================
-- Track per-module reconcile failures so one sloppy migration doesn't
-- silently break the whole module loop. Populated by the migration runner
-- in packages/shared/src/modules/migrations.ts.
-- ============================================================================

ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS last_reconcile_at timestamptz;

ALTER TABLE public.installed_modules
  ADD COLUMN IF NOT EXISTS reconcile_error jsonb;

COMMENT ON COLUMN public.installed_modules.last_reconcile_at IS
  'Timestamp of the most recent reconcile attempt for this module (success or failure).';

COMMENT ON COLUMN public.installed_modules.reconcile_error IS
  'Most recent reconcile failure for this module, or NULL if the last attempt succeeded. Shape: { phase: "migration"|"lifecycle", filename?: string, message: string, code?: string, occurred_at: string }';

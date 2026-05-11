-- ============================================================================
-- 00029_module_sources_origin_env — allow 'env' as a module_sources.origin
-- ============================================================================
--
-- The shared seeder (packages/shared/src/modules/lifecycle.ts) writes
-- `origin = 'env'` for MODULE_SOURCES env-var-supplied sources. The
-- constraint in migration 00020 didn't include 'env', so every API
-- startup logged constraint-violation errors for env-supplied sources
-- and the Modules admin page never saw them.
--
-- This migration extends the allowed set. Idempotent.
-- ============================================================================

ALTER TABLE public.module_sources DROP CONSTRAINT IF EXISTS module_sources_origin_check;
ALTER TABLE public.module_sources ADD CONSTRAINT module_sources_origin_check
  CHECK (origin IN ('config', 'user', 'upload', 'orphaned', 'env'));

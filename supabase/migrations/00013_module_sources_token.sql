-- =============================================================================
-- 00017_module_sources_token.sql
-- Add an optional access token column for private git repositories.
-- The token is used at clone/pull time and never exposed to the browser.
-- =============================================================================

ALTER TABLE public.module_sources
  ADD COLUMN IF NOT EXISTS token text;

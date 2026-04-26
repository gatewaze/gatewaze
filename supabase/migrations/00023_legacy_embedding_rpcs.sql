-- ============================================================================
-- Migration: 00023_legacy_embedding_rpcs
-- Description: Stub the embedding RPCs the legacy scheduler calls.
--
-- scripts/scheduler/EmbeddingScheduler.js (the cron entrypoint that ships
-- in the scheduler image's default CMD) calls two RPCs every 15 min and
-- every 30 min:
--
--   - get_pending_event_embeddings(max_count integer)
--   - get_customers_needing_embeddings(since_timestamp timestamptz)
--
-- These were originally defined in the gatewaze-admin repo alongside a
-- pgvector embedding queue + customer_embeddings tables. New brands
-- spun up against the gatewaze chart never inherit those migrations,
-- so the scheduler hammers Supabase with PGRST202 "function not found"
-- errors every loop.
--
-- This migration ships no-op stubs that return empty result sets,
-- silencing the noise without forcing every brand to provision the
-- pgvector / embedding-queue infra. Brands that DO want real embeddings
-- should replace these stubs with the full implementations from
-- gatewaze-admin/supabase/migrations/20250108010000_add_pgvector_embeddings.sql
-- and 20260206235125_add_event_embedding_queue_and_trigger.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_event_embeddings(max_count integer DEFAULT 50)
RETURNS TABLE (event_id uuid, priority integer, reason text)
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::uuid, NULL::integer, NULL::text WHERE false;
$$;

COMMENT ON FUNCTION public.get_pending_event_embeddings(integer)
  IS 'Stub. Replace with the full implementation if your brand uses pgvector event embeddings.';

CREATE OR REPLACE FUNCTION public.get_customers_needing_embeddings(since_timestamp timestamptz)
RETURNS TABLE (id bigint, email text, updated_at timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::bigint, NULL::text, NULL::timestamptz WHERE false;
$$;

COMMENT ON FUNCTION public.get_customers_needing_embeddings(timestamptz)
  IS 'Stub. Replace with the full implementation if your brand uses pgvector customer embeddings.';

-- Grant to service_role (the legacy scheduler authenticates as service_role)
-- and to authenticated for parity with the gatewaze-admin originals.
GRANT EXECUTE ON FUNCTION public.get_pending_event_embeddings(integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customers_needing_embeddings(timestamptz) TO service_role, authenticated;

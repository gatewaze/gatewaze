-- ============================================================================
-- Migration: 00001_foundation
-- Description: Foundation utilities and extensions required before any tables.
--
-- This migration enables extensions, creates schemas, and defines shared
-- utility functions that all subsequent migrations depend on.
--
-- Note: Core roles (anon, authenticated, service_role, supabase_admin,
-- supabase_auth_admin, supabase_storage_admin) and schemas (auth, storage,
-- extensions) are created by the Supabase postgres image's init-scripts.
-- ============================================================================

-- Schemas not created by the image by default
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS _realtime;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm"   WITH SCHEMA public;

-- ==========================================================================
-- Stub: auth.jwt() -- GoTrue/PostgREST creates this on startup, but we need
-- it available during migrations for RLS policies that reference JWT claims.
-- ==========================================================================
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

-- ==========================================================================
-- Utility: auto-update updated_at timestamp
-- Attach to any table with:
--   CREATE TRIGGER set_updated_at BEFORE UPDATE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.set_updated_at()
  IS 'Automatically sets updated_at to current timestamp on row update';

-- ============================================================================
-- Migration: 00001_initial_schema
-- Description: Enable additional extensions and create shared utility functions
--
-- Note: Core roles (anon, authenticated, service_role, supabase_admin,
-- supabase_auth_admin, supabase_storage_admin) and schemas (auth, storage,
-- extensions) are created by the Supabase postgres image's init-scripts.
-- ============================================================================

-- Create realtime schemas (not created by the image by default)
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS _realtime;

-- Enable additional extensions needed by Gatewaze
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA public;

-- ==========================================================================
-- Stub: auth.jwt() — GoTrue/PostgREST creates this on startup, but we need
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
-- Utility function: auto-update updated_at timestamp
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

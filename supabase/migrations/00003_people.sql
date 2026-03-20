-- ============================================================================
-- Migration: 00003_people
-- Description: Core people table — the single source of truth for all
--              platform users / community members.
--              Extended tables (profiles, badges, QR tokens, contact scans)
--              live in 00005_people_extended.sql (after the events table exists).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.people (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  text UNIQUE NOT NULL,
  first_name             text,
  last_name              text,
  full_name              text,
  avatar_url             text,
  company                text,
  job_title              text,
  location               text,
  bio                    text,
  linkedin_url           text,
  twitter_url            text,
  website_url            text,
  phone                  text,
  cio_id                 text UNIQUE,
  attributes             jsonb DEFAULT '{}'::jsonb,
  attribute_timestamps   jsonb DEFAULT '{}'::jsonb,
  auth_user_id           uuid REFERENCES auth.users(id),
  has_gravatar           boolean DEFAULT false,
  avatar_source          text,
  avatar_storage_path    text,
  avatar_updated_at      timestamptz,
  linkedin_avatar_url    text,
  last_synced_at         timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.people IS 'Platform users / community members';

CREATE INDEX IF NOT EXISTS idx_people_email     ON public.people (email);
CREATE INDEX IF NOT EXISTS idx_people_full_name ON public.people (full_name);
CREATE INDEX IF NOT EXISTS idx_people_cio_id    ON public.people (cio_id) WHERE cio_id IS NOT NULL;

CREATE TRIGGER people_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

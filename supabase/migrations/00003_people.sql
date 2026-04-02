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
  phone                  text,
  avatar_url             text,
  cio_id                 text UNIQUE,
  attributes             jsonb DEFAULT '{}'::jsonb,
  attribute_timestamps   jsonb DEFAULT '{}'::jsonb,
  auth_user_id           uuid REFERENCES auth.users(id),
  has_gravatar           boolean DEFAULT false,
  avatar_source          text,
  avatar_storage_path    text,
  avatar_updated_at      timestamptz,
  linkedin_avatar_url    text,
  is_guest               boolean DEFAULT false,
  last_synced_at         timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.people IS 'Platform users / community members. Profile fields (first_name, last_name, company, etc.) are stored in the attributes JSONB column.';

CREATE INDEX IF NOT EXISTS idx_people_email     ON public.people (email);
CREATE INDEX IF NOT EXISTS idx_people_cio_id    ON public.people (cio_id) WHERE cio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_attributes_gin ON public.people USING gin (attributes jsonb_path_ops);

CREATE TRIGGER people_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

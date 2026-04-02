-- ============================================================================
-- Migration: 00005_people_extended
-- Description: People-related extension tables that depend on the events table
--              (created in 00004_events.sql). Includes people profiles.
--
-- Note: Badge printing, QR access tokens, and contact scan tables have been
--       moved to the badge-scanning module.
-- Note: RLS policies for these tables live in 00007_rls_policies.sql.
-- ============================================================================

-- ==========================================================================
-- 1. people_profiles
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.people_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  qr_code_id            varchar(12) UNIQUE NOT NULL,
  qr_enabled            boolean DEFAULT true,
  profile_visibility    text CHECK (profile_visibility IN ('public', 'event_only', 'private')) DEFAULT 'event_only',
  allow_contact_sharing boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(person_id)
);

COMMENT ON TABLE public.people_profiles IS 'Extended profile for a person — QR identity, visibility prefs, contact-sharing opt-in.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_profiles_qr
  ON public.people_profiles (qr_code_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_profiles_person
  ON public.people_profiles (person_id);

CREATE TRIGGER people_profiles_updated_at
  BEFORE UPDATE ON public.people_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 2. people_profiles_with_people (VIEW)
-- ==========================================================================
CREATE OR REPLACE VIEW public.people_profiles_with_people AS
SELECT
  mp.id,
  mp.person_id,
  mp.qr_code_id,
  mp.qr_enabled,
  mp.profile_visibility,
  mp.allow_contact_sharing,
  mp.created_at  AS profile_created_at,
  mp.updated_at  AS profile_updated_at,
  c.cio_id,
  c.email,
  c.attributes->>'first_name'   AS first_name,
  c.attributes->>'last_name'    AS last_name,
  COALESCE(
    NULLIF(TRIM(COALESCE(c.attributes->>'first_name', '') || ' ' || COALESCE(c.attributes->>'last_name', '')), ''),
    c.attributes->>'first_name'
  ) AS full_name,
  c.attributes->>'company'      AS company,
  c.attributes->>'job_title'    AS job_title,
  c.phone,
  c.attributes->>'linkedin_url' AS linkedin_url,
  c.attributes->>'twitter_url'  AS twitter_handle,
  c.avatar_source,
  c.avatar_storage_path,
  c.linkedin_avatar_url,
  c.has_gravatar,
  c.avatar_url
FROM public.people_profiles mp
JOIN public.people c ON c.id = mp.person_id;

COMMENT ON VIEW public.people_profiles_with_people IS 'Convenience view joining people_profiles with the people table.';

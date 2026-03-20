-- ============================================================================
-- Migration: 00009_views
-- Description: Core database views for the platform.
--
-- Note: The people_profiles_with_people view is defined in
--       00005_people_extended.sql alongside its base tables.
--       Module-specific views (events_speakers_with_details,
--       events_talks_with_speakers) are created by the event-speakers
--       module migration.
-- ============================================================================

-- ==========================================================================
-- 1. events_registrations_with_people
-- Joins registrations with people data for convenient querying.
-- ==========================================================================
CREATE OR REPLACE VIEW public.events_registrations_with_people AS
SELECT
  r.*,
  p.email,
  p.first_name,
  p.last_name,
  p.full_name,
  p.company,
  p.job_title,
  p.linkedin_url,
  p.avatar_url,
  p.phone,
  p.location,
  p.cio_id,
  p.attributes AS people_attributes
FROM public.events_registrations r
LEFT JOIN public.people p ON p.id = r.person_id;

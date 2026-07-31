-- ============================================================================
-- 00042: people.contact_kind — lawful-basis discriminator for every contact
--
-- Separates consent-based community members from contacts stored under
-- legitimate interest, so bulk email paths can default-deny the latter:
--   'member'        — consented signup (LFID / magic link / forms). Default.
--   'event_contact' — registered for an event (contract basis): transactional
--                     and event email are fine; not marketing-consented.
--   'prospect'      — added by staff or imported (potential speakers/sponsors/
--                     experts, e.g. Apollo exports): legitimate interest, no
--                     opt-in. Excluded from bulk sends unless a send explicitly
--                     opts in (see broadcasts migration 014).
--
-- acquisition_source records provenance ("apollo_export_2026_07",
-- "sponsor_team", "conference_badges") — needed for GDPR Art. 14 notices
-- ("we obtained your details from …") and for answering complaints.
--
-- Conversion: a prospect who gets an auth account (LFID/magic-link signup —
-- auth_user_id linked) becomes 'member' via the trigger below; a prospect who
-- registers for an event becomes 'event_contact' via the events module's
-- migration 018 trigger. Kinds never downgrade automatically.
-- ============================================================================

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS contact_kind text NOT NULL DEFAULT 'member';
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS acquisition_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.people'::regclass AND conname = 'people_contact_kind_check'
  ) THEN
    ALTER TABLE public.people
      ADD CONSTRAINT people_contact_kind_check
      CHECK (contact_kind IN ('member', 'event_contact', 'prospect'));
  END IF;
END $$;

COMMENT ON COLUMN public.people.contact_kind IS
  'Lawful basis of the contact: member (consented signup), event_contact (event registration — contract), prospect (legitimate interest, no opt-in; excluded from bulk sends by default).';
COMMENT ON COLUMN public.people.acquisition_source IS
  'Where the contact came from (e.g. apollo_export_2026_07, sponsor_team, conference_badges) — provenance for GDPR Art. 14 notices.';

-- Non-members are the rare minority; partial index keeps kind filters cheap.
CREATE INDEX IF NOT EXISTS idx_people_contact_kind
  ON public.people (contact_kind) WHERE contact_kind <> 'member';
-- Case-insensitive email lookups (also used by the broadcast prospect gate).
CREATE INDEX IF NOT EXISTS idx_people_email_lower ON public.people (lower(email));

-- Conversion: linking an auth account means the person went through a real
-- signup (LFID / magic link — terms + consent flow), so a prospect becomes a
-- member. Fires on both fresh inserts and later linking (people-signup,
-- integrations-lfid-callback, ensure_person_for_auth_user all UPDATE or INSERT
-- auth_user_id). Never downgrades an existing member/event_contact.
CREATE OR REPLACE FUNCTION public.people_contact_kind_on_auth_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL AND NEW.contact_kind = 'prospect' THEN
    NEW.contact_kind := 'member';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS people_contact_kind_on_auth_link ON public.people;
CREATE TRIGGER people_contact_kind_on_auth_link
  BEFORE INSERT OR UPDATE OF auth_user_id ON public.people
  FOR EACH ROW
  EXECUTE FUNCTION public.people_contact_kind_on_auth_link();

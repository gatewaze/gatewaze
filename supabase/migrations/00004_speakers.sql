-- ============================================================================
-- Migration: 00004_speakers
-- Description: Speakers and the event-speaker junction table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.speakers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  email        text,
  title        text,
  company      text,
  bio          text,
  avatar_url   text,
  linkedin_url text,
  twitter_url  text,
  website_url  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.speakers IS 'Speaker profiles';

CREATE TRIGGER speakers_updated_at
  BEFORE UPDATE ON public.speakers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- Junction: event <-> speaker
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.event_speakers (
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  speaker_id    uuid NOT NULL REFERENCES public.speakers(id) ON DELETE CASCADE,
  role          text,
  display_order integer,
  PRIMARY KEY (event_id, speaker_id)
);

COMMENT ON TABLE public.event_speakers IS 'Links speakers to events with optional role and ordering';

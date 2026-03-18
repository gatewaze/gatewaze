-- ============================================================================
-- Migration: 00015_events_extended_v2
-- Description: Add entry_type to agenda entries, expand event_media for uploads,
--              add event_talks table for speaker talk management
-- ============================================================================

-- ==========================================================================
-- 1. Agenda entries: add entry_type and talk_id
-- ==========================================================================

ALTER TABLE public.event_agenda_entries ADD COLUMN IF NOT EXISTS entry_type text DEFAULT 'session'
  CHECK (entry_type IN ('session', 'break', 'spacer'));

-- ==========================================================================
-- 2. Expand event_media for file uploads
-- ==========================================================================

ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;
ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ==========================================================================
-- 3. Event talks (speaker submissions / session proposals)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_talks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title             text NOT NULL,
  synopsis          text,
  duration_minutes  integer DEFAULT 30,
  session_type      text DEFAULT 'talk'
    CHECK (session_type IN ('talk', 'panel', 'workshop', 'lightning', 'fireside', 'keynote')),
  status            text DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'approved', 'confirmed', 'reserve', 'rejected', 'placeholder')),
  sort_order        integer DEFAULT 0,
  is_featured       boolean DEFAULT false,
  event_sponsor_id  uuid REFERENCES public.event_sponsors(id) ON DELETE SET NULL,
  submitted_at      timestamptz DEFAULT now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  confirmation_token text,
  edit_token        text,
  presentation_url  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_talks_event ON public.event_talks (event_id);
CREATE INDEX IF NOT EXISTS idx_event_talks_status ON public.event_talks (status);

CREATE TRIGGER event_talks_updated_at
  BEFORE UPDATE ON public.event_talks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 4. Event talk speakers (junction: talks to speakers)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_talk_speakers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id     uuid NOT NULL REFERENCES public.event_talks(id) ON DELETE CASCADE,
  speaker_id  uuid NOT NULL REFERENCES public.speakers(id) ON DELETE CASCADE,
  role        text DEFAULT 'presenter'
    CHECK (role IN ('presenter', 'panelist', 'moderator', 'co_presenter', 'host')),
  is_primary  boolean DEFAULT true,
  sort_order  integer DEFAULT 0,
  UNIQUE (talk_id, speaker_id)
);

CREATE INDEX IF NOT EXISTS idx_event_talk_speakers_talk ON public.event_talk_speakers (talk_id);
CREATE INDEX IF NOT EXISTS idx_event_talk_speakers_speaker ON public.event_talk_speakers (speaker_id);

-- ==========================================================================
-- 5. Link agenda entries to talks
-- ==========================================================================

ALTER TABLE public.event_agenda_entries ADD COLUMN IF NOT EXISTS talk_id uuid
  REFERENCES public.event_talks(id) ON DELETE SET NULL;

-- ==========================================================================
-- 6. RLS for new tables
-- ==========================================================================

ALTER TABLE public.event_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_talk_speakers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_event_talks" ON public.event_talks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_event_talk_speakers" ON public.event_talk_speakers FOR SELECT TO anon USING (true);
CREATE POLICY "auth_all_event_talks" ON public.event_talks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_event_talk_speakers" ON public.event_talk_speakers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==========================================================================
-- 7. Add speaker_status to event_speakers for workflow management
-- ==========================================================================

ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmed'
  CHECK (status IN ('pending', 'approved', 'confirmed', 'reserve', 'rejected', 'placeholder'));
ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS company_logo_url text;
ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS member_profile_id uuid;

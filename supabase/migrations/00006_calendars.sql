-- ============================================================================
-- Migration: 00006_calendars
-- Description: Calendars and the calendar-event junction table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id text UNIQUE,
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  image_url   text,
  is_public   boolean NOT NULL DEFAULT true,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.calendars IS 'Curated event calendars';

CREATE TRIGGER calendars_updated_at
  BEFORE UPDATE ON public.calendars
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- Auto-generate calendar_id (CAL-XXXXXXXX) when not provided
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.generate_calendar_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.calendar_id IS NULL OR NEW.calendar_id = '' THEN
    NEW.calendar_id := 'CAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calendars_generate_calendar_id
  BEFORE INSERT ON public.calendars
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_calendar_id();

-- ==========================================================================
-- Junction: calendar <-> event
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.calendar_events (
  calendar_id uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  PRIMARY KEY (calendar_id, event_id)
);

COMMENT ON TABLE public.calendar_events IS 'Links events to calendars';

-- ============================================================================
-- Migration: 00038_people_events
-- Description: Per-person behavioural/analytics event log.
--              Replaces the legacy Customer.io-backed `customer_events` table:
--              core edge functions (people-track-event) write events here as the
--              source of truth instead of forwarding them to Customer.io.
--
--              NB: distinct from the events MODULE (calendar events). This is a
--              lightweight behavioural event stream keyed to a person.
-- Note: RLS — service-role writes, admins read, denied to anon/other authed.
--       (Mirrors the service-role-only pattern in 00025_silent_table_policies.sql.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.people_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid REFERENCES public.people(id) ON DELETE CASCADE,
  email         text NOT NULL,
  event_name    text NOT NULL,
  event_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  source        text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.people_events IS 'Per-person behavioural/analytics event log. Written by core edge functions (people-track-event) as the source of truth; replaces the legacy Customer.io customer_events table.';

CREATE INDEX IF NOT EXISTS idx_people_events_person   ON public.people_events (person_id);
CREATE INDEX IF NOT EXISTS idx_people_events_email    ON public.people_events (email);
CREATE INDEX IF NOT EXISTS idx_people_events_name     ON public.people_events (event_name);
CREATE INDEX IF NOT EXISTS idx_people_events_occurred ON public.people_events (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: service-role writes, admins read, everyone else denied.
-- ---------------------------------------------------------------------------
ALTER TABLE public.people_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "people_events_select_admin"
  ON public.people_events FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "people_events_deny_anon"
  ON public.people_events FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "people_events_service_role"
  ON public.people_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

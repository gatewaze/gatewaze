-- ============================================================================
-- Migration: 00008_registrations
-- Description: Event registrations linking events to customers
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'attended', 'no_show')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  cancelled_at  timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_registrations IS 'Tracks attendee registrations for events';

-- Each customer can register for an event only once
ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS uq_event_registrations_event_customer;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT uq_event_registrations_event_customer
  UNIQUE (event_id, customer_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id    ON public.event_registrations (event_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_customer_id ON public.event_registrations (customer_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_status      ON public.event_registrations (status);

-- Updated-at trigger
CREATE TRIGGER event_registrations_updated_at
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

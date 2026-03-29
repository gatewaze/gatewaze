-- Integration events outbox table
-- Core functions write events here; integration modules consume them.
-- This decouples core logic from specific integrations (Customer.io, etc.)

CREATE TABLE IF NOT EXISTS public.integration_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    text NOT NULL,       -- e.g. 'person.created', 'person.updated', 'event.registered'
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count   int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

CREATE INDEX idx_integration_events_pending
  ON public.integration_events (created_at)
  WHERE status = 'pending';

-- Auto-cleanup: drop completed events older than 7 days
CREATE OR REPLACE FUNCTION clean_old_integration_events() RETURNS void AS $$
BEGIN
  DELETE FROM public.integration_events
  WHERE status = 'completed' AND processed_at < now() - interval '7 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE public.integration_events IS 'Outbox for integration events. Core functions emit events; modules consume them.';

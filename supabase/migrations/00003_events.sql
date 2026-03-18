-- ============================================================================
-- Migration: 00003_events
-- Description: Core events table matching TechTickets schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 varchar(10) NOT NULL UNIQUE,
  event_title              varchar(255) NOT NULL,
  event_description        text,
  listing_intro            varchar(255),
  offer_result             varchar(255),
  offer_close_display      varchar(500),
  event_topics             text[],
  offer_ticket_details     text,
  offer_value              varchar(500),
  event_city               varchar(100),
  event_country_code       varchar(2),
  event_link               text,
  event_logo               text,
  offer_slug               varchar(500),
  offer_close_date         timestamptz,
  event_start              timestamptz,
  event_end                timestamptz,
  listing_type             varchar(500),
  event_region             varchar(2),
  event_location           varchar(500),
  event_topics_updated_at  bigint,
  event_type               varchar(500),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  screenshot_generated     boolean DEFAULT false,
  screenshot_generated_at  timestamptz,
  screenshot_url           text,
  source_type              varchar(20) DEFAULT 'manual',
  source_details           jsonb DEFAULT '{}'::jsonb,
  added_at                 timestamptz DEFAULT now(),
  last_updated_at          timestamptz,
  last_scraped_at          timestamptz,
  venue_address            text,
  scraped_by               text,
  scraper_id               integer,
  event_source_url         text,
  event_source_name        text,
  status                   varchar(20) DEFAULT 'incomplete',
  account_id               uuid,
  account                  text,
  offer_beta               boolean DEFAULT false,
  is_live_in_production    boolean NOT NULL DEFAULT true,
  checkin_qr_code          text,
  badge_logo               text
);

COMMENT ON TABLE public.events IS 'Events managed on the platform';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_status     ON public.events (status);
CREATE INDEX IF NOT EXISTS idx_events_start      ON public.events (event_start);
CREATE INDEX IF NOT EXISTS idx_events_event_id   ON public.events (event_id);
CREATE INDEX IF NOT EXISTS idx_events_link       ON public.events (event_link);

-- Updated-at trigger
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Event ID generation is handled in the application layer (API/scrapers)
-- matching the original gatewaze-admin approach:
-- 3-4 random lowercase letters + remaining digits, shuffled to 6 chars

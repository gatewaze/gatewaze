-- ============================================================================
-- Migration: 00004_events
-- Description: Core events tables only. Module-specific tables (speakers,
--              agenda, sponsors, discounts, budget, media) are created by
--              their respective module migrations.
--              Runs after 00003_people.sql (people table) and before
--              00005_people_extended.sql.
-- ============================================================================

-- ==========================================================================
-- 1. events
-- ==========================================================================

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
  account_id               uuid,          -- FK added in 00006_platform.sql after accounts table exists
  account                  text,
  offer_beta               boolean DEFAULT false,
  is_live_in_production    boolean NOT NULL DEFAULT true,
  checkin_qr_code          text,
  badge_logo               text,
  event_timezone           varchar(100) DEFAULT 'UTC',
  source_event_id          text,
  gradient_color_1         text,
  gradient_color_2         text,
  gradient_color_3         text,
  event_featured_image     text,
  enable_registration      boolean DEFAULT true,
  enable_native_registration boolean DEFAULT false,
  walkins_allowed          boolean DEFAULT false,
  register_button_text     text,
  enable_call_for_speakers boolean DEFAULT false,
  enable_agenda            boolean DEFAULT false,
  enable_interest          boolean DEFAULT false,
  is_live                  boolean,
  talk_duration_options    jsonb,
  page_content             text,
  addedpage_title          text,
  addedpage_content        text,
  venue_content            text,
  venue_map_image          text,
  luma_event_id            text,
  gradual_eventslug        text,
  event_source             text,
  cvent_event_id           text,
  cvent_event_code         text,
  cvent_admission_item_id  text,
  cvent_sync_enabled       boolean DEFAULT false,
  custom_domain            text,
  custom_domain_status     text,
  custom_domain_verified   boolean DEFAULT false,
  custom_domain_verified_at timestamptz,
  is_listed                boolean NOT NULL DEFAULT true,
  luma_page_data           jsonb,
  meetup_page_data         jsonb,
  luma_processed_html      text,
  meetup_processed_html    text,
  luma_processing_status   text
    CHECK (luma_processing_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  luma_processed_at        timestamptz,
  luma_processing_error    text,
  luma_page_data_hash      text,
  event_slug               text,
  event_latitude           double precision,
  event_longitude          double precision,
  recommended_event_id     uuid,
  account_id_text          text,
  -- Portal theme columns
  portal_theme             text,
  theme_colors             jsonb
);

-- Self-referencing FK for recommended_event_id
ALTER TABLE public.events
  ADD CONSTRAINT events_recommended_event_id_fkey
  FOREIGN KEY (recommended_event_id) REFERENCES public.events(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_start ON public.events (event_start);
CREATE INDEX IF NOT EXISTS idx_events_event_id ON public.events (event_id);
CREATE INDEX IF NOT EXISTS idx_events_link ON public.events (event_link);
CREATE INDEX IF NOT EXISTS idx_events_city ON public.events (event_city);
CREATE INDEX IF NOT EXISTS idx_events_country_code ON public.events (event_country_code);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON public.events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_source_type ON public.events (source_type);
CREATE INDEX IF NOT EXISTS idx_events_event_slug ON public.events (event_slug);
CREATE INDEX IF NOT EXISTS idx_events_luma_event_id ON public.events (luma_event_id);
CREATE INDEX IF NOT EXISTS idx_events_is_listed ON public.events (is_listed) WHERE is_listed = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_custom_domain ON public.events (custom_domain) WHERE custom_domain IS NOT NULL;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.events IS 'Core events table containing all event configuration, metadata, and portal settings.';

-- ==========================================================================
-- 2. events_registrations
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.events_registrations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id               uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'confirmed', 'cancelled', 'attended', 'no_show', 'waitlisted')),
  registered_at           timestamptz NOT NULL DEFAULT now(),
  checked_in              boolean DEFAULT false,
  checked_in_at           timestamptz,
  cancelled_at            timestamptz,
  notes                   text,
  people_profile_id       uuid,
  registration_source     text,
  registration_metadata   jsonb,
  registration_answers    jsonb,
  registration_type       text
    CHECK (registration_type IN ('free', 'paid', 'comp', 'sponsor', 'speaker', 'staff', 'vip')),
  ticket_type             text,
  payment_status          text
    CHECK (payment_status IN ('pending', 'paid', 'refunded', 'waived')),
  amount_paid             numeric(10, 2),
  currency                text,
  calendar_added_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events_registrations
  ADD CONSTRAINT uq_events_registrations_event_person UNIQUE (event_id, person_id);

CREATE INDEX IF NOT EXISTS idx_events_registrations_event_id ON public.events_registrations (event_id);
CREATE INDEX IF NOT EXISTS idx_events_registrations_person_id ON public.events_registrations (person_id);
CREATE INDEX IF NOT EXISTS idx_events_registrations_status ON public.events_registrations (status);

CREATE TRIGGER events_registrations_updated_at
  BEFORE UPDATE ON public.events_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.events_registrations IS 'Event registration records linking people to events with status tracking.';

-- ==========================================================================
-- 3. events_attendance
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.events_attendance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id             uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  registration_id       uuid REFERENCES public.events_registrations(id) ON DELETE SET NULL,
  people_profile_id     uuid,
  check_in_method       text CHECK (check_in_method IN ('qr_scan', 'manual_entry', 'badge_scan', 'mobile_app', 'sponsor_booth')),
  check_in_location     text,
  checked_in_at         timestamptz NOT NULL DEFAULT now(),
  checked_in_by         uuid,
  checked_out_at        timestamptz,
  sessions_attended     text[],
  attendance_metadata   jsonb,
  full_name             text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_attendance_event ON public.events_attendance (event_id);
CREATE INDEX IF NOT EXISTS idx_events_attendance_person ON public.events_attendance (person_id);
CREATE INDEX IF NOT EXISTS idx_events_attendance_checkin ON public.events_attendance (checked_in_at);

COMMENT ON TABLE public.events_attendance IS 'Check-in and attendance records for event participants.';

-- ==========================================================================
-- 4. registration_field_mappings
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.registration_field_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_label    text NOT NULL,
  source_question_type text,
  target_type     text NOT NULL DEFAULT 'customer_attribute',
  target_field    text NOT NULL,
  transform       text NOT NULL DEFAULT 'direct',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_field_mappings_event ON public.registration_field_mappings(event_id);

CREATE TRIGGER registration_field_mappings_updated_at
  BEFORE UPDATE ON public.registration_field_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.registration_field_mappings IS 'Maps registration form fields to people attributes or registration fields.';

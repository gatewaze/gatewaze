-- ============================================================================
-- Migration: 00014_events_extended
-- Description: Extended events columns and related tables
--              Matches TechTickets schema + useful additions
-- ============================================================================

-- ==========================================================================
-- 1. Additional columns matching TechTickets schema
-- ==========================================================================

-- Timezone & description extras
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_timezone varchar(100) DEFAULT 'UTC';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS source_event_id text;

-- Appearance
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gradient_color_1 text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gradient_color_2 text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gradient_color_3 text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS featured_image text;

-- Registration & engagement
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS enable_registration boolean DEFAULT true;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS enable_native_registration boolean DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS walkins_allowed boolean DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS register_button_text text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS enable_call_for_speakers boolean DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS enable_agenda boolean DEFAULT false;

-- Speaker submission config
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS talk_duration_options jsonb;

-- Page content
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS page_content text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS addedpage_title text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS addedpage_content text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_content text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_map_image text;

-- Integrations
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_event_id text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gradual_eventslug text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS custom_domain_status text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_source text;

-- Scraped data
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_page_data jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS meetup_page_data jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_processed_html text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS meetup_processed_html text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_processing_status text
  CHECK (luma_processing_status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_processed_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_processing_error text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS luma_page_data_hash text;

-- Topics
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS recommended_event_id uuid REFERENCES public.events(id);

-- Slug
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slug text;

-- Account association
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS account_id_text text;

-- Cvent integration
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cvent_event_id text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cvent_event_code text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cvent_admission_item_id text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cvent_sync_enabled boolean DEFAULT false;

-- Useful additions (not in original TechTickets but needed for new features)
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS longitude double precision;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_city ON public.events (event_city);
CREATE INDEX IF NOT EXISTS idx_events_country_code ON public.events (event_country_code);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON public.events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_source_type ON public.events (source_type);
CREATE INDEX IF NOT EXISTS idx_events_slug ON public.events (slug);
CREATE INDEX IF NOT EXISTS idx_events_luma_event_id ON public.events (luma_event_id);

-- ==========================================================================
-- 2. Event agenda tracks
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_agenda_tracks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_agenda_tracks_event ON public.event_agenda_tracks (event_id);

CREATE TRIGGER event_agenda_tracks_updated_at
  BEFORE UPDATE ON public.event_agenda_tracks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 3. Event agenda entries
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_agenda_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  track_id    uuid REFERENCES public.event_agenda_tracks(id) ON DELETE SET NULL,
  title       text NOT NULL,
  description text,
  start_time  timestamptz,
  end_time    timestamptz,
  location    text,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_agenda_entries_event ON public.event_agenda_entries (event_id);
CREATE INDEX IF NOT EXISTS idx_event_agenda_entries_track ON public.event_agenda_entries (track_id);

CREATE TRIGGER event_agenda_entries_updated_at
  BEFORE UPDATE ON public.event_agenda_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 4. Event agenda entry speakers (junction)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_agenda_entry_speakers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_entry_id uuid NOT NULL REFERENCES public.event_agenda_entries(id) ON DELETE CASCADE,
  speaker_id      uuid NOT NULL REFERENCES public.speakers(id) ON DELETE CASCADE,
  sort_order      integer DEFAULT 0,
  UNIQUE (agenda_entry_id, speaker_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_entry_speakers_entry ON public.event_agenda_entry_speakers (agenda_entry_id);
CREATE INDEX IF NOT EXISTS idx_agenda_entry_speakers_speaker ON public.event_agenda_entry_speakers (speaker_id);

-- ==========================================================================
-- 5. Sponsors
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.sponsors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text UNIQUE,
  logo_url      text,
  website       text,
  description   text,
  contact_email text,
  contact_phone text,
  social_links  jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sponsors_updated_at
  BEFORE UPDATE ON public.sponsors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 6. Event sponsors (junction)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_sponsors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sponsor_id        uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  sponsorship_tier  text CHECK (sponsorship_tier IN ('platinum', 'gold', 'silver', 'bronze', 'partner', 'exhibitor')),
  booth_number      text,
  booth_size        text,
  benefits          jsonb,
  custom_branding   jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, sponsor_id)
);

CREATE INDEX IF NOT EXISTS idx_event_sponsors_event ON public.event_sponsors (event_id);
CREATE INDEX IF NOT EXISTS idx_event_sponsors_sponsor ON public.event_sponsors (sponsor_id);

CREATE TRIGGER event_sponsors_updated_at
  BEFORE UPDATE ON public.event_sponsors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 7. Event attendance
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_attendance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  customer_id           uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  registration_id       uuid REFERENCES public.event_registrations(id) ON DELETE SET NULL,
  check_in_method       text CHECK (check_in_method IN ('qr_scan', 'manual_entry', 'badge_scan', 'mobile_app', 'sponsor_booth')),
  check_in_location     text,
  checked_in_at         timestamptz NOT NULL DEFAULT now(),
  checked_out_at        timestamptz,
  sessions_attended     text[],
  attendance_metadata   jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_attendance_event ON public.event_attendance (event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendance_customer ON public.event_attendance (customer_id);
CREATE INDEX IF NOT EXISTS idx_event_attendance_checkin ON public.event_attendance (checked_in_at);

-- ==========================================================================
-- 8. Discount codes
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code            text NOT NULL,
  description     text,
  discount_type   text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value  numeric(10, 2) NOT NULL,
  max_uses        integer,
  current_uses    integer NOT NULL DEFAULT 0,
  valid_from      timestamptz,
  valid_until     timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code)
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_event ON public.discount_codes (event_id);

CREATE TRIGGER discount_codes_updated_at
  BEFORE UPDATE ON public.discount_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 9. Event budget
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_budget_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category    text NOT NULL,
  description text,
  amount      numeric(10, 2) NOT NULL,
  type        text NOT NULL CHECK (type IN ('income', 'expense')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_budget_items_event ON public.event_budget_items (event_id);

CREATE TRIGGER event_budget_items_updated_at
  BEFORE UPDATE ON public.event_budget_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================================
-- 10. Event media
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.event_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  url         text NOT NULL,
  type        text NOT NULL CHECK (type IN ('image', 'video')),
  caption     text,
  album       text,
  sort_order  integer DEFAULT 0,
  sponsor_id  uuid REFERENCES public.sponsors(id) ON DELETE SET NULL,
  uploaded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_media_event ON public.event_media (event_id);

-- ==========================================================================
-- 11. Add discount_code_id and additional fields to event_registrations
-- ==========================================================================

ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS registration_type text
  CHECK (registration_type IN ('free', 'paid', 'comp', 'sponsor', 'speaker', 'staff', 'vip'));
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS ticket_type text;
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS payment_status text
  CHECK (payment_status IN ('pending', 'paid', 'refunded', 'waived'));
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS amount_paid numeric(10, 2);
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS discount_code_id uuid
  REFERENCES public.discount_codes(id) ON DELETE SET NULL;
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS badge_print_status text;
ALTER TABLE public.event_registrations ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ==========================================================================
-- 12. Add is_featured to event_speakers
-- ==========================================================================

ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS speaker_title text;
ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS speaker_bio text;
ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS speaker_topic text;
ALTER TABLE public.event_speakers ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;

-- ==========================================================================
-- 13. RLS policies for new tables
-- ==========================================================================

ALTER TABLE public.event_agenda_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_agenda_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_agenda_entry_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_media ENABLE ROW LEVEL SECURITY;

-- Anon read access for public-facing tables
CREATE POLICY "anon_read_agenda_tracks" ON public.event_agenda_tracks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_agenda_entries" ON public.event_agenda_entries FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_agenda_entry_speakers" ON public.event_agenda_entry_speakers FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_sponsors" ON public.sponsors FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "anon_read_event_sponsors" ON public.event_sponsors FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "anon_read_event_media" ON public.event_media FOR SELECT TO anon USING (true);

-- Authenticated full access for admin operations
CREATE POLICY "auth_all_agenda_tracks" ON public.event_agenda_tracks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_agenda_entries" ON public.event_agenda_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_agenda_entry_speakers" ON public.event_agenda_entry_speakers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_sponsors" ON public.sponsors FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_event_sponsors" ON public.event_sponsors FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_event_attendance" ON public.event_attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_discount_codes" ON public.discount_codes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_event_budget_items" ON public.event_budget_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_event_media" ON public.event_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
